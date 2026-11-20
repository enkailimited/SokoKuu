import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PackagingUnit, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { MerchantTier, TenantContext } from '@common/security/auth.types';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { kgToQuarterQuantaChecked } from '@modules/06-inventory/quarter-quanta.util';
import {
  assertChannelHarmonyForCustomUnit,
  assertChannelHarmonyForTier,
} from './channel-harmony.policy';
import {
  AddGlobalCatalogItemDto,
  BulkUpdateClonePublishStatusDto,
  CloneStandardCatalogDto,
  CreateCatalogCategoryDto,
  CreateMerchantProductDto,
  PublishMarketStockDto,
  UpdateClonePublishStatusDto,
  UpdateFreeDeliveryDto,
  UpdateGlobalCatalogItemDto,
  UpdateMerchantCloneDto,
  UpdateMerchantProductDto,
  UpsertCustomMerchantUnitDto,
  UpsertProductPriceTierDto,
} from './dto/catalog.dto';
import { syncLinkedProductFromClone } from './clone-product-sync.util';
import { deriveUnitCategory } from './unit-category.util';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

  async listCategories(includeInactive = false) {
    return this.prismaService.sokoCatalogCategory.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { nameSw: 'asc' },
    });
  }

  async listMarketplaceMerchants(tier?: string) {
    const where: Prisma.BusinessProfileWhereInput = { isOpen: true };
    if (
      tier &&
      ['WHOLESALE', 'RETAIL_DUKA', 'HYBRID_STORE', 'MANUFACTURER_SUPPLIER'].includes(
        tier.toUpperCase(),
      )
    ) {
      where.tier = tier.toUpperCase() as Prisma.EnumBusinessTierFilter['equals'];
    }

    const rows = await this.prismaService.businessProfile.findMany({
      where,
      include: {
        _count: {
          select: { products: { where: { isActive: true } } },
        },
      },
      orderBy: { businessName: 'asc' },
      take: 200,
    });

    return rows.map((row) => ({
      merchantId: row.id,
      smsShortCode: row.smsShortCode,
      merchantName: row.businessName,
      tier: row.tier,
      ward: row.ward,
      district: row.district,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      isPlatformManaged: row.isPlatformManaged,
      offersFreeDelivery: row.offersFreeDelivery,
      activeSkusCount: row._count.products,
      logoUrl:
        row.logoCdnUrl ?? 'https://ik.imagekit.io/ochspoiwa/sokokuutz/catalog/default-merchant.webp',
    }));
  }

  async listMerchantClones(tenantContext?: TenantContext, requestedBusinessId?: string) {
    let targetMerchantId = tenantContext?.businessId ?? null;
    if (tenantContext?.isSuperAdmin && requestedBusinessId) {
      targetMerchantId = requestedBusinessId;
    } else if (
      requestedBusinessId &&
      targetMerchantId &&
      requestedBusinessId !== targetMerchantId
    ) {
      throw new ForbiddenException('Cross-Merchant cloned catalog read denied.');
    }

    if (!targetMerchantId) {
      throw new ForbiddenException(
        'Authenticated Merchant tenant context is required to inspect cloned products.',
      );
    }

    const clones = await this.prismaService.merchantClonedProduct.findMany({
      where: { retailerBusinessId: targetMerchantId, isActive: true },
      include: {
        globalCatalog: {
          include: {
            productUnits: {
              where: { isActive: true },
              include: { systemUnit: true },
            },
          },
        },
        unitPricingOverrides: {
          where: { isActive: true },
          include: {
            globalProductUnit: {
              include: { systemUnit: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return clones.map((clone) => {
      const units = clone.globalCatalog.productUnits ?? [];
      const unitCategory = deriveUnitCategory({
        systemUnitCategories: units.map((u) => u.systemUnit.category),
        baseQuantumUnit: clone.globalCatalog.baseQuantumUnit,
        categoryCode: clone.globalCatalog.categoryCode,
      });

      const baseOverride =
        clone.unitPricingOverrides.find((ov) => ov.globalProductUnit.quarterQuantaPerUnit === 4) ??
        clone.unitPricingOverrides[0];
      const sellingPriceTzs =
        Number(clone.unitPriceTzs) > 0
          ? Number(clone.unitPriceTzs)
          : baseOverride
            ? Number(baseOverride.effectiveSellingPriceTzs)
            : 0;

      return {
        clonedProductId: clone.id,
        retailerBusinessId: clone.retailerBusinessId,
        globalCatalogId: clone.globalCatalogId,
        canonicalSku: clone.globalCatalog.canonicalSku,
        categoryCode: clone.globalCatalog.categoryCode,
        baseQuantumUnit: clone.globalCatalog.baseQuantumUnit,
        unitCategory,
        fixedNameSw: clone.globalCatalog.fixedNameSw,
        fixedNameEn: clone.globalCatalog.fixedNameEn,
        imagekitCdnUrl: clone.imagekitCdnUrl || clone.globalCatalog.imagekitCdnUrl,
        availableQuantaStock: clone.availableQuantaStock,
        lowStockThresholdQuanta: clone.lowStockThresholdQuanta,
        unitPriceTzs: Number(clone.unitPriceTzs),
        sellingPriceTzs,
        inventoryValueTzs: Number(clone.inventoryValueTzs),
        lastBuyingPricePerQuantumTzs: Number(clone.lastBuyingPricePerQuantumTzs),
        weightedAvgBuyingCostPerQuantumTzs: Number(clone.weightedAvgBuyingCostPerQuantumTzs),
        buyingPriceEstablished: clone.buyingPriceEstablished,
        isPublishedToMarket: clone.isPublishedToMarket,
        isActiveForSale: clone.isActiveForSale,
        unitPricingOverrides: clone.unitPricingOverrides.map((ov) => ({
          overrideId: ov.id,
          globalProductUnitId: ov.globalProductUnitId,
          unitCode: ov.globalProductUnit.systemUnit.unitCode,
          category: ov.globalProductUnit.systemUnit.category,
          abbreviation: ov.globalProductUnit.systemUnit.abbreviation,
          displayLabelSw:
            ov.globalProductUnit.displayLabelSw || ov.globalProductUnit.systemUnit.nameSw,
          displayLabelEn:
            ov.globalProductUnit.displayLabelEn || ov.globalProductUnit.systemUnit.nameEn,
          quarterQuantaPerUnit: ov.globalProductUnit.quarterQuantaPerUnit,
          standardPriceId: ov.standardPriceId,
          standardPriceVersion: ov.standardPriceVersion,
          selectedStandardPriceTzs: ov.selectedStandardPriceTzs
            ? Number(ov.selectedStandardPriceTzs)
            : null,
          amendedSellingPriceTzs: ov.amendedSellingPriceTzs
            ? Number(ov.amendedSellingPriceTzs)
            : null,
          effectiveSellingPriceTzs: Number(ov.effectiveSellingPriceTzs),
          isOverridden: ov.isOverridden,
        })),
      };
    });
  }

  async updateMerchantClonePublishStatus(
    clonedProductId: string,
    dto: UpdateClonePublishStatusDto,
    tenantContext?: TenantContext,
  ) {
    if (!tenantContext?.isSuperAdmin && !tenantContext?.businessId) {
      throw new ForbiddenException(
        'Authenticated Merchant tenant context is required to update market visibility.',
      );
    }

    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const existing = await tx.merchantClonedProduct.findUnique({
        where: { id: clonedProductId },
        include: {
          globalCatalog: {
            select: { fixedNameSw: true, fixedNameEn: true },
          },
          unitPricingOverrides: {
            where: { isActive: true },
            select: { effectiveSellingPriceTzs: true },
          },
        },
      });

      if (!existing || !existing.isActive) {
        throw new NotFoundException(`Cloned catalog item ${clonedProductId} was not found.`);
      }

      this.assertTenantOwnership(existing.retailerBusinessId, tenantContext, 'publish');

      const hasActiveOverridePrice = existing.unitPricingOverrides.some(
        (ov) => Number(ov.effectiveSellingPriceTzs) > 0,
      );
      const hasSellingPrice = Number(existing.unitPriceTzs) > 0 || hasActiveOverridePrice;

      if (dto.isPublishedToMarket) {
        if (existing.availableQuantaStock <= 0) {
          throw new BadRequestException(
            `Bidhaa "${existing.globalCatalog.fixedNameSw}" haina stock (0 Quanta). Ingiza mzigo kwanza kabla ya kupeleka Sokoni / Product must have stock (> 0) before publishing to Sokoni Market.`,
          );
        }
        if (!hasSellingPrice) {
          throw new BadRequestException(
            `Bidhaa "${existing.globalCatalog.fixedNameSw}" haijawekewa bei ya kuuzia (> 0 TZS). Chagua au rekebisha bei kwanza / Set a selling price (> 0 TZS) before publishing to Sokoni Market.`,
          );
        }
      }

      const nextIsActiveForSale =
        dto.isActiveForSale !== undefined ? dto.isActiveForSale : dto.isPublishedToMarket;

      const updated = await tx.merchantClonedProduct.update({
        where: { id: clonedProductId },
        data: {
          isPublishedToMarket: dto.isPublishedToMarket,
          isActiveForSale: nextIsActiveForSale,
        },
      });

      await syncLinkedProductFromClone(tx, clonedProductId);

      return {
        clonedProductId: updated.id,
        retailerBusinessId: updated.retailerBusinessId,
        isPublishedToMarket: updated.isPublishedToMarket,
        isActiveForSale: updated.isActiveForSale,
        availableQuantaStock: updated.availableQuantaStock,
        sellingPriceTzs: Number(updated.unitPriceTzs),
        updatedAtEat: updated.updatedAt.toISOString(),
      };
    });
  }

  async bulkUpdateMerchantClonePublishStatus(
    dto: BulkUpdateClonePublishStatusDto,
    tenantContext?: TenantContext,
  ) {
    const results: Array<{
      clonedProductId: string;
      isPublishedToMarket: boolean;
      isActiveForSale: boolean;
    }> = [];

    for (const clonedProductId of dto.clonedProductIds) {
      const updated = await this.updateMerchantClonePublishStatus(
        clonedProductId,
        {
          isPublishedToMarket: dto.isPublishedToMarket,
          isActiveForSale: dto.isPublishedToMarket,
        },
        tenantContext,
      );
      results.push({
        clonedProductId: updated.clonedProductId,
        isPublishedToMarket: updated.isPublishedToMarket,
        isActiveForSale: updated.isActiveForSale,
      });
    }

    return {
      updatedCount: results.length,
      isPublishedToMarket: dto.isPublishedToMarket,
      results,
    };
  }

  async createCategory(dto: CreateCatalogCategoryDto) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      try {
        return await tx.sokoCatalogCategory.create({
          data: {
            categoryCode: dto.categoryCode.trim().toUpperCase(),
            nameSw: dto.nameSw.trim(),
            nameEn: dto.nameEn.trim(),
            imagekitFolderPath: dto.imagekitFolderPath.trim(),
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException(
            `Catalog category ${dto.categoryCode.trim().toUpperCase()} already exists.`,
          );
        }
        throw error;
      }
    });
  }

  async addGlobalCatalogItem(dto: AddGlobalCatalogItemDto) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      try {
        const created = await tx.sokoGlobalCatalog.create({
          data: {
            canonicalSku: dto.canonicalSku.trim().toUpperCase(),
            fixedNameSw: dto.fixedNameSw.trim(),
            fixedNameEn: dto.fixedNameEn.trim(),
            categoryCode: dto.categoryCode.trim().toUpperCase(),
            staticImageUrl: dto.imagekitCdnUrl.trim(),
            imagekitCdnUrl: dto.imagekitCdnUrl.trim(),
            baseQuantumUnit: dto.baseQuantumUnit?.trim() || 'QUANTA_250G',
          },
        });

        return {
          ...created,
          clonedByStoresCount: Number(created.clonedByStoresCount),
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException(
            `Canonical SKU ${dto.canonicalSku.trim().toUpperCase()} already exists in soko_global_catalog.`,
          );
        }
        throw error;
      }
    });
  }

  async updateGlobalCatalogItem(globalCatalogId: string, dto: UpdateGlobalCatalogItemDto) {
    const existing = await this.prismaService.sokoGlobalCatalog.findUnique({
      where: { id: globalCatalogId },
      select: { id: true, canonicalSku: true },
    });

    if (!existing) {
      throw new NotFoundException(
        `Global catalog item ${globalCatalogId} was not found.`,
      );
    }

    if (dto.categoryCode) {
      const category = await this.prismaService.sokoCatalogCategory.findUnique({
        where: { categoryCode: dto.categoryCode.trim().toUpperCase() },
        select: { categoryCode: true },
      });
      if (!category) {
        throw new BadRequestException(
          `Category ${dto.categoryCode.trim().toUpperCase()} does not exist.`,
        );
      }
    }

    const data: Prisma.SokoGlobalCatalogUpdateInput = {};
    if (dto.fixedNameSw !== undefined) data.fixedNameSw = dto.fixedNameSw.trim();
    if (dto.fixedNameEn !== undefined) data.fixedNameEn = dto.fixedNameEn.trim();
    if (dto.categoryCode !== undefined) data.categoryCode = dto.categoryCode.trim().toUpperCase();
    if (dto.imagekitCdnUrl !== undefined) {
      const url = dto.imagekitCdnUrl.trim();
      data.imagekitCdnUrl = url;
      // Keep the legacy static column in sync so clones/thumbnails never regress.
      data.staticImageUrl = url;
    }
    if (dto.baseQuantumUnit !== undefined) data.baseQuantumUnit = dto.baseQuantumUnit.trim();
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prismaService.sokoGlobalCatalog.update({
      where: { id: globalCatalogId },
      data,
    });

    return {
      ...updated,
      clonedByStoresCount: Number(updated.clonedByStoresCount),
    };
  }

  async listGlobalCatalog(categoryCode?: string, q?: string) {
    const where: Prisma.SokoGlobalCatalogWhereInput = { isActive: true };
    if (categoryCode) {
      where.categoryCode = categoryCode.trim().toUpperCase();
    }
    if (q && q.trim().length > 0) {
      const term = q.trim();
      where.OR = [
        { fixedNameSw: { contains: term, mode: 'insensitive' } },
        { fixedNameEn: { contains: term, mode: 'insensitive' } },
        { canonicalSku: { contains: term, mode: 'insensitive' } },
      ];
    }

    const items = await this.prismaService.sokoGlobalCatalog.findMany({
      where,
      include: {
        productUnits: {
          where: { isActive: true },
          include: { systemUnit: true },
          orderBy: { quarterQuantaPerUnit: 'asc' },
        },
        standardPrices: {
          where: { isActive: true },
          include: {
            globalProductUnit: {
              include: { systemUnit: true },
            },
          },
          orderBy: [{ version: 'desc' }, { minQty: 'asc' }],
        },
      },
      orderBy: [{ clonedByStoresCount: 'desc' }, { fixedNameSw: 'asc' }],
      take: 200,
    });

    return items.map((item) => {
      const units = item.productUnits ?? [];
      const unitCategory = deriveUnitCategory({
        systemUnitCategories: units.map((u) => u.systemUnit.category),
        baseQuantumUnit: item.baseQuantumUnit,
        categoryCode: item.categoryCode,
      });
      const stdRetail = (item.standardPrices ?? []).find((p) => p.profileType === 'RETAIL');
      const stdWholesale = (item.standardPrices ?? []).find((p) => p.profileType === 'WHOLESALE');

      return {
        ...item,
        clonedByStoresCount: Number(item.clonedByStoresCount),
        unitCategory,
        availableUnits: units.map((u) => ({
          id: u.id,
          unitCode: u.systemUnit.unitCode,
          category: u.systemUnit.category,
          abbreviation: u.systemUnit.abbreviation,
          displayLabelSw: u.displayLabelSw || u.systemUnit.nameSw,
          displayLabelEn: u.displayLabelEn || u.systemUnit.nameEn,
          quarterQuantaPerUnit: u.quarterQuantaPerUnit,
          isWholesaleUnit: u.isWholesaleUnit,
        })),
        standardRetailPriceTzs: stdRetail ? Number(stdRetail.standardPriceTzs) : null,
        standardRetailUnitLabelSw:
          stdRetail?.globalProductUnit?.displayLabelSw ||
          stdRetail?.globalProductUnit?.systemUnit?.nameSw ||
          null,
        standardWholesalePriceTzs: stdWholesale ? Number(stdWholesale.standardPriceTzs) : null,
        standardWholesaleUnitLabelSw:
          stdWholesale?.globalProductUnit?.displayLabelSw ||
          stdWholesale?.globalProductUnit?.systemUnit?.nameSw ||
          null,
      };
    });
  }

  private async generateSupplierSmsItemCode(
    tx: Prisma.TransactionClient,
    sellerBusinessId: string,
    canonicalSku: string,
  ): Promise<string> {
    const seed =
      canonicalSku.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 4).padEnd(4, 'X') || 'SUPX';

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = `${seed}${randomBytes(2).toString('hex').toUpperCase()}`;
      const existing = await tx.product.findUnique({
        where: {
          sellerBusinessId_smsItemCode: {
            sellerBusinessId,
            smsItemCode: candidate,
          },
        },
        select: { id: true },
      });
      if (!existing) return candidate;
    }

    throw new ConflictException(
      'Could not allocate a unique Supplier warehouse item code. Please retry.',
    );
  }

  /**
   * Base-Zero Merchant Shelf Cloning:
   * Strictly initializes cloned product at 0 Quarter-Quanta stock and 0 TZS,
   * copies only the ImageKit CDN pointer, and avoids double-counting on idempotent replay.
   */
  async cloneStandardCatalogItem(
    dto: CloneStandardCatalogDto,
    tenantContext?: TenantContext,
  ) {
    let targetMerchantId = tenantContext?.businessId ?? null;

    if (tenantContext?.isSuperAdmin && dto.retailerBusinessId) {
      targetMerchantId = dto.retailerBusinessId;
    } else if (
      dto.retailerBusinessId &&
      targetMerchantId &&
      dto.retailerBusinessId !== targetMerchantId
    ) {
      throw new ForbiddenException(
        'Cross-Merchant catalog cloning denied: tenant mismatch.',
      );
    }

    if (!targetMerchantId) {
      throw new ForbiddenException(
        'Authenticated Merchant tenant context is required for catalog cloning.',
      );
    }

    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const masterItem = await tx.sokoGlobalCatalog.findUnique({
        where: { id: dto.globalCatalogId },
      });

      if (!masterItem || !masterItem.isActive) {
        throw new NotFoundException(
          `Global catalog SKU ${dto.globalCatalogId} was not found or is inactive.`,
        );
      }

      if (tenantContext?.tier === 'MANUFACTURER_SUPPLIER') {
        const existingWarehouseProduct = await tx.product.findFirst({
          where: {
            sellerBusinessId: targetMerchantId,
            globalCatalogId: masterItem.id,
          },
          select: {
            id: true,
            smsItemCode: true,
            baseQuarterQuantaStock: true,
            unitPriceTzs: true,
          },
        });

        if (existingWarehouseProduct) {
          return {
            localInventoryId: existingWarehouseProduct.id,
            productId: existingWarehouseProduct.id,
            globalCatalogId: masterItem.id,
            retailerBusinessId: targetMerchantId,
            supplierBusinessId: targetMerchantId,
            canonicalSku: masterItem.canonicalSku,
            imagekitCdnUrl: masterItem.imagekitCdnUrl,
            initializedStockQuanta: existingWarehouseProduct.baseQuarterQuantaStock,
            initializedPriceTzs: Number(existingWarehouseProduct.unitPriceTzs),
            updatedClonedByStoresCount: Number(masterItem.clonedByStoresCount),
            idempotentReplay: true,
            committedAtEat: new Date().toISOString(),
          };
        }

        const smsItemCode = await this.generateSupplierSmsItemCode(
          tx,
          targetMerchantId,
          masterItem.canonicalSku,
        );
        const createdWarehouseProduct = await tx.product.create({
          data: {
            sellerBusinessId: targetMerchantId,
            globalCatalogId: masterItem.id,
            smsItemCode,
            nameEn: masterItem.fixedNameEn,
            nameSw: masterItem.fixedNameSw,
            cartonPriceTzs: 0n,
            dozenPriceTzs: 0n,
            packPriceTzs: 0n,
            unitPriceTzs: 0n,
            baseQuarterQuantaStock: 0,
            sealedBulkPackagesStock: 0,
            lowStockThresholdQuanta: 20,
            isActive: true,
          },
          select: { id: true, createdAt: true },
        });

        const refreshedMaster = await tx.sokoGlobalCatalog.update({
          where: { id: masterItem.id },
          data: { clonedByStoresCount: { increment: 1 } },
          select: { clonedByStoresCount: true },
        });

        await this.outboxService.enqueue(
          {
            aggregateType: 'SupplierWarehouseProduct',
            aggregateId: createdWarehouseProduct.id,
            eventType: 'GlobalCatalogClonedBaseZeroEvent',
            routingKey: 'catalog.global.cloned.supplier',
            payload: {
              localInventoryId: createdWarehouseProduct.id,
              productId: createdWarehouseProduct.id,
              globalCatalogId: masterItem.id,
              supplierBusinessId: targetMerchantId,
              canonicalSku: masterItem.canonicalSku,
            },
          },
          tx,
        );

        return {
          localInventoryId: createdWarehouseProduct.id,
          productId: createdWarehouseProduct.id,
          globalCatalogId: masterItem.id,
          retailerBusinessId: targetMerchantId,
          supplierBusinessId: targetMerchantId,
          canonicalSku: masterItem.canonicalSku,
          imagekitCdnUrl: masterItem.imagekitCdnUrl,
          initializedStockQuanta: 0,
          initializedPriceTzs: 0,
          updatedClonedByStoresCount: Number(refreshedMaster.clonedByStoresCount),
          idempotentReplay: false,
          committedAtEat: createdWarehouseProduct.createdAt.toISOString(),
        };
      }

      const existingClone = await tx.merchantClonedProduct.findUnique({
        where: {
          retailerBusinessId_globalCatalogId: {
            retailerBusinessId: targetMerchantId,
            globalCatalogId: dto.globalCatalogId,
          },
        },
      });

      if (existingClone) {
        return {
          localInventoryId: existingClone.id,
          globalCatalogId: masterItem.id,
          retailerBusinessId: targetMerchantId,
          canonicalSku: masterItem.canonicalSku,
          imagekitCdnUrl: existingClone.imagekitCdnUrl || masterItem.imagekitCdnUrl,
          initializedStockQuanta: existingClone.availableQuantaStock,
          initializedPriceTzs: Number(existingClone.unitPriceTzs),
          updatedClonedByStoresCount: Number(masterItem.clonedByStoresCount),
          idempotentReplay: true,
          committedAtEat: new Date().toISOString(),
        };
      }

      const createdClone = await tx.merchantClonedProduct.create({
        data: {
          retailerBusinessId: targetMerchantId,
          globalCatalogId: masterItem.id,
          availableQuantaStock: 0,
          unitPriceTzs: 0n,
          inventoryValueTzs: 0n,
          lastBuyingPricePerQuantumTzs: 0n,
          weightedAvgBuyingCostPerQuantumTzs: 0n,
          buyingPriceEstablished: false,
          imagekitCdnUrl: masterItem.imagekitCdnUrl,
        },
      });

      const refreshedMaster = await tx.sokoGlobalCatalog.findUnique({
        where: { id: masterItem.id },
        select: { clonedByStoresCount: true },
      });

      const inheritedProductUnits =
        tx.globalProductUnit && typeof tx.globalProductUnit.findMany === 'function'
          ? await tx.globalProductUnit.findMany({
              where: { globalCatalogId: masterItem.id, isActive: true },
              include: { systemUnit: true },
              orderBy: { quarterQuantaPerUnit: 'asc' },
            })
          : [];

      const availableStandardPrices =
        tx.globalCatalogStandardPrice &&
        typeof tx.globalCatalogStandardPrice.findMany === 'function'
          ? await tx.globalCatalogStandardPrice.findMany({
              where: { globalCatalogId: masterItem.id, isActive: true },
              orderBy: [{ version: 'desc' }, { minQty: 'asc' }],
            })
          : [];

      await this.outboxService.enqueue(
        {
          aggregateType: 'MerchantClonedProduct',
          aggregateId: createdClone.id,
          eventType: 'GlobalCatalogClonedBaseZeroEvent',
          routingKey: 'catalog.global.cloned',
          payload: {
            localInventoryId: createdClone.id,
            globalCatalogId: masterItem.id,
            retailerBusinessId: targetMerchantId,
            canonicalSku: masterItem.canonicalSku,
          },
        },
        tx,
      );

      return {
        localInventoryId: createdClone.id,
        globalCatalogId: masterItem.id,
        retailerBusinessId: targetMerchantId,
        canonicalSku: masterItem.canonicalSku,
        imagekitCdnUrl: createdClone.imagekitCdnUrl,
        initializedStockQuanta: 0,
        initializedPriceTzs: 0,
        inventoryValueTzs: 0,
        lastBuyingPricePerQuantumTzs: 0,
        weightedAvgBuyingCostPerQuantumTzs: 0,
        buyingPriceEstablished: false,
        inheritedProductUnits,
        availableStandardPrices: availableStandardPrices.map((p) => ({
          id: p.id,
          globalProductUnitId: p.globalProductUnitId,
          profileType: p.profileType,
          version: p.version,
          minQty: p.minQty,
          maxQty: p.maxQty,
          standardPriceTzs: Number(p.standardPriceTzs),
        })),
        updatedClonedByStoresCount: Number(
          refreshedMaster?.clonedByStoresCount ?? masterItem.clonedByStoresCount,
        ),
        idempotentReplay: false,
        committedAtEat: new Date().toISOString(),
      };
    });
  }

  async createMerchantProduct(
    dto: CreateMerchantProductDto,
    tenantContext?: TenantContext,
  ) {
    const sellerBusinessId = tenantContext?.businessId;
    if (!sellerBusinessId) {
      throw new ForbiddenException(
        'Authenticated Merchant tenant context is required to create products.',
      );
    }

    try {
      const created = await this.prismaService.product.create({
        data: {
          sellerBusinessId,
          globalCatalogId: dto.globalCatalogId ?? null,
          smsItemCode: dto.smsItemCode.trim().toUpperCase(),
          nameEn: dto.nameEn.trim(),
          nameSw: dto.nameSw.trim(),
          cartonPriceTzs: BigInt(dto.cartonPriceTzs),
          dozenPriceTzs: BigInt(dto.dozenPriceTzs),
          packPriceTzs: BigInt(dto.packPriceTzs),
          unitPriceTzs: BigInt(dto.unitPriceTzs),
          baseQuarterQuantaStock: dto.baseQuarterQuantaStock ?? 0,
          sealedBulkPackagesStock: dto.sealedBulkPackagesStock ?? 0,
          sealedParentUnitType: (dto.sealedParentUnitType ?? 'SACK_50KG') as PackagingUnit,
          quantaPerSealedPackage: dto.quantaPerSealedPackage ?? 200,
          lowStockThresholdQuanta: dto.lowStockThresholdQuanta ?? 20,
        },
      });

      return {
        ...created,
        cartonPriceTzs: Number(created.cartonPriceTzs),
        dozenPriceTzs: Number(created.dozenPriceTzs),
        packPriceTzs: Number(created.packPriceTzs),
        unitPriceTzs: Number(created.unitPriceTzs),
        wholesaleMinWeightKg: Number(created.wholesaleMinWeightKg),
        version: Number(created.version),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `Product SMS code ${dto.smsItemCode.trim().toUpperCase()} already exists for this Merchant.`,
        );
      }
      throw error;
    }
  }

  /**
   * Edit an existing Merchant product's vipimo (unit mapping), prices and stock.
   * Scoped to the authenticated tenant so one Merchant cannot edit another's SKUs.
   */
  async updateMerchantProduct(
    productId: string,
    dto: UpdateMerchantProductDto,
    tenantContext?: TenantContext,
  ) {
    const existing = await this.prismaService.product.findUnique({
      where: { id: productId },
      select: { id: true, sellerBusinessId: true, smsItemCode: true },
    });

    if (!existing) {
      throw new NotFoundException(`Product ${productId} was not found.`);
    }

    if (
      !tenantContext?.isSuperAdmin &&
      existing.sellerBusinessId !== tenantContext?.businessId
    ) {
      throw new ForbiddenException('You may only edit products belonging to your own business.');
    }

    const data: Prisma.ProductUncheckedUpdateInput = {};
    if (dto.nameSw !== undefined) data.nameSw = dto.nameSw.trim();
    if (dto.nameEn !== undefined) data.nameEn = dto.nameEn.trim();
    if (dto.cartonPriceTzs !== undefined) data.cartonPriceTzs = BigInt(dto.cartonPriceTzs);
    if (dto.dozenPriceTzs !== undefined) data.dozenPriceTzs = BigInt(dto.dozenPriceTzs);
    if (dto.packPriceTzs !== undefined) data.packPriceTzs = BigInt(dto.packPriceTzs);
    if (dto.unitPriceTzs !== undefined) data.unitPriceTzs = BigInt(dto.unitPriceTzs);
    if (dto.cartonUnits !== undefined) data.cartonUnits = dto.cartonUnits;
    if (dto.baseQuarterQuantaStock !== undefined) {
      data.baseQuarterQuantaStock = dto.baseQuarterQuantaStock;
    }
    if (dto.sealedBulkPackagesStock !== undefined) {
      data.sealedBulkPackagesStock = dto.sealedBulkPackagesStock;
    }
    if (dto.sealedParentUnitType !== undefined) {
      data.sealedParentUnitType = dto.sealedParentUnitType as PackagingUnit;
    }
    if (dto.quantaPerSealedPackage !== undefined) {
      data.quantaPerSealedPackage = dto.quantaPerSealedPackage;
    }
    if (dto.lowStockThresholdQuanta !== undefined) {
      data.lowStockThresholdQuanta = dto.lowStockThresholdQuanta;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prismaService.product.update({
      where: { id: productId },
      data,
    });

    return {
      ...updated,
      cartonPriceTzs: Number(updated.cartonPriceTzs),
      dozenPriceTzs: Number(updated.dozenPriceTzs),
      packPriceTzs: Number(updated.packPriceTzs),
      unitPriceTzs: Number(updated.unitPriceTzs),
      wholesaleMinWeightKg: Number(updated.wholesaleMinWeightKg),
      version: Number(updated.version),
    };
  }

  async getMerchantMarketSettings(
    tenantContext?: TenantContext,
    requestedBusinessId?: string,
  ) {
    const businessId = tenantContext?.isSuperAdmin
      ? requestedBusinessId ?? tenantContext?.businessId
      : tenantContext?.businessId;

    if (!businessId) {
      throw new ForbiddenException(
        'Authenticated Merchant tenant context is required to read market delivery settings.',
      );
    }

    const profile = await this.prismaService.businessProfile.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        businessName: true,
        tier: true,
        offersFreeDelivery: true,
      },
    });

    if (!profile) {
      throw new NotFoundException(`Merchant ${businessId} was not found.`);
    }

    return {
      businessId: profile.id,
      businessName: profile.businessName,
      tier: profile.tier,
      offersFreeDelivery: profile.offersFreeDelivery,
    };
  }

  async updateFreeDelivery(
    dto: UpdateFreeDeliveryDto,
    tenantContext?: TenantContext,
  ) {
    const businessId = tenantContext?.businessId;
    if (!businessId) {
      throw new ForbiddenException(
        'Authenticated Merchant tenant context is required to update delivery settings.',
      );
    }

    const updated = await this.prismaService.businessProfile.update({
      where: { id: businessId },
      data: {
        offersFreeDelivery: dto.offersFreeDelivery,
        version: { increment: 1 },
      },
      select: {
        id: true,
        businessName: true,
        offersFreeDelivery: true,
      },
    });

    return {
      businessId: updated.id,
      businessName: updated.businessName,
      offersFreeDelivery: updated.offersFreeDelivery,
    };
  }

  async publishMarketStock(
    dto: PublishMarketStockDto,
    tenantContext?: TenantContext,
  ) {
    const businessId = tenantContext?.businessId;
    if (!businessId) {
      throw new ForbiddenException(
        'Authenticated Merchant tenant context is required to publish market stock.',
      );
    }

    const quantityByProduct = new Map<string, number>();
    for (const item of dto.items) {
      quantityByProduct.set(
        item.productId,
        (quantityByProduct.get(item.productId) ?? 0) + item.quantityQuanta,
      );
    }

    const productIds = Array.from(quantityByProduct.keys());
    const ownedProducts = await this.prismaService.product.findMany({
      where: { id: { in: productIds }, sellerBusinessId: businessId },
      select: { id: true },
    });

    if (ownedProducts.length !== productIds.length) {
      throw new ForbiddenException(
        'One or more selected products do not belong to the authenticated Merchant.',
      );
    }

    const updatedProducts = await this.prismaService.runInTransaction(
      'Serializable',
      async (tx) => {
        for (const [productId, quantityQuanta] of quantityByProduct) {
          await tx.product.update({
            where: { id: productId },
            data: {
              baseQuarterQuantaStock: { increment: quantityQuanta },
              isActive: true,
              version: { increment: 1 },
            },
          });
        }

        return tx.product.findMany({
          where: { id: { in: productIds }, sellerBusinessId: businessId },
          select: {
            id: true,
            smsItemCode: true,
            nameSw: true,
            nameEn: true,
            baseQuarterQuantaStock: true,
          },
          orderBy: { nameSw: 'asc' },
        });
      },
    );

    return {
      businessId,
      publishedCount: updatedProducts.length,
      products: updatedProducts.map((product) => ({
        productId: product.id,
        sku: product.smsItemCode,
        nameSw: product.nameSw,
        nameEn: product.nameEn,
        availableQuarterQuanta: product.baseQuarterQuantaStock,
      })),
    };
  }

  async upsertProductPriceTier(
    productId: string,
    dto: UpsertProductPriceTierDto,
    tenantContext?: TenantContext,
  ) {
    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
      include: {
        seller: {
          select: { id: true, tier: true },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product ${productId} was not found.`);
    }

    if (
      !tenantContext?.isSuperAdmin &&
      product.sellerBusinessId !== tenantContext?.businessId
    ) {
      throw new ForbiddenException('Cross-Merchant price tier modification denied.');
    }

    assertChannelHarmonyForTier({
      merchantTier: product.seller.tier as MerchantTier,
      unitType: dto.unitType,
      isWholesaleTier: dto.isWholesaleTier,
    });

    const tierRow = await this.prismaService.productPriceTier.upsert({
      where: {
        productId_unitType_isWholesaleTier: {
          productId,
          unitType: dto.unitType as PackagingUnit,
          isWholesaleTier: dto.isWholesaleTier,
        },
      },
      update: {
        quarterQuantaPerUnit: dto.quarterQuantaPerUnit,
        priceTzs: BigInt(dto.priceTzs),
        isActive: true,
      },
      create: {
        productId,
        unitType: dto.unitType as PackagingUnit,
        quarterQuantaPerUnit: dto.quarterQuantaPerUnit,
        priceTzs: BigInt(dto.priceTzs),
        isWholesaleTier: dto.isWholesaleTier,
      },
    });

    return {
      ...tierRow,
      priceTzs: Number(tierRow.priceTzs),
    };
  }

  async upsertCustomMerchantUnit(
    productId: string,
    dto: UpsertCustomMerchantUnitDto,
    tenantContext?: TenantContext,
  ) {
    const quarterQuantaPerUnit = kgToQuarterQuantaChecked(dto.baseKg);

    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
      include: {
        seller: {
          select: { id: true, tier: true },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product ${productId} was not found.`);
    }

    if (
      !tenantContext?.isSuperAdmin &&
      product.sellerBusinessId !== tenantContext?.businessId
    ) {
      throw new ForbiddenException('Cross-Merchant custom unit modification denied.');
    }

    const normalizedCode = dto.unitCode.trim().toUpperCase();
    assertChannelHarmonyForCustomUnit({
      merchantTier: product.seller.tier as MerchantTier,
      unitCode: normalizedCode,
      quarterQuantaPerUnit,
      isWholesaleTier: dto.isWholesaleTier,
    });

    const saved = await this.prismaService.merchantCustomUnit.upsert({
      where: {
        productId_unitCode: {
          productId,
          unitCode: normalizedCode,
        },
      },
      update: {
        unitLabel: dto.unitLabel.trim(),
        baseKg: new Prisma.Decimal(dto.baseKg),
        quarterQuantaPerUnit,
        priceTzs: BigInt(dto.priceTzs),
        isWholesaleTier: dto.isWholesaleTier,
        isActive: true,
      },
      create: {
        productId,
        unitCode: normalizedCode,
        unitLabel: dto.unitLabel.trim(),
        baseKg: new Prisma.Decimal(dto.baseKg),
        quarterQuantaPerUnit,
        priceTzs: BigInt(dto.priceTzs),
        isWholesaleTier: dto.isWholesaleTier,
      },
    });

    return {
      ...saved,
      baseKg: Number(saved.baseKg),
      priceTzs: Number(saved.priceTzs),
    };
  }

  async listActiveProductsByMerchant(businessId: string) {
    const [products, merchantClones] = await Promise.all([
      this.prismaService.product.findMany({
        where: {
          sellerBusinessId: businessId,
          isActive: true,
        },
        include: {
          globalCatalog: {
            select: {
              imagekitCdnUrl: true,
              staticImageUrl: true,
              baseQuantumUnit: true,
              categoryCode: true,
              productUnits: {
                where: { isActive: true },
                include: { systemUnit: true },
              },
            },
          },
          priceTiers: {
            where: { isActive: true },
            orderBy: { quarterQuantaPerUnit: 'asc' },
          },
          customUnits: {
            where: { isActive: true },
            orderBy: { quarterQuantaPerUnit: 'asc' },
          },
        },
        orderBy: { nameSw: 'asc' },
      }),
      this.prismaService.merchantClonedProduct &&
      typeof this.prismaService.merchantClonedProduct.findMany === 'function'
        ? this.prismaService.merchantClonedProduct.findMany({
            where: { retailerBusinessId: businessId, isActive: true },
            select: {
              id: true,
              globalCatalogId: true,
              availableQuantaStock: true,
              lastBuyingPricePerQuantumTzs: true,
              weightedAvgBuyingCostPerQuantumTzs: true,
              unitPriceTzs: true,
              isPublishedToMarket: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const cloneByGlobalId = new Map(
      merchantClones.map((c) => [c.globalCatalogId, c]),
    );

    return products.map((product) => {
      const clone = product.globalCatalogId
        ? cloneByGlobalId.get(product.globalCatalogId)
        : undefined;
      const units = product.globalCatalog?.productUnits ?? [];
      const unitCategory = deriveUnitCategory({
        systemUnitCategories: units.map((u) => u.systemUnit.category),
        baseQuantumUnit: product.globalCatalog?.baseQuantumUnit,
        categoryCode: product.globalCatalog?.categoryCode,
      });
      const sellingPriceTzs =
        clone && Number(clone.unitPriceTzs) > 0
          ? Number(clone.unitPriceTzs)
          : Number(product.unitPriceTzs);

      return {
        productId: product.id,
        sellerBusinessId: product.sellerBusinessId,
        globalCatalogId: product.globalCatalogId,
        clonedProductId: clone?.id ?? null,
        sku: product.smsItemCode,
        imagekitCdnUrl:
          product.globalCatalog?.imagekitCdnUrl || product.globalCatalog?.staticImageUrl || '',
        nameSw: product.nameSw,
        nameEn: product.nameEn,
        unitPriceTzs: Number(product.unitPriceTzs),
        sellingPriceTzs,
        cartonPriceTzs: Number(product.cartonPriceTzs),
        dozenPriceTzs: Number(product.dozenPriceTzs),
        packPriceTzs: Number(product.packPriceTzs),
        cartonUnits: product.cartonUnits,
        quantaPerSealedPackage: product.quantaPerSealedPackage,
        sealedParentUnitType: product.sealedParentUnitType,
        lowStockThresholdQuanta: product.lowStockThresholdQuanta,
        wholesaleThresholdUnits: product.wholesaleMinUnitsThreshold,
        availableQuarterQuanta: product.baseQuarterQuantaStock,
        availableQuantaStock: clone?.availableQuantaStock ?? product.baseQuarterQuantaStock,
        lastBuyingPricePerQuantumTzs: clone ? Number(clone.lastBuyingPricePerQuantumTzs) : 0,
        weightedAvgBuyingCostPerQuantumTzs: clone
          ? Number(clone.weightedAvgBuyingCostPerQuantumTzs)
          : 0,
        unitCategory,
        isPublishedToMarket: clone ? clone.isPublishedToMarket : product.isActive,
        sealedBulkPackagesStock: product.sealedBulkPackagesStock,
        priceTiers: product.priceTiers.map((tier) => ({
          id: tier.id,
          unitType: tier.unitType,
          quarterQuantaPerUnit: tier.quarterQuantaPerUnit,
          priceTzs: Number(tier.priceTzs),
          isWholesaleTier: tier.isWholesaleTier,
        })),
        customUnits: product.customUnits.map((unit) => ({
          id: unit.id,
          unitCode: unit.unitCode,
          unitLabel: unit.unitLabel,
          baseKg: Number(unit.baseKg),
          quarterQuantaPerUnit: unit.quarterQuantaPerUnit,
          priceTzs: Number(unit.priceTzs),
          isWholesaleTier: unit.isWholesaleTier,
        })),
      };
    });
  }

  async getIntelligentCatalogView(
    wholesalerBusinessId: string,
    tenantContext?: TenantContext,
  ) {
    const buyerBusinessId = tenantContext?.businessId;
    if (!buyerBusinessId && !tenantContext?.isSuperAdmin) {
      throw new ForbiddenException(
        'Authenticated Merchant tenant context is required.',
      );
    }

    return this.prismaService.runInTransaction('RepeatableRead', async (tx) => {
      const sellerProducts = await tx.product.findMany({
        where: {
          sellerBusinessId: wholesalerBusinessId,
          isActive: true,
        },
        include: {
          globalCatalog: {
            select: {
              imagekitCdnUrl: true,
              staticImageUrl: true,
              baseQuantumUnit: true,
              categoryCode: true,
              productUnits: {
                where: { isActive: true },
                include: { systemUnit: true },
              },
            },
          },
          priceTiers: {
            where: { isActive: true, isWholesaleTier: true },
            orderBy: { quarterQuantaPerUnit: 'asc' },
          },
        },
        orderBy: { nameSw: 'asc' },
      });

      const buyerClones = buyerBusinessId
        ? await tx.merchantClonedProduct.findMany({
            where: { retailerBusinessId: buyerBusinessId, isActive: true },
            select: {
              globalCatalogId: true,
              availableQuantaStock: true,
              lowStockThresholdQuanta: true,
              lastBuyingPricePerQuantumTzs: true,
              weightedAvgBuyingCostPerQuantumTzs: true,
              unitPriceTzs: true,
              isPublishedToMarket: true,
            },
          })
        : [];

      const sellerClones =
        tx.merchantClonedProduct && typeof tx.merchantClonedProduct.findMany === 'function'
          ? await tx.merchantClonedProduct.findMany({
              where: { retailerBusinessId: wholesalerBusinessId, isActive: true },
              select: {
                globalCatalogId: true,
                availableQuantaStock: true,
                lastBuyingPricePerQuantumTzs: true,
                weightedAvgBuyingCostPerQuantumTzs: true,
                unitPriceTzs: true,
                isPublishedToMarket: true,
              },
            })
          : [];

      const cloneMap = new Map(
        buyerClones.map((clone) => [clone.globalCatalogId, clone]),
      );
      const sellerCloneMap = new Map(
        sellerClones.map((clone) => [clone.globalCatalogId, clone]),
      );

      const enriched = sellerProducts.map((product) => {
        const buyerShelf = product.globalCatalogId
          ? cloneMap.get(product.globalCatalogId)
          : undefined;
        const sellerClone = product.globalCatalogId
          ? sellerCloneMap.get(product.globalCatalogId)
          : undefined;
        const requiresUrgentReorder = buyerShelf
          ? buyerShelf.availableQuantaStock <= buyerShelf.lowStockThresholdQuanta
          : false;
        const wholesalePriceTzs = product.priceTiers[0]
          ? Number(product.priceTiers[0].priceTzs)
          : Number(product.cartonPriceTzs);
        const sellingPriceTzs = wholesalePriceTzs > 0 ? wholesalePriceTzs : Number(product.unitPriceTzs);
        const units = product.globalCatalog?.productUnits ?? [];
        const unitCategory = deriveUnitCategory({
          systemUnitCategories: units.map((u) => u.systemUnit.category),
          baseQuantumUnit: product.globalCatalog?.baseQuantumUnit,
          categoryCode: product.globalCatalog?.categoryCode,
        });

        return {
          productId: product.id,
          globalCatalogId: product.globalCatalogId,
          sku: product.smsItemCode,
          nameSw: product.nameSw,
          nameEn: product.nameEn,
          imagekitCdnUrl:
            product.globalCatalog?.imagekitCdnUrl ||
            product.globalCatalog?.staticImageUrl ||
            '',
          wholesalePriceTzs,
          sellingPriceTzs,
          moqLabel: `${product.wholesaleMinUnitsThreshold} Vifungashio`,
          wholesalerStockQuanta: product.baseQuarterQuantaStock,
          availableQuantaStock: sellerClone?.availableQuantaStock ?? product.baseQuarterQuantaStock,
          lastBuyingPricePerQuantumTzs: buyerShelf
            ? Number(buyerShelf.lastBuyingPricePerQuantumTzs)
            : 0,
          weightedAvgBuyingCostPerQuantumTzs: buyerShelf
            ? Number(buyerShelf.weightedAvgBuyingCostPerQuantumTzs)
            : 0,
          unitCategory,
          isPublishedToMarket: sellerClone ? sellerClone.isPublishedToMarket : product.isActive,
          buyerShelfQuanta: buyerShelf?.availableQuantaStock ?? null,
          requiresUrgentReorder,
        };
      });

      enriched.sort((a, b) => {
        if (a.requiresUrgentReorder !== b.requiresUrgentReorder) {
          return a.requiresUrgentReorder ? -1 : 1;
        }
        return a.nameSw.localeCompare(b.nameSw);
      });

      return enriched;
    });
  }

  // ===========================================================================
  // Governance — reversible deletes owned by Admin or by the tenant itself
  // ===========================================================================

  private assertTenantOwnership(
    ownerBusinessId: string,
    tenantContext: TenantContext | undefined,
    action: string,
  ): void {
    if (!tenantContext?.isSuperAdmin && ownerBusinessId !== tenantContext?.businessId) {
      throw new ForbiddenException(`You may only ${action} data belonging to your own business.`);
    }
  }

  async deleteCategory(categoryId: string) {
    const existing = await this.prismaService.sokoCatalogCategory.findUnique({
      where: { id: categoryId },
      select: { id: true, categoryCode: true, isActive: true },
    });
    if (!existing) {
      throw new NotFoundException(`Catalog category ${categoryId} was not found.`);
    }

    if (existing.isActive) {
      await this.prismaService.sokoCatalogCategory.update({
        where: { id: categoryId },
        data: { isActive: false },
      });
    }

    return {
      categoryId: existing.id,
      categoryCode: existing.categoryCode,
      isActive: false,
      deleted: true,
      idempotentReplay: !existing.isActive,
    };
  }

  async deleteGlobalCatalogItem(globalCatalogId: string) {
    const existing = await this.prismaService.sokoGlobalCatalog.findUnique({
      where: { id: globalCatalogId },
      select: { id: true, canonicalSku: true, isActive: true },
    });
    if (!existing) {
      throw new NotFoundException(`Global catalog item ${globalCatalogId} was not found.`);
    }

    if (existing.isActive) {
      await this.prismaService.sokoGlobalCatalog.update({
        where: { id: globalCatalogId },
        data: { isActive: false },
      });
    }

    return {
      globalCatalogId: existing.id,
      canonicalSku: existing.canonicalSku,
      isActive: false,
      deleted: true,
      idempotentReplay: !existing.isActive,
    };
  }

  async updateMerchantClone(
    clonedProductId: string,
    dto: UpdateMerchantCloneDto,
    tenantContext?: TenantContext,
  ) {
    const existing = await this.prismaService.merchantClonedProduct.findUnique({
      where: { id: clonedProductId },
      select: { id: true, retailerBusinessId: true, isActive: true },
    });
    if (!existing || !existing.isActive) {
      throw new NotFoundException(`Cloned catalog item ${clonedProductId} was not found.`);
    }
    this.assertTenantOwnership(existing.retailerBusinessId, tenantContext, 'edit');

    const updated = await this.prismaService.merchantClonedProduct.update({
      where: { id: clonedProductId },
      data: {
        availableQuantaStock: dto.availableQuantaStock,
        lowStockThresholdQuanta: dto.lowStockThresholdQuanta,
        imagekitCdnUrl: dto.imagekitCdnUrl?.trim(),
      },
    });

    return {
      clonedProductId: updated.id,
      retailerBusinessId: updated.retailerBusinessId,
      availableQuantaStock: updated.availableQuantaStock,
      lowStockThresholdQuanta: updated.lowStockThresholdQuanta,
      imagekitCdnUrl: updated.imagekitCdnUrl,
      updatedAtEat: updated.updatedAt.toISOString(),
    };
  }

  async deleteMerchantClone(clonedProductId: string, tenantContext?: TenantContext) {
    const existing = await this.prismaService.merchantClonedProduct.findUnique({
      where: { id: clonedProductId },
      select: { id: true, retailerBusinessId: true, isActive: true },
    });
    if (!existing) {
      throw new NotFoundException(`Cloned catalog item ${clonedProductId} was not found.`);
    }
    this.assertTenantOwnership(existing.retailerBusinessId, tenantContext, 'delete');

    const updated = await this.prismaService.merchantClonedProduct.update({
      where: { id: clonedProductId },
      data: { isActive: false, deletedAt: new Date() },
      select: { id: true, deletedAt: true },
    });

    return {
      clonedProductId: updated.id,
      deleted: true,
      deletedAtEat: updated.deletedAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  async restoreMerchantClone(clonedProductId: string, tenantContext?: TenantContext) {
    const existing = await this.prismaService.merchantClonedProduct.findUnique({
      where: { id: clonedProductId },
      select: { id: true, retailerBusinessId: true },
    });
    if (!existing) {
      throw new NotFoundException(`Cloned catalog item ${clonedProductId} was not found.`);
    }
    this.assertTenantOwnership(existing.retailerBusinessId, tenantContext, 'restore');

    await this.prismaService.merchantClonedProduct.update({
      where: { id: clonedProductId },
      data: { isActive: true, deletedAt: null },
    });

    return { clonedProductId: existing.id, restored: true };
  }

  async deleteMerchantProduct(productId: string, tenantContext?: TenantContext) {
    const existing = await this.prismaService.product.findUnique({
      where: { id: productId },
      select: { id: true, sellerBusinessId: true, isActive: true },
    });
    if (!existing) {
      throw new NotFoundException(`Product ${productId} was not found.`);
    }
    this.assertTenantOwnership(existing.sellerBusinessId, tenantContext, 'delete');

    if (existing.isActive) {
      await this.prismaService.product.update({
        where: { id: productId },
        data: { isActive: false },
      });
    }

    return { productId: existing.id, deleted: true, isActive: false };
  }

  async deletePriceTier(
    productId: string,
    tierId: string,
    tenantContext?: TenantContext,
  ) {
    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
      select: { id: true, sellerBusinessId: true },
    });
    if (!product) {
      throw new NotFoundException(`Product ${productId} was not found.`);
    }
    this.assertTenantOwnership(product.sellerBusinessId, tenantContext, 'delete');

    const tier = await this.prismaService.productPriceTier.findFirst({
      where: { id: tierId, productId },
      select: { id: true },
    });
    if (!tier) {
      throw new NotFoundException(`Price tier ${tierId} was not found on this product.`);
    }

    await this.prismaService.productPriceTier.update({
      where: { id: tierId },
      data: { isActive: false },
    });

    return { productId, tierId, deleted: true, isActive: false };
  }

  async deleteCustomUnit(
    productId: string,
    unitId: string,
    tenantContext?: TenantContext,
  ) {
    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
      select: { id: true, sellerBusinessId: true },
    });
    if (!product) {
      throw new NotFoundException(`Product ${productId} was not found.`);
    }
    this.assertTenantOwnership(product.sellerBusinessId, tenantContext, 'delete');

    const unit = await this.prismaService.merchantCustomUnit.findFirst({
      where: { id: unitId, productId },
      select: { id: true },
    });
    if (!unit) {
      throw new NotFoundException(`Custom unit ${unitId} was not found on this product.`);
    }

    await this.prismaService.merchantCustomUnit.update({
      where: { id: unitId },
      data: { isActive: false },
    });

    return { productId, unitId, deleted: true, isActive: false };
  }
}
