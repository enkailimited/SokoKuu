import { BusinessTier, PackagingUnit, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';

function mapGlobalUnitToPackagingUnit(unitCode: string, quarterQuantaPerUnit: number): PackagingUnit {
  const code = unitCode.toUpperCase();
  if (code.includes('50KG') || (code.includes('GUNIA') && quarterQuantaPerUnit >= 200)) {
    return PackagingUnit.SACK_50KG;
  }
  if (code.includes('25KG') || code.includes('GUNIA') || code.includes('SACK')) {
    return PackagingUnit.SACK_25KG;
  }
  if (code.includes('CARTON') || code.includes('KATONI') || code.includes('DEBE')) {
    return PackagingUnit.CARTON;
  }
  if (code.includes('DOZEN') || code.includes('DAZANI')) {
    return PackagingUnit.DOZEN;
  }
  if (code.includes('PACK') || code.includes('PAKITI')) {
    return PackagingUnit.PACK;
  }
  if (quarterQuantaPerUnit === 1) return PackagingUnit.QUARTER_KILO_LITRE;
  if (quarterQuantaPerUnit === 2) return PackagingUnit.HALF_KILO_LITRE;
  if (quarterQuantaPerUnit === 3) return PackagingUnit.THREE_QUARTER_KILO;
  if (quarterQuantaPerUnit === 4) return PackagingUnit.SINGLE_KILO_LITRE;
  if (quarterQuantaPerUnit >= 200) return PackagingUnit.SACK_50KG;
  if (quarterQuantaPerUnit >= 100) return PackagingUnit.SACK_25KG;
  if (quarterQuantaPerUnit >= 48) return PackagingUnit.CARTON;
  return PackagingUnit.UNIT;
}

async function allocateUniqueSku(
  tx: Prisma.TransactionClient,
  sellerBusinessId: string,
  canonicalSku: string,
): Promise<string> {
  const cleaned = canonicalSku.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const base = cleaned.slice(0, 8) || 'SKU00001';
  const existingBase = await tx.product.findUnique({
    where: {
      sellerBusinessId_smsItemCode: {
        sellerBusinessId,
        smsItemCode: base,
      },
    },
    select: { id: true },
  });
  if (!existingBase) return base;

  const prefix = cleaned.slice(0, 4).padEnd(4, 'X');
  for (let i = 0; i < 12; i += 1) {
    const candidate = `${prefix}${randomBytes(2).toString('hex').toUpperCase()}`;
    const clash = await tx.product.findUnique({
      where: {
        sellerBusinessId_smsItemCode: {
          sellerBusinessId,
          smsItemCode: candidate,
        },
      },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `SK${randomBytes(3).toString('hex').toUpperCase()}`;
}

/**
 * Synchronizes a MerchantClonedProduct's stock, pricing, and market publish status
 * into the store-isolated `products` table so published cloned items are immediately
 * discoverable and orderable in Sokoni Marketplace & POS.
 * Guards optional tx properties so isolated Jest unit tests remain unaffected.
 */
export async function syncLinkedProductFromClone(
  tx: Prisma.TransactionClient,
  clonedProductId: string,
): Promise<void> {
  if (
    !tx.product ||
    typeof tx.product.findFirst !== 'function' ||
    !tx.merchantClonedProduct ||
    typeof tx.merchantClonedProduct.findUnique !== 'function'
  ) {
    return;
  }

  const cloned = await tx.merchantClonedProduct.findUnique({
    where: { id: clonedProductId },
    include: {
      globalCatalog: true,
      merchant: { select: { id: true, tier: true } },
      unitPricingOverrides: {
        where: { isActive: true },
        include: {
          globalProductUnit: {
            include: { systemUnit: true },
          },
        },
      },
    },
  });

  if (!cloned || !cloned.globalCatalog) return;

  const existingProduct = await tx.product.findFirst({
    where: {
      sellerBusinessId: cloned.retailerBusinessId,
      globalCatalogId: cloned.globalCatalogId,
    },
  });

  if (!existingProduct && !cloned.isPublishedToMarket) {
    return;
  }

  const overrides = cloned.unitPricingOverrides ?? [];
  const retailOverride =
    overrides.find((o) => o.globalProductUnit.quarterQuantaPerUnit === 4) ??
    overrides.find((o) => !o.globalProductUnit.isWholesaleUnit) ??
    overrides[0];
  const wholesaleOverride =
    overrides.find((o) => o.globalProductUnit.isWholesaleUnit) ??
    overrides.find((o) => o.globalProductUnit.quarterQuantaPerUnit >= 24) ??
    retailOverride;

  let baseUnitPriceTzs = cloned.unitPriceTzs > 0n ? cloned.unitPriceTzs : 0n;
  if (retailOverride && retailOverride.effectiveSellingPriceTzs > 0n) {
    const q = Math.max(1, retailOverride.globalProductUnit.quarterQuantaPerUnit);
    baseUnitPriceTzs =
      q === 4
        ? retailOverride.effectiveSellingPriceTzs
        : BigInt(Math.max(1, Math.round((Number(retailOverride.effectiveSellingPriceTzs) * 4) / q)));
  }
  if (baseUnitPriceTzs <= 0n && wholesaleOverride && wholesaleOverride.effectiveSellingPriceTzs > 0n) {
    const q = Math.max(1, wholesaleOverride.globalProductUnit.quarterQuantaPerUnit);
    baseUnitPriceTzs = BigInt(
      Math.max(1, Math.round((Number(wholesaleOverride.effectiveSellingPriceTzs) * 4) / q)),
    );
  }

  const resolvedUnitPrice = baseUnitPriceTzs > 0n ? baseUnitPriceTzs : 1n;
  const resolvedCartonPrice =
    wholesaleOverride && wholesaleOverride.effectiveSellingPriceTzs > 0n
      ? wholesaleOverride.effectiveSellingPriceTzs
      : resolvedUnitPrice * 12n;
  const resolvedDozenPrice = resolvedUnitPrice * 12n;
  const resolvedPackPrice = resolvedUnitPrice * 4n;

  let targetProductId: string;
  if (existingProduct) {
    const updated = await tx.product.update({
      where: { id: existingProduct.id },
      data: {
        nameSw: cloned.globalCatalog.fixedNameSw,
        nameEn: cloned.globalCatalog.fixedNameEn,
        baseQuarterQuantaStock: cloned.availableQuantaStock,
        lowStockThresholdQuanta: cloned.lowStockThresholdQuanta,
        unitPriceTzs: resolvedUnitPrice,
        cartonPriceTzs: resolvedCartonPrice,
        dozenPriceTzs: resolvedDozenPrice,
        packPriceTzs: resolvedPackPrice,
        isActive: cloned.isPublishedToMarket && cloned.isActiveForSale,
        version: { increment: 1 },
      },
      select: { id: true },
    });
    targetProductId = updated.id;
  } else {
    const smsItemCode = await allocateUniqueSku(
      tx,
      cloned.retailerBusinessId,
      cloned.globalCatalog.canonicalSku,
    );
    const created = await tx.product.create({
      data: {
        sellerBusinessId: cloned.retailerBusinessId,
        globalCatalogId: cloned.globalCatalogId,
        smsItemCode,
        nameSw: cloned.globalCatalog.fixedNameSw,
        nameEn: cloned.globalCatalog.fixedNameEn,
        unitPriceTzs: resolvedUnitPrice,
        packPriceTzs: resolvedPackPrice,
        dozenPriceTzs: resolvedDozenPrice,
        cartonPriceTzs: resolvedCartonPrice,
        baseQuarterQuantaStock: cloned.availableQuantaStock,
        sealedBulkPackagesStock: 0,
        lowStockThresholdQuanta: cloned.lowStockThresholdQuanta,
        isActive: cloned.isPublishedToMarket && cloned.isActiveForSale,
      },
      select: { id: true },
    });
    targetProductId = created.id;
  }

  if (tx.productPriceTier && typeof tx.productPriceTier.upsert === 'function') {
    const tierType = cloned.merchant?.tier ?? BusinessTier.RETAIL_DUKA;
    for (const ov of overrides) {
      const qpu = ov.globalProductUnit.quarterQuantaPerUnit;
      const mappedUnit = mapGlobalUnitToPackagingUnit(
        ov.globalProductUnit.systemUnit.unitCode,
        qpu,
      );
      const isWholesale =
        tierType === BusinessTier.WHOLESALE
          ? true
          : tierType === BusinessTier.RETAIL_DUKA
            ? false
            : ov.globalProductUnit.isWholesaleUnit;

      if (
        tierType === BusinessTier.WHOLESALE &&
        (['QUARTER_KILO_LITRE', 'HALF_KILO_LITRE', 'THREE_QUARTER_KILO', 'SINGLE_KILO_LITRE', 'PACK', 'UNIT'] as string[]).includes(
          mappedUnit,
        )
      ) {
        continue;
      }
      if (
        tierType === BusinessTier.RETAIL_DUKA &&
        (['SACK_50KG', 'SACK_25KG'] as string[]).includes(mappedUnit)
      ) {
        continue;
      }

      await tx.productPriceTier.upsert({
        where: {
          productId_unitType_isWholesaleTier: {
            productId: targetProductId,
            unitType: mappedUnit,
            isWholesaleTier: isWholesale,
          },
        },
        update: {
          quarterQuantaPerUnit: qpu,
          priceTzs: ov.effectiveSellingPriceTzs,
          isActive: true,
        },
        create: {
          productId: targetProductId,
          unitType: mappedUnit,
          quarterQuantaPerUnit: qpu,
          priceTzs: ov.effectiveSellingPriceTzs,
          isWholesaleTier: isWholesale,
          isActive: true,
        },
      });
    }
  }
}
