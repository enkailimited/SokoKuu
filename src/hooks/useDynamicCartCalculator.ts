import { useCallback, useEffect, useMemo, useState } from 'react';

export type BusinessTierMode = 'WHOLESALE_HUB' | 'RETAIL_DUKA' | 'HYBRID_STORE';

export interface LocalCatalogProduct {
  productId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  sellerTier: BusinessTierMode;
  unitType: string;
  unitLabelSw: string;
  unitLabelEn: string;
  // Vipimo vinahifadhiwa kwa namba kamili za Robo (1 Robo = 1, 1L/1KG = 4) kuzuia makosa ya desimali
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
  appliedTierLabel: string; // "Bei ya Rejareja" au "Bei ya Jumla 🎉"
  activeUnitPriceTzs: number;
  lineTotalTzs: number;
  savingsTzs: number;
}

const IDB_NAME = 'sokokuu_dynamic_pricing_cache';
const IDB_STORE = 'hybrid_price_sheets';

export const DEFAULT_HYBRID_PRODUCTS: LocalCatalogProduct[] = [
  {
    productId: 'prod-azania-unga-1kg',
    sku: 'AZN-UNGA-1KG',
    nameSw: 'Unga wa Ngano Azania (Pakiti 1KG)',
    nameEn: 'Azania Wheat Flour (1KG Pack)',
    sellerTier: 'HYBRID_STORE',
    unitType: 'SINGLE_KILO_LITRE',
    unitLabelSw: 'Pakiti (1KG)',
    unitLabelEn: 'Pack (1KG)',
    quarterQuantaPerUnit: 4,
    wholesaleMinUnitsThreshold: 25, // Kuanzia pakiti 25 -> Bei ya Jumla
    wholesaleMinQuarterQuanta: 100, // 25KG
    retailUnitPriceTzs: 2_100,
    wholesaleUnitPriceTzs: 1_850,
    availableQuarterQuanta: 800,
  },
  {
    productId: 'prod-korie-oil-robo',
    sku: 'KOR-OIL-ROBO',
    nameSw: 'Mafuta ya Kupikia Korie (Kipimo cha Robo 250mL)',
    nameEn: 'Korie Cooking Oil (Robo 250mL)',
    sellerTier: 'HYBRID_STORE',
    unitType: 'QUARTER_KILO_LITRE',
    unitLabelSw: 'Robo Lita (250mL)',
    unitLabelEn: 'Quarter Litre (250mL)',
    quarterQuantaPerUnit: 1,
    wholesaleMinUnitsThreshold: 4, // Chini ya Lita 1 = Rejareja; kuanzia Robo 4 (Lita 1+) = Bei ya Jumla
    wholesaleMinQuarterQuanta: 4,
    retailUnitPriceTzs: 1_400,
    wholesaleUnitPriceTzs: 1_200,
    availableQuarterQuanta: 400,
  },
];

async function cacheAndReadPriceSheets(): Promise<LocalCatalogProduct[]> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return DEFAULT_HYBRID_PRODUCTS;
  }
  return new Promise((resolve) => {
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'productId' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const writeTx = db.transaction(IDB_STORE, 'readwrite');
      const store = writeTx.objectStore(IDB_STORE);
      DEFAULT_HYBRID_PRODUCTS.forEach((p) => store.put(p));
      writeTx.oncomplete = () => {
        const readTx = db.transaction(IDB_STORE, 'readonly');
        const allReq = readTx.objectStore(IDB_STORE).getAll();
        allReq.onsuccess = () => resolve((allReq.result as LocalCatalogProduct[]) || DEFAULT_HYBRID_PRODUCTS);
        allReq.onerror = () => resolve(DEFAULT_HYBRID_PRODUCTS);
      };
    };
    req.onerror = () => resolve(DEFAULT_HYBRID_PRODUCTS);
  });
}

export function useDynamicCartCalculator() {
  const [catalog, setCatalog] = useState<LocalCatalogProduct[]>(DEFAULT_HYBRID_PRODUCTS);
  const [quantities, setQuantities] = useState<Record<string, number>>({
    'prod-azania-unga-1kg': 1,
    'prod-korie-oil-robo': 2,
  });

  useEffect(() => {
    let active = true;
    cacheAndReadPriceSheets().then((rows) => {
      if (active && rows.length > 0) setCatalog(rows);
    });
    return () => {
      active = false;
    };
  }, []);

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

      // Mantiki ya Bei Kulingana na Kiasi (Dynamic Volume Routing):
      // Ikiwa duka ni HYBRID_STORE na kiasi au uzito umevuka kiwango cha chini cha jumla,
      // mfumo unahamisha bei moja kwa moja kutoka Rejareja kwenda Jumla.
      const crossesThreshold =
        product.sellerTier === 'WHOLESALE_HUB' ||
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
        appliedTierLabel: crossesThreshold ? 'Bei ya Jumla 🎉' : 'Bei ya Rejareja',
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
  };
}
