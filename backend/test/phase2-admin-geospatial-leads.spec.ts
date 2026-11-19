import './test-env.setup';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Role } from '@common/security/roles.enum';
import { PrismaService } from '@database/prisma.service';
import { OutboxService } from '@database/outbox.service';
import { GeospatialService } from '@modules/04-branches/geospatial.service';
import { AdminMerchantsService } from '@modules/16-platform-admin/admin-merchants.service';
import {
  buildSwahiliLeadActivationSms,
  SalesLeadsService,
} from '@modules/16-platform-admin/sales-leads.service';
import { MerchantTierDto } from '@modules/16-platform-admin/dto/platform-admin.dto';

describe('Phase 2: Geospatial Gatekeeper, Admin Merchant Controls & Lead Optimistic Locking', () => {
  describe('GeospatialService (geospatial_map_enabled fail-closed guard)', () => {
    it('throws HTTP 403 FORBIDDEN when geospatial_map_enabled is FALSE for non-SUPER_ADMIN Merchant', async () => {
      const tx = {
        businessProfile: {
          findUnique: jest.fn().mockResolvedValue({ geospatialMapEnabled: false }),
        },
        $queryRaw: jest.fn(),
      };
      const prisma = {
        runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      } as unknown as PrismaService;

      const geoService = new GeospatialService(prisma);

      await expect(
        geoService.loadStoresMapMatrix(
          { sub: 'u1', role: Role.RETAILER, businessId: 'merchant-1' },
          {
            businessId: 'merchant-1',
            merchantId: 'merchant-1',
            tier: 'RETAIL_DUKA',
            isPlatformManaged: true,
            geospatialMapEnabled: false,
            isSuperAdmin: false,
          },
          -6.809,
          39.255,
          25000,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns PostGIS proximity-ordered Merchant nodes when Admin enables geospatial_map_enabled', async () => {
      let mapEnabled = false;
      const outbox = { enqueue: jest.fn() } as unknown as OutboxService;

      const tx = {
        businessProfile: {
          findUnique: jest.fn(async () => ({
            id: 'merchant-1',
            businessName: 'Kariakoo Hub',
            geospatialMapEnabled: mapEnabled,
          })),
          update: jest.fn(async ({ data }: any) => {
            mapEnabled = data.geospatialMapEnabled;
            return {
              id: 'merchant-1',
              businessName: 'Kariakoo Hub',
              geospatialMapEnabled: mapEnabled,
              updatedAt: new Date(),
            };
          }),
        },
        $queryRaw: jest.fn().mockResolvedValue([
          {
            id: 'merchant-2',
            sms_short_code: 'S12',
            business_name: 'Ilala Wholesale Merchant',
            tier: 'WHOLESALE',
            ward: 'Kariakoo',
            district: 'Ilala',
            latitude: -6.8205,
            longitude: 39.2725,
            distance_meters: 420.5,
            logo_url: 'https://ik.imagekit.io/ochspoiwa/sokokuutz/catalog/s12.webp',
            is_platform_managed: true,
          },
        ]),
      };

      const prisma = {
        runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      } as unknown as PrismaService;

      const adminMerchants = new AdminMerchantsService(prisma, outbox);
      const geoService = new GeospatialService(prisma);

      const toggled = await adminMerchants.setGeospatialMapEnabled('merchant-1', true);
      expect(toggled.geospatialMapEnabled).toBe(true);

      const matrix = await geoService.loadStoresMapMatrix(
        { sub: 'u1', role: Role.RETAILER, businessId: 'merchant-1' },
        undefined,
        -6.809,
        39.255,
        25000,
      );
      expect(matrix.isolationLevel).toBe('REPEATABLE_READ');
      expect(matrix.nodeCount).toBe(1);
      expect(matrix.nodes[0].merchantName).toBe('Ilala Wholesale Merchant');
      expect(matrix.nodes[0].distanceMeters).toBe(420.5);
    });
  });

  describe('SalesLeadsService (Optimistic Locking & <= 160-char Swahili PIN4 SMS)', () => {
    it('builds Swahili PIN4 activation SMS strictly <= 160 GSM-7 characters', () => {
      const sms = buildSwahiliLeadActivationSms(
        'Kariakoo Super Wholesale & Distribution Center Tanzania Limited',
        '4829',
      );
      expect(sms.length).toBeLessThanOrEqual(160);
      expect(sms).toContain('PIN ya kuingia: 4829');
    });

    it('converts lead atomically once and throws HTTP 409 CONFLICT on concurrent stale version', async () => {
      let currentVersion = 1;
      let currentStatus: 'PROSPECT' | 'CONVERTED' = 'PROSPECT';
      const outboxEvents: any[] = [];

      const tx = {
        sokoLead: {
          findUnique: jest.fn(async () => ({
            id: 'lead-1',
            merchantName: 'Mlimani Duka',
            ownerName: 'Hassan Mwinyi',
            ownerPhoneE164: '+255712000111',
            wardName: 'Ubungo',
            businessTier: MerchantTierDto.RETAIL_DUKA,
            latitude: -6.78,
            longitude: 39.22,
            status: currentStatus,
            version: BigInt(currentVersion),
          })),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'user-new-1' }),
        },
        $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
          const sql = strings.join(' ');
          if (sql.includes('UPDATE soko_leads')) {
            const expectedVersion = Number(values[3]);
            if (currentStatus === 'PROSPECT' && currentVersion === expectedVersion) {
              currentVersion += 1;
              currentStatus = 'CONVERTED';
              return 1;
            }
            return 0;
          }
          return 1;
        }),
      };

      const prisma = {
        runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      } as unknown as PrismaService;

      const outbox = {
        enqueue: jest.fn(async (event: any) => {
          outboxEvents.push(event);
          return { id: 'outbox-1' };
        }),
      } as unknown as OutboxService;

      const leadsService = new SalesLeadsService(prisma, outbox);

      const first = await leadsService.convertLeadToMerchant(
        'lead-1',
        { expectedVersion: 1, district: 'Ubungo' },
        'admin-1',
      );
      expect(first.status).toBe('CONVERTED');
      expect(first.newVersion).toBe(2);
      expect(first.isPlatformManaged).toBe(true);
      expect(outboxEvents).toHaveLength(1);
      expect(outboxEvents[0].eventType).toBe('LeadConvertedEvent');
      expect(outboxEvents[0].payload.smsLength).toBeLessThanOrEqual(160);

      // Second concurrent call with stale expectedVersion=1 -> HTTP 409 CONFLICT
      await expect(
        leadsService.convertLeadToMerchant('lead-1', { expectedVersion: 1 }, 'admin-2'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
