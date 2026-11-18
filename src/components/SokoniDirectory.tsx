import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  ShoppingCart,
  Store,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { putQueuedOrder } from '../lib/indexedDbDemo';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

export interface SokoniStoreProfile {
  businessId: string;
  name: string;
  initials: string;
  tier: 'WHOLESALE_HUB' | 'HYBRID_STORE' | 'RETAIL_DUKA';
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
  unitType: string;
  packingLabelSw: string;
  packingLabelEn: string;
  moqLabelSw: string;
  moqLabelEn: string;
  wholesaleThresholdQty: number;
  retailPriceTzs: number;
  wholesalePriceTzs: number;
  stockPackagesAvailable: number;
}

interface BackendMerchantDto {
  merchantId: string;
  smsShortCode: string;
  merchantName: string;
  tier: 'WHOLESALE_HUB' | 'HYBRID_STORE' | 'RETAIL_DUKA';
  ward: string;
  district: string;
}

interface BackendProductDto {
  productId: string;
  sellerBusinessId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitPriceTzs: number;
  cartonPriceTzs: number;
  wholesaleThresholdUnits: number;
  availableQuarterQuanta: number;
  priceTiers?: Array<{
    unitType: string;
    quarterQuantaPerUnit: number;
    priceTzs: number;
    isWholesaleTier: boolean;
  }>;
}

export function SokoniDirectory({ locale = 'en' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [stores, setStores] = useState<SokoniStoreProfile[]>([]);
  const [storeProducts, setStoreProducts] = useState<StoreCatalogItem[]>([]);
  const [selectedStore, setSelectedStore] = useState<SokoniStoreProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [cartQtyByProductId, setCartQtyByProductId] = useState<Record<string, number>>({});
  const [cartExpanded, setCartExpanded] = useState<boolean>(false);
  const [toastConfirmation, setToastConfirmation] = useState<{
    message: string;
    orderRef8: string;
    totalTzs: number;
  } | null>(null);

  const loadMerchants = useCallback(async () => {
    if (!SokoApiClient.hasAccessToken()) {
      setLoading(false);
      setStores([]);
      return;
    }
    setLoading(true);
    setBackendOffline(false);
    setApiError(null);
    try {
      const list = await SokoApiClient.get<BackendMerchantDto[]>('/marketplace/merchants');
      setStores(
        (Array.isArray(list) ? list : [])
          .filter((m) => m.tier === 'WHOLESALE_HUB' || m.tier === 'HYBRID_STORE')
          .map((m, idx) => ({
            businessId: m.merchantId,
            name: m.merchantName,
            initials:
              m.smsShortCode ||
              m.merchantName
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join('')
                .toUpperCase(),
            tier: m.tier,
            ward: m.ward,
            city: m.district,
            distanceMeters: 250 + idx * 280,
          }))
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setStores([]);
      } else {
        setApiError(
          err instanceof SokoHttpError ? err.message : 'Failed to load wholesale merchants.'
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMerchants();
  }, [loadMerchants]);

  const handleOpenStore = async (store: SokoniStoreProfile) => {
    setSelectedStore(store);
    setStoreProducts([]);
    setCartQtyByProductId({});
    setCartExpanded(false);
    setToastConfirmation(null);
    setLoadingCatalog(true);
    setApiError(null);
    try {
      const products = await SokoApiClient.get<BackendProductDto[]>(
        `/products/active?businessId=${encodeURIComponent(store.businessId)}`
      );
      setBackendOffline(false);
      setStoreProducts(
        (Array.isArray(products) ? products : []).map((p) => {
          const tiers = p.priceTiers ?? [];
          const wTier = tiers.find((t) => t.isWholesaleTier) ?? tiers[0];
          const rTier = tiers.find((t) => !t.isWholesaleTier) ?? tiers[0];
          const unitType = wTier?.unitType ?? 'SACK_50KG';
          const qpu = Math.max(1, wTier?.quarterQuantaPerUnit ?? 200);
          const wholesalePrice = Number(wTier?.priceTzs ?? p.cartonPriceTzs ?? p.unitPriceTzs);
          const retailPrice = Number(rTier?.priceTzs ?? wholesalePrice);
          const stockAvailable = Math.max(0, Math.floor(Number(p.availableQuarterQuanta ?? 0) / qpu));

          return {
            productId: p.productId,
            businessId: p.sellerBusinessId,
            sku: p.sku,
            titleSw: p.nameSw,
            titleEn: p.nameEn,
            unitType,
            packingLabelSw: unitType,
            packingLabelEn: unitType,
            moqLabelSw: `Jumla kuanzia vipimo ${Math.max(1, p.wholesaleThresholdUnits || 2)}+`,
            moqLabelEn: `Wholesale from ${Math.max(1, p.wholesaleThresholdUnits || 2)}+ units`,
            wholesaleThresholdQty: Math.max(1, Number(p.wholesaleThresholdUnits || 2)),
            retailPriceTzs: retailPrice,
            wholesalePriceTzs: wholesalePrice,
            stockPackagesAvailable: stockAvailable > 0 ? stockAvailable : 100,
          };
        })
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError ? err.message : 'Failed to load merchant catalog.'
        );
      }
    } finally {
      setLoadingCatalog(false);
    }
  };

  const handleReturnToDirectory = () => {
    setSelectedStore(null);
    setStoreProducts([]);
    setCartQtyByProductId({});
    setCartExpanded(false);
  };

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
    const activeLines: Array<{
      item: StoreCatalogItem;
      qty: number;
      unitPrice: number;
      isWholesale: boolean;
    }> = [];

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

  const handleSubmitOrder = async () => {
    if (!selectedStore || cartStats.activeLines.length === 0) return;
    setSubmitting(true);
    setApiError(null);
    try {
      const resp = await SokoApiClient.post<{
        orderId: string;
        orderRef: string;
        expectedTotalTzs: number;
      }>('/marketplace/orders/submit-request', {
        sellerBusinessId: selectedStore.businessId,
        originChannel: 'PWA_ONLINE',
        paymentMethod: 'CASH',
        deliveryFeeTzs: 0,
        items: cartStats.activeLines.map((l) => ({
          productId: l.item.productId,
          unitType: l.item.unitType,
          quantity: l.qty,
        })),
      });

      setToastConfirmation({
        message: isSw
          ? `Oda yako imetumwa kwa ${selectedStore.name}!`
          : `Order submitted to ${selectedStore.name}!`,
        orderRef8: resp.orderRef,
        totalTzs: Number(resp.expectedTotalTzs ?? cartStats.totalCashTzs),
      });
      setCartQtyByProductId({});
      setCartExpanded(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        const queuedRef = `Q-${Date.now().toString(36).toUpperCase()}`;
        await putQueuedOrder({
          idempotencyKey: queuedRef,
          sellerBusinessId: selectedStore.businessId,
          sellerHub: selectedStore.name,
          compactSmsBody: `${cartStats.activeLines.length} SKU(s) queued`,
          totalTzs: cartStats.totalCashTzs,
          items: cartStats.activeLines.map((l) => ({
            productId: l.item.productId,
            unitType: l.item.unitType,
            quantity: l.qty,
          })),
          clientCreatedAt: new Date().toISOString(),
          syncStatus: 'QUEUED_OFFLINE',
          retryCount: 0,
        });
        setToastConfirmation({
          message: isSw
            ? `Nje ya Mtandao: Oda imewekwa foleni ya kusawazishwa (${selectedStore.name})`
            : `Offline: Order queued in IndexedDB for ${selectedStore.name}`,
          orderRef8: queuedRef,
          totalTzs: cartStats.totalCashTzs,
        });
        setCartQtyByProductId({});
        setCartExpanded(false);
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError ? err.message : 'Failed to submit order.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {backendOffline && (
        <BackendOfflineBanner locale={locale} onRetry={() => void loadMerchants()} />
      )}

      {apiError && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg p-3.5 flex items-center gap-2 text-xs font-semibold text-red-900"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
          <span>{apiError}</span>
        </div>
      )}

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
                #{toastConfirmation.orderRef8} · Taslimu: TZS{' '}
                {toastConfirmation.totalTzs.toLocaleString('en-US')}
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

      {!selectedStore ? (
        <section className="space-y-4">
          <div className="border-b border-slate-100 pb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight">
                {isSw ? 'Orodha ya Wafanyabiashara' : 'Merchant Store Directory'}
              </h2>
              <p className="text-xs text-slate-500">
                {isSw
                  ? 'Wafanyabiashara wa jumla waliothibitishwa katika PostgreSQL'
                  : 'Verified wholesale & hybrid merchants from PostgreSQL'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-emerald-600 font-semibold">
                {stores.length} {isSw ? 'wazi' : 'active'}
              </span>
              <button
                type="button"
                onClick={() => void loadMerchants()}
                disabled={loading}
                className="p-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 cursor-pointer"
                aria-label="Refresh stores"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {!loading && stores.length === 0 ? (
            <EmptyStateCard
              locale={locale}
              titleSw="Hakuna rekodi bado"
              titleEn="No wholesale merchants found yet"
              descriptionSw="Hakuna mfanyabiashara wa jumla aliyepatikana kwenye PostgreSQL kwa sasa."
              descriptionEn="Seed or approve a Wholesale Hub / Hybrid Store merchant in the backend."
            />
          ) : (
            <div className="space-y-3">
              {stores.map((store) => (
                <article
                  key={store.businessId}
                  className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
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
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleOpenStore(store)}
                    className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                  >
                    {isSw ? 'Fungua Duka' : 'Open Store'}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-4">
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
                  {selectedStore.ward}, {selectedStore.city}
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

          {loadingCatalog ? (
            <div className="bg-white border border-slate-100 rounded-lg p-6 text-center text-xs text-slate-500">
              {isSw ? 'Inapakia bidhaa...' : 'Loading active catalog...'}
            </div>
          ) : storeProducts.length === 0 ? (
            <EmptyStateCard
              locale={locale}
              titleSw="Hakuna bidhaa dukani bado"
              titleEn="No active products listed for this merchant"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {storeProducts.map((item) => {
                const qty = cartQtyByProductId[item.productId] ?? 0;
                const wholesaleApplied = qty >= item.wholesaleThresholdQty;
                const activePrice = wholesaleApplied
                  ? item.wholesalePriceTzs
                  : item.retailPriceTzs;

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
                            {isSw ? 'Bei ya Jumla' : 'Wholesale Rate'}
                          </span>
                        )}
                      </div>

                      <div className="h-20 w-full rounded-md bg-slate-50 border border-slate-100 flex items-center justify-center p-2">
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
          )}

          <div className="bg-white border border-slate-100 rounded-lg shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setCartExpanded((prev) => !prev)}
              className="w-full px-4 py-3.5 border-b border-slate-100 flex items-center justify-between text-sm font-bold text-slate-900 cursor-pointer hover:bg-slate-50/50"
            >
              <span>
                {isSw ? 'Kikapu chako' : 'Cart'} ({cartStats.totalUnits}{' '}
                {isSw ? 'bidhaa' : 'items'})
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
                <div className="text-xs text-slate-500">
                  {isSw ? 'Jumla ya Cash (CoD)' : 'Total CoD Cash'}
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-emerald-600">
                  TZS {cartStats.totalCashTzs.toLocaleString('en-US')}
                </div>
              </div>

              <button
                type="button"
                disabled={cartStats.activeLines.length === 0 || submitting}
                onClick={() => void handleSubmitOrder()}
                className="min-h-[48px] px-6 py-3 text-sm font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-500 transition-colors whitespace-nowrap cursor-pointer shadow-xs"
              >
                {submitting
                  ? isSw
                    ? 'Inatuma...'
                    : 'Submitting...'
                  : isSw
                    ? 'Tuma Ombi la Mzigo'
                    : 'Submit Order'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
