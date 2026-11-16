import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Store,
  Zap,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { recordOrderDispatchAuditTrace } from '../lib/sokoManagedState';

export interface RecommendedProduct {
  id: string;
  name: string;
  nameEn: string;
  priceTzs: number;
  moq: string;
  moqEn: string;
  availableStockQuanta: number;
  requiresUrgentReorder: boolean;
}

const DEFAULT_INTELLIGENT_CATALOG: RecommendedProduct[] = [
  {
    id: 'P01',
    name: 'Azania Unga wa Ngano (2kg × 12)',
    nameEn: 'Azania Wheat Flour (2kg × 12)',
    priceTzs: 81_600,
    moq: 'Katoni 2',
    moqEn: '2 Cartons',
    availableStockQuanta: 180,
    requiresUrgentReorder: true,
  },
  {
    id: 'P03',
    name: 'Kilombero Sukari ya Kayu (5kg × 4)',
    nameEn: 'Kilombero Brown Sugar (5kg × 4)',
    priceTzs: 39_600,
    moq: 'Dozen 1',
    moqEn: '1 Dozen',
    availableStockQuanta: 140,
    requiresUrgentReorder: true,
  },
  {
    id: 'P02',
    name: 'Korie Cooking Oil (1L × 12)',
    nameEn: 'Korie Cooking Oil (1L × 12)',
    priceTzs: 94_000,
    moq: 'Katoni 1',
    moqEn: '1 Carton',
    availableStockQuanta: 96,
    requiresUrgentReorder: false,
  },
  {
    id: 'P04',
    name: 'Mbeya Mchele Supa (50kg)',
    nameEn: 'Mbeya Super Rice (50kg)',
    priceTzs: 115_000,
    moq: 'Gunia 1',
    moqEn: '1 Sack',
    availableStockQuanta: 64,
    requiresUrgentReorder: false,
  },
];

export function SmartStoreCatalog({
  storeName,
  sellerBusinessId = '11111111-aaaa-4111-8111-000000000001',
  locale = 'sw',
  onClose,
  onOrderDispatched,
}: {
  storeName: string;
  sellerBusinessId?: string;
  locale?: Locale;
  onClose: () => void;
  onOrderDispatched?: (orderRef8: string) => void;
}) {
  const isSw = locale === 'sw';
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cartQuantities, setCartQuantities] = useState<Record<string, number>>({});
  const [dispatchedRef, setDispatchedRef] = useState<string | null>(null);

  // Local pre-sorted intelligent catalog stream (urgent_reorder DESC, product_name ASC)
  const [products] = useState<RecommendedProduct[]>(DEFAULT_INTELLIGENT_CATALOG);

  const updateCartQty = (id: string, delta: number) => {
    setDispatchedRef(null);
    setCartQuantities((prev) => {
      const current = prev[id] || 0;
      return { ...prev, [id]: Math.max(0, current + delta) };
    });
  };

  // Zero-network client-side search filtering across both Smart Re-Order & Regular Goods
  const { reorderRecommendations, regularProducts } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const sorted = [...products].sort((a, b) => {
      if (a.requiresUrgentReorder !== b.requiresUrgentReorder) {
        return a.requiresUrgentReorder ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const filtered = q
      ? sorted.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.nameEn.toLowerCase().includes(q) ||
            p.id.toLowerCase().includes(q)
        )
      : sorted;

    return {
      reorderRecommendations: filtered.filter((p) => p.requiresUrgentReorder),
      regularProducts: filtered.filter((p) => !p.requiresUrgentReorder),
    };
  }, [products, searchQuery]);

  const cartSummary = useMemo(() => {
    let totalItems = 0;
    let totalTzs = 0;
    const summaryParts: string[] = [];

    for (const prod of products) {
      const qty = cartQuantities[prod.id] || 0;
      if (qty > 0) {
        totalItems += qty;
        totalTzs += qty * prod.priceTzs;
        summaryParts.push(`${prod.name} (x${qty})`);
      }
    }

    return { totalItems, totalTzs, summaryText: summaryParts.join(' + ') };
  }, [products, cartQuantities]);

  const handleCheckoutReorder = () => {
    if (cartSummary.totalItems === 0) return;
    const orderRef8 = 'SK' + Math.random().toString(36).substring(2, 8).toUpperCase();
    recordOrderDispatchAuditTrace({
      orderRef8,
      sellerBusinessId,
      sellerBusinessName: storeName,
      totalCashDueTzs: cartSummary.totalTzs,
      itemsSummary: cartSummary.summaryText,
    });
    setCartQuantities({});
    setDispatchedRef(orderRef8);
    onOrderDispatched?.(orderRef8);
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-4 bg-slate-50 min-h-screen pb-32 font-sans antialiased">
      {/* IN-STORE BACK AND TITLE BAR */}
      <div className="flex justify-between items-center bg-white border border-slate-100 p-4 rounded-2xl shadow-sm">
        <div className="flex items-center space-x-2 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 font-bold text-xs pr-2 py-1 rounded-lg hover:bg-slate-50 cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>{isSw ? 'Rudi' : 'Back'}</span>
          </button>
          <div className="min-w-0">
            <span className="text-[9px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded uppercase border border-emerald-100">
              Sokoni Platform
            </span>
            <h2 className="text-base font-black text-slate-900 tracking-tight mt-0.5 flex items-center gap-1.5 truncate">
              <Store className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span className="truncate">{storeName}</span>
            </h2>
          </div>
        </div>
      </div>

      {/* DYNAMIC CLIENT-SIDE SEARCH BAR (Zero Redundant Network Fetches) */}
      <div className="bg-white border border-slate-100 rounded-2xl p-3.5 shadow-sm">
        <label htmlFor="smart-store-search" className="sr-only">
          {isSw ? 'Tafuta bidhaa ndani ya duka hili' : 'Search products inside this store'}
        </label>
        <div className="relative">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="smart-store-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-xs bg-slate-50 text-slate-900 font-medium focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none"
            placeholder={
              isSw
                ? 'Tafuta unga, mafuta, sukari ndani ya duka hili...'
                : 'Search flour, oil, sugar inside this store...'
            }
          />
        </div>
      </div>

      {dispatchedRef && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 flex items-center gap-2.5 text-xs font-semibold text-emerald-950"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
          <span>
            {isSw
              ? `Oda #${dispatchedRef} imetumwa kwa ${storeName} na arifa ya STOMP imerushwa.`
              : `Order #${dispatchedRef} dispatched to ${storeName} with STOMP alert broadcast.`}
          </span>
        </div>
      )}

      {/* SECTION 1: SMART RE-ORDER RECOMMENDATIONS (Locked at the Top!) */}
      {reorderRecommendations.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center space-x-1.5 px-1 text-emerald-700 font-black text-xs uppercase tracking-wider">
            <Zap className="w-3.5 h-3.5 text-emerald-600 animate-pulse shrink-0" aria-hidden="true" />
            <h3>
              {isSw
                ? 'Inashauriwa Ununue (Smart Re-Order)'
                : 'Urgent Re-Order Recommendations'}
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {reorderRecommendations.map((prod) => (
              <div
                key={prod.id}
                className="bg-white border-2 border-emerald-500 rounded-2xl p-4 shadow-sm flex justify-between items-center gap-3 relative overflow-hidden"
              >
                <span className="absolute top-0 right-0 bg-emerald-500 text-white font-black text-[9px] px-2.5 py-0.5 rounded-bl-xl uppercase tracking-wide inline-flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
                  <span>{isSw ? 'Stoo Yako Imeisha' : 'Low Shelf Stock'}</span>
                </span>
                <div className="space-y-1 min-w-0 pt-2">
                  <h4 className="font-bold text-slate-800 text-sm leading-snug">
                    {isSw ? prod.name : prod.nameEn}
                  </h4>
                  <p className="text-[10px] text-slate-500">
                    Min MOQ: {isSw ? prod.moq : prod.moqEn} · {prod.availableStockQuanta}Q
                  </p>
                  <h5 className="font-mono font-black text-slate-900 text-sm mt-1 tabular-nums">
                    TZS {prod.priceTzs.toLocaleString('en-US')}
                  </h5>
                </div>
                {/* Counter Control */}
                <div className="flex items-center space-x-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200 shrink-0 mt-3">
                  <button
                    type="button"
                    onClick={() => updateCartQty(prod.id, -1)}
                    aria-label={isSw ? `Punguza ${prod.name}` : `Decrease ${prod.nameEn}`}
                    className="w-7 h-7 bg-white border border-slate-200 rounded-lg text-slate-700 font-bold inline-flex items-center justify-center hover:bg-slate-100 cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <span className="font-mono font-bold text-sm px-1 min-w-[20px] text-center tabular-nums">
                    {cartQuantities[prod.id] || 0}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateCartQty(prod.id, 1)}
                    aria-label={isSw ? `Ongeza ${prod.name}` : `Increase ${prod.nameEn}`}
                    className="w-7 h-7 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold inline-flex items-center justify-center cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 2: REGULAR PRODUCTS CATALOG */}
      <div className="space-y-2.5">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider px-1">
          {isSw ? 'Bidhaa Nyinginezo za Duka' : 'Standard Warehouse Goods'}
        </h3>
        {regularProducts.length === 0 && reorderRecommendations.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
            {isSw
              ? `Hakuna bidhaa inayolingana na "${searchQuery}".`
              : `No products matched "${searchQuery}".`}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {regularProducts.map((prod) => (
              <div
                key={prod.id}
                className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex justify-between items-center gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <h4 className="font-bold text-slate-800 text-sm leading-snug">
                    {isSw ? prod.name : prod.nameEn}
                  </h4>
                  <p className="text-[10px] text-slate-500">
                    Min MOQ: {isSw ? prod.moq : prod.moqEn} · {prod.availableStockQuanta}Q
                  </p>
                  <h5 className="font-mono font-black text-slate-900 text-sm mt-1 tabular-nums">
                    TZS {prod.priceTzs.toLocaleString('en-US')}
                  </h5>
                </div>
                {/* Counter Control */}
                <div className="flex items-center space-x-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200 shrink-0">
                  <button
                    type="button"
                    onClick={() => updateCartQty(prod.id, -1)}
                    aria-label={isSw ? `Punguza ${prod.name}` : `Decrease ${prod.nameEn}`}
                    className="w-7 h-7 bg-white border border-slate-200 rounded-lg text-slate-700 font-bold inline-flex items-center justify-center hover:bg-slate-100 cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <span className="font-mono font-bold text-sm px-1 min-w-[20px] text-center tabular-nums">
                    {cartQuantities[prod.id] || 0}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateCartQty(prod.id, 1)}
                    aria-label={isSw ? `Ongeza ${prod.name}` : `Increase ${prod.nameEn}`}
                    className="w-7 h-7 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold inline-flex items-center justify-center cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sticky Bottom Re-Order Dispatch Bar */}
      {cartSummary.totalItems > 0 && (
        <div className="sticky bottom-4 z-20 bg-white border border-emerald-200 rounded-2xl p-3.5 shadow-lg flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold text-slate-500">
              {cartSummary.totalItems} {isSw ? 'vifungashio' : 'packs'}
            </div>
            <div className="text-sm font-mono font-black text-slate-900 tabular-nums">
              TZS {cartSummary.totalTzs.toLocaleString('en-US')}
            </div>
          </div>
          <button
            type="button"
            onClick={handleCheckoutReorder}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <ShoppingCart className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Agiza Re-Order' : 'Dispatch Re-Order'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default SmartStoreCatalog;
