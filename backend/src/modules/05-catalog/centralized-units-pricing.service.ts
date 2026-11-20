import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StandardPricingProfileType, SystemUnitCategory } from '@prisma/client';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { computeWeightedAvgPurchaseCost } from './costing.util';
import {
  CreateStandardPricingProfileDto,
  CreateSystemUnitDto,
  DefineGlobalProductUnitDto,
  PublishStandardPricesBatchDto,
  RecordExternalPurchaseReceiptDto,
  ResetMerchantPriceDto,
  SelectOrAmendMerchantPriceDto,
  UpdateGlobalProductUnitDto,
  UpdateSystemUnitDto,
} from './dto/centralized-units-pricing.dto';

@Injectable()
export class CentralizedUnitsPricingService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

  // ===========================================================================
  // A. Platform Admin — System Unit Registry & Product-Specific Units
  // ===========================================================================

  async listSystemUnits(includeInactive = false) {
    return this.prismaService.systemUnit.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ category: 'asc' }, { unitCode: 'asc' }],
    });
  }

  async createSystemUnit(dto: CreateSystemUnitDto) {
    const normalizedCode = dto.unitCode.trim().toUpperCase();
    try {
      return await this.prismaService.systemUnit.create({
        data: {
          unitCode: normalizedCode,
          category: dto.category as SystemUnitCategory,
          nameSw: dto.nameSw.trim(),
          nameEn: dto.nameEn.trim(),
          abbreviation: dto.abbreviation.trim(),
          allowFractional: Boolean(dto.allowFractional),
          baseReferenceCode: dto.baseReferenceCode?.trim().toUpperCase() ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`System unit ${normalizedCode} already exists.`);
      }
      throw error;
    }
  }

  async updateSystemUnit(unitId: string, dto: UpdateSystemUnitDto) {
    const existing = await this.prismaService.systemUnit.findUnique({ where: { id: unitId } });
    if (!existing) {
      throw new NotFoundException(`System unit ${unitId} was not found.`);
    }

    return this.prismaService.systemUnit.update({
      where: { id: unitId },
      data: {
        nameSw: dto.nameSw?.trim(),
        nameEn: dto.nameEn?.trim(),
        abbreviation: dto.abbreviation?.trim(),
        allowFractional: dto.allowFractional,
        baseReferenceCode: dto.baseReferenceCode?.trim().toUpperCase(),
        isActive: dto.isActive,
      },
    });
  }

  async defineProductUnit(globalCatalogId: string, dto: DefineGlobalProductUnitDto) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const catalogItem = await tx.sokoGlobalCatalog.findUnique({
        where: { id: globalCatalogId },
        select: { id: true, canonicalSku: true, isActive: true },
      });
      if (!catalogItem) {
        throw new NotFoundException(`Global catalog SKU ${globalCatalogId} was not found.`);
      }

      const systemUnit = await tx.systemUnit.findUnique({
        where: { id: dto.systemUnitId },
      });
      if (!systemUnit || !systemUnit.isActive) {
        throw new NotFoundException(
          `System unit ${dto.systemUnitId} was not found or is inactive.`,
        );
      }

      const saved = await tx.globalProductUnit.upsert({
        where: {
          globalCatalogId_systemUnitId: {
            globalCatalogId,
            systemUnitId: dto.systemUnitId,
          },
        },
        update: {
          quarterQuantaPerUnit: dto.quarterQuantaPerUnit,
          displayLabelSw: dto.displayLabelSw?.trim() ?? systemUnit.nameSw,
          displayLabelEn: dto.displayLabelEn?.trim() ?? systemUnit.nameEn,
          isWholesaleUnit: Boolean(dto.isWholesaleUnit),
          isActive: true,
        },
        create: {
          globalCatalogId,
          systemUnitId: dto.systemUnitId,
          quarterQuantaPerUnit: dto.quarterQuantaPerUnit,
          displayLabelSw: dto.displayLabelSw?.trim() ?? systemUnit.nameSw,
          displayLabelEn: dto.displayLabelEn?.trim() ?? systemUnit.nameEn,
          isWholesaleUnit: Boolean(dto.isWholesaleUnit),
        },
        include: {
          systemUnit: true,
        },
      });

      return saved;
    });
  }

  async listProductUnits(globalCatalogId: string) {
    return this.prismaService.globalProductUnit.findMany({
      where: { globalCatalogId, isActive: true },
      include: { systemUnit: true },
      orderBy: { quarterQuantaPerUnit: 'asc' },
    });
  }

  /** Edit an existing product-specific unit (conversion, label, wholesale flag). */
  async updateProductUnit(
    globalCatalogId: string,
    productUnitId: string,
    dto: UpdateGlobalProductUnitDto,
  ) {
    const existing = await this.prismaService.globalProductUnit.findFirst({
      where: { id: productUnitId, globalCatalogId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(
        `Product unit ${productUnitId} was not found on catalog ${globalCatalogId}.`,
      );
    }

    if (dto.systemUnitId) {
      const systemUnit = await this.prismaService.systemUnit.findUnique({
        where: { id: dto.systemUnitId },
        select: { id: true },
      });
      if (!systemUnit) {
        throw new NotFoundException(`System unit ${dto.systemUnitId} was not found.`);
      }
    }

    const data: Prisma.GlobalProductUnitUncheckedUpdateInput = {};
    if (dto.systemUnitId !== undefined) data.systemUnitId = dto.systemUnitId;
    if (dto.quarterQuantaPerUnit !== undefined) data.quarterQuantaPerUnit = dto.quarterQuantaPerUnit;
    if (dto.displayLabelSw !== undefined) data.displayLabelSw = dto.displayLabelSw.trim();
    if (dto.displayLabelEn !== undefined) data.displayLabelEn = dto.displayLabelEn.trim();
    if (dto.isWholesaleUnit !== undefined) data.isWholesaleUnit = dto.isWholesaleUnit;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prismaService.globalProductUnit.update({
      where: { id: productUnitId },
      data,
      include: { systemUnit: true },
    });
  }

  // ===========================================================================
  // B. Platform Admin — Versioned Standard Pricing Management
  // ===========================================================================

  async listPricingProfiles() {
    return this.prismaService.standardPricingProfile.findMany({
      where: { isActive: true },
      orderBy: [{ profileType: 'asc' }, { profileCode: 'asc' }],
    });
  }

  async createPricingProfile(
    dto: CreateStandardPricingProfileDto,
    adminUser: AuthenticatedUser,
  ) {
    const code = dto.profileCode.trim().toUpperCase();
    try {
      return await this.prismaService.standardPricingProfile.create({
        data: {
          profileCode: code,
          profileType: dto.profileType as StandardPricingProfileType,
          nameSw: dto.nameSw.trim(),
          nameEn: dto.nameEn.trim(),
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          createdByAdminId: adminUser.sub,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Pricing profile code ${code} already exists.`);
      }
      throw error;
    }
  }

  /**
   * Publishes a new active version of Standard Selling Prices for (globalCatalogId, globalProductUnitId, profileType).
   * Older active platform prices are superseded cleanly WITHOUT altering any Merchant overrides or historical orders.
   */
  async publishStandardPrices(
    globalCatalogId: string,
    dto: PublishStandardPricesBatchDto,
    adminUser: AuthenticatedUser,
  ) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const catalogItem = await tx.sokoGlobalCatalog.findUnique({
        where: { id: globalCatalogId },
        select: { id: true, canonicalSku: true },
      });
      if (!catalogItem) {
        throw new NotFoundException(`Global catalog SKU ${globalCatalogId} was not found.`);
      }

      // Group items by (globalProductUnitId, profileType)
      const grouped = new Map<string, typeof dto.prices>();
      for (const item of dto.prices) {
        if (item.maxQty !== undefined && item.maxQty !== null && item.maxQty < item.minQty) {
          throw new BadRequestException(
            `Invalid quantity bracket (${item.minQty}–${item.maxQty}): maxQty must be >= minQty.`,
          );
        }
        const key = `${item.globalProductUnitId}::${item.profileType}`;
        const list = grouped.get(key) ?? [];
        list.push(item);
        grouped.set(key, list);
      }

      const published: Array<{
        id: string;
        globalProductUnitId: string;
        profileType: string;
        version: number;
        minQty: number;
        maxQty: number | null;
        standardPriceTzs: number;
      }> = [];

      for (const [key, items] of grouped.entries()) {
        const [unitId, profileType] = key.split('::');

        // Validate brackets do not overlap inside the same batch
        const sorted = [...items].sort((a, b) => a.minQty - b.minQty);
        for (let i = 0; i < sorted.length - 1; i += 1) {
          const currMax = sorted[i].maxQty ?? Number.MAX_SAFE_INTEGER;
          if (currMax >= sorted[i + 1].minQty) {
            throw new BadRequestException(
              `Overlapping wholesale/standard pricing bracket for unit ${unitId} (${profileType}).`,
            );
          }
        }

        const unitRow = await tx.globalProductUnit.findFirst({
          where: { id: unitId, globalCatalogId, isActive: true },
        });
        if (!unitRow) {
          throw new NotFoundException(
            `Global product unit ${unitId} does not belong to catalog SKU ${globalCatalogId}.`,
          );
        }

        const existingMax = await tx.globalCatalogStandardPrice.aggregate({
          where: {
            globalCatalogId,
            globalProductUnitId: unitId,
            profileType: profileType as StandardPricingProfileType,
          },
          _max: { version: true },
        });
        const nextVersion = (existingMax._max.version ?? 0) + 1;

        // Deactivate previous active versions only on platform standard table (never touches merchant overrides)
        await tx.globalCatalogStandardPrice.updateMany({
          where: {
            globalCatalogId,
            globalProductUnitId: unitId,
            profileType: profileType as StandardPricingProfileType,
            isActive: true,
          },
          data: {
            isActive: false,
            effectiveTo: new Date(),
          },
        });

        for (const item of sorted) {
          const profile = await tx.standardPricingProfile.findUnique({
            where: { id: item.pricingProfileId },
            select: { id: true, isActive: true },
          });
          if (!profile || !profile.isActive) {
            throw new NotFoundException(
              `Standard pricing profile ${item.pricingProfileId} was not found or is inactive.`,
            );
          }

          const created = await tx.globalCatalogStandardPrice.create({
            data: {
              globalCatalogId,
              globalProductUnitId: unitId,
              pricingProfileId: item.pricingProfileId,
              profileType: item.profileType as StandardPricingProfileType,
              version: nextVersion,
              minQty: item.minQty,
              maxQty: item.maxQty ?? null,
              standardPriceTzs: BigInt(item.standardPriceTzs),
              effectiveFrom: item.effectiveFrom ? new Date(item.effectiveFrom) : new Date(),
              effectiveTo: item.effectiveTo ? new Date(item.effectiveTo) : null,
              isActive: true,
              createdByAdminId: adminUser.sub,
            },
          });

          published.push({
            id: created.id,
            globalProductUnitId: created.globalProductUnitId,
            profileType: created.profileType,
            version: created.version,
            minQty: created.minQty,
            maxQty: created.maxQty,
            standardPriceTzs: Number(created.standardPriceTzs),
          });
        }
      }

      return {
        globalCatalogId,
        canonicalSku: catalogItem.canonicalSku,
        publishedCount: published.length,
        published,
      };
    });
  }

  async getStandardPricesForCatalogItem(globalCatalogId: string, includeHistory = false) {
    const units = await this.prismaService.globalProductUnit.findMany({
      where: { globalCatalogId, isActive: true },
      include: { systemUnit: true },
      orderBy: { quarterQuantaPerUnit: 'asc' },
    });

    const prices = await this.prismaService.globalCatalogStandardPrice.findMany({
      where: {
        globalCatalogId,
        ...(includeHistory ? {} : { isActive: true }),
      },
      include: {
        pricingProfile: {
          select: { id: true, profileCode: true, profileType: true, nameSw: true, nameEn: true },
        },
      },
      orderBy: [{ version: 'desc' }, { minQty: 'asc' }],
    });

    return {
      globalCatalogId,
      units,
      standardPrices: prices.map((p) => ({
        id: p.id,
        globalProductUnitId: p.globalProductUnitId,
        pricingProfileId: p.pricingProfileId,
        profileCode: p.pricingProfile.profileCode,
        profileType: p.profileType,
        version: p.version,
        minQty: p.minQty,
        maxQty: p.maxQty,
        standardPriceTzs: Number(p.standardPriceTzs),
        currency: p.currency,
        effectiveFrom: p.effectiveFrom.toISOString(),
        effectiveTo: p.effectiveTo?.toISOString() ?? null,
        isActive: p.isActive,
      })),
    };
  }

  // ===========================================================================
  // D. Merchant Selling Price Selection, Tenant-Isolated Amendment & Reset
  // ===========================================================================

  async selectOrAmendMerchantPrice(
    clonedProductId: string,
    dto: SelectOrAmendMerchantPriceDto,
    user: AuthenticatedUser,
    tenantContext?: TenantContext,
  ) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const cloned = await tx.merchantClonedProduct.findUnique({
        where: { id: clonedProductId },
      });
      if (!cloned) {
        throw new NotFoundException(`Cloned Merchant product ${clonedProductId} was not found.`);
      }

      if (
        !tenantContext?.isSuperAdmin &&
        cloned.retailerBusinessId !== tenantContext?.businessId
      ) {
        throw new ForbiddenException(
          'Cross-Merchant selling price modification denied: tenant mismatch.',
        );
      }

      const priceSource = await this.resolveMerchantPriceSource(
        tx,
        cloned,
        dto,
      );

      const existingOverride = await tx.merchantUnitPricingOverride.findUnique({
        where: {
          clonedProductId_globalProductUnitId: {
            clonedProductId,
            globalProductUnitId: dto.globalProductUnitId,
          },
        },
      });

      const previousPriceTzs = existingOverride
        ? existingOverride.effectiveSellingPriceTzs
        : null;

      const isOverridden =
        dto.amendedSellingPriceTzs !== undefined &&
        BigInt(dto.amendedSellingPriceTzs) !== priceSource.priceTzs;

      const amendedBigInt = isOverridden ? BigInt(dto.amendedSellingPriceTzs!) : null;
      const effectiveBigInt = isOverridden ? amendedBigInt! : priceSource.priceTzs;

      const savedOverride = await tx.merchantUnitPricingOverride.upsert({
        where: {
          clonedProductId_globalProductUnitId: {
            clonedProductId,
            globalProductUnitId: dto.globalProductUnitId,
          },
        },
        update: {
          standardPriceId: priceSource.standardPriceId,
          standardPriceVersion: priceSource.version,
          selectedStandardPriceTzs: priceSource.priceTzs,
          amendedSellingPriceTzs: amendedBigInt,
          effectiveSellingPriceTzs: effectiveBigInt,
          isOverridden,
          isActive: true,
        },
        create: {
          clonedProductId,
          businessId: cloned.retailerBusinessId,
          globalProductUnitId: dto.globalProductUnitId,
          standardPriceId: priceSource.standardPriceId,
          standardPriceVersion: priceSource.version,
          selectedStandardPriceTzs: priceSource.priceTzs,
          amendedSellingPriceTzs: amendedBigInt,
          effectiveSellingPriceTzs: effectiveBigInt,
          isOverridden,
          isActive: true,
        },
      });

      // Mirror base unit display price on merchant_cloned_products if unset or unit matches
      await tx.merchantClonedProduct.update({
        where: { id: clonedProductId },
        data: { unitPriceTzs: effectiveBigInt },
      });

      const action = isOverridden ? 'AMEND_PRICE' : 'SELECT_STANDARD';
      await tx.merchantPriceAuditLog.create({
        data: {
          businessId: cloned.retailerBusinessId,
          clonedProductId,
          globalProductUnitId: dto.globalProductUnitId,
          actorUserId: user.sub,
          action,
          previousPriceTzs,
          newPriceTzs: effectiveBigInt,
          standardPriceId: priceSource.standardPriceId,
          standardPriceVersion: priceSource.version,
        },
      });

      if (tx.securityAuditLog && typeof tx.securityAuditLog.create === 'function') {
        await tx.securityAuditLog.create({
          data: {
            userId: user.sub,
            eventType: `MERCHANT_PRICE_${action}`,
            details: {
              businessId: cloned.retailerBusinessId,
              clonedProductId,
              globalProductUnitId: dto.globalProductUnitId,
              previousPriceTzs: previousPriceTzs !== null ? Number(previousPriceTzs) : null,
              newPriceTzs: Number(effectiveBigInt),
              standardPriceVersion: priceSource.version,
              pricingTemplateId: priceSource.pricingTemplateId ?? null,
              pricingChannel: priceSource.channel,
            },
          },
        });
      }

      return {
        overrideId: savedOverride.id,
        clonedProductId,
        businessId: cloned.retailerBusinessId,
        globalProductUnitId: dto.globalProductUnitId,
        standardPriceId: priceSource.standardPriceId,
        standardPriceVersion: priceSource.version,
        pricingTemplateId: priceSource.pricingTemplateId ?? null,
        pricingChannel: priceSource.channel,
        selectedStandardPriceTzs: Number(priceSource.priceTzs),
        amendedSellingPriceTzs: amendedBigInt !== null ? Number(amendedBigInt) : null,
        effectiveSellingPriceTzs: Number(effectiveBigInt),
        isOverridden,
      };
    });
  }

  /**
   * Resolve the Admin-controlled price a Merchant is selecting: either a
   * standalone attached Pricing Template or a legacy versioned standard price.
   * Merchant amendments are still stored per tenant in the existing override
   * table — template updates never rewrite them.
   */
  private async resolveMerchantPriceSource(
    tx: any,
    cloned: { id: string; globalCatalogId: string },
    dto: SelectOrAmendMerchantPriceDto,
  ): Promise<{
    priceTzs: bigint;
    version: number;
    standardPriceId: string | null;
    pricingTemplateId: string | null;
    channel: string;
  }> {
    if (dto.pricingTemplateId) {
      const attachment = await tx.globalCatalogPricingTemplate.findFirst({
        where: {
          globalCatalogId: cloned.globalCatalogId,
          templateId: dto.pricingTemplateId,
          template: { isActive: true },
        },
        include: { template: { include: { systemUnit: true } } },
      });
      if (!attachment) {
        throw new NotFoundException(
          `Pricing template ${dto.pricingTemplateId} is not attached to this product.`,
        );
      }

      const productUnit = await tx.globalProductUnit.findUnique({
        where: { id: dto.globalProductUnitId },
        select: { id: true, globalCatalogId: true, systemUnitId: true },
      });
      if (!productUnit || productUnit.globalCatalogId !== cloned.globalCatalogId) {
        throw new NotFoundException(
          `Product unit ${dto.globalProductUnitId} was not found for this product.`,
        );
      }
      if (productUnit.systemUnitId !== attachment.template.systemUnitId) {
        throw new BadRequestException(
          'Pricing template system unit does not match the selected product unit.',
        );
      }

      return {
        priceTzs: attachment.template.standardPriceTzs,
        version: attachment.template.version,
        standardPriceId: null,
        pricingTemplateId: attachment.template.id,
        channel: attachment.template.pricingChannel,
      };
    }

    if (!dto.standardPriceId) {
      throw new BadRequestException('Either pricingTemplateId or standardPriceId is required.');
    }

    const stdPrice = await tx.globalCatalogStandardPrice.findUnique({
      where: { id: dto.standardPriceId },
    });
    if (
      !stdPrice ||
      stdPrice.globalCatalogId !== cloned.globalCatalogId ||
      stdPrice.globalProductUnitId !== dto.globalProductUnitId
    ) {
      throw new NotFoundException(
        `Standard price ${dto.standardPriceId} was not found for this product unit.`,
      );
    }

    return {
      priceTzs: stdPrice.standardPriceTzs,
      version: stdPrice.version,
      standardPriceId: stdPrice.id,
      pricingTemplateId: null,
      channel: stdPrice.profileType,
    };
  }

  async resetMerchantPriceToStandard(
    clonedProductId: string,
    dto: ResetMerchantPriceDto,
    user: AuthenticatedUser,
    tenantContext?: TenantContext,
  ) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const cloned = await tx.merchantClonedProduct.findUnique({
        where: { id: clonedProductId },
      });
      if (!cloned) {
        throw new NotFoundException(`Cloned Merchant product ${clonedProductId} was not found.`);
      }

      if (
        !tenantContext?.isSuperAdmin &&
        cloned.retailerBusinessId !== tenantContext?.businessId
      ) {
        throw new ForbiddenException(
          'Cross-Merchant selling price reset denied: tenant mismatch.',
        );
      }

      const existingOverride = await tx.merchantUnitPricingOverride.findUnique({
        where: {
          clonedProductId_globalProductUnitId: {
            clonedProductId,
            globalProductUnitId: dto.globalProductUnitId,
          },
        },
      });

      const activeStd = await tx.globalCatalogStandardPrice.findFirst({
        where: {
          globalCatalogId: cloned.globalCatalogId,
          globalProductUnitId: dto.globalProductUnitId,
          isActive: true,
        },
        orderBy: [{ version: 'desc' }, { minQty: 'asc' }],
      });

      if (!activeStd) {
        throw new NotFoundException(
          `No active platform standard price found to reset unit ${dto.globalProductUnitId}.`,
        );
      }

      const previousPriceTzs = existingOverride
        ? existingOverride.effectiveSellingPriceTzs
        : null;

      const updated = await tx.merchantUnitPricingOverride.upsert({
        where: {
          clonedProductId_globalProductUnitId: {
            clonedProductId,
            globalProductUnitId: dto.globalProductUnitId,
          },
        },
        update: {
          standardPriceId: activeStd.id,
          standardPriceVersion: activeStd.version,
          selectedStandardPriceTzs: activeStd.standardPriceTzs,
          amendedSellingPriceTzs: null,
          effectiveSellingPriceTzs: activeStd.standardPriceTzs,
          isOverridden: false,
          isActive: true,
        },
        create: {
          clonedProductId,
          businessId: cloned.retailerBusinessId,
          globalProductUnitId: dto.globalProductUnitId,
          standardPriceId: activeStd.id,
          standardPriceVersion: activeStd.version,
          selectedStandardPriceTzs: activeStd.standardPriceTzs,
          amendedSellingPriceTzs: null,
          effectiveSellingPriceTzs: activeStd.standardPriceTzs,
          isOverridden: false,
          isActive: true,
        },
      });

      await tx.merchantClonedProduct.update({
        where: { id: clonedProductId },
        data: { unitPriceTzs: activeStd.standardPriceTzs },
      });

      await tx.merchantPriceAuditLog.create({
        data: {
          businessId: cloned.retailerBusinessId,
          clonedProductId,
          globalProductUnitId: dto.globalProductUnitId,
          actorUserId: user.sub,
          action: 'RESET_TO_STANDARD',
          previousPriceTzs,
          newPriceTzs: activeStd.standardPriceTzs,
          standardPriceId: activeStd.id,
          standardPriceVersion: activeStd.version,
        },
      });

      if (tx.securityAuditLog && typeof tx.securityAuditLog.create === 'function') {
        await tx.securityAuditLog.create({
          data: {
            userId: user.sub,
            eventType: 'MERCHANT_PRICE_RESET_TO_STANDARD',
            details: {
              businessId: cloned.retailerBusinessId,
              clonedProductId,
              globalProductUnitId: dto.globalProductUnitId,
              previousPriceTzs: previousPriceTzs !== null ? Number(previousPriceTzs) : null,
              newPriceTzs: Number(activeStd.standardPriceTzs),
              standardPriceVersion: activeStd.version,
            },
          },
        });
      }

      return {
        overrideId: updated.id,
        clonedProductId,
        globalProductUnitId: dto.globalProductUnitId,
        standardPriceId: activeStd.id,
        standardPriceVersion: activeStd.version,
        effectiveSellingPriceTzs: Number(activeStd.standardPriceTzs),
        isOverridden: false,
      };
    });
  }

  // ===========================================================================
  // E. Purchase-Driven Buying Price Population & External Goods Receiving
  // ===========================================================================

  async recordExternalPurchaseReceipt(
    dto: RecordExternalPurchaseReceiptDto,
    user: AuthenticatedUser,
    tenantContext?: TenantContext,
  ) {
    const status = dto.receiptStatus ?? 'GOODS_RECEIVED';

    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const lockedClones = await tx.$queryRaw<
        Array<{
          id: string;
          retailer_business_id: string;
          global_catalog_id: string;
          available_quanta_stock: number;
          weighted_avg_buying_cost_per_quantum_tzs: bigint;
          last_buying_price_per_quantum_tzs: bigint;
          buying_price_established: boolean;
        }>
      >`
        SELECT id::text AS id,
               retailer_business_id::text AS retailer_business_id,
               global_catalog_id::text AS global_catalog_id,
               available_quanta_stock,
               weighted_avg_buying_cost_per_quantum_tzs,
               last_buying_price_per_quantum_tzs,
               buying_price_established
          FROM merchant_cloned_products
         WHERE id = ${dto.clonedProductId}::uuid
           FOR UPDATE
      `;

      const cloned = lockedClones[0];
      if (!cloned) {
        throw new NotFoundException(`Cloned Merchant product ${dto.clonedProductId} was not found.`);
      }

      if (
        !tenantContext?.isSuperAdmin &&
        cloned.retailer_business_id !== tenantContext?.businessId
      ) {
        throw new ForbiddenException(
          'Cross-Merchant external purchase recording denied: tenant mismatch.',
        );
      }

      let quarterQuantaPerUnit = dto.quarterQuantaPerUnit ?? 0;
      if (dto.globalProductUnitId) {
        const productUnit = await tx.globalProductUnit.findFirst({
          where: {
            id: dto.globalProductUnitId,
            globalCatalogId: cloned.global_catalog_id,
            isActive: true,
          },
        });
        if (!productUnit) {
          throw new NotFoundException(
            `Global product unit ${dto.globalProductUnitId} does not belong to this SKU.`,
          );
        }
        quarterQuantaPerUnit = productUnit.quarterQuantaPerUnit;
      }

      if (!Number.isInteger(quarterQuantaPerUnit) || quarterQuantaPerUnit < 1) {
        throw new BadRequestException(
          'Either a valid globalProductUnitId or quarterQuantaPerUnit >= 1 is required.',
        );
      }

      const receivedQuanta = dto.quantityUnits * quarterQuantaPerUnit;
      const agreedTotalCost = BigInt(dto.agreedTotalCostTzs);
      const prevWeightedAvg = BigInt(cloned.weighted_avg_buying_cost_per_quantum_tzs);

      if (status === 'ORDER_CONFIRMED') {
        // Record agreed supplier order cost WITHOUT hydrating physical shelf inventory or establishing final buying price
        const costPerQuantumPreview =
          (agreedTotalCost + BigInt(receivedQuanta) / 2n) / BigInt(receivedQuanta);

        const receipt = await tx.externalPurchaseReceipt.create({
          data: {
            businessId: cloned.retailer_business_id,
            clonedProductId: cloned.id,
            globalProductUnitId: dto.globalProductUnitId ?? null,
            supplierName: dto.supplierName.trim(),
            supplierReference: dto.supplierReference?.trim() ?? null,
            receiptStatus: 'ORDER_CONFIRMED',
            quantityUnits: dto.quantityUnits,
            quarterQuantaPerUnit,
            receivedQuanta,
            agreedTotalCostTzs: agreedTotalCost,
            costPerQuantumTzs: costPerQuantumPreview,
            prevWeightedAvgCostPerQuantumTzs: prevWeightedAvg,
            newWeightedAvgCostPerQuantumTzs: prevWeightedAvg,
            recordedByUserId: user.sub,
            receivedAt: null,
          },
        });

        await tx.$executeRaw`
          UPDATE merchant_cloned_products
             SET last_agreed_purchase_price_tzs = ${agreedTotalCost},
                 updated_at = NOW()
           WHERE id = ${cloned.id}::uuid
        `;

        return {
          receiptId: receipt.id,
          clonedProductId: cloned.id,
          receiptStatus: 'ORDER_CONFIRMED' as const,
          stockHydrated: false,
          availableQuantaStock: Number(cloned.available_quanta_stock),
          buyingPriceEstablished: Boolean(cloned.buying_price_established),
          lastAgreedPurchasePriceTzs: Number(agreedTotalCost),
        };
      }

      // GOODS_RECEIVED: atomically hydrate shelf stock & recalculate weighted average buying cost
      const costing = computeWeightedAvgPurchaseCost({
        existingStockQuanta: Number(cloned.available_quanta_stock),
        existingWeightedAvgCostPerQuantumTzs: prevWeightedAvg,
        receivedQuanta,
        agreedTotalCostTzs: agreedTotalCost,
      });

      const receipt = await tx.externalPurchaseReceipt.create({
        data: {
          businessId: cloned.retailer_business_id,
          clonedProductId: cloned.id,
          globalProductUnitId: dto.globalProductUnitId ?? null,
          supplierName: dto.supplierName.trim(),
          supplierReference: dto.supplierReference?.trim() ?? null,
          receiptStatus: 'GOODS_RECEIVED',
          quantityUnits: dto.quantityUnits,
          quarterQuantaPerUnit,
          receivedQuanta,
          agreedTotalCostTzs: agreedTotalCost,
          costPerQuantumTzs: costing.lastBuyingPricePerQuantumTzs,
          prevWeightedAvgCostPerQuantumTzs: prevWeightedAvg,
          newWeightedAvgCostPerQuantumTzs: costing.weightedAvgBuyingCostPerQuantumTzs,
          recordedByUserId: user.sub,
          receivedAt: new Date(),
        },
      });

      await tx.$executeRaw`
        UPDATE merchant_cloned_products
           SET available_quanta_stock = ${costing.newTotalQuanta}::integer,
               last_buying_price_per_quantum_tzs = ${costing.lastBuyingPricePerQuantumTzs},
               weighted_avg_buying_cost_per_quantum_tzs = ${costing.weightedAvgBuyingCostPerQuantumTzs},
               inventory_value_tzs = ${costing.newInventoryValueTzs},
               buying_price_established = TRUE,
               last_agreed_purchase_price_tzs = ${agreedTotalCost},
               updated_at = NOW()
         WHERE id = ${cloned.id}::uuid
      `;

      if (tx.financialAuditLog && typeof tx.financialAuditLog.create === 'function') {
        await tx.financialAuditLog.create({
          data: {
            actorUserId: user.sub,
            sellerBusinessId: cloned.retailer_business_id,
            eventType: 'EXTERNAL_GOODS_RECEIVED_COSTING',
            amountTzs: agreedTotalCost,
            previousState: String(prevWeightedAvg),
            newState: String(costing.weightedAvgBuyingCostPerQuantumTzs),
            details: {
              receiptId: receipt.id,
              clonedProductId: cloned.id,
              supplierName: dto.supplierName.trim(),
              receivedQuanta,
              newTotalQuanta: costing.newTotalQuanta,
              lastBuyingPricePerQuantumTzs: Number(costing.lastBuyingPricePerQuantumTzs),
              weightedAvgBuyingCostPerQuantumTzs: Number(
                costing.weightedAvgBuyingCostPerQuantumTzs,
              ),
              inventoryValueTzs: Number(costing.newInventoryValueTzs),
            },
          },
        });
      }

      await this.outboxService.enqueue(
        {
          aggregateType: 'ExternalPurchaseReceipt',
          aggregateId: receipt.id,
          eventType: 'ExternalGoodsReceivedEvent',
          routingKey: 'inventory.external_goods.received',
          payload: {
            receiptId: receipt.id,
            businessId: cloned.retailer_business_id,
            clonedProductId: cloned.id,
            receivedQuanta,
            newTotalQuanta: costing.newTotalQuanta,
            weightedAvgBuyingCostPerQuantumTzs: Number(costing.weightedAvgBuyingCostPerQuantumTzs),
          },
        },
        tx,
      );

      return {
        receiptId: receipt.id,
        clonedProductId: cloned.id,
        receiptStatus: 'GOODS_RECEIVED' as const,
        stockHydrated: true,
        receivedQuanta,
        availableQuantaStock: costing.newTotalQuanta,
        lastBuyingPricePerQuantumTzs: Number(costing.lastBuyingPricePerQuantumTzs),
        weightedAvgBuyingCostPerQuantumTzs: Number(costing.weightedAvgBuyingCostPerQuantumTzs),
        inventoryValueTzs: Number(costing.newInventoryValueTzs),
        buyingPriceEstablished: true,
      };
    });
  }
}
