import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '@common/security/auth.types';
import { PrismaService } from '@database/prisma.service';
import {
  AttachPricingTemplatesDto,
  CreatePricingTemplateDto,
  UpdatePricingTemplateDto,
} from './dto/pricing-template.dto';

const UNIT_SELECT = {
  id: true,
  unitCode: true,
  nameSw: true,
  nameEn: true,
  category: true,
  abbreviation: true,
} as const;

/**
 * Admin-owned, reusable Standard Pricing Templates.
 *
 * A template is a first-class object: Admin creates and versions it once, then
 * attaches it to any number of Global Catalog products. Existing
 * `global_catalog_standard_prices` rows and Merchant overrides are never
 * mutated here, so historical orders stay reproducible.
 */
@Injectable()
export class PricingTemplateService {
  constructor(private readonly prismaService: PrismaService) {}

  async createTemplate(dto: CreatePricingTemplateDto, user?: AuthenticatedUser) {
    const systemUnit = await this.prismaService.systemUnit.findUnique({
      where: { id: dto.systemUnitId },
      select: { id: true, isActive: true },
    });
    if (!systemUnit) {
      throw new NotFoundException(`System unit ${dto.systemUnitId} was not found.`);
    }
    if (!systemUnit.isActive) {
      throw new BadRequestException(`System unit ${dto.systemUnitId} is inactive.`);
    }

    const created = await this.prismaService.standardPricingTemplate.create({
      data: {
        templateName: dto.templateName.trim(),
        systemUnitId: dto.systemUnitId,
        packItemCount: dto.packItemCount ?? 1,
        unitMeasureValue: dto.unitMeasureValue.trim(),
        quarterQuantaTotal: dto.quarterQuantaTotal,
        pricingChannel: dto.pricingChannel as never,
        standardPriceTzs: BigInt(dto.standardPriceTzs),
        createdByAdminId: user?.sub ?? null,
      },
      include: { systemUnit: { select: UNIT_SELECT } },
    });

    return this.serialize(created);
  }

  async listTemplates(includeInactive = false) {
    const templates = await this.prismaService.standardPricingTemplate.findMany({
      where: includeInactive ? undefined : { isActive: true },
      include: {
        systemUnit: { select: UNIT_SELECT },
        _count: { select: { attachments: true } },
      },
      orderBy: [{ pricingChannel: 'asc' }, { templateName: 'asc' }],
    });

    return templates.map((template) => ({
      ...this.serialize(template),
      attachedProductCount: template._count.attachments,
    }));
  }

  async updateTemplate(templateId: string, dto: UpdatePricingTemplateDto) {
    const existing = await this.prismaService.standardPricingTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, version: true },
    });
    if (!existing) {
      throw new NotFoundException(`Pricing template ${templateId} was not found.`);
    }

    if (dto.systemUnitId) {
      const systemUnit = await this.prismaService.systemUnit.findUnique({
        where: { id: dto.systemUnitId },
        select: { id: true, isActive: true },
      });
      if (!systemUnit || !systemUnit.isActive) {
        throw new NotFoundException(`Active system unit ${dto.systemUnitId} was not found.`);
      }
    }

    const data: Record<string, unknown> = { version: { increment: 1 } };
    if (dto.templateName !== undefined) data.templateName = dto.templateName.trim();
    if (dto.systemUnitId !== undefined) data.systemUnitId = dto.systemUnitId;
    if (dto.packItemCount !== undefined) data.packItemCount = dto.packItemCount;
    if (dto.unitMeasureValue !== undefined) data.unitMeasureValue = dto.unitMeasureValue.trim();
    if (dto.quarterQuantaTotal !== undefined) data.quarterQuantaTotal = dto.quarterQuantaTotal;
    if (dto.pricingChannel !== undefined) data.pricingChannel = dto.pricingChannel as never;
    if (dto.standardPriceTzs !== undefined) data.standardPriceTzs = BigInt(dto.standardPriceTzs);
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prismaService.standardPricingTemplate.update({
      where: { id: templateId },
      data: data as never,
      include: { systemUnit: { select: UNIT_SELECT } },
    });

    return this.serialize(updated);
  }

  /**
   * Synchronise the full set of templates attached to one Global Catalog SKU.
   * Templates unrelated to this product are left intact.
   */
  async attachTemplates(globalCatalogId: string, dto: AttachPricingTemplatesDto) {
    const catalog = await this.prismaService.sokoGlobalCatalog.findUnique({
      where: { id: globalCatalogId },
      select: { id: true, canonicalSku: true },
    });
    if (!catalog) {
      throw new NotFoundException(`Global catalog product ${globalCatalogId} was not found.`);
    }

    const templateIds = [...new Set(dto.templateIds)];
    const found = await this.prismaService.standardPricingTemplate.findMany({
      where: { id: { in: templateIds } },
      select: { id: true },
    });
    if (found.length !== templateIds.length) {
      const foundIds = new Set(found.map((t) => t.id));
      const missing = templateIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Pricing template(s) not found: ${missing.join(', ')}`);
    }

    await this.prismaService.$transaction(async (tx) => {
      await tx.globalCatalogPricingTemplate.deleteMany({
        where: { globalCatalogId, templateId: { notIn: templateIds } },
      });
      for (const templateId of templateIds) {
        await tx.globalCatalogPricingTemplate.upsert({
          where: {
            globalCatalogId_templateId: { globalCatalogId, templateId },
          },
          create: { globalCatalogId, templateId },
          update: {},
        });
      }
    });

    return this.listTemplatesForCatalog(globalCatalogId);
  }

  async listTemplatesForCatalog(globalCatalogId: string) {
    const attachments = await this.prismaService.globalCatalogPricingTemplate.findMany({
      where: { globalCatalogId, template: { isActive: true } },
      include: {
        template: { include: { systemUnit: { select: UNIT_SELECT } } },
      },
      orderBy: { template: { templateName: 'asc' } },
    });

    return {
      globalCatalogId,
      templates: attachments.map((attachment) => this.serialize(attachment.template)),
    };
  }

  async deleteTemplate(templateId: string) {
    const existing = await this.prismaService.standardPricingTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, isActive: true },
    });
    if (!existing) {
      throw new NotFoundException(`Pricing template ${templateId} was not found.`);
    }

    if (existing.isActive) {
      await this.prismaService.standardPricingTemplate.update({
        where: { id: templateId },
        data: { isActive: false },
      });
    }

    return {
      templateId: existing.id,
      isActive: false,
      deleted: true,
      idempotentReplay: !existing.isActive,
    };
  }

  private serialize(template: {
    id: string;
    templateName: string;
    packItemCount: number;
    unitMeasureValue: string;
    quarterQuantaTotal: number;
    pricingChannel: string;
    standardPriceTzs: bigint;
    version: number;
    isActive: boolean;
    systemUnit: {
      id: string;
      unitCode: string;
      nameSw: string;
      nameEn: string;
      category: string;
      abbreviation: string;
    };
  }) {
    return {
      id: template.id,
      templateName: template.templateName,
      systemUnit: template.systemUnit,
      packItemCount: template.packItemCount,
      unitMeasureValue: template.unitMeasureValue,
      quarterQuantaTotal: template.quarterQuantaTotal,
      pricingChannel: template.pricingChannel,
      standardPriceTzs: Number(template.standardPriceTzs),
      version: template.version,
      isActive: template.isActive,
    };
  }
}
