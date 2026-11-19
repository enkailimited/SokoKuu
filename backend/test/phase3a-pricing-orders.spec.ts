import './test-env.setup';
import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Role } from '@common/security/roles.enum';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { PricingRoutingEngine } from '@modules/07-pricing/pricing-routing.engine';
import { OrdersService } from '@modules/09-orders/orders.service';
import { AuditService } from '@modules/15-audit/audit.service';
import { RedisService } from '@redis/redis.service';

describe('Phase 3A: PricingRoutingEngine, Orders Idempotency, Bulk Reservation, Cancellation & Managed Interceptor', () => {
  const sellerId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const productId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const buyerUserId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  describe('PricingRoutingEngine & Channel Harmony', () => {
    it('switches HYBRID_STORE dynamically to wholesale pricing when Quarter-Quanta threshold is met', async () => {
      const tx = {
        businessProfile: {
          findUnique: jest.fn().mockResolvedValue({
            id: sellerId,
            businessName: 'Kariakoo Hybrid Merchant',
            tier: 'HYBRID_STORE',
            isOpen: true,
            isPlatformManaged: true,
          }),
        },
        product: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: productId,
              sellerBusinessId: sellerId,
              nameSw: 'Mchele Mbeya',
              nameEn: 'Mbeya Rice',
              cartonPriceTzs: 60000n,
              dozenPriceTzs: 30000n,
              packPriceTzs: 12000n,
              unitPriceTzs: 3200n,
              sealedParentUnitType: 'SACK_50KG',
              quantaPerSealedPackage: 200,
              wholesaleMinUnitsThreshold: 10,
              wholesaleMinWeightKg: 5,
              wholesaleMinQuarterQuanta: 20, // 5 KG = 20 Quarter-Quanta
              priceTiers: [
                {
                  unitType: 'SINGLE_KILO_LITRE',
                  quarterQuantaPerUnit: 4,
                  priceTzs: 3200n,
                  isWholesaleTier: false,
                  isActive: true,
                },
                {
                  unitType: 'SINGLE_KILO_LITRE',
                  quarterQuantaPerUnit: 4,
                  priceTzs: 2800n,
                  isWholesaleTier: true,
                  isActive: true,
                },
              ],
            },
          ]),
        },
      };

      const prisma = {
        runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      } as unknown as PrismaService;

      const engine = new PricingRoutingEngine(prisma);

      // 4 x 1KG = 16 quanta (< 20) -> Retail tier (3,200 TZS)
      const retailQuote = await engine.calculateOrderQuote({
        sellerBusinessId: sellerId,
        items: [{ productId, unitType: 'SINGLE_KILO_LITRE', quantity: 4 }],
      });
      expect(retailQuote.lines[0].isWholesaleTierApplied).toBe(false);
      expect(retailQuote.expectedTotalTzs).toBe(12800);

      // 5 x 1KG = 20 quanta (>= 20) -> Wholesale tier (2,800 TZS)
      const wholesaleQuote = await engine.calculateOrderQuote({
        sellerBusinessId: sellerId,
        items: [{ productId, unitType: 'SINGLE_KILO_LITRE', quantity: 5 }],
      });
      expect(wholesaleQuote.lines[0].isWholesaleTierApplied).toBe(true);
      expect(wholesaleQuote.expectedTotalTzs).toBe(14000);
    });

    it('rejects WHOLESALE retail fractions (422) and multi-seller basket mixing (422)', async () => {
      const tx = {
        businessProfile: {
          findUnique: jest.fn().mockResolvedValue({
            id: sellerId,
            businessName: 'Pure Wholesale Hub',
            tier: 'WHOLESALE',
            isOpen: true,
            isPlatformManaged: false,
          }),
        },
        product: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: productId,
              sellerBusinessId: sellerId,
              nameSw: 'Sukari',
              nameEn: 'Sugar',
              cartonPriceTzs: 48000n,
              dozenPriceTzs: 24000n,
              packPriceTzs: 10000n,
              unitPriceTzs: 2500n,
              sealedParentUnitType: 'SACK_50KG',
              quantaPerSealedPackage: 200,
              wholesaleMinUnitsThreshold: 1,
              wholesaleMinWeightKg: 1,
              wholesaleMinQuarterQuanta: 4,
              priceTiers: [],
            },
          ]),
        },
      };

      const prisma = {
        runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      } as unknown as PrismaService;
      const engine = new PricingRoutingEngine(prisma);

      await expect(
        engine.calculateOrderQuote({
          sellerBusinessId: sellerId,
          items: [{ productId, unitType: 'QUARTER_KILO_LITRE', quantity: 1 }],
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      // Multi-seller violation
      tx.product.findMany.mockResolvedValueOnce([
        {
          id: productId,
          sellerBusinessId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          nameSw: 'Sukari',
          nameEn: 'Sugar',
          cartonPriceTzs: 48000n,
          dozenPriceTzs: 24000n,
          packPriceTzs: 10000n,
          unitPriceTzs: 2500n,
          sealedParentUnitType: 'SACK_50KG',
          quantaPerSealedPackage: 200,
          wholesaleMinUnitsThreshold: 1,
          wholesaleMinWeightKg: 1,
          wholesaleMinQuarterQuanta: 4,
          priceTiers: [],
        },
      ]);

      await expect(
        engine.calculateOrderQuote({
          sellerBusinessId: sellerId,
          items: [{ productId, unitType: 'CARTON', quantity: 1 }],
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('OrdersService: Idempotency Replay, Auto Bulk-Break, Managed Routing & Lifecycle Transitions', () => {
    it('enforces X-Idempotency-Key replay without double-deducting stock and blocks mismatched payload (409)', async () => {
      let looseStock = 10;
      let sealedStock = 1;
      const idemStore = new Map<string, any>();
      const outboxEvents: any[] = [];
      const traces: any[] = [];

      const tx = {
        idempotencyKey: {
          findUnique: jest.fn(async ({ where }: any) => idemStore.get(where.scopeKey) ?? null),
          upsert: jest.fn(async ({ where, create }: any) => {
            idemStore.set(where.scopeKey, create);
            return create;
          }),
        },
        businessProfile: {
          findUnique: jest.fn().mockResolvedValue({
            id: sellerId,
            businessName: 'Ilala Managed Hub',
            tier: 'HYBRID_STORE',
            isOpen: true,
            isPlatformManaged: true,
          }),
        },
        product: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: productId,
              sellerBusinessId: sellerId,
              nameSw: 'Unga wa Sembe',
              nameEn: 'Maize Flour',
              cartonPriceTzs: 40000n,
              dozenPriceTzs: 20000n,
              packPriceTzs: 8000n,
              unitPriceTzs: 2000n,
              sealedParentUnitType: 'SACK_50KG',
              quantaPerSealedPackage: 200,
              wholesaleMinUnitsThreshold: 20,
              wholesaleMinWeightKg: 25,
              wholesaleMinQuarterQuanta: 100,
              priceTiers: [],
            },
          ]),
        },
        $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
          const sql = strings.join(' ');
          if (sql.includes('FOR UPDATE')) {
            return [
              {
                id: productId,
                seller_business_id: sellerId,
                name_sw: 'Unga wa Sembe',
                base_quarter_quanta_stock: looseStock,
                sealed_bulk_packages_stock: sealedStock,
                quanta_per_sealed_package: 200,
              },
            ];
          }
          if (sql.includes('SELECT base_quarter_quanta_stock')) {
            return [{ base_quarter_quanta_stock: looseStock }];
          }
          return [];
        }),
        $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
          const sql = strings.join(' ');
          if (sql.includes('CALL auto_break_bulk_package')) {
            sealedStock -= 1;
            looseStock += 200;
          } else if (sql.includes('UPDATE products')) {
            looseStock = Number(values[0]);
          }
          return 1;
        }),
        order: {
          create: jest.fn(async ({ data }: any) => ({
            id: data.id,
            orderRef: data.orderRef,
            placedAt: new Date(),
          })),
        },
        orderItem: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        orderDispatchAuditTrace: {
          create: jest.fn(async ({ data }: any) => {
            traces.push(data);
            return data;
          }),
        },
        financialAuditLog: {
          create: jest.fn().mockResolvedValue({ id: 'fin-1' }),
        },
      };

      const prisma = {
        runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      } as unknown as PrismaService;
      const outbox = {
        enqueue: jest.fn(async (ev: any) => {
          outboxEvents.push(ev);
          return { id: 'outbox-1' };
        }),
      } as unknown as OutboxService;
      const redis = { getClient: jest.fn().mockReturnValue({ status: 'wait' }) } as unknown as RedisService;
      const pricingEngine = new PricingRoutingEngine(prisma);
      const ordersService = new OrdersService(prisma, outbox, redis, pricingEngine);

      // 4 x SINGLE_KILO_LITRE = 16 quanta -> triggers auto_break_bulk_package (10 + 200 - 16 = 194 quanta)
      const firstReceipt = await ordersService.createOrder(
        {
          sellerBusinessId: sellerId,
          items: [{ productId, unitType: 'SINGLE_KILO_LITRE', quantity: 4 }],
        },
        'idem-order-key-001',
        { sub: buyerUserId, role: Role.RETAILER },
      );

      expect(firstReceipt.idempotentReplay).toBe(false);
      expect(firstReceipt.routingOutputCode).toBe('ROUTED_PLATFORM_MANAGED_HELPDESK');
      expect(firstReceipt.expectedTotalTzs).toBe(8000);
      expect(looseStock).toBe(194);
      expect(sealedStock).toBe(0);
      expect(traces[0].routingOutputCode).toBe('ROUTED_PLATFORM_MANAGED_HELPDESK');
      expect(outboxEvents[0].eventType).toBe('ManagedOrderRoutedEvent');

      // Duplicate idempotent retry -> exact replay, stock unchanged at 194
      const replayReceipt = await ordersService.createOrder(
        {
          sellerBusinessId: sellerId,
          items: [{ productId, unitType: 'SINGLE_KILO_LITRE', quantity: 4 }],
        },
        'idem-order-key-001',
        { sub: buyerUserId, role: Role.RETAILER },
      );

      expect(replayReceipt.idempotentReplay).toBe(true);
      expect(replayReceipt.orderId).toBe(firstReceipt.orderId);
      expect(looseStock).toBe(194);

      // Same idempotency key with DIFFERENT quantity -> HTTP 409 Conflict
      await expect(
        ordersService.createOrder(
          {
            sellerBusinessId: sellerId,
            items: [{ productId, unitType: 'SINGLE_KILO_LITRE', quantity: 5 }],
          },
          'idem-order-key-001',
          { sub: buyerUserId, role: Role.RETAILER },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('restores reserved Quarter-Quanta on PLACED -> CANCELLED and blocks DELIVERED -> CANCELLED (409)', async () => {
      let currentStock = 100;
      let orderStatus: 'PLACED' | 'DELIVERED' = 'PLACED';
      const orderId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

      const tx = {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
          const sql = strings.join(' ');
          if (sql.includes('FROM orders')) {
            return [
              {
                id: orderId,
                order_ref: 'SK882211',
                buyer_user_id: buyerUserId,
                seller_business_id: sellerId,
                driver_user_id: null,
                status: orderStatus,
                expected_total_tzs: 16000n,
              },
            ];
          }
          return [{ id: productId }];
        }),
        orderItem: {
          findMany: jest.fn().mockResolvedValue([{ productId, baseUnitsTotal: 16 }]),
        },
        $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
          const sql = strings.join(' ');
          if (sql.includes('UPDATE products')) {
            currentStock += Number(values[0]);
          }
          return 1;
        }),
        financialAuditLog: { create: jest.fn().mockResolvedValue({ id: 'fin-c1' }) },
      };

      const prisma = {
        runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      } as unknown as PrismaService;
      const outbox = { enqueue: jest.fn().mockResolvedValue({ id: 'o-c1' }) } as unknown as OutboxService;
      const redis = { getClient: jest.fn() } as unknown as RedisService;
      const engine = new PricingRoutingEngine(prisma);
      const ordersService = new OrdersService(prisma, outbox, redis, engine);

      const cancelled = await ordersService.cancelOrder(
        orderId,
        { reason: 'Customer changed mind' },
        { sub: buyerUserId, role: Role.RETAILER },
      );

      expect(cancelled.status).toBe('CANCELLED');
      expect(currentStock).toBe(116);

      // Invalid transition DELIVERED -> CANCELLED -> HTTP 409
      orderStatus = 'DELIVERED';
      await expect(
        ordersService.cancelOrder(
          orderId,
          { reason: 'Too late' },
          { sub: buyerUserId, role: Role.RETAILER },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('supports Admin Managed Helpdesk trace triage in AuditService', async () => {
      const traceId = '99999999-9999-9999-9999-999999999999';
      const tx = {
        orderDispatchAuditTrace: {
          findUnique: jest.fn().mockResolvedValue({
            id: traceId,
            orderId: 'order-1',
            helpdeskStatus: 'OPEN',
            handledNotes: null,
          }),
          update: jest.fn().mockResolvedValue({
            id: traceId,
            orderId: 'order-1',
            helpdeskStatus: 'RESOLVED',
            handledByAdminId: 'admin-1',
            handledNotes: 'Dispatched via Dar courier',
            handledAt: new Date(),
          }),
        },
        securityAuditLog: {
          create: jest.fn().mockResolvedValue({ id: 'sec-1' }),
        },
      };

      const prisma = {
        runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      } as unknown as PrismaService;
      const auditService = new AuditService(prisma);

      const res = await auditService.updateManagedOrderHelpdeskStatus(
        traceId,
        { helpdeskStatus: 'RESOLVED', notes: 'Dispatched via Dar courier' },
        'admin-1',
      );
      expect(res.helpdeskStatus).toBe('RESOLVED');
      expect(res.previousStatus).toBe('OPEN');
    });
  });
});
