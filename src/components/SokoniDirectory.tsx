import { useState, useMemo } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  MapPin,
  Minus,
  Plus,
  ShoppingCart,
  Store,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import type { Locale } from '../data/i18n';

export interface SokoniStoreProfile {
  businessId: string;
  name: string;
  initials: string;
  tier: 'WHOLESALE_HUB' | 'HYBRID_STORE';
  ward: string;
  city: string;
  distanceMeters: number;
}

export interface StoreCatalogItem {
  productId: string;
  businessId: string;
  sku: string;
  titleSw: string;
  titleEn: string;
  packingLabelSw: string;
  packingLabelEn: string;
  moqLabelSw: string;
  moqLabelEn: string;
  wholesaleThresholdQty: number;
  retailPriceTzs: number;
  wholesalePriceTzs: number;
  stockPackagesAvailable: number;
}

// PostGIS proximity-sorted wholesale hubs in Dar es Salaam
const NEARBY_STORES: SokoniStoreProfile[] = [
  {
    businessId: '11111111-aaaa-4111-8111-000000000001',
    name: 'Mo Wholesale Hub',
    initials: 'MWH',
    tier: 'WHOLESALE_HUB',
    ward: 'Kariakoo',
    city: 'Dar es Salaam',
    distanceMeters: 300,
  },
  {
    businessId: '22222222-bbbb-4222-8222-000000000002',
    name: 'Bakhresa Group',
    initials: 'BG',
    tier: 'WHOLESALE_HUB',
    ward: 'Ilala',
    city: 'Dar es Salaam',
    distanceMeters: 620,
  },
  {
    businessId: '33333333-cccc-4333-8333-000000000003',
    name: 'Kilombero Wholesalers',
    initials: 'KW',
    tier: 'WHOLESALE_HUB',
    ward: 'Mchikichini',
    city: 'Dar es Salaam',
    distanceMeters: 950,
  },
  {
    businessId: '44444444-dddd-4444-8444-000000000004',
    name: 'Sinza Mseto Hub',
    initials: 'SMH',
    tier: 'HYBRID_STORE',
    ward: 'Sinza Mori',
    city: 'Dar es Salaam',
    distanceMeters: 1420,
  },
];

const STORE_CATALOG_DB: Record<string, StoreCatalogItem[]> = {
  '11111111-aaaa-4111-8111-000000000001': [
    {
      productId: 'p-mwh-azania',
      businessId: '11111111-aaaa-4111-8111-000000000001',
      sku: 'AZN-2KG-CTN',
      titleSw: 'Unga wa Ngano Azania (2kg × 12)',
      titleEn: 'Azania Wheat Flour (2kg × 12)',
      packingLabelSw: 'Katoni',
      packingLabelEn: 'Carton',
      moqLabelSw: 'Kiwango cha Chini: Katoni 2',
      moqLabelEn: 'Minimum Order: 2 Cartons',
      wholesaleThresholdQty: 2,
      retailPriceTzs: 43_000,
      wholesalePriceTzs: 40_800,
      stockPackagesAvailable: 45,
    },
    {
      productId: 'p-mwh-korie',
      businessId: '11111111-aaaa-4111-8111-000000000001',
      sku: 'KOR-1L-CTN',
      titleSw: 'Mafuta ya Kupikia Korie (1L × 12)',
      titleEn: 'Korie Cooking Oil (1L × 12)',
      packingLabelSw: 'Katoni',
      packingLabelEn: 'Carton',
      moqLabelSw: 'Kiwango cha Chini: Katoni 2',
      moqLabelEn: 'Minimum Order: 2 Cartons',
      wholesaleThresholdQty: 2,
      retailPriceTzs: 84_500,
      wholesalePriceTzs: 81_600,
      stockPackagesAvailable: 28,
    },
    {
      productId: 'p-mwh-sugar',
      businessId: '11111111-aaaa-4111-8111-000000000001',
      sku: 'KLM-5KG-BAL',
      titleSw: 'Sukari ya Kilombero (5kg × 4)',
      titleEn: 'Kilombero Sugar (5kg × 4)',
      packingLabelSw: 'Balo',
      packingLabelEn: 'Bale',
      moqLabelSw: 'Kiwango cha Chini: Balo 2',
      moqLabelEn: 'Minimum Order: 2 Bales',
      wholesaleThresholdQty: 2,
      retailPriceTzs: 86_000,
      wholesalePriceTzs: 83_600,
      stockPackagesAvailable: 34,
    },
    {
      productId: 'p-mwh-rice',
      businessId: '11111111-aaaa-4111-8111-000000000001',
      sku: 'MBY-25KG-SCK',
      titleSw: 'Mchele wa Mbeya Super (25kg)',
      titleEn: 'Mbeya Super Rice (25kg Sack)',
      packingLabelSw: 'Gunia 25KG',
      packingLabelEn: '25KG Sack',
      moqLabelSw: 'MOQ: Gunia 1',
      moqLabelEn: 'MOQ: 1 Sack',
      wholesaleThresholdQty: 3,
      retailPriceTzs: 64_000,
      wholesalePriceTzs: 60_500,
      stockPackagesAvailable: 60,
    },
  ],
  '22222222-bbbb-4222-8222-000000000002': [
    {
      productId: 'p-bg-sembe',
      businessId: '22222222-bbbb-4222-8222-000000000002',
      sku: 'AZM-SMB-25',
      titleSw: 'Azam Sembe Bora (25kg)',
      titleEn: 'Azam Sembe Flour (25kg)',
      packingLabelSw: 'Mfuko 25KG',
      packingLabelEn: '25KG Sack',
      moqLabelSw: 'Kiwango cha Chini: Mifuko 2',
      moqLabelEn: 'Minimum Order: 2 Sacks',
      wholesaleThresholdQty: 2,
      retailPriceTzs: 42_500,
      wholesalePriceTzs: 39_000,
      stockPackagesAvailable: 80,
    },
    {
      productId: 'p-bg-juice',
      businessId: '22222222-bbbb-4222-8222-000000000002',
      sku: 'AZM-EMB-CTN',
      titleSw: 'Azam Embe Juice (Katoni)',
      titleEn: 'Azam Mango Juice (Carton)',
      packingLabelSw: 'Katoni',
      packingLabelEn: 'Carton',
      moqLabelSw: 'MOQ: Katoni 3',
      moqLabelEn: 'MOQ: 3 Cartons',
      wholesaleThresholdQty: 3,
      retailPriceTzs: 19_500,
      wholesalePriceTzs: 17_800,
      stockPackagesAvailable: 55,
    },
  ],
  '33333333-cccc-4333-8333-000000000003': [
    {
      productId: 'p-kw-sugar50',
      businessId: '33333333-cccc-4333-8333-000000000003',
      sku: 'KLM-50KG-SCK',
      titleSw: 'Sukari ya Kilombero (Gunia 50kg)',
      titleEn: 'Kilombero Brown Sugar (50kg Sack)',
      packingLabelSw: 'Gunia 50KG',
      packingLabelEn: '50KG Sack',
      moqLabelSw: 'MOQ: Gunia 1',
      moqLabelEn: 'MOQ: 1 Sack',
      wholesaleThresholdQty: 2,
      retailPriceTzs: 162_000,
      wholesalePriceTzs: 156_000,
      stockPackagesAvailable: 42,
    },
  ],
  '44444444-dddd-4444-8444-000000000004': [
    {
      productId: 'p-smh-oil-1l',
      businessId: '44444444-dddd-4444-8444-000000000004',
      sku: 'SMH-OIL-1L',
      titleSw: 'Mafuta ya Korie (Lita 1 / Robo)',
      titleEn: 'Korie Oil (1L Loose / Carton)',
      packingLabelSw: 'Lita 1',
      packingLabelEn: '1 Litre',
      moqLabelSw: 'Bei ya Jumla kuanzia Lita 3+',
      moqLabelEn: 'Wholesale rate at 3+ Litres',
      wholesaleThresholdQty: 3,
      retailPriceTzs: 6_200,
      wholesalePriceTzs: 5_450,
      stockPackagesAvailable: 120,
    },
    {
      productId: 'p-smh-sugar-1k',
      businessId: '44444444-dddd-4444-8444-000000000004',
      sku: 'SMH-SUG-1K',
      titleSw: 'Sukari ya Kilombero (Kilo 1)',
      titleEn: 'Kilombero Sugar (1KG Loose)',
      packingLabelSw: 'Kilo 1',
      packingLabelEn: '1 KG',
      moqLabelSw: 'Bei ya Jumla kuanzia Kilo 5+',
      moqLabelEn: 'Wholesale rate at 5+ KG',
      wholesaleThresholdQty: 5,
      retailPriceTzs: 3_600,
      wholesalePriceTzs: 3_250,
      stockPackagesAvailable: 95,
    },
  ],
};

// ============================================================================
// SokoniDirectory.tsx — Refactored to max-w-2xl mx-auto container layout
// Mipaka ya Mpangilio: Inatumia max-w-2xl mx-auto ili kuzuia kukunjuka vibaya
// kwenye skrini kubwa za kompyuta (widescreen desktop monitors).
// ============================================================================
export function SokoniDirectory({ locale = 'en' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [selectedStore, setSelectedStore] = useState<SokoniStoreProfile | null>(null);
  const [cartQtyByProductId, setCartQtyByProductId] = useState<Record<string, number>>({});
  const [cartExpanded, setCartExpanded] = useState<boolean>(false);
  const [toastConfirmation, setToastConfirmation] = useState<{
    message: string;
    orderRef8: string;
    buyerPin4: string;
    totalTzs: number;
  } | null>(null);

  const handleOpenStore = (store: SokoniStoreProfile) => {
    setSelectedStore(store);
    setCartQtyByProductId({});
    setCartExpanded(false);
    setToastConfirmation(null);
  };

  const handleReturnToDirectory = () => {
    setSelectedStore(null);
    setCartQtyByProductId({});
    setCartExpanded(false);
  };

  const storeProducts = useMemo(() => {
    if (!selectedStore) return [];
    return (STORE_CATALOG_DB[selectedStore.businessId] ?? []).filter(
      (item) => item.businessId === selectedStore.businessId
    );
  }, [selectedStore]);

  const adjustQty = (item: StoreCatalogItem, delta: number) => {
    setCartQtyByProductId((prev) => {
      const current = prev[item.productId] ?? 0;
      const next = Math.max(0, Math.min(item.stockPackagesAvailable, current + delta));
      return { ...prev, [item.productId]: next };
    });
  };

  const cartStats = useMemo(() => {
    let totalUnits = 0;
    let totalCashTzs = 0;
    const activeLines: Array<{ item: StoreCatalogItem; qty: number; unitPrice: number; isWholesale: boolean }> = [];

    for (const item of storeProducts) {
      const qty = cartQtyByProductId[item.productId] ?? 0;
      if (qty <= 0) continue;
      const isWholesale = qty >= item.wholesaleThresholdQty;
      const unitPrice = isWholesale ? item.wholesalePriceTzs : item.retailPriceTzs;
      totalUnits += qty;
      totalCashTzs += qty * unitPrice;
      activeLines.push({ item, qty, unitPrice, isWholesale });
    }
    return { totalUnits, totalCashTzs, activeLines };
  }, [storeProducts, cartQtyByProductId]);

  const handleSubmitOrder = () => {
    if (!selectedStore || cartStats.activeLines.length === 0) return;

    const orderRef8 = Math.random().toString(36).substring(2, 10).toUpperCase();
    const buyerPin4 = String(Math.floor(1000 + Math.random() * 9000));

    setToastConfirmation({
      message: `Oda yako imetumwa kwa ${selectedStore.name}!`,
      orderRef8,
      buyerPin4,
      totalTzs: cartStats.totalCashTzs,
    });

    setCartQtyByProductId({});
    setCartExpanded(false);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Dynamic Confirmation Toast Banner */}
      {toastConfirmation && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 flex items-start justify-between gap-4 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-900">
                {toastConfirmation.message}
              </div>
              <div className="text-xs text-slate-700 font-mono tabular-nums">
                Oda #{toastConfirmation.orderRef8} · Taslimu: TZS{' '}
                {toastConfirmation.totalTzs.toLocaleString('en-US')} ·{' '}
                <span className="font-bold text-emerald-700">
                  PIN ya Mnunuzi (CoD): {toastConfirmation.buyerPin4}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setToastConfirmation(null)}
            className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
            aria-label="Dismiss confirmation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* SCREEN 1: Sokoni Store Directory View */}
      {!selectedStore ? (
        <section className="space-y-4">
          <div className="border-b border-slate-100 pb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight">
                {isSw ? 'Orodha ya Maduka' : 'Store Directory'}
              </h2>
              <p className="text-xs text-slate-500">
                {isSw
                  ? 'Maduka ya jumla yaliyo karibu nawe katika Dar es Salaam'
                  : 'Verified wholesale hubs near your shop in Dar es Salaam'}
              </p>
            </div>
            <span className="text-xs font-mono text-emerald-600 font-semibold">
              {NEARBY_STORES.length} {isSw ? 'maduka wazi' : 'active stores'}
            </span>
          </div>

          <div className="space-y-3">
            {NEARBY_STORES.map((store) => (
              <article
                key={store.businessId}
                className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  {/* Circular thumbnail box on the left for company logo */}
                  <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0 font-mono font-bold text-sm text-emerald-700">
                    {store.initials}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <h3 className="text-sm font-bold text-slate-900 truncate">{store.name}</h3>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {store.ward}, {store.city}
                      </span>
                    </div>
                    {/* PostGIS proximity distance badge */}
                    <div className="text-xs font-mono font-semibold text-emerald-600 tabular-nums">
                      📍 Mita {store.distanceMeters} karibu
                    </div>
                  </div>
                </div>

                {/* Concise, non-stretched emerald button labeled "Fungua Duka" */}
                <button
                  type="button"
                  onClick={() => handleOpenStore(store)}
                  className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                >
                  Fungua Duka
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : (
        /* SCREEN 2 & 3: Isolated Store Catalog & Slide-Up / Bottom Cart Sheet */
        <section className="space-y-4">
          {/* Store Top Context Bar */}
          <div className="bg-slate-900 text-white rounded-lg px-4 py-3.5 flex items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={handleReturnToDirectory}
                className="min-w-[40px] min-h-[40px] -ml-1 flex items-center justify-center rounded-md hover:bg-slate-800 text-white cursor-pointer"
                aria-label={isSw ? 'Rudi kwenye orodha ya maduka' : 'Back to directory'}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <div className="text-sm font-bold truncate">{selectedStore.name}</div>
                <div className="text-[11px] text-slate-300 truncate">
                  {selectedStore.ward} · Mita {selectedStore.distanceMeters} ·{' '}
                  {isSw ? 'Kikapu kimefungwa' : 'Store-isolated'}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCartExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-semibold font-mono tabular-nums whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShoppingCart className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{cartStats.totalUnits}</span>
            </button>
          </div>

          {/* Clean 2-column card grid template for product catalog */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {storeProducts.map((item) => {
              const qty = cartQtyByProductId[item.productId] ?? 0;
              const wholesaleApplied = qty >= item.wholesaleThresholdQty;
              const activePrice = wholesaleApplied ? item.wholesalePriceTzs : item.retailPriceTzs;

              return (
                <article
                  key={item.productId}
                  className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono text-slate-500">{item.sku}</span>
                      {wholesaleApplied && (
                        <span className="font-semibold text-emerald-600">
                          Bei ya Jumla Applied 🎉
                        </span>
                      )}
                    </div>

                    {/* Padded image preview frame */}
                    <div className="h-24 w-full rounded-md bg-white border border-slate-100 flex items-center justify-center p-2">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Store className="w-5 h-5 text-emerald-600" aria-hidden="true" />
                        <span className="text-xs font-mono font-medium">
                          {isSw ? item.packingLabelSw : item.packingLabelEn}
                        </span>
                      </div>
                    </div>

                    <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                      {isSw ? item.titleSw : item.titleEn}
                    </h3>
                    <div className="text-xs text-slate-500 font-mono">
                      {isSw ? item.moqLabelSw : item.moqLabelEn}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    <div>
                      <div
                        className={`text-sm font-bold font-mono tabular-nums ${
                          wholesaleApplied ? 'text-emerald-600' : 'text-slate-900'
                        }`}
                      >
                        TZS {activePrice.toLocaleString('en-US')}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {qty} {isSw ? 'vipimo' : 'units'}
                      </div>
                    </div>

                    {/* Compact volume counter row [-] quantity [+] */}
                    <div className="inline-flex items-center border border-slate-200 rounded-md bg-white">
                      <button
                        type="button"
                        aria-label={`Decrease ${item.sku}`}
                        onClick={() => adjustQty(item, -1)}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <span className="w-8 text-center text-sm font-bold font-mono tabular-nums text-slate-900">
                        {qty}
                      </span>
                      <button
                        type="button"
                        aria-label={`Increase ${item.sku}`}
                        onClick={() => adjustQty(item, 1)}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center text-white bg-emerald-600 hover:bg-emerald-700 rounded-r-md cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Integrated Cart & Checkout Slide-Up Sheet ("Kikapu chako") */}
          <div className="bg-white border border-slate-100 rounded-lg shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setCartExpanded((prev) => !prev)}
              className="w-full px-4 py-3.5 border-b border-slate-100 flex items-center justify-between text-sm font-bold text-slate-900 cursor-pointer hover:bg-slate-50/50"
            >
              <span>
                Kikapu chako ({cartStats.totalUnits} {isSw ? 'bidhaa' : 'items'})
              </span>
              {cartExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-500" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500" aria-hidden="true" />
              )}
            </button>

            {cartExpanded && (
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 space-y-2">
                {cartStats.activeLines.length === 0 ? (
                  <div className="text-xs text-slate-500 py-1">
                    {isSw
                      ? 'Chagua idadi kwa kutumia [+] kuongeza bidhaa kutoka duka hili.'
                      : 'Tap [+] on items above to build your order.'}
                  </div>
                ) : (
                  cartStats.activeLines.map(({ item, qty, unitPrice }) => (
                    <div
                      key={item.productId}
                      className="flex items-center justify-between text-xs text-slate-700 py-1"
                    >
                      <span className="truncate pr-2">
                        {qty} × {isSw ? item.titleSw : item.titleEn}
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                        TZS {(qty * unitPrice).toLocaleString('en-US')}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
              <div>
                <div className="text-xs text-slate-500">{isSw ? 'Jumla ya Cash (CoD)' : 'Total CoD Cash'}</div>
                <div className="text-xl font-bold font-mono tabular-nums text-emerald-600">
                  TZS {cartStats.totalCashTzs.toLocaleString('en-US')}
                </div>
              </div>

              <button
                type="button"
                disabled={cartStats.activeLines.length === 0}
                onClick={handleSubmitOrder}
                className="min-h-[48px] px-6 py-3 text-sm font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-500 transition-colors whitespace-nowrap cursor-pointer shadow-xs"
              >
                Tuma Ombi la Mzigo
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
