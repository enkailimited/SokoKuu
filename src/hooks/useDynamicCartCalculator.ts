import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';

export type BusinessTierMode = 'WHOLESALE' | 'RETAIL_DUKA' | 'HYBRID_STORE';

export interface LocalCatalogProduct {
  productId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  sellerTier: BusinessTierMode;
  unitType: string;
  unitLabelSw: string;
  unitLabelEn: string;
  quarterQuantaPerUnit: number;
  wholesaleMinUnitsThreshold: number;
  wholesaleMinQuarterQuanta: number;
  retailUnitPriceTzs: number;
  wholesaleUnitPriceTzs: number;
  availableQuarterQuanta: number;
}

export interface DynamicCartLine extends LocalCatalogProduct {
  quantity: number;
  totalQuarterQuanta: number;
  isWholesaleApplied: boolean;
  appliedTierLabel: string;
  activeUnitPriceTzs: number;
  lineTotalTzs: number;
  savingsTzs: number;
}

interface MerchantDto {
  businessId: string;
  businessName: string;
  tier: BusinessTierMode;
}

interface ActiveProductDto {
  productId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitPriceTzs: number;
  cartonPriceTzs: number;
  wholesaleThresholdUnits: number;
  availableQuarterQuanta: number;
  priceTiers: Array<{
    unitType: string;
    quarterQuantaPerUnit: number;
    priceTzs: number;
    isWholesaleTier: boolean;
  }>;
}

export function useDynamicCartCalculator(sellerBusinessId?: string | null) {
  const [catalog, setCatalog] = useState<LocalCatalogProduct[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(
    typeof window !== 'undefined' ? !window.navigator.onLine : false
  );
  const [apiError, setApiError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setLoading(true);
    setBackendOffline(false);
    setApiError(null);

    try {
      let targetSellerId = sellerBusinessId || null;
      let targetTier: BusinessTierMode = 'HYBRID_STORE';

      const merchants = await SokoApiClient.get<MerchantDto[]>(
        '/marketplace/merchants',
        false
      );
      const list = Array.isArray(merchants) ? merchants : [];

      if (targetSellerId) {
        const match = list.find((m) => m.businessId === targetSellerId);
        if (match) targetTier = match.tier;
      } else {
        const hybrid =
          list.find((m) => m.tier === 'HYBRID_STORE') ??
          list.find((m) => m.tier === 'WHOLESALE') ??
          list[0];
        if (hybrid) {
          targetSellerId = hybrid.businessId;
          targetTier = hybrid.tier;
        }
      }

      if (!targetSellerId) {
        setCatalog([]);
        return;
      }

      const products = await SokoApiClient.get<ActiveProductDto[]>(
        `/products/active?businessId=${encodeURIComponent(targetSellerId)}`,
        false
      );

      const mapped: LocalCatalogProduct[] = (Array.isArray(products) ? products : []).map(
        (p) => {
          const retailTier =
            p.priceTiers?.find((t) => !t.isWholesaleTier) ?? p.priceTiers?.[0];
          const wholesaleTier =
            p.priceTiers?.find(
              (t) => t.isWholesaleTier && t.unitType === retailTier?.unitType
            ) ??
            p.priceTiers?.find((t) => t.isWholesaleTier) ??
            retailTier;

          const unitType = retailTier?.unitType ?? wholesaleTier?.unitType ?? 'SINGLE_KILO_LITRE';
          const quarterQuantaPerUnit = Number(retailTier?.quarterQuantaPerUnit ?? 4);
          const wholesaleMinUnitsThreshold = Math.max(
            1,
            Number(p.wholesaleThresholdUnits ?? 10)
          );
          const retailUnitPriceTzs = Number(retailTier?.priceTzs ?? p.unitPriceTzs ?? 0);
          const wholesaleUnitPriceTzs = Number(wholesaleTier?.priceTzs ?? retailUnitPriceTzs);

          return {
            productId: p.productId,
            sku: p.sku,
            nameSw: p.nameSw,
            nameEn: p.nameEn,
            sellerTier: targetTier,
            unitType,
            unitLabelSw: unitType,
            unitLabelEn: unitType,
            quarterQuantaPerUnit,
            wholesaleMinUnitsThreshold,
            wholesaleMinQuarterQuanta: wholesaleMinUnitsThreshold * quarterQuantaPerUnit,
            retailUnitPriceTzs,
            wholesaleUnitPriceTzs,
            availableQuarterQuanta: Number(p.availableQuarterQuanta ?? 0),
          };
        }
      );

      setCatalog(mapped);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else if (err instanceof SokoHttpError) {
        setApiError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [sellerBusinessId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const updateQuantity = useCallback((productId: string, nextQty: number) => {
    setQuantities((prev) => ({
      ...prev,
      [productId]: Math.max(0, Math.floor(nextQty)),
    }));
  }, []);

  const cartLines = useMemo<DynamicCartLine[]>(() => {
    return catalog.map((product) => {
      const qty = quantities[product.productId] ?? 0;
      const totalQuarterQuanta = qty * product.quarterQuantaPerUnit;

      const crossesThreshold =
        product.sellerTier === 'WHOLESALE' ||
        (product.sellerTier === 'HYBRID_STORE' &&
          qty > 0 &&
          (qty >= product.wholesaleMinUnitsThreshold ||
            totalQuarterQuanta >= product.wholesaleMinQuarterQuanta));

      const activeUnitPriceTzs = crossesThreshold
        ? product.wholesaleUnitPriceTzs
        : product.retailUnitPriceTzs;

      const lineTotalTzs = qty * activeUnitPriceTzs;
      const retailBaselineTzs = qty * product.retailUnitPriceTzs;

      return {
        ...product,
        quantity: qty,
        totalQuarterQuanta,
        isWholesaleApplied: crossesThreshold,
        appliedTierLabel: crossesThreshold ? 'Bei ya Jumla' : 'Bei ya Rejareja',
        activeUnitPriceTzs,
        lineTotalTzs,
        savingsTzs: Math.max(0, retailBaselineTzs - lineTotalTzs),
      };
    });
  }, [catalog, quantities]);

  const grandTotalTzs = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.lineTotalTzs, 0),
    [cartLines]
  );

  const totalSavingsTzs = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.savingsTzs, 0),
    [cartLines]
  );

  return {
    cartLines,
    grandTotalTzs,
    totalSavingsTzs,
    updateQuantity,
    loading,
    backendOffline,
    apiError,
    reload,
  };
}
