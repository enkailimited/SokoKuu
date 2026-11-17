import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PackagingUnit, Prisma } from '@prisma/client';
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
  CloneStandardCatalogDto,
  CreateCatalogCategoryDto,
  CreateMerchantProductDto,
  UpsertCustomMerchantUnitDto,
  UpsertProductPriceTierDto,
} from './dto/catalog.dto';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

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
      orderBy: [{ clonedByStoresCount: 'desc' }, { fixedNameSw: 'asc' }],
      take: 200,
    });

    return items.map((item) => ({
      ...item,
      clonedByStoresCount: Number(item.clonedByStoresCount),
    }));
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
    const products = await this.prismaService.product.findMany({
      where: {
        sellerBusinessId: businessId,
        isActive: true,
      },
      include: {
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
    });

    return products.map((product) => ({
      productId: product.id,
      sellerBusinessId: product.sellerBusinessId,
      sku: product.smsItemCode,
      nameSw: product.nameSw,
      nameEn: product.nameEn,
      unitPriceTzs: Number(product.unitPriceTzs),
      cartonPriceTzs: Number(product.cartonPriceTzs),
      wholesaleThresholdUnits: product.wholesaleMinUnitsThreshold,
      availableQuarterQuanta: product.baseQuarterQuantaStock,
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
    }));
  }

  async getIntelligentCatalogView(
    wholesalerBusinessId: string,
    tenantContext?: TenantContext,
  ) {
    const buyerBusinessId = tenantContext?.businessId;
    if (!buyerBusinessId && !tenantContext?.isSuperAdmin) {
      throw new ForbiddenException(
        'Authenticated Retailer Merchant tenant context is required.',
      );
    }

    return this.prismaService.runInTransaction('RepeatableRead', async (tx) => {
      const sellerProducts = await tx.product.findMany({
        where: {
          sellerBusinessId: wholesalerBusinessId,
          isActive: true,
        },
        include: {
          priceTiers: {
            where: { isActive: true, isWholesaleTier: true },
            orderBy: { quarterQuantaPerUnit: 'asc' },
          },
        },
        orderBy: { nameSw: 'asc' },
      });

      const buyerClones = buyerBusinessId
        ? await tx.merchantClonedProduct.findMany({
            where: { retailerBusinessId: buyerBusinessId },
            select: {
              globalCatalogId: true,
              availableQuantaStock: true,
              lowStockThresholdQuanta: true,
            },
          })
        : [];

      const cloneMap = new Map(
        buyerClones.map((clone) => [clone.globalCatalogId, clone]),
      );

      const enriched = sellerProducts.map((product) => {
        const buyerShelf = product.globalCatalogId
          ? cloneMap.get(product.globalCatalogId)
          : undefined;
        const requiresUrgentReorder = buyerShelf
          ? buyerShelf.availableQuantaStock <= buyerShelf.lowStockThresholdQuanta
          : false;
        const wholesalePriceTzs = product.priceTiers[0]
          ? Number(product.priceTiers[0].priceTzs)
          : Number(product.cartonPriceTzs);

        return {
          productId: product.id,
          sku: product.smsItemCode,
          nameSw: product.nameSw,
          nameEn: product.nameEn,
          wholesalePriceTzs,
          moqLabel: `${product.wholesaleMinUnitsThreshold} Vifungashio`,
          wholesalerStockQuanta: product.baseQuarterQuantaStock,
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
}
