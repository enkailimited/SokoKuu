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
  Zap,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { putQueuedOrder } from '../lib/indexedDbDemo';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

export interface RecommendedProduct {
  id: string;
  sku?: string;
  name: string;
  nameEn: string;
  priceTzs: number;
  moq: string;
  moqEn: string;
  unitType?: string;
  availableStockQuanta: number;
  requiresUrgentReorder: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}

export function SmartStoreCatalog({
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
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cartQuantities, setCartQuantities] = useState<Record<string, number>>({});
  const [dispatchedRef, setDispatchedRef] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [products, setProducts] = useState<RecommendedProduct[]>([]);

  const loadLiveIntelligentCatalog = useCallback(async () => {
    if (!isUuid(sellerBusinessId)) {
      setProducts([]);
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
            wholesalerStockQuanta: number;
            requiresUrgentReorder: boolean;
          }>
        >(`/marketplace/catalog/intelligent-view?wholesalerId=${encodeURIComponent(sellerBusinessId)}`),
        SokoApiClient.get<
          Array<{
            productId: string;
            priceTiers: Array<{ unitType: string; isWholesaleTier: boolean; priceTzs: number }>;
          }>
        >(`/products/active?businessId=${encodeURIComponent(sellerBusinessId)}`),
      ]);

      const unitByProd = new Map<string, string>();
      for (const row of activeRows ?? []) {
        const wTier = row.priceTiers.find((t) => t.isWholesaleTier) ?? row.priceTiers[0];
        if (wTier) unitByProd.set(row.productId, wTier.unitType);
      }

      setProducts(
        (Array.isArray(intelligentRows) ? intelligentRows : []).map((r) => ({
          id: r.productId,
          sku: r.sku,
          name: r.nameSw,
          nameEn: r.nameEn,
          priceTzs: r.wholesalePriceTzs,
          moq: r.moqLabel,
          moqEn: r.moqLabel,
          unitType: unitByProd.get(r.productId) ?? 'SACK_50KG',
          availableStockQuanta: r.wholesalerStockQuanta,
          requiresUrgentReorder: r.requiresUrgentReorder,
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
              ? 'Imeshindikana kupakia katalogi ya Smart Re-Order.'
              : 'Failed to load intelligent catalog.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [isSw, sellerBusinessId]);

  useEffect(() => {
    void loadLiveIntelligentCatalog();
  }, [loadLiveIntelligentCatalog]);

  const updateCartQty = (id: string, delta: number) => {
    setDispatchedRef(null);
    setErrorBanner(null);
    setCartQuantities((prev) => {
      const current = prev[id] || 0;
      return { ...prev, [id]: Math.max(0, current + delta) };
    });
  };

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
            (p.sku ?? p.id).toLowerCase().includes(q),
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
    const lines: Array<{ productId: string; unitType: string; quantity: number }> = [];

    for (const prod of products) {
      const qty = cartQuantities[prod.id] || 0;
      if (qty > 0) {
        totalItems += qty;
        totalTzs += qty * prod.priceTzs;
        summaryParts.push(`${prod.sku ?? prod.name}:${qty}`);
        lines.push({
          productId: prod.id,
          unitType: prod.unitType ?? 'SACK_50KG',
          quantity: qty,
        });
      }
    }

    return { totalItems, totalTzs, summaryText: summaryParts.join(','), lines };
  }, [products, cartQuantities]);

  const queueReorderOffline = async () => {
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
    setCartQuantities({});
    setDispatchedRef('QUEUED_OFFLINE');
  };

  const handleCheckoutReorder = async () => {
    if (cartSummary.totalItems === 0 || !isUuid(sellerBusinessId)) return;
    setErrorBanner(null);

    if (!navigator.onLine) {
      setBackendOffline(true);
      await queueReorderOffline();
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
      setCartQuantities({});
      setDispatchedRef(res.orderRef);
      onOrderDispatched?.(res.orderRef);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        await queueReorderOffline();
      } else {
        setErrorBanner(err instanceof Error ? err.message : 'Re-order failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-4 bg-slate-50 min-h-dvh pb-32 font-sans antialiased sk-safe-bottom">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          retrying={loading}
          onRetry={() => void loadLiveIntelligentCatalog()}
        />
      )}

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

      {errorBanner && (
        <div
          role="alert"
          className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 flex items-center gap-2.5 text-xs font-semibold text-rose-900"
        >
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
          <span>{errorBanner}</span>
        </div>
      )}

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
            {dispatchedRef === 'QUEUED_OFFLINE'
              ? isSw
                ? `Oda imewekwa foleni (QUEUED_OFFLINE) kwa ${storeName} kusubiri mtandao.`
                : `Order queued (QUEUED_OFFLINE) for ${storeName} pending connectivity.`
              : isSw
                ? `Oda #${dispatchedRef} imetumwa kwa ${storeName} na kuhifadhiwa PostgreSQL.`
                : `Order #${dispatchedRef} submitted to ${storeName} in PostgreSQL.`}
          </span>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
          {isSw ? 'Inapakia orodha ya Smart Re-Order...' : 'Loading Smart Re-Order view...'}
        </div>
      ) : (
        <>
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

          <div className="space-y-2.5">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider px-1">
              {isSw ? 'Bidhaa Nyinginezo za Duka' : 'Standard Warehouse Goods'}
            </h3>
            {regularProducts.length === 0 && reorderRecommendations.length === 0 ? (
              <EmptyStateCard
                locale={locale}
                titleSw="Hakuna rekodi bado"
                titleEn="No records yet"
                descriptionSw="Hakuna bidhaa zilizopatikana katika PostgreSQL kwa duka hili."
                descriptionEn="No intelligent catalog items found in PostgreSQL for this store."
              />
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
        </>
      )}

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
            disabled={submitting}
            onClick={() => void handleCheckoutReorder()}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <ShoppingCart className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {submitting
                ? isSw
                  ? 'Inatuma...'
                  : 'Submitting...'
                : isSw
                  ? 'Agiza Re-Order'
                  : 'Dispatch Re-Order'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

export default SmartStoreCatalog;
