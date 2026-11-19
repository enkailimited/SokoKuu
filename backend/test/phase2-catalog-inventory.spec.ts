import './test-env.setup';
import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { assertChannelHarmonyForTier } from '@modules/05-catalog/channel-harmony.policy';
import { CatalogService } from '@modules/05-catalog/catalog.service';
import { PackagingUnitDto } from '@modules/05-catalog/dto/catalog.dto';
import { PosPaymentMethod } from '@modules/06-inventory/dto/pos-sales.dto';
import { InventoryService } from '@modules/06-inventory/inventory.service';
import { kgToQuarterQuantaChecked } from '@modules/06-inventory/quarter-quanta.util';

describe('Phase 2: Master Catalog Cloning, Channel Harmony, Custom Units & Quarter-Quanta Bulk-Breaking', () => {
  describe('Channel Harmony Policy', () => {
    it('rejects WHOLESALE listing QUARTER_KILO_LITRE (Robo) fractions', () => {
      expect(() =>
        assertChannelHarmonyForTier({
          merchantTier: 'WHOLESALE',
          unitType: PackagingUnitDto.QUARTER_KILO_LITRE,
          isWholesaleTier: true,
        }),
      ).toThrow(UnprocessableEntityException);
    });

    it('rejects RETAIL_DUKA listing SACK_50KG wholesale bulk sacks', () => {
      expect(() =>
        assertChannelHarmonyForTier({
          merchantTier: 'RETAIL_DUKA',
          unitType: PackagingUnitDto.SACK_50KG,
          isWholesaleTier: true,
        }),
      ).toThrow(UnprocessableEntityException);
    });

    it('permits HYBRID_STORE to list both SACK_50KG wholesale and QUARTER_KILO_LITRE retail', () => {
      expect(() =>
        assertChannelHarmonyForTier({
          merchantTier: 'HYBRID_STORE',
          unitType: PackagingUnitDto.SACK_50KG,
          isWholesaleTier: true,
        }),
      ).not.toThrow();

      expect(() =>
        assertChannelHarmonyForTier({
          merchantTier: 'HYBRID_STORE',
          unitType: PackagingUnitDto.QUARTER_KILO_LITRE,
          isWholesaleTier: false,
        }),
      ).not.toThrow();
    });
  });

  describe('Quarter-Quanta Custom Unit Conversion (Debe, Sado, Dumu)', () => {
    it('maps Debe (20 KG), Sado (4 KG), and Robo (0.25 KG) strictly to integer Quarter-Quanta', () => {
      expect(kgToQuarterQuantaChecked(20)).toBe(80); // Debe
      expect(kgToQuarterQuantaChecked(4)).toBe(16); // Sado
      expect(kgToQuarterQuantaChecked(0.25)).toBe(1); // Robo
    });

    it('rejects non-0.25 fractional float values', () => {
      expect(() => kgToQuarterQuantaChecked(0.33)).toThrow(BadRequestException);
    });
  });

  describe('CatalogService Base-Zero Cloning & Idempotent Adoption Counter', () => {
    it('clones strictly at 0 stock & 0 TZS and avoids double-counting on idempotent replay', async () => {
      const clones = new Map<string, any>();
      let adoptionCount = 0n;
      const outboxEvents: any[] = [];

      const tx = {
        sokoGlobalCatalog: {
          findUnique: jest.fn(async () => ({
            id: 'global-1',
            canonicalSku: 'GC-AZN-WHEAT-2KG',
            imagekitCdnUrl: 'https://ik.imagekit.io/ochspoiwa/sokokuutz/catalog/wheat.webp',
            clonedByStoresCount: adoptionCount,
            isActive: true,
          })),
        },
        merchantClonedProduct: {
          findUnique: jest.fn(async ({ where }: any) => {
            const key = `${where.retailerBusinessId_globalCatalogId.retailerBusinessId}:${where.retailerBusinessId_globalCatalogId.globalCatalogId}`;
            return clones.get(key) ?? null;
          }),
          create: jest.fn(async ({ data }: any) => {
            const key = `${data.retailerBusinessId}:${data.globalCatalogId}`;
            const row = { id: 'clone-1', ...data };
            clones.set(key, row);
            // Simulate PostgreSQL trigger trg_increment_global_catalog_adoption
            adoptionCount += 1n;
            return row;
          }),
        },
      };

      const prisma = {
        runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      } as unknown as PrismaService;
      const outbox = {
        enqueue: jest.fn(async (evt: any) => {
          outboxEvents.push(evt);
          return { id: 'evt-1' };
        }),
      } as unknown as OutboxService;

      const catalogService = new CatalogService(prisma, outbox);
      const tenant = {
        businessId: 'retailer-1',
        merchantId: 'retailer-1',
        tier: 'RETAIL_DUKA' as const,
        isPlatformManaged: true,
        geospatialMapEnabled: false,
        isSuperAdmin: false,
      };

      const first = await catalogService.cloneStandardCatalogItem(
        { globalCatalogId: 'global-1' },
        tenant,
      );
      expect(first.initializedStockQuanta).toBe(0);
      expect(first.initializedPriceTzs).toBe(0);
      expect(first.updatedClonedByStoresCount).toBe(1);
      expect(first.idempotentReplay).toBe(false);
      expect(first.imagekitCdnUrl).toBe('https://ik.imagekit.io/ochspoiwa/sokokuutz/catalog/wheat.webp');

      const replay = await catalogService.cloneStandardCatalogItem(
        { globalCatalogId: 'global-1' },
        tenant,
      );
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.updatedClonedByStoresCount).toBe(1);
      expect(outboxEvents).toHaveLength(1);
    });
  });

  describe('InventoryService POS Sales & auto_break_bulk_package Conservation', () => {
    it('invokes auto_break_bulk_package, preserves exact Quarter-Quanta conservation, and emits BulkPackageBrokenEvent <= 160 chars', async () => {
      let looseQuanta = 4;
      let sealedPackages = 5;
      const quantaPerPkg = 200;
      const deconstructionLogs: any[] = [];
      const outboxEvents: any[] = [];

      const tx = {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
          const sql = strings.join(' ');
          if (sql.includes('FOR UPDATE')) {
            return [
              {
                id: 'prod-1',
                seller_business_id: 'retailer-1',
                name_sw: 'Sukari ya Kilombero',
                base_quarter_quanta_stock: looseQuanta,
                sealed_bulk_packages_stock: sealedPackages,
                quanta_per_sealed_package: quantaPerPkg,
                unit_price_tzs: 1000n,
              },
            ];
          }
          return [
            {
              base_quarter_quanta_stock: looseQuanta,
              sealed_bulk_packages_stock: sealedPackages,
            },
          ];
        }),
        $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
          const sql = strings.join(' ');
          if (sql.includes('CALL auto_break_bulk_package')) {
            const required = Number(values[1]);
            while (looseQuanta < required) {
              if (sealedPackages < 1) {
                throw new Error('INSUFFICIENT_SEALED_BULK (P0002)');
              }
              const before = looseQuanta;
              sealedPackages -= 1;
              looseQuanta += quantaPerPkg;
              deconstructionLogs.push({
                productId: 'prod-1',
                bulkPackagesBroken: 1,
                creditedQuarterQuanta: quantaPerPkg,
                looseQuantaBefore: before,
                looseQuantaAfter: looseQuanta,
              });
            }
            return 1;
          }
          if (sql.includes('UPDATE products')) {
            looseQuanta = Number(values[0]);
            return 1;
          }
          return 1;
        }),
        inventoryDeconstructionLog: {
          findMany: jest.fn(async () => deconstructionLogs),
        },
      };

      const prisma = {
        runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      } as unknown as PrismaService;
      const outbox = {
        enqueue: jest.fn(async (evt: any) => {
          outboxEvents.push(evt);
          return { id: `outbox-${outboxEvents.length}` };
        }),
      } as unknown as OutboxService;

      const inventoryService = new InventoryService(prisma, outbox);
      const tenant = {
        businessId: 'retailer-1',
        merchantId: 'retailer-1',
        tier: 'RETAIL_DUKA' as const,
        isPlatformManaged: true,
        geospatialMapEnabled: false,
        isSuperAdmin: false,
      };

      const receipt = await inventoryService.recordPosSale(
        {
          productId: 'prod-1',
          quantityRequested: 8,
          paymentMethod: PosPaymentMethod.M_PESA,
        },
        tenant,
      );

      // 4 initial + 200 credited (1 x 50KG sack broken) - 8 sold = 196 remaining; sealed 5 -> 4
      expect(receipt.statusSuccess).toBe(true);
      expect(receipt.bulkPackagesBroken).toBe(1);
      expect(receipt.remainingLooseQuanta).toBe(196);
      expect(receipt.remainingSealedPackages).toBe(4);
      // unit_price_tzs is per base unit (4 quarter-quanta); 8 quanta x 1000 / 4 = 2000.
      expect(receipt.totalTzs).toBe(2000);
      expect(deconstructionLogs).toHaveLength(1);
      expect(deconstructionLogs[0].looseQuantaBefore).toBe(4);
      expect(deconstructionLogs[0].looseQuantaAfter).toBe(204);

      const breakEvt = outboxEvents.find((e) => e.eventType === 'BulkPackageBrokenEvent');
      expect(breakEvt).toBeDefined();
      expect(breakEvt.payload.smsLength).toBeLessThanOrEqual(160);
    });

    it('throws HTTP 409 CONFLICT when both shelf quanta and sealed packages are exhausted', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            id: 'prod-1',
            seller_business_id: 'retailer-1',
            name_sw: 'Sukari',
            base_quarter_quanta_stock: 2,
            sealed_bulk_packages_stock: 0,
            quanta_per_sealed_package: 200,
            unit_price_tzs: 1000n,
          },
        ]),
        $executeRaw: jest.fn().mockRejectedValue(new Error('INSUFFICIENT_SEALED_BULK (P0002)')),
      };
      const prisma = {
        runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      } as unknown as PrismaService;
      const outbox = { enqueue: jest.fn() } as unknown as OutboxService;

      const inventoryService = new InventoryService(prisma, outbox);
      await expect(
        inventoryService.recordPosSale(
          {
            productId: 'prod-1',
            quantityRequested: 5,
            paymentMethod: PosPaymentMethod.CASH,
          },
          {
            businessId: 'retailer-1',
            merchantId: 'retailer-1',
            tier: 'RETAIL_DUKA',
            isPlatformManaged: true,
            geospatialMapEnabled: false,
            isSuperAdmin: false,
          },
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
