import './test-env.setup';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { Role } from '@common/security/roles.enum';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { CatalogService } from '@modules/05-catalog/catalog.service';
import { CentralizedUnitsPricingService } from '@modules/05-catalog/centralized-units-pricing.service';
import { computeWeightedAvgPurchaseCost } from '@modules/05-catalog/costing.util';
import { PricingRoutingEngine } from '@modules/07-pricing/pricing-routing.engine';
import { CodVerificationService } from '@modules/11-cod-verification/cod-verification.service';
import { signQrTokenPayload } from '@modules/11-cod-verification/qr-crypto.util';
import { RedisService } from '@redis/redis.service';

describe('Phase 3: Centralized Product Units, Versioned Standard Pricing & Purchase-Driven Costing Engine', () => {
  const adminUser: AuthenticatedUser = {
    sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    role: Role.SUPER_ADMIN,
  };
  const merchantAUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const merchantABizId = '11111111-1111-4111-8111-111111111111';
  const merchantBUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const merchantBBizId = '22222222-2222-4222-8222-222222222222';

  const merchantATenant: TenantContext = {
    businessId: merchantABizId,
    merchantId: merchantABizId,
    tier: 'HYBRID_STORE',
    isPlatformManaged: true,
    geospatialMapEnabled: false,
    isSuperAdmin: false,
  };

  const merchantBTenant: TenantContext = {
    businessId: merchantBBizId,
    merchantId: merchantBBizId,
    tier: 'RETAIL_DUKA',
    isPlatformManaged: true,
    geospatialMapEnabled: false,
    isSuperAdmin: false,
  };

  it('defines product-specific Gunia/Debe conversions (Rice 1 Gunia = 25KG = 100Q vs Sugar 1 Gunia = 50KG = 200Q, Oil 250mL..20L Debe)', async () => {
    const productUnits: any[] = [];
    const systemUnits = new Map<string, any>([
      ['unit-gunia', { id: 'unit-gunia', unitCode: 'GUNIA', nameSw: 'Gunia', nameEn: 'Sack', isActive: true }],
      ['unit-debe', { id: 'unit-debe', unitCode: 'DEBE', nameSw: 'Debe', nameEn: '20L Tin', isActive: true }],
      ['unit-250ml', { id: 'unit-250ml', unitCode: 'ML250', nameSw: 'Robo Lita', nameEn: '250mL', isActive: true }],
    ]);

    const tx = {
      sokoGlobalCatalog: {
        findUnique: jest.fn(async ({ where }: any) => ({
          id: where.id,
          canonicalSku: where.id === 'cat-rice' ? 'GC-RICE' : 'GC-SUGAR',
          isActive: true,
        })),
      },
      systemUnit: {
        findUnique: jest.fn(async ({ where }: any) => systemUnits.get(where.id) ?? null),
      },
      globalProductUnit: {
        upsert: jest.fn(async ({ where, create }: any) => {
          const idx = productUnits.findIndex(
            (u) =>
              u.globalCatalogId === where.globalCatalogId_systemUnitId.globalCatalogId &&
              u.systemUnitId === where.globalCatalogId_systemUnitId.systemUnitId,
          );
          const record = {
            id: `gpu-${productUnits.length + 1}`,
            ...create,
            systemUnit: systemUnits.get(create.systemUnitId),
          };
          if (idx >= 0) productUnits[idx] = record;
          else productUnits.push(record);
          return record;
        }),
      },
    };

    const prisma = {
      runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      globalProductUnit: {
        findMany: jest.fn(async ({ where }: any) =>
          productUnits.filter((u) => u.globalCatalogId === where.globalCatalogId),
        ),
      },
    } as unknown as PrismaService;

    const service = new CentralizedUnitsPricingService(prisma, { enqueue: jest.fn() } as unknown as OutboxService);

    // Rice: 1 Gunia = 25 KG = 100 Quanta
    const riceGunia = await service.defineProductUnit('cat-rice', {
      systemUnitId: 'unit-gunia',
      quarterQuantaPerUnit: 100,
      displayLabelSw: 'Gunia 25 KG (Mchele)',
      isWholesaleUnit: true,
    });
    // Sugar: 1 Gunia = 50 KG = 200 Quanta
    const sugarGunia = await service.defineProductUnit('cat-sugar', {
      systemUnitId: 'unit-gunia',
      quarterQuantaPerUnit: 200,
      displayLabelSw: 'Gunia 50 KG (Sukari)',
      isWholesaleUnit: true,
    });
    // Cooking Oil: 250mL = 1Q, 20L Debe = 80Q
    const oilRobo = await service.defineProductUnit('cat-oil', {
      systemUnitId: 'unit-250ml',
      quarterQuantaPerUnit: 1,
      displayLabelSw: '250 mL',
      isWholesaleUnit: false,
    });
    const oilDebe = await service.defineProductUnit('cat-oil', {
      systemUnitId: 'unit-debe',
      quarterQuantaPerUnit: 80,
      displayLabelSw: 'Debe 20 L',
      isWholesaleUnit: true,
    });

    expect(riceGunia.quarterQuantaPerUnit).toBe(100);
    expect(sugarGunia.quarterQuantaPerUnit).toBe(200);
    expect(oilRobo.quarterQuantaPerUnit).toBe(1);
    expect(oilDebe.quarterQuantaPerUnit).toBe(80);
  });

  it('publishes versioned Admin Standard Pricing brackets without mutating existing Merchant overrides, supports tenant-isolated amendment & reset', async () => {
    const standardPrices: any[] = [];
    const merchantOverrides: any[] = [];
    const priceAuditLogs: any[] = [];
    const securityAuditLogs: any[] = [];

    const oilCatalogId = 'cat-oil-1';
    const oilUnitId = 'gpu-oil-250ml';
    const retailProfileId = 'prof-retail';
    const wholesaleProfileId = 'prof-wholesale';
    const cloneAId = 'clone-merchant-a';
    const cloneBId = 'clone-merchant-b';

    const tx = {
      sokoGlobalCatalog: {
        findUnique: jest.fn().mockResolvedValue({
          id: oilCatalogId,
          canonicalSku: 'GC-OIL-KORIE',
          imagekitCdnUrl: 'https://ik.imagekit.io/ochspoiwa/sokokuutz/oil.webp',
          clonedByStoresCount: 2n,
          isActive: true,
        }),
      },
      globalProductUnit: {
        findFirst: jest.fn().mockResolvedValue({
          id: oilUnitId,
          globalCatalogId: oilCatalogId,
          quarterQuantaPerUnit: 1,
          isActive: true,
          systemUnit: { unitCode: 'ML250' },
        }),
      },
      standardPricingProfile: {
        findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, isActive: true })),
      },
      globalCatalogStandardPrice: {
        aggregate: jest.fn(async ({ where }: any) => {
          const matching = standardPrices.filter(
            (p) =>
              p.globalCatalogId === where.globalCatalogId &&
              p.globalProductUnitId === where.globalProductUnitId &&
              p.profileType === where.profileType,
          );
          const maxV = matching.reduce((m, p) => Math.max(m, p.version), 0);
          return { _max: { version: maxV || null } };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const p of standardPrices) {
            if (
              p.globalCatalogId === where.globalCatalogId &&
              p.globalProductUnitId === where.globalProductUnitId &&
              p.profileType === where.profileType &&
              p.isActive
            ) {
              p.isActive = data.isActive;
              p.effectiveTo = data.effectiveTo;
              count += 1;
            }
          }
          return { count };
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `std-${standardPrices.length + 1}`,
            ...data,
            currency: 'TZS',
          };
          standardPrices.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          standardPrices.find((p) => p.id === where.id) ?? null,
        ),
        findFirst: jest.fn(async ({ where }: any) => {
          const list = standardPrices
            .filter(
              (p) =>
                p.globalCatalogId === where.globalCatalogId &&
                p.globalProductUnitId === where.globalProductUnitId &&
                (where.isActive === undefined || p.isActive === where.isActive),
            )
            .sort((a, b) => b.version - a.version || a.minQty - b.minQty);
          return list[0] ?? null;
        }),
        findMany: jest.fn(async ({ where }: any) =>
          standardPrices
            .filter(
              (p) =>
                p.globalCatalogId === where.globalCatalogId &&
                p.globalProductUnitId === where.globalProductUnitId &&
                p.profileType === where.profileType &&
                p.isActive &&
                p.minQty <= where.minQty.lte,
            )
            .sort((a, b) => b.version - a.version || b.minQty - a.minQty),
        ),
      },
      merchantClonedProduct: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id === cloneAId) {
            return {
              id: cloneAId,
              retailerBusinessId: merchantABizId,
              globalCatalogId: oilCatalogId,
            };
          }
          if (where.id === cloneBId) {
            return {
              id: cloneBId,
              retailerBusinessId: merchantBBizId,
              globalCatalogId: oilCatalogId,
            };
          }
          return null;
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      merchantUnitPricingOverride: {
        findUnique: jest.fn(async ({ where }: any) => {
          const k = where.clonedProductId_globalProductUnitId;
          return (
            merchantOverrides.find(
              (o) =>
                o.clonedProductId === k.clonedProductId &&
                o.globalProductUnitId === k.globalProductUnitId,
            ) ?? null
          );
        }),
        upsert: jest.fn(async ({ where, update, create }: any) => {
          const k = where.clonedProductId_globalProductUnitId;
          const idx = merchantOverrides.findIndex(
            (o) =>
              o.clonedProductId === k.clonedProductId &&
              o.globalProductUnitId === k.globalProductUnitId,
          );
          if (idx >= 0) {
            merchantOverrides[idx] = { ...merchantOverrides[idx], ...update };
            return merchantOverrides[idx];
          }
          const created = { id: `ovr-${merchantOverrides.length + 1}`, ...create };
          merchantOverrides.push(created);
          return created;
        }),
      },
      merchantPriceAuditLog: {
        create: jest.fn(async ({ data }: any) => {
          priceAuditLogs.push(data);
          return data;
        }),
      },
      securityAuditLog: {
        create: jest.fn(async ({ data }: any) => {
          securityAuditLogs.push(data);
          return data;
        }),
      },
    };

    const prisma = {
      runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
    } as unknown as PrismaService;

    const service = new CentralizedUnitsPricingService(prisma, { enqueue: jest.fn() } as unknown as OutboxService);
    const pricingEngine = new PricingRoutingEngine(prisma);

    // 1. Admin publishes Wholesale brackets v1: 1-9 = 1,500, 10-49 = 1,400, 50+ = 1,300
    const v1Batch = await service.publishStandardPrices(
      oilCatalogId,
      {
        prices: [
          {
            globalProductUnitId: oilUnitId,
            pricingProfileId: wholesaleProfileId,
            profileType: 'WHOLESALE',
            minQty: 1,
            maxQty: 9,
            standardPriceTzs: 1500,
          },
          {
            globalProductUnitId: oilUnitId,
            pricingProfileId: wholesaleProfileId,
            profileType: 'WHOLESALE',
            minQty: 10,
            maxQty: 49,
            standardPriceTzs: 1400,
          },
          {
            globalProductUnitId: oilUnitId,
            pricingProfileId: wholesaleProfileId,
            profileType: 'WHOLESALE',
            minQty: 50,
            maxQty: null,
            standardPriceTzs: 1300,
          },
        ],
      },
      adminUser,
    );
    expect(v1Batch.published.every((p) => p.version === 1)).toBe(true);

    // Retail standard pricing quote at qty 15 picks 1,400 TZS bracket
    const bracketQuote = await pricingEngine.evaluateStandardPricingQuote({
      globalCatalogId: oilCatalogId,
      globalProductUnitId: oilUnitId,
      quantity: 15,
      profileType: 'WHOLESALE',
    });
    expect(bracketQuote.unitPriceTzs).toBe(1400);
    expect(bracketQuote.lineTotalTzs).toBe(21000);

    // 2. Merchant A selects standard price, then amends exclusively for Merchant A (1,650 TZS)
    const selected = await service.selectOrAmendMerchantPrice(
      cloneAId,
      {
        globalProductUnitId: oilUnitId,
        standardPriceId: v1Batch.published[0].id,
      },
      { sub: merchantAUserId, role: Role.WHOLESALER },
      merchantATenant,
    );
    expect(selected.isOverridden).toBe(false);
    expect(selected.effectiveSellingPriceTzs).toBe(1500);

    const amended = await service.selectOrAmendMerchantPrice(
      cloneAId,
      {
        globalProductUnitId: oilUnitId,
        standardPriceId: v1Batch.published[0].id,
        amendedSellingPriceTzs: 1650,
      },
      { sub: merchantAUserId, role: Role.WHOLESALER },
      merchantATenant,
    );
    expect(amended.isOverridden).toBe(true);
    expect(amended.effectiveSellingPriceTzs).toBe(1650);

    // Cross-tenant Merchant B cannot amend Merchant A's override -> 403 Forbidden
    await expect(
      service.selectOrAmendMerchantPrice(
        cloneAId,
        {
          globalProductUnitId: oilUnitId,
          standardPriceId: v1Batch.published[0].id,
          amendedSellingPriceTzs: 999,
        },
        { sub: merchantBUserId, role: Role.RETAILER },
        merchantBTenant,
      ),
    ).rejects.toThrow(ForbiddenException);

    // 3. Admin publishes Wholesale v2 (1-9 = 1,550): v1 deactivated, v2 active, Merchant A override 1,650 preserved!
    const v2Batch = await service.publishStandardPrices(
      oilCatalogId,
      {
        prices: [
          {
            globalProductUnitId: oilUnitId,
            pricingProfileId: wholesaleProfileId,
            profileType: 'WHOLESALE',
            minQty: 1,
            maxQty: 9,
            standardPriceTzs: 1550,
          },
        ],
      },
      adminUser,
    );
    expect(v2Batch.published[0].version).toBe(2);
    expect(standardPrices.filter((p) => p.version === 1).every((p) => !p.isActive)).toBe(true);
    expect(merchantOverrides[0].effectiveSellingPriceTzs).toBe(1650n);
    expect(merchantOverrides[0].isOverridden).toBe(true);

    // Standard quote for Merchant B (no override) sees v2 1,550, while Merchant A sees override 1,650
    const quoteMerchantB = await pricingEngine.evaluateStandardPricingQuote({
      globalCatalogId: oilCatalogId,
      globalProductUnitId: oilUnitId,
      quantity: 5,
      profileType: 'WHOLESALE',
      clonedProductId: cloneBId,
    });
    expect(quoteMerchantB.unitPriceTzs).toBe(1550);
    expect(quoteMerchantB.merchantOverrideApplied).toBe(false);

    const quoteMerchantA = await pricingEngine.evaluateStandardPricingQuote({
      globalCatalogId: oilCatalogId,
      globalProductUnitId: oilUnitId,
      quantity: 5,
      profileType: 'WHOLESALE',
      clonedProductId: cloneAId,
    });
    expect(quoteMerchantA.unitPriceTzs).toBe(1650);
    expect(quoteMerchantA.merchantOverrideApplied).toBe(true);

    // 4. Merchant A resets to active platform standard -> cleanly reverts to v2 1,550 TZS + writes audit log
    const resetRes = await service.resetMerchantPriceToStandard(
      cloneAId,
      { globalProductUnitId: oilUnitId },
      { sub: merchantAUserId, role: Role.WHOLESALER },
      merchantATenant,
    );
    expect(resetRes.isOverridden).toBe(false);
    expect(resetRes.effectiveSellingPriceTzs).toBe(1550);
    expect(resetRes.standardPriceVersion).toBe(2);
    expect(priceAuditLogs.map((l) => l.action)).toEqual([
      'SELECT_STANDARD',
      'AMEND_PRICE',
      'RESET_TO_STANDARD',
    ]);
    expect(securityAuditLogs).toHaveLength(3);
  });

  it('keeps Base-Zero clone unstocked on ORDER_CONFIRMED and hydrates stock, lastBuying & weightedAvg cost only upon Dual-PIN/QR DELIVERED and External GOODS_RECEIVED', async () => {
    // Part A: Base-zero clone & external ORDER_CONFIRMED vs GOODS_RECEIVED weighted avg costing parity
    const cloneRow = {
      id: 'clone-rice-1',
      retailerBusinessId: merchantABizId,
      globalCatalogId: 'cat-rice-1',
      availableQuantaStock: 0,
      unitPriceTzs: 0n,
      inventoryValueTzs: 0n,
      lastBuyingPricePerQuantumTzs: 0n,
      weightedAvgBuyingCostPerQuantumTzs: 0n,
      buyingPriceEstablished: false,
      lastAgreedPurchasePriceTzs: null as bigint | null,
    };

    const externalReceipts: any[] = [];
    const tx = {
      sokoGlobalCatalog: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cat-rice-1',
          canonicalSku: 'GC-RICE-25',
          imagekitCdnUrl: 'https://ik.imagekit.io/ochspoiwa/sokokuutz/rice.webp',
          clonedByStoresCount: 1n,
          isActive: true,
        }),
      },
      merchantClonedProduct: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async () => cloneRow),
      },
      globalProductUnit: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({
          id: 'gpu-rice-gunia',
          globalCatalogId: 'cat-rice-1',
          quarterQuantaPerUnit: 100, // 25 KG = 100Q
          isActive: true,
        }),
      },
      globalCatalogStandardPrice: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn(async () => [
        {
          id: cloneRow.id,
          retailer_business_id: cloneRow.retailerBusinessId,
          global_catalog_id: cloneRow.globalCatalogId,
          available_quanta_stock: cloneRow.availableQuantaStock,
          weighted_avg_buying_cost_per_quantum_tzs: cloneRow.weightedAvgBuyingCostPerQuantumTzs,
          last_buying_price_per_quantum_tzs: cloneRow.lastBuyingPricePerQuantumTzs,
          buying_price_established: cloneRow.buyingPriceEstablished,
        },
      ]),
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        const sql = strings.join(' ');
        if (sql.includes('SET last_agreed_purchase_price_tzs') && !sql.includes('available_quanta_stock')) {
          cloneRow.lastAgreedPurchasePriceTzs = values[0];
        } else if (sql.includes('SET available_quanta_stock')) {
          cloneRow.availableQuantaStock = Number(values[0]);
          cloneRow.lastBuyingPricePerQuantumTzs = BigInt(values[1]);
          cloneRow.weightedAvgBuyingCostPerQuantumTzs = BigInt(values[2]);
          cloneRow.inventoryValueTzs = BigInt(values[3]);
          cloneRow.buyingPriceEstablished = true;
          cloneRow.lastAgreedPurchasePriceTzs = BigInt(values[4]);
        }
        return 1;
      }),
      externalPurchaseReceipt: {
        create: jest.fn(async ({ data }: any) => {
          const rec = { id: `ext-${externalReceipts.length + 1}`, ...data };
          externalReceipts.push(rec);
          return rec;
        }),
      },
      financialAuditLog: { create: jest.fn().mockResolvedValue({ id: 'fin-1' }) },
    };

    const prisma = {
      runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
    } as unknown as PrismaService;
    const outbox = { enqueue: jest.fn().mockResolvedValue({ id: 'out-1' }) } as unknown as OutboxService;

    const catalogService = new CatalogService(prisma, outbox);
    const unitsPricingService = new CentralizedUnitsPricingService(prisma, outbox);

    // 1. Base-Zero clone starts at 0 stock, 0 buying price, 0 selling price
    const cloned = await catalogService.cloneStandardCatalogItem(
      { globalCatalogId: 'cat-rice-1' },
      merchantATenant,
    );
    expect(cloned).toMatchObject({
      initializedStockQuanta: 0,
      initializedPriceTzs: 0,
      inventoryValueTzs: 0,
      lastBuyingPricePerQuantumTzs: 0,
      weightedAvgBuyingCostPerQuantumTzs: 0,
      buyingPriceEstablished: false,
    });

    // 2. ORDER_CONFIRMED records agreed cost without hydrating physical stock
    const confirmed = await unitsPricingService.recordExternalPurchaseReceipt(
      {
        clonedProductId: cloneRow.id,
        globalProductUnitId: 'gpu-rice-gunia',
        supplierName: 'Mbeya Millers',
        receiptStatus: 'ORDER_CONFIRMED',
        quantityUnits: 1,
        agreedTotalCostTzs: 50000,
      },
      { sub: merchantAUserId, role: Role.WHOLESALER },
      merchantATenant,
    );
    expect(confirmed).toMatchObject({
      receiptStatus: 'ORDER_CONFIRMED',
      stockHydrated: false,
      availableQuantaStock: 0,
      buyingPriceEstablished: false,
      lastAgreedPurchasePriceTzs: 50000,
    });

    // 3. First GOODS_RECEIVED: 1 Gunia (100Q) at 50,000 TZS -> 500 TZS/Q
    const recv1 = await unitsPricingService.recordExternalPurchaseReceipt(
      {
        clonedProductId: cloneRow.id,
        globalProductUnitId: 'gpu-rice-gunia',
        supplierName: 'Mbeya Millers',
        receiptStatus: 'GOODS_RECEIVED',
        quantityUnits: 1,
        agreedTotalCostTzs: 50000,
      },
      { sub: merchantAUserId, role: Role.WHOLESALER },
      merchantATenant,
    );
    expect(recv1).toMatchObject({
      stockHydrated: true,
      availableQuantaStock: 100,
      lastBuyingPricePerQuantumTzs: 500,
      weightedAvgBuyingCostPerQuantumTzs: 500,
      inventoryValueTzs: 50000,
      buyingPriceEstablished: true,
    });

    // 4. Second GOODS_RECEIVED: 1 Gunia (100Q) at 70,000 TZS -> lastBuying 700, weightedAvg 600, inventoryValue 120,000
    const recv2 = await unitsPricingService.recordExternalPurchaseReceipt(
      {
        clonedProductId: cloneRow.id,
        globalProductUnitId: 'gpu-rice-gunia',
        supplierName: 'Kariakoo Traders',
        receiptStatus: 'GOODS_RECEIVED',
        quantityUnits: 1,
        agreedTotalCostTzs: 70000,
      },
      { sub: merchantAUserId, role: Role.WHOLESALER },
      merchantATenant,
    );
    expect(recv2).toMatchObject({
      stockHydrated: true,
      availableQuantaStock: 200,
      lastBuyingPricePerQuantumTzs: 700,
      weightedAvgBuyingCostPerQuantumTzs: 600,
      inventoryValueTzs: 120000,
    });

    // Part B: Sokoni Marketplace Dual-PIN + QR DELIVERED updates buyer shelf stock & weighted avg buying cost
    const buyerPinHash = await argon2.hash('2468', { type: argon2.argon2id });
    const driverPinHash = await argon2.hash('1357', { type: argon2.argon2id });
    const qrSecret = 'test_qr_hmac_secret_with_at_least_32_bytes';
    const expiresAt = new Date(Date.now() + 180_000);
    const qrToken = 'SKQR-112233445566';
    const qrSig = signQrTokenPayload(qrSecret, 'ord-cod-1', qrToken, expiresAt.toISOString());

    const codClone = {
      availableQuantaStock: 200,
      weightedAvgBuyingCostPerQuantumTzs: 600n,
      lastBuyingPricePerQuantumTzs: 700n,
      inventoryValueTzs: 120000n,
    };

    const codTx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join(' ');
        if (sql.includes('FROM orders')) {
          return [
            {
              id: 'ord-cod-1',
              order_ref: 'SKCOST01',
              buyer_user_id: merchantAUserId,
              seller_business_id: 'wholesaler-1',
              driver_user_id: 'driver-1',
              status: 'DISPATCHED',
              expected_total_tzs: 90000n,
            },
          ];
        }
        return [
          {
            id: 'led-cod-1',
            order_id: 'ord-cod-1',
            driver_user_id: 'driver-1',
            one_time_qr_token: qrToken,
            qr_token_expires_at: expiresAt,
            qr_token_signature: qrSig,
            is_qr_token_consumed: false,
            buyer_confirmation_pin: buyerPinHash,
            driver_confirmation_pin: driverPinHash,
            is_buyer_confirmed: false,
            is_driver_confirmed: false,
            expected_cash_amount: 90000n,
            collected_cash_amount: 0n,
            payment_method: 'CASH',
            mobile_money_ref: null,
            mobile_money_verified: true,
            verification_status: 'WAITING',
          },
        ];
      }),
      businessProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: merchantABizId }),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            baseUnitsTotal: 100, // 100Q for 90,000 -> 900 TZS/Q
            lineTotalTzs: 90000n,
            product: { globalCatalogId: 'cat-rice-1' },
          },
        ]),
      },
      merchantClonedProduct: {
        findUnique: jest.fn().mockResolvedValue({
          availableQuantaStock: codClone.availableQuantaStock,
          weightedAvgBuyingCostPerQuantumTzs: codClone.weightedAvgBuyingCostPerQuantumTzs,
        }),
      },
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        if (strings.join(' ').includes('INSERT INTO merchant_cloned_products')) {
          codClone.availableQuantaStock += Number(values[2]);
          codClone.inventoryValueTzs = BigInt(values[3]);
          codClone.lastBuyingPricePerQuantumTzs = BigInt(values[4]);
          codClone.weightedAvgBuyingCostPerQuantumTzs = BigInt(values[5]);
        }
        return 1;
      }),
      financialAuditLog: { create: jest.fn().mockResolvedValue({ id: 'fin-cod-1' }) },
    };

    const codPrisma = {
      runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(codTx)),
      securityAuditLog: { create: jest.fn() },
    } as unknown as PrismaService;
    const codService = new CodVerificationService(
      codPrisma,
      outbox,
      { getClient: jest.fn().mockReturnValue({ status: 'wait' }) } as unknown as RedisService,
      { get: jest.fn().mockReturnValue(qrSecret) } as unknown as ConfigService,
    );

    const delivered = await codService.verifyDoorstepQr(
      {
        orderId: 'ord-cod-1',
        qrToken,
        qrSignature: qrSig,
        buyerPin: '2468',
        driverPin: '1357',
        collectedCashTzs: 90000,
      },
      { sub: 'driver-1', role: Role.DRIVER },
    );

    expect(delivered).toMatchObject({ status: 'DELIVERED', hydratedSkuCount: 1 });
    // Existing 200Q @ 600 + 100Q @ 900 = 210,000 / 300 = 700 TZS/Q weighted average!
    expect(codClone.availableQuantaStock).toBe(300);
    expect(codClone.lastBuyingPricePerQuantumTzs).toBe(900n);
    expect(codClone.weightedAvgBuyingCostPerQuantumTzs).toBe(700n);
    expect(codClone.inventoryValueTzs).toBe(210000n);

    // Sanity check direct helper parity
    const check = computeWeightedAvgPurchaseCost({
      existingStockQuanta: 200,
      existingWeightedAvgCostPerQuantumTzs: 600n,
      receivedQuanta: 100,
      agreedTotalCostTzs: 90000n,
    });
    expect(check.weightedAvgBuyingCostPerQuantumTzs).toBe(700n);
  });
});
