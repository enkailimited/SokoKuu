import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  BusinessTier,
  PackagingUnit,
  Prisma,
  StandardPricingProfileType,
} from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { assertChannelHarmonyForTier } from '@modules/05-catalog/channel-harmony.policy';
import { safeMultiplyIntegerTzs } from '@modules/06-inventory/quarter-quanta.util';
import { CalculateQuoteDto, CalculateStandardPricingQuoteDto } from './dto/pricing.dto';

export const DEFAULT_QUARTER_QUANTA_BY_UNIT: Record<PackagingUnit, number> = {
  QUARTER_KILO_LITRE: 1,
  HALF_KILO_LITRE: 2,
  THREE_QUARTER_KILO: 3,
  SINGLE_KILO_LITRE: 4,
  UNIT: 4,
  PACK: 4,
  DOZEN: 48,
  CARTON: 96,
  SACK_25KG: 100,
  SACK_50KG: 200,
};

export interface EvaluatedLinePricing {
  productId: string;
  sellerBusinessId: string;
  nameSw: string;
  nameEn: string;
  unitType: PackagingUnit;
  quantity: number;
  quarterQuantaPerUnit: number;
  totalQuarterQuanta: number;
  unitPriceTzs: number;
  lineTotalTzs: number;
  isWholesaleTierApplied: boolean;
  pricingRuleReason: string;
}

export interface CalculatedOrderQuote {
  sellerBusinessId: string;
  sellerBusinessName: string;
  sellerTier: BusinessTier;
  isPlatformManaged: boolean;
  currency: 'TZS';
  itemsSubtotalTzs: number;
  deliveryFeeTzs: number;
  expectedTotalTzs: number;
  totalQuarterQuanta: number;
  lines: EvaluatedLinePricing[];
}

@Injectable()
export class PricingRoutingEngine {
  constructor(private readonly prismaService: PrismaService) {}

  async calculateOrderQuote(
    dto: CalculateQuoteDto,
    tx?: Prisma.TransactionClient,
  ): Promise<CalculatedOrderQuote> {
    if (tx) {
      return this.evaluateQuoteWithClient(dto, tx);
    }
    return this.prismaService.runInTransaction('RepeatableRead', (client) =>
      this.evaluateQuoteWithClient(dto, client),
    );
  }

  private async evaluateQuoteWithClient(
    dto: CalculateQuoteDto,
    client: Prisma.TransactionClient,
  ): Promise<CalculatedOrderQuote> {
    const seller = await client.businessProfile.findUnique({
      where: { id: dto.sellerBusinessId },
      select: {
        id: true,
        businessName: true,
        tier: true,
        isOpen: true,
        isPlatformManaged: true,
      },
    });

    if (!seller) {
      throw new NotFoundException(`Seller Merchant ${dto.sellerBusinessId} was not found.`);
    }
    if (!seller.isOpen) {
      throw new UnprocessableEntityException(
        `Seller Merchant ${seller.businessName} is currently closed for orders.`,
      );
    }

    const uniqueProductIds = Array.from(new Set(dto.items.map((item) => item.productId)));
    const products = await client.product.findMany({
      where: {
        id: { in: uniqueProductIds },
        isActive: true,
      },
      include: {
        priceTiers: {
          where: { isActive: true },
        },
      },
    });

    const productMap = new Map(products.map((product) => [product.id, product]));
    const lines: EvaluatedLinePricing[] = [];
    let itemsSubtotalTzs = 0;
    let totalQuarterQuanta = 0;

    for (const reqItem of dto.items) {
      const product = productMap.get(reqItem.productId);
      if (!product) {
        throw new NotFoundException(`Product ${reqItem.productId} was not found or is inactive.`);
      }

      if (product.sellerBusinessId !== seller.id) {
        throw new UnprocessableEntityException(
          `SINGLE_STORE_ISOLATION_VIOLATION: Product ${reqItem.productId} does not belong to Merchant ${seller.id}.`,
        );
      }

      const retailTier = product.priceTiers.find(
        (t) => t.unitType === reqItem.unitType && !t.isWholesaleTier,
      );
      const wholesaleTier = product.priceTiers.find(
        (t) => t.unitType === reqItem.unitType && t.isWholesaleTier,
      );

      const fallbackQuanta =
        reqItem.unitType === product.sealedParentUnitType
          ? product.quantaPerSealedPackage
          : DEFAULT_QUARTER_QUANTA_BY_UNIT[reqItem.unitType];

      const preliminaryQuantaPerUnit =
        wholesaleTier?.quarterQuantaPerUnit ??
        retailTier?.quarterQuantaPerUnit ??
        fallbackQuanta;

      const itemTotalQuanta = preliminaryQuantaPerUnit * reqItem.quantity;
      if (!Number.isSafeInteger(itemTotalQuanta) || itemTotalQuanta < reqItem.quantity) {
        throw new BadRequestException('Invalid Quarter-Quanta quantity calculation.');
      }

      const minUnitsThreshold = Math.max(1, product.wholesaleMinUnitsThreshold ?? 1);
      const minQuantaThreshold = Math.max(
        1,
        product.wholesaleMinQuarterQuanta ??
          Math.max(1, Math.round(Number(product.wholesaleMinWeightKg ?? 1) * 4)),
      );

      let isWholesaleTierApplied = false;
      let pricingRuleReason = 'RETAIL_BASE_TIER';

      if (seller.tier === 'WHOLESALE_HUB') {
        assertChannelHarmonyForTier({
          merchantTier: 'WHOLESALE_HUB',
          unitType: reqItem.unitType,
          isWholesaleTier: true,
        });
        isWholesaleTierApplied = true;
        pricingRuleReason = 'WHOLESALE_HUB_ENFORCED';
      } else if (seller.tier === 'RETAIL_DUKA') {
        assertChannelHarmonyForTier({
          merchantTier: 'RETAIL_DUKA',
          unitType: reqItem.unitType,
          isWholesaleTier: false,
        });
        isWholesaleTierApplied = false;
        pricingRuleReason = 'RETAIL_DUKA_ENFORCED';
      } else {
        // HYBRID_STORE dynamic threshold evaluation (volume OR total quarter-quanta crossover)
        const meetsThreshold =
          reqItem.quantity >= minUnitsThreshold || itemTotalQuanta >= minQuantaThreshold;
        if (wholesaleTier && meetsThreshold) {
          isWholesaleTierApplied = true;
          pricingRuleReason =
            itemTotalQuanta >= minQuantaThreshold
              ? 'HYBRID_WHOLESALE_QUANTA_CROSSOVER'
              : 'HYBRID_WHOLESALE_UNITS_CROSSOVER';
        } else if (!retailTier && wholesaleTier) {
          isWholesaleTierApplied = true;
          pricingRuleReason = 'HYBRID_WHOLESALE_BULK_UNIT';
        } else {
          isWholesaleTierApplied = false;
          pricingRuleReason = 'HYBRID_RETAIL_BELOW_THRESHOLD';
        }
      }

      const selectedTier = isWholesaleTierApplied
        ? wholesaleTier ?? retailTier
        : retailTier ?? wholesaleTier;

      const quarterQuantaPerUnit = selectedTier?.quarterQuantaPerUnit ?? fallbackQuanta;
      const finalItemQuanta = quarterQuantaPerUnit * reqItem.quantity;

      const unitPriceBigInt = selectedTier
        ? BigInt(selectedTier.priceTzs)
        : this.resolveFallbackUnitPriceBigInt(product, reqItem.unitType);

      const lineTotalTzs = safeMultiplyIntegerTzs(reqItem.quantity, unitPriceBigInt);
      const unitPriceTzs = Number(unitPriceBigInt);

      itemsSubtotalTzs += lineTotalTzs;
      totalQuarterQuanta += finalItemQuanta;

      if (itemsSubtotalTzs > Number.MAX_SAFE_INTEGER) {
        throw new BadRequestException('Order subtotal overflowed safe integer TZS limit.');
      }

      lines.push({
        productId: product.id,
        sellerBusinessId: seller.id,
        nameSw: product.nameSw,
        nameEn: product.nameEn,
        unitType: reqItem.unitType,
        quantity: reqItem.quantity,
        quarterQuantaPerUnit,
        totalQuarterQuanta: finalItemQuanta,
        unitPriceTzs,
        lineTotalTzs,
        isWholesaleTierApplied,
        pricingRuleReason,
      });
    }

    const deliveryFeeTzs = dto.deliveryFeeTzs ?? 0;
    const expectedTotalTzs = itemsSubtotalTzs + deliveryFeeTzs;

    return {
      sellerBusinessId: seller.id,
      sellerBusinessName: seller.businessName,
      sellerTier: seller.tier,
      isPlatformManaged: seller.isPlatformManaged,
      currency: 'TZS',
      itemsSubtotalTzs,
      deliveryFeeTzs,
      expectedTotalTzs,
      totalQuarterQuanta,
      lines,
    };
  }

  private resolveFallbackUnitPriceBigInt(
    product: {
      cartonPriceTzs: bigint;
      dozenPriceTzs: bigint;
      packPriceTzs: bigint;
      unitPriceTzs: bigint;
      quantaPerSealedPackage: number;
    },
    unitType: PackagingUnit,
  ): bigint {
    switch (unitType) {
      case 'CARTON':
      case 'SACK_50KG':
      case 'SACK_25KG':
        return BigInt(product.cartonPriceTzs);
      case 'DOZEN':
        return BigInt(product.dozenPriceTzs);
      case 'PACK':
        return BigInt(product.packPriceTzs);
      default:
        return BigInt(product.unitPriceTzs);
    }
  }

  async evaluateStandardPricingQuote(dto: CalculateStandardPricingQuoteDto) {
    return this.prismaService.runInTransaction('RepeatableRead', async (tx) => {
      const unit = await tx.globalProductUnit.findFirst({
        where: {
          id: dto.globalProductUnitId,
          globalCatalogId: dto.globalCatalogId,
          isActive: true,
        },
        include: { systemUnit: true },
      });

      if (!unit) {
        throw new NotFoundException(
          `Product unit ${dto.globalProductUnitId} was not found for catalog SKU ${dto.globalCatalogId}.`,
        );
      }

      const profileType = (dto.profileType ?? 'WHOLESALE') as StandardPricingProfileType;
      const now = new Date();

      const matchingBrackets = await tx.globalCatalogStandardPrice.findMany({
        where: {
          globalCatalogId: dto.globalCatalogId,
          globalProductUnitId: dto.globalProductUnitId,
          profileType,
          isActive: true,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          minQty: { lte: dto.quantity },
        },
        orderBy: [{ version: 'desc' }, { minQty: 'desc' }],
      });

      const matchedBracket = matchingBrackets.find(
        (b) => b.maxQty === null || dto.quantity <= b.maxQty,
      );

      let merchantOverride: {
        id: string;
        effectiveSellingPriceTzs: bigint;
        isOverridden: boolean;
        standardPriceVersion: number | null;
      } | null = null;

      if (dto.clonedProductId) {
        merchantOverride = await tx.merchantUnitPricingOverride.findUnique({
          where: {
            clonedProductId_globalProductUnitId: {
              clonedProductId: dto.clonedProductId,
              globalProductUnitId: dto.globalProductUnitId,
            },
          },
          select: {
            id: true,
            effectiveSellingPriceTzs: true,
            isOverridden: true,
            standardPriceVersion: true,
          },
        });
      }

      const authoritativeUnitPriceBigInt =
        merchantOverride?.isOverridden
          ? merchantOverride.effectiveSellingPriceTzs
          : matchedBracket?.standardPriceTzs ?? merchantOverride?.effectiveSellingPriceTzs;

      if (!authoritativeUnitPriceBigInt) {
        throw new NotFoundException(
          `No active ${profileType} standard pricing bracket or Merchant price found for quantity ${dto.quantity}.`,
        );
      }

      const lineTotalTzs = safeMultiplyIntegerTzs(dto.quantity, authoritativeUnitPriceBigInt);
      const totalQuarterQuanta = unit.quarterQuantaPerUnit * dto.quantity;

      return {
        globalCatalogId: dto.globalCatalogId,
        globalProductUnitId: dto.globalProductUnitId,
        unitCode: unit.systemUnit.unitCode,
        quarterQuantaPerUnit: unit.quarterQuantaPerUnit,
        quantity: dto.quantity,
        totalQuarterQuanta,
        profileType,
        standardPriceId: matchedBracket?.id ?? null,
        standardPriceVersion: matchedBracket?.version ?? merchantOverride?.standardPriceVersion ?? null,
        matchedBracket: matchedBracket
          ? { minQty: matchedBracket.minQty, maxQty: matchedBracket.maxQty }
          : null,
        merchantOverrideApplied: Boolean(merchantOverride?.isOverridden),
        unitPriceTzs: Number(authoritativeUnitPriceBigInt),
        lineTotalTzs,
        currency: 'TZS' as const,
      };
    });
  }
}
