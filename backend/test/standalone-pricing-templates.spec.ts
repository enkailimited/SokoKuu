import './test-env.setup';
import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { Role } from '@common/security/roles.enum';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { CentralizedUnitsPricingService } from '@modules/05-catalog/centralized-units-pricing.service';
import { PricingTemplateService } from '@modules/07-pricing/pricing-template.service';

const adminUser: AuthenticatedUser = {
  sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  role: Role.SUPER_ADMIN,
};

const merchantUser: AuthenticatedUser = {
  sub: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  role: Role.WHOLESALER,
};

const merchantBizId = '11111111-1111-4111-8111-111111111111';
const otherBizId = '22222222-2222-4222-8222-222222222222';
const catalogId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const cartonUnitId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const productUnitId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const templateId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const tenantA: TenantContext = {
  businessId: merchantBizId,
  merchantId: merchantBizId,
  tier: 'WHOLESALE',
  isPlatformManaged: true,
  geospatialMapEnabled: false,
  isSuperAdmin: false,
};

const tenantB: TenantContext = {
  businessId: otherBizId,
  merchantId: otherBizId,
  tier: 'WHOLESALE',
  isPlatformManaged: true,
  geospatialMapEnabled: false,
  isSuperAdmin: false,
};

describe('Standalone Pricing Templates', () => {
  it('creates and versions a standalone template without mutating Merchant overrides', async () => {
    const units = new Map<string, any>([
      [
        cartonUnitId,
        {
          id: cartonUnitId,
          unitCode: 'CARTON',
          nameSw: 'Katoni',
          nameEn: 'Carton',
          category: 'PACKAGING',
          abbreviation: 'Crt',
          isActive: true,
        },
      ],
    ]);
    const templates: any[] = [];
    const prisma = {
      systemUnit: {
        findUnique: jest.fn(async ({ where }: any) => units.get(where.id) ?? null),
      },
      standardPricingTemplate: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: templateId,
            ...data,
            version: 1,
            isActive: true,
            systemUnit: units.get(data.systemUnitId),
          };
          templates.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          templates.find((t) => t.id === where.id) ?? null,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const row = templates.find((t) => t.id === where.id)!;
          const next = { ...row, ...data, version: row.version + 1 };
          templates[templates.indexOf(row)] = next;
          return { ...next, systemUnit: units.get(next.systemUnitId) };
        }),
      },
    } as unknown as PrismaService;

    const service = new PricingTemplateService(prisma);

    const created = await service.createTemplate(
      {
        templateName: '1.6 L Katoni (Chupa 6)',
        systemUnitId: cartonUnitId,
        packItemCount: 6,
        unitMeasureValue: '1.6',
        quarterQuantaTotal: 36,
        pricingChannel: 'WHOLESALE',
        standardPriceTzs: 3300,
      },
      adminUser,
    );

    expect(created.templateName).toBe('1.6 L Katoni (Chupa 6)');
    expect(created.systemUnit.unitCode).toBe('CARTON');
    expect(created.packItemCount).toBe(6);
    expect(created.quarterQuantaTotal).toBe(36);
    expect(created.pricingChannel).toBe('WHOLESALE');
    expect(created.standardPriceTzs).toBe(3300);
    expect(created.version).toBe(1);

    const updated = await service.updateTemplate(templateId, { standardPriceTzs: 3500 });
    expect(updated.standardPriceTzs).toBe(3500);
    expect(updated.version).toBe(2);
  });

  it('attaches reusable templates to a Global Catalog product', async () => {
    const templateRows = [
      {
        id: templateId,
        templateName: '300 mL Katoni (Chupa 12)',
        packItemCount: 12,
        unitMeasureValue: '300',
        quarterQuantaTotal: 12,
        pricingChannel: 'WHOLESALE',
        standardPriceTzs: 5000n,
        version: 1,
        isActive: true,
        systemUnitId: cartonUnitId,
      },
    ];
    const attachments: any[] = [];
    const deleteMany = jest.fn(async ({ where }: any) => {
      for (let i = attachments.length - 1; i >= 0; i -= 1) {
        if (where.templateId.notIn.includes(attachments[i].templateId)) attachments.splice(i, 1);
      }
      return { count: 0 };
    });
    const upsert = jest.fn(async ({ create }: any) => {
      attachments.push({ ...create });
      return {};
    });

    const tx = { globalCatalogPricingTemplate: { deleteMany, upsert } };
    const prisma = {
      sokoGlobalCatalog: {
        findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, canonicalSku: 'AFJ300' })),
      },
      standardPricingTemplate: {
        findMany: jest.fn(async ({ where }: any) =>
          templateRows.filter((t) => where.id.in.includes(t.id)),
        ),
      },
      globalCatalogPricingTemplate: {
        findMany: jest.fn(async () =>
          attachments.map((a) => ({
            ...a,
            template: {
              ...templateRows[0],
              systemUnit: { id: cartonUnitId, unitCode: 'CARTON', category: 'PACKAGING' },
            },
          })),
        ),
      },
      $transaction: jest.fn(async (fn: (client: any) => Promise<any>) => fn(tx)),
    } as unknown as PrismaService;

    const service = new PricingTemplateService(prisma);
    const result = await service.attachTemplates(catalogId, { templateIds: [templateId] });

    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ globalCatalogId: catalogId }) }),
    );
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].standardPriceTzs).toBe(5000);
    expect(result.templates[0].systemUnit.unitCode).toBe('CARTON');
  });

  it('applies attached templates tenant-isolately for Merchant price amendment', async () => {
    const overrides: any[] = [];
    const auditLogs: any[] = [];
    const tx = {
      merchantClonedProduct: {
        findUnique: jest.fn(async () => ({
          id: 'clone-1',
          retailerBusinessId: merchantBizId,
          globalCatalogId: catalogId,
        })),
        update: jest.fn(async () => ({})),
      },
      globalCatalogPricingTemplate: {
        findFirst: jest.fn(async () => ({
          templateId,
          template: {
            id: templateId,
            systemUnitId: cartonUnitId,
            standardPriceTzs: 3300n,
            version: 1,
            pricingChannel: 'WHOLESALE',
            isActive: true,
            systemUnit: { id: cartonUnitId, unitCode: 'CARTON' },
          },
        })),
      },
      globalProductUnit: {
        findUnique: jest.fn(async () => ({
          id: productUnitId,
          globalCatalogId: catalogId,
          systemUnitId: cartonUnitId,
        })),
      },
      merchantUnitPricingOverride: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async ({ create, update }: any) => {
          const row = { id: `override-${overrides.length + 1}`, ...create, ...update };
          overrides.push(row);
          return row;
        }),
      },
      merchantPriceAuditLog: {
        create: jest.fn(async ({ data }: any) => {
          auditLogs.push(data);
          return {};
        }),
      },
    };

    const prisma = {
      runInTransaction: jest.fn(async (_iso: any, fn: (client: any) => Promise<any>) => fn(tx)),
    } as unknown as PrismaService;
    const service = new CentralizedUnitsPricingService(
      prisma,
      { enqueue: jest.fn() } as unknown as OutboxService,
    );

    // Another Merchant's tenant cannot select/amend this clone's template price.
    await expect(
      service.selectOrAmendMerchantPrice(
        'clone-1',
        { globalProductUnitId: productUnitId, pricingTemplateId: templateId },
        merchantUser,
        tenantB,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const result = await service.selectOrAmendMerchantPrice(
      'clone-1',
      {
        globalProductUnitId: productUnitId,
        pricingTemplateId: templateId,
        amendedSellingPriceTzs: 3400,
      },
      merchantUser,
      tenantA,
    );

    expect(result.isOverridden).toBe(true);
    expect(result.effectiveSellingPriceTzs).toBe(3400);
    expect(result.selectedStandardPriceTzs).toBe(3300);
    expect(result.pricingTemplateId).toBe(templateId);
    expect(result.pricingChannel).toBe('WHOLESALE');
    expect(result.standardPriceId).toBeNull();
    expect(overrides[0].businessId).toBe(merchantBizId);
    expect(auditLogs).toHaveLength(1);
  });
});
