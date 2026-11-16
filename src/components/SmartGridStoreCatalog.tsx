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
  X,
  Zap,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { useDataSaver } from '../context/DataSaverContext';
import { recordOrderDispatchAuditTrace } from '../lib/sokoManagedState';
import azaniaFlourImg from '../assets/images/azania_wheat_flour_1794734183041.jpg';
import korieOilImg from '../assets/images/korie_cooking_oil_1794734183539.jpg';
import kilomberoSugarImg from '../assets/images/kilombero_brown_sugar_1794734184028.jpg';
import mbeyaRiceImg from '../assets/images/mbeya_super_rice_1794734184118.jpg';

export interface GridProduct {
  id: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  priceTzs: number;
  minMoq: string;
  minMoqEn: string;
  imageSrc: string;
  isLowStockInDuka: boolean;
}

const DEFAULT_SMART_GRID_PRODUCTS: GridProduct[] = [
  {
    id: 'P01',
    sku: 'GC-AZN-WHEAT',
    nameSw: 'Azania Wheat Flour (2kg)',
    nameEn: 'Azania Wheat Flour (2kg)',
    priceTzs: 81_600,
    minMoq: 'Katoni 2',
    minMoqEn: '2 Cartons',
    imageSrc: azaniaFlourImg,
    isLowStockInDuka: true,
  },
  {
    id: 'P02',
    sku: 'GC-KOR-OIL',
    nameSw: 'Korie Cooking Oil (1L)',
    nameEn: 'Korie Cooking Oil (1L)',
    priceTzs: 94_000,
    minMoq: 'Katoni 1',
    minMoqEn: '1 Carton',
    imageSrc: korieOilImg,
    isLowStockInDuka: false,
  },
  {
    id: 'P03',
    sku: 'GC-KLM-SUGAR',
    nameSw: 'Kilombero Sugar (1kg)',
    nameEn: 'Kilombero Sugar (1kg)',
    priceTzs: 39_600,
    minMoq: 'Dozen 1',
    minMoqEn: '1 Dozen',
    imageSrc: kilomberoSugarImg,
    isLowStockInDuka: true,
  },
  {
    id: 'P04',
    sku: 'GC-MBY-RICE',
    nameSw: 'Mbeya Grade A Rice (50kg)',
    nameEn: 'Mbeya Grade A Rice (50kg)',
    priceTzs: 115_000,
    minMoq: 'Gunia 1',
    minMoqEn: '1 Sack',
    imageSrc: mbeyaRiceImg,
    isLowStockInDuka: false,
  },
];

export function SmartGridStoreCatalog({
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
  const { isLowDataModeActive } = useDataSaver();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [dispatchedRef, setDispatchedRef] = useState<string | null>(null);
  const [storeProducts] = useState<GridProduct[]>(DEFAULT_SMART_GRID_PRODUCTS);

  const updateCart = (id: string, amount: number) => {
    setDispatchedRef(null);
    setCart((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + amount) }));
  };

  // Context-aware search & shelf-velocity sorting (is_low_stock DESC, name ASC)
  const { filteredGridProducts, lowStockSuggestions } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const sorted = [...storeProducts].sort((a, b) => {
      if (a.isLowStockInDuka !== b.isLowStockInDuka) {
        return a.isLowStockInDuka ? -1 : 1;
      }
      return a.nameSw.localeCompare(b.nameSw);
    });

    const filtered = q
      ? sorted.filter(
          (p) =>
            p.nameSw.toLowerCase().includes(q) ||
            p.nameEn.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q)
        )
      : sorted;

    const suggestions = sorted.filter((p) => p.isLowStockInDuka);
    return { filteredGridProducts: filtered, lowStockSuggestions: suggestions };
  }, [storeProducts, searchQuery]);

  const cartSummary = useMemo(() => {
    let totalUnits = 0;
    let totalTzs = 0;
    const parts: string[] = [];
    for (const product of storeProducts) {
      const qty = cart[product.id] || 0;
      if (qty > 0) {
        totalUnits += qty;
        totalTzs += qty * product.priceTzs;
        parts.push(`${product.nameSw} (x${qty})`);
      }
    }
    return { totalUnits, totalTzs, summaryText: parts.join(' + ') };
  }, [storeProducts, cart]);

  const handleDispatchGridOrder = () => {
    if (cartSummary.totalUnits === 0) return;
    const orderRef8 = 'SK' + Math.random().toString(36).substring(2, 8).toUpperCase();
    recordOrderDispatchAuditTrace({
      orderRef8,
      sellerBusinessId,
      sellerBusinessName: storeName,
      totalCashDueTzs: cartSummary.totalTzs,
      itemsSummary: cartSummary.summaryText,
    });
    setCart({});
    setDispatchedRef(orderRef8);
    onOrderDispatched?.(orderRef8);
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-4 bg-slate-50 min-h-screen font-sans antialiased pb-28">
      {/* 1. STORE HEADER BAR */}
      <div className="bg-white border border-slate-100 p-4 rounded-2xl shadow-sm flex justify-between items-center gap-3">
        <div className="flex items-center space-x-2 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 text-slate-500 text-xs font-bold hover:text-slate-900 pr-1.5 py-1 rounded-lg hover:bg-slate-50 cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>{isSw ? 'Rudi' : 'Back'}</span>
          </button>
          <h2 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-1.5 truncate">
            <Store className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span className="truncate">{storeName}</span>
          </h2>
        </div>
        <span className="bg-emerald-50 text-emerald-700 font-black text-[9px] px-2 py-0.5 rounded-md uppercase border border-emerald-100 shrink-0">
          B2B Mode
        </span>
      </div>

      {/* 2. DYNAMIC INPUT SEARCH COMPONENT (Swahili Title & SKU Filter) */}
      <div className="bg-white border border-slate-100 rounded-2xl p-3 shadow-sm">
        <label htmlFor="smart-grid-search-input" className="sr-only">
          {isSw ? 'Tafuta bidhaa kwa jina au SKU' : 'Search products by name or SKU'}
        </label>
        <div className="relative flex items-center">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="smart-grid-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full py-2.5 pl-9 pr-9 border border-slate-200 rounded-xl text-xs bg-slate-50 text-slate-900 font-medium focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none"
            placeholder={
              isSw
                ? 'Tafuta bidhaa mtaani (e.g. Unga, Mafuta, SKU)...'
                : 'Search store items (e.g. Flour, Oil, SKU)...'
            }
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label={isSw ? 'Futa utafutaji' : 'Clear search'}
              className="absolute right-2.5 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* 3. DYNAMIC LOW-STOCK RECOMMENDATION HORIZONTAL CAROUSEL */}
      {lowStockSuggestions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center space-x-1 text-emerald-700 font-black text-xs uppercase tracking-wider">
              <Zap className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
              <h3>
                {isSw
                  ? 'Inashauriwa Ununue (Duka Lako Limeshaisha)'
                  : 'Recommended Re-Order (Low Shelf Stock)'}
              </h3>
            </div>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-[10px] font-bold text-emerald-700 hover:underline cursor-pointer"
              >
                {isSw ? 'Onyesha Zote' : 'Show All'}
              </button>
            )}
          </div>

          <div className="flex space-x-2 overflow-x-auto pb-1">
            {lowStockSuggestions.map((suggest) => {
              const isSelected = searchQuery.toLowerCase() === suggest.nameSw.toLowerCase();
              return (
                <button
                  type="button"
                  key={suggest.id}
                  onClick={() =>
                    setSearchQuery((prev) =>
                      prev.toLowerCase() === suggest.nameSw.toLowerCase() ? '' : suggest.nameSw
                    )
                  }
                  className={`flex-shrink-0 border p-3 rounded-xl flex items-center space-x-3 cursor-pointer active:scale-95 transition-all text-left shadow-xs ${
                    isSelected
                      ? 'bg-emerald-100 border-emerald-500 ring-1 ring-emerald-500'
                      : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100/70'
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white font-bold flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-xs max-w-[140px] truncate">
                      {isSw ? suggest.nameSw : suggest.nameEn}
                    </h4>
                    <p className="text-[9px] text-emerald-700 font-bold uppercase mt-0.5">
                      {isSw ? 'Low Stock katika Rafu yako' : 'Low Stock on Your Shelf'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {dispatchedRef && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 flex items-center gap-2 text-xs font-semibold text-emerald-950"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
          <span>
            {isSw
              ? `Oda #${dispatchedRef} imetumwa kwenda ${storeName}.`
              : `Order #${dispatchedRef} dispatched to ${storeName}.`}
          </span>
        </div>
      )}

      {/* 4. THE 2-COLUMN BALANCED PRODUCT GRID VIEW */}
      {filteredGridProducts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
          {isSw
            ? `Hakuna bidhaa inayolingana na "${searchQuery}".`
            : `No catalog items matched "${searchQuery}".`}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filteredGridProducts.map((product) => {
            const qty = cart[product.id] || 0;
            return (
              <div
                key={product.id}
                className="bg-white border border-slate-100 rounded-2xl p-3 shadow-sm flex flex-col justify-between space-y-3 relative"
              >
                {product.isLowStockInDuka && (
                  <span className="absolute top-2 left-2 bg-rose-500 text-white font-black text-[8px] px-1.5 py-0.5 rounded-md uppercase tracking-wider z-10 shadow-sm inline-flex items-center gap-0.5 animate-pulse">
                    <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
                    <span>Re-Order</span>
                  </span>
                )}

                {!isLowDataModeActive ? (
                  <div className="w-full h-24 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-center p-2 overflow-hidden">
                    <img
                      src={product.imageSrc}
                      alt={isSw ? product.nameSw : product.nameEn}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-full h-24 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-center text-[10px] text-slate-400 font-mono font-bold uppercase select-none text-center px-2">
                    {product.sku}
                  </div>
                )}

                <div>
                  <div className="text-[9px] font-mono text-slate-400 truncate">{product.sku}</div>
                  <h4 className="font-bold text-slate-800 text-xs line-clamp-1 mt-0.5">
                    {isSw ? product.nameSw : product.nameEn}
                  </h4>
                  <p className="text-[9px] text-slate-400 font-mono mt-0.5">
                    MOQ: {isSw ? product.minMoq : product.minMoqEn}
                  </p>
                  <h5 className="font-mono font-black text-slate-900 text-sm mt-1 tabular-nums">
                    TZS {product.priceTzs.toLocaleString('en-US')}
                  </h5>
                </div>

                <div className="flex justify-between items-center bg-slate-50 p-1 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => updateCart(product.id, -1)}
                    aria-label={isSw ? `Punguza ${product.nameSw}` : `Decrease ${product.nameEn}`}
                    className="w-7 h-7 bg-white border border-slate-200 text-slate-700 font-bold rounded-lg shadow-xs inline-flex items-center justify-center hover:bg-slate-100 cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <span className="font-mono font-bold text-xs tabular-nums">{qty}</span>
                  <button
                    type="button"
                    onClick={() => updateCart(product.id, 1)}
                    aria-label={isSw ? `Ongeza ${product.nameSw}` : `Increase ${product.nameEn}`}
                    className="w-7 h-7 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg shadow-xs inline-flex items-center justify-center cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky Dispatch Bar */}
      {cartSummary.totalUnits > 0 && (
        <div className="sticky bottom-4 z-20 bg-white border border-emerald-200 rounded-2xl p-3.5 shadow-lg flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold text-slate-500">
              {cartSummary.totalUnits} {isSw ? 'vifungashio' : 'units'}
            </div>
            <div className="text-sm font-mono font-black text-slate-900 tabular-nums">
              TZS {cartSummary.totalTzs.toLocaleString('en-US')}
            </div>
          </div>
          <button
            type="button"
            onClick={handleDispatchGridOrder}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <ShoppingCart className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Tuma Oda ya Gridi' : 'Dispatch Grid Order'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default SmartGridStoreCatalog;
