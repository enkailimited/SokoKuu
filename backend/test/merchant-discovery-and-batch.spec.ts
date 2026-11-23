import './test-env.setup';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BusinessTier, OrderChannel, OrderMode, PackagingUnit } from '@prisma/client';
import { Role } from '@common/security/roles.enum';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { IdentityService } from '@modules/01-identity/identity.service';
import { CatalogService } from '@modules/05-catalog/catalog.service';
import { PricingRoutingEngine } from '@modules/07-pricing/pricing-routing.engine';
import { OrderModeDto } from '@modules/09-orders/dto/orders.dto';
import { OrdersService } from '@modules/09-orders/orders.service';
import { DispatchService } from '@modules/12-dispatch/dispatch.service';
import { OutboundSmsService } from '@modules/13-notifications/outbound-sms.service';
import { RedisService } from '@redis/redis.service';

describe('Localization Preferences, Smart Merchant Discovery & Batch Order Modes', () => {
  describe('IdentityService language preferences', () => {
    it('persists preferredLanguage via updatePreferences and exposes it in getMe', async () => {
      let storedLang = 'sw';
      const userId = '11111111-1111-1111-1111-111111111111';

      const mockPrisma = {
        user: {
          update: jest.fn(async ({ data }: any) => {
            storedLang = data.preferredLanguage;
            return {
              id: userId,
              preferredLocale: storedLang,
              preferredLanguage: storedLang,
            };
          }),
          findUnique: jest.fn(async () => ({
            id: userId,
            phoneE164: '+255712345678',
            fullName: 'Asha Juma',
            role: 'RETAILER',
            preferredLocale: storedLang,
            preferredLanguage: storedLang,
            isActive: true,
            createdAt: new Date(),
            ownedMerchants: [],
          })),
        },
      } as unknown as PrismaService;

      const identityService = new IdentityService(
        mockPrisma,
        { getClient: () => ({}) } as unknown as RedisService,
        {} as OutboxService,
        new JwtService({ secret: process.env.JWT_ACCESS_SECRET }),
        new ConfigService({ JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET }),
        {} as OutboundSmsService,
      );

      const initialMe = await identityService.getMe(userId);
      expect(initialMe.user.preferredLanguage).toBe('sw');

      const updated = await identityService.updatePreferences(userId, 'en');
      expect(updated.preferredLanguage).toBe('en');
      expect(updated.preferredLocale).toBe('en');

      const afterMe = await identityService.getMe(userId);
      expect(afterMe.user.preferredLanguage).toBe('en');
    });
  });

  describe('CatalogService.discoverMerchants', () => {
    it('matches active Merchants carrying any selected standard product and ranks by coverage then proximity', async () => {
      const catSugar = 'aaaa0001-0000-0000-0000-000000000001';
      const catRice = 'aaaa0002-0000-0000-0000-000000000002';
      const unitKgId = 'bbbb0001-0000-0000-0000-000000000001';
      const merchantFullId = 'cccc0001-0000-0000-0000-000000000001';
      const merchantPartialId = 'cccc0002-0000-0000-0000-000000000002';

      const mockPrisma = {
        businessProfile: {
          findUnique: jest.fn(async () => null),
          findMany: jest.fn(async () => [
            {
              id: merchantPartialId,
              businessName: 'Sinza Wholesalers',
              tier: BusinessTier.WHOLESALE,
              ward: 'Sinza',
              district: 'Ubungo',
              latitude: -6.78,
              longitude: 39.22,
              logoCdnUrl: 'https://cdn.example.com/sinza.jpg',
              offersFreeDelivery: false,
              isFreeDeliveryEnabled: false,
              freeDeliveryMinOrderTzs: 0n,
              standardDeliveryFeeTzs: 0n,
            },
            {
              id: merchantFullId,
              businessName: 'Kariakoo Hub',
              tier: BusinessTier.HYBRID_STORE,
              ward: 'Kariakoo',
              district: 'Ilala',
              latitude: -6.82,
              longitude: 39.27,
              logoCdnUrl: null,
              offersFreeDelivery: true,
              isFreeDeliveryEnabled: true,
              freeDeliveryMinOrderTzs: 0n,
              standardDeliveryFeeTzs: 0n,
            },
          ]),
        },
        sokoGlobalCatalog: {
          findMany: jest.fn(async () => [
            {
              id: catSugar,
              canonicalSku: 'SUG-1',
              fixedNameSw: 'Sukari Kilombero',
              fixedNameEn: 'Kilombero Sugar',
              imagekitCdnUrl: 'https://cdn.example.com/sugar.jpg',
              staticImageUrl: '/sugar.jpg',
              productUnits: [
                {
                  systemUnitId: unitKgId,
                  quarterQuantaPerUnit: 4,
                  displayLabelSw: '1 KG',
                  displayLabelEn: '1 KG',
                  systemUnit: { unitCode: 'KG', nameSw: 'Kilo 1', nameEn: '1 KG' },
                },
              ],
            },
            {
              id: catRice,
              canonicalSku: 'RIC-1',
              fixedNameSw: 'Mchele Mbeya',
              fixedNameEn: 'Mbeya Rice',
              imagekitCdnUrl: 'https://cdn.example.com/rice.jpg',
              staticImageUrl: '/rice.jpg',
              productUnits: [
                {
                  systemUnitId: unitKgId,
                  quarterQuantaPerUnit: 4,
                  displayLabelSw: '1 KG',
                  displayLabelEn: '1 KG',
                  systemUnit: { unitCode: 'KG', nameSw: 'Kilo 1', nameEn: '1 KG' },
                },
              ],
            },
          ]),
        },
        $queryRaw: jest.fn(async () => [
          { id: merchantPartialId, distance_km: 1.5 },
          { id: merchantFullId, distance_km: 3.1 },
        ]),
        product: {
          findMany: jest.fn(async () => [
            {
              id: 'prod-1',
              sellerBusinessId: merchantFullId,
              globalCatalogId: catSugar,
              baseQuarterQuantaStock: 200,
              sealedBulkPackagesStock: 0,
              quantaPerSealedPackage: 200,
              sealedParentUnitType: PackagingUnit.SACK_50KG,
              cartonPriceTzs: 120000n,
              dozenPriceTzs: 30000n,
              packPriceTzs: 12000n,
              unitPriceTzs: 3200n,
              wholesaleMinUnitsThreshold: 10,
              wholesaleMinQuarterQuanta: 40,
              wholesaleMinWeightKg: 10,
              priceTiers: [
                {
                  unitType: PackagingUnit.SINGLE_KILO_LITRE,
                  quarterQuantaPerUnit: 4,
                  priceTzs: 3200n,
                  isWholesaleTier: false,
                  isActive: true,
                },
              ],
            },
            {
              id: 'prod-2',
              sellerBusinessId: merchantFullId,
              globalCatalogId: catRice,
              baseQuarterQuantaStock: 200,
              sealedBulkPackagesStock: 0,
              quantaPerSealedPackage: 200,
              sealedParentUnitType: PackagingUnit.SACK_50KG,
              cartonPriceTzs: 100000n,
              dozenPriceTzs: 25000n,
              packPriceTzs: 10000n,
              unitPriceTzs: 2800n,
              wholesaleMinUnitsThreshold: 10,
              wholesaleMinQuarterQuanta: 40,
              wholesaleMinWeightKg: 10,
              priceTiers: [
                {
                  unitType: PackagingUnit.SINGLE_KILO_LITRE,
                  quarterQuantaPerUnit: 4,
                  priceTzs: 2800n,
                  isWholesaleTier: false,
                  isActive: true,
                },
              ],
            },
            {
              id: 'prod-3',
              sellerBusinessId: merchantPartialId,
              globalCatalogId: catSugar,
              baseQuarterQuantaStock: 400,
              sealedBulkPackagesStock: 10,
              quantaPerSealedPackage: 200,
              sealedParentUnitType: PackagingUnit.SACK_50KG,
              cartonPriceTzs: 115000n,
              dozenPriceTzs: 29000n,
              packPriceTzs: 11000n,
              unitPriceTzs: 3000n,
              wholesaleMinUnitsThreshold: 1,
              wholesaleMinQuarterQuanta: 4,
              wholesaleMinWeightKg: 1,
              priceTiers: [
                {
                  unitType: PackagingUnit.SACK_50KG,
                  quarterQuantaPerUnit: 200,
                  priceTzs: 115000n,
                  isWholesaleTier: true,
                  isActive: true,
                },
              ],
            },
          ]),
        },
        supplierCatalogListing: {
          findMany: jest.fn(async () => []),
        },
      } as unknown as PrismaService;

      const catalogService = new CatalogService(mockPrisma, {} as OutboxService);
      const res = await catalogService.discoverMerchants(
        {
          latitude: -6.816,
          longitude: 39.28,
          items: [
            { globalCatalogId: catSugar, systemUnitId: unitKgId, quantity: 2 },
            { globalCatalogId: catRice, systemUnitId: unitKgId, quantity: 1 },
          ],
        },
        { sub: 'buyer-1', role: Role.CONSUMER, businessId: null, tier: null, phoneE164: '+255712000000' },
      );

      expect(res.matchedMerchantsCount).toBe(2);
      // Kariakoo Hub carries both items -> ranked first despite larger distance
      expect(res.merchants[0].merchantId).toBe(merchantFullId);
      expect(res.merchants[0].matchedItems).toHaveLength(2);
      expect(res.merchants[0].missingItems).toHaveLength(0);
      expect(res.merchants[0].isFreeDeliveryEnabled).toBe(true);
      expect(res.merchants[0].merchantSubtotalTzs).toBe(2 * 3200 + 2800);

      // Sinza Wholesalers only carries Sugar and enforces SACK_50KG wholesale harmony
      expect(res.merchants[1].merchantId).toBe(merchantPartialId);
      expect(res.merchants[1].matchedItems).toHaveLength(1);
      expect(res.merchants[1].missingItems).toHaveLength(1);
      expect(res.merchants[1].missingItems[0].globalCatalogId).toBe(catRice);
    });
  });

  describe('OrdersService.submitBatchOrders & Scheduled Delivery Validation', () => {
    it('rejects past scheduledDeliveryDate and submits multi-merchant batch orders with unique per-seller idempotency keys', async () => {
      const ordersService = new OrdersService(
        {} as PrismaService,
        {} as OutboxService,
        { getClient: () => null } as unknown as RedisService,
        {} as PricingRoutingEngine,
        {} as DispatchService,
      );

      const createOrderSpy = jest
        .spyOn(ordersService, 'createOrder')
        .mockImplementation(async (dto, idemKey, user) => ({
          orderId: `ord-${dto.sellerBusinessId}`,
          orderRef: dto.sellerBusinessId.slice(0, 8).toUpperCase(),
          buyerUserId: user.sub,
          sellerBusinessId: dto.sellerBusinessId,
          status: 'PLACED',
          originChannel: 'PWA_ONLINE',
          orderChannel: dto.orderChannel ?? OrderChannel.RETAIL_MARKETPLACE,
          orderMode:
            dto.orderMode === OrderModeDto.SCHEDULED ? OrderMode.SCHEDULED : OrderMode.INSTANT,
          scheduledDeliveryDate: dto.scheduledDeliveryDate ?? null,
          routingOutputCode: 'ROUTED_DIRECT_MERCHANT_DB',
          targetPipeline: 'MERCHANT',
          expectedTotalTzs: 25000,
          deliveryFeeTzs: dto.deliveryFeeTzs ?? 0,
          paymentMethod: dto.paymentMethod ?? 'CASH',
          items: [],
          idempotentReplay: false,
          placedAtEat: new Date().toISOString(),
        }));

      const user = {
        sub: 'buyer-1',
        role: Role.RETAILER,
        businessId: 'buyer-biz-1',
        tier: 'RETAIL_DUKA' as const,
        phoneE164: '+255712111222',
      };

      await expect(
        ordersService.submitBatchOrders(
          {
            orderMode: OrderModeDto.SCHEDULED,
            scheduledDeliveryDate: '2020-01-01',
            orders: [
              {
                sellerBusinessId: '11111111-1111-1111-1111-111111111111',
                items: [
                  {
                    productId: '22222222-2222-2222-2222-222222222222',
                    unitType: PackagingUnit.CARTON,
                    quantity: 1,
                  },
                ],
              },
            ],
          },
          'batch-key-0001',
          user,
        ),
      ).rejects.toThrow(BadRequestException);

      const futureDate = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
      const batchResult = await ordersService.submitBatchOrders(
        {
          orderMode: OrderModeDto.SCHEDULED,
          scheduledDeliveryDate: futureDate,
          orders: [
            {
              sellerBusinessId: 'aaaa1111-1111-1111-1111-111111111111',
              items: [
                {
                  productId: '22222222-2222-2222-2222-222222222222',
                  unitType: PackagingUnit.CARTON,
                  quantity: 1,
                },
              ],
            },
            {
              sellerBusinessId: 'bbbb2222-2222-2222-2222-222222222222',
              items: [
                {
                  productId: '33333333-3333-3333-3333-333333333333',
                  unitType: PackagingUnit.UNIT,
                  quantity: 2,
                },
              ],
            },
          ],
        },
        'batch-key-0002',
        user,
      );

      expect(batchResult.batchCount).toBe(2);
      expect(batchResult.orderMode).toBe(OrderMode.SCHEDULED);
      expect(batchResult.scheduledDeliveryDate).toBe(futureDate);
      expect(batchResult.totalBatchTzs).toBe(50000);
      expect(createOrderSpy).toHaveBeenCalledTimes(2);
      expect(createOrderSpy.mock.calls[0][1]).toBe('batch-key-0002:0:aaaa1111');
      expect(createOrderSpy.mock.calls[1][1]).toBe('batch-key-0002:1:bbbb2222');
    });
  });
});
