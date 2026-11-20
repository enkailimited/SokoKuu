import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { putQueuedOrder } from '../lib/indexedDbDemo';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';
import { resolveBackendImageUrl } from '../lib/sokoProductImage';

export interface GridProduct {
  id: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  priceTzs: number;
  unitType?: string;
  minMoq: string;
  minMoqEn: string;
  imageSrc: string;
  isLowStockInDuka: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}



export function SmartGridStoreCatalog({
  storeName,
  sellerBusinessId,
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
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [storeProducts, setStoreProducts] = useState<GridProduct[]>([]);

  const loadLiveGrid = useCallback(async () => {
    if (!isUuid(sellerBusinessId)) {
      setStoreProducts([]);
      return;
    }
    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }
    setLoading(true);
    setBackendOffline(false);
    setErrorBanner(null);
    try {
      const [intelligentRows, activeRows] = await Promise.all([
        SokoApiClient.get<
          Array<{
            productId: string;
            sku: string;
            nameSw: string;
            nameEn: string;
            wholesalePriceTzs: number;
            moqLabel: string;
            requiresUrgentReorder: boolean;
            imagekitCdnUrl?: string;
          }>
        >(`/marketplace/catalog/intelligent-view?wholesalerId=${encodeURIComponent(sellerBusinessId)}`),
        SokoApiClient.get<
          Array<{
            productId: string;
            priceTiers: Array<{ unitType: string; isWholesaleTier: boolean }>;
          }>
        >(`/products/active?businessId=${encodeURIComponent(sellerBusinessId)}`),
      ]);

      const unitByProd = new Map<string, string>();
      for (const row of activeRows ?? []) {
        const wTier = row.priceTiers.find((t) => t.isWholesaleTier) ?? row.priceTiers[0];
        if (wTier) unitByProd.set(row.productId, wTier.unitType);
      }

      setStoreProducts(
        (Array.isArray(intelligentRows) ? intelligentRows : []).map((r) => ({
          id: r.productId,
          sku: r.sku,
          nameSw: r.nameSw,
          nameEn: r.nameEn,
          priceTzs: r.wholesalePriceTzs,
          unitType: unitByProd.get(r.productId) ?? 'SACK_50KG',
          minMoq: r.moqLabel,
          minMoqEn: r.moqLabel,
          imageSrc: resolveBackendImageUrl(r.imagekitCdnUrl),
          isLowStockInDuka: r.requiresUrgentReorder,
        })),
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorBanner(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia gridi ya bidhaa.'
              : 'Failed to load catalog.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [isSw, sellerBusinessId]);

  useEffect(() => {
    void loadLiveGrid();
  }, [loadLiveGrid]);

  const updateCart = (id: string, amount: number) => {
    setDispatchedRef(null);
    setErrorBanner(null);
    setCart((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + amount) }));
  };

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
            p.sku.toLowerCase().includes(q),
        )
      : sorted;

    const suggestions = sorted.filter((p) => p.isLowStockInDuka);
    return { filteredGridProducts: filtered, lowStockSuggestions: suggestions };
  }, [storeProducts, searchQuery]);

  const cartSummary = useMemo(() => {
    let totalUnits = 0;
    let totalTzs = 0;
    const parts: string[] = [];
    const lines: Array<{ productId: string; unitType: string; quantity: number }> = [];
    for (const product of storeProducts) {
      const qty = cart[product.id] || 0;
      if (qty > 0) {
        totalUnits += qty;
        totalTzs += qty * product.priceTzs;
        parts.push(`${product.sku}:${qty}`);
        lines.push({
          productId: product.id,
          unitType: product.unitType ?? 'SACK_50KG',
          quantity: qty,
        });
      }
    }
    return { totalUnits, totalTzs, summaryText: parts.join(','), lines };
  }, [storeProducts, cart]);

  const queueGridOrderOffline = async () => {
    if (!isUuid(sellerBusinessId) || cartSummary.lines.length === 0) return;
    await putQueuedOrder({
      idempotencyKey: crypto.randomUUID(),
      sellerBusinessId,
      sellerHub: storeName,
      compactSmsBody: cartSummary.summaryText,
      totalTzs: cartSummary.totalTzs,
      items: cartSummary.lines,
      clientCreatedAt: new Date().toISOString(),
      syncStatus: 'QUEUED_OFFLINE',
      retryCount: 0,
    });
    setCart({});
    setDispatchedRef('QUEUED_OFFLINE');
  };

  const handleDispatchGridOrder = async () => {
    if (cartSummary.totalUnits === 0 || !isUuid(sellerBusinessId)) return;
    setErrorBanner(null);

    if (!navigator.onLine) {
      setBackendOffline(true);
      await queueGridOrderOffline();
      return;
    }

    setSubmitting(true);
    try {
      const res = await SokoApiClient.post<{
        orderId: string;
        orderRef: string;
        expectedTotalTzs: number;
      }>('/marketplace/orders/submit-request', {
        sellerBusinessId,
        originChannel: 'PWA_ONLINE',
        paymentMethod: 'CASH',
        deliveryFeeTzs: 0,
        items: cartSummary.lines,
      });
      setCart({});
      setDispatchedRef(res.orderRef);
      onOrderDispatched?.(res.orderRef);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        await queueGridOrderOffline();
      } else {
        setErrorBanner(err instanceof Error ? err.message : 'Grid order submission failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-4 bg-slate-50 min-h-dvh font-sans antialiased pb-28 sk-safe-bottom">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          retrying={loading}
          onRetry={() => void loadLiveGrid()}
        />
      )}

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

      {errorBanner && (
        <div
          role="alert"
          className="bg-rose-50 border border-rose-200 rounded-2xl p-3 flex items-center gap-2 text-xs font-semibold text-rose-900"
        >
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
          <span>{errorBanner}</span>
        </div>
      )}

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

          <div className="sk-scroll-x space-x-2 pb-1 max-w-full">
            {lowStockSuggestions.map((suggest) => {
              const isSelected = searchQuery.toLowerCase() === suggest.nameSw.toLowerCase();
              return (
                <button
                  type="button"
                  key={suggest.id}
                  onClick={() =>
                    setSearchQuery((prev) =>
                      prev.toLowerCase() === suggest.nameSw.toLowerCase() ? '' : suggest.nameSw,
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
            {dispatchedRef === 'QUEUED_OFFLINE'
              ? isSw
                ? `Oda imewekwa foleni (QUEUED_OFFLINE) kwa ${storeName} kusubiri mtandao.`
                : `Order queued (QUEUED_OFFLINE) for ${storeName} pending connectivity.`
              : isSw
                ? `Oda #${dispatchedRef} imetumwa kwenda ${storeName} katika PostgreSQL.`
                : `Order #${dispatchedRef} submitted to ${storeName} in PostgreSQL.`}
          </span>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
          {isSw ? 'Inapakia bidhaa za gridi...' : 'Loading store grid...'}
        </div>
      ) : filteredGridProducts.length === 0 ? (
        <EmptyStateCard
          locale={locale}
          titleSw="Hakuna rekodi bado"
          titleEn="No records yet"
          descriptionSw="Hakuna bidhaa za duka hili katika PostgreSQL bado."
          descriptionEn="No catalog items found in PostgreSQL for this store."
        />
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
            disabled={submitting}
            onClick={() => void handleDispatchGridOrder()}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <ShoppingCart className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {submitting
                ? isSw
                  ? 'Inatuma...'
                  : 'Submitting...'
                : isSw
                  ? 'Tuma Oda ya Gridi'
                  : 'Dispatch Grid Order'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

export default SmartGridStoreCatalog;
