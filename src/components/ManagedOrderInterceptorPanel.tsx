import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowRightLeft,
  CheckCircle2,
  Database,
  Globe,
  RefreshCw,
  Send,
  ShieldAlert,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { SokoApiClient, isSokoNetworkError } from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';
import {
  formatPipelineLabel,
  formatRoutingLabel,
  type DispatchRoutingCode,
  type DispatchTargetPipeline,
} from '../lib/sokoManagedState';

interface ApiMerchantRow {
  merchantId: string;
  smsShortCode: string;
  merchantName: string;
  tier: string;
  ward: string;
  district: string;
  isPlatformManaged: boolean;
  createdAt: string;
}

interface ApiTraceRow {
  traceId: string;
  orderId: string;
  orderRef8: string;
  sellerBusinessId: string;
  merchantName: string;
  merchantShortCode: string;
  isPlatformManagedSnapshot: boolean;
  routingOutputCode: DispatchRoutingCode;
  targetPipeline: DispatchTargetPipeline;
  txIsolationLevel: string;
  helpdeskStatus: string;
  recordedAt: string;
  orderStatus: string;
  expectedTotalTzs: number;
}

interface ApiGlobalCatalogItem {
  id: string;
  canonicalSku: string;
  fixedNameSw: string;
  fixedNameEn: string;
  categoryCode: string;
  imagekitCdnUrl: string;
  baseQuantumUnit: string;
}

interface ApiMerchantProduct {
  productId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitPriceTzs: number;
  cartonPriceTzs: number;
  priceTiers?: Array<{ unitType: string; priceTzs: number }>;
}

export function ManagedOrderInterceptorPanel({ locale = 'en' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [merchants, setMerchants] = useState<ApiMerchantRow[]>([]);
  const [traces, setTraces] = useState<ApiTraceRow[]>([]);
  const [catalogItems, setCatalogItems] = useState<ApiGlobalCatalogItem[]>([]);
  const [sellerProducts, setSellerProducts] = useState<ApiMerchantProduct[]>([]);
  const [selectedSellerId, setSelectedSellerId] = useState<string>('');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedUnitType, setSelectedUnitType] = useState<string>('SINGLE_KILO_LITRE');
  const [testQuantity, setTestQuantity] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [merchantsRes, tracesRes, catalogRes] = await Promise.all([
        SokoApiClient.get<{ merchants: ApiMerchantRow[] }>('/admin/merchants'),
        SokoApiClient.get<{ traces: ApiTraceRow[] }>('/admin/managed-orders'),
        SokoApiClient.get<ApiGlobalCatalogItem[]>('/marketplace/catalog'),
      ]);
      const merchantList = merchantsRes.merchants ?? [];
      setMerchants(merchantList);
      setTraces(tracesRes.traces ?? []);
      setCatalogItems(Array.isArray(catalogRes) ? catalogRes : []);
      setBackendOffline(false);

      if (merchantList.length > 0 && !selectedSellerId) {
        setSelectedSellerId(merchantList[0].merchantId);
      }
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load interceptor state');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedSellerId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedSellerId) {
      setSellerProducts([]);
      setSelectedProductId('');
      return;
    }
    let cancelled = false;
    SokoApiClient.get<ApiMerchantProduct[]>(`/products/active?businessId=${selectedSellerId}`)
      .then((list) => {
        if (cancelled) return;
        const products = Array.isArray(list) ? list : [];
        setSellerProducts(products);
        setSelectedProductId(products[0]?.productId ?? '');
      })
      .catch(() => {
        if (!cancelled) {
          setSellerProducts([]);
          setSelectedProductId('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSellerId]);

  const handleToggleManagedFlag = async (hub: ApiMerchantRow) => {
    setTogglingId(hub.merchantId);
    setErrorMsg(null);
    try {
      const res = await SokoApiClient.patch<{
        merchantId: string;
        merchantName: string;
        isPlatformManaged: boolean;
      }>(`/admin/merchants/${hub.merchantId}/platform-managed`, {
        isPlatformManaged: !hub.isPlatformManaged,
      });

      setMerchants((prev) =>
        prev.map((m) =>
          m.merchantId === hub.merchantId
            ? { ...m, isPlatformManaged: res.isPlatformManaged }
            : m,
        ),
      );
      setStatusNotice(
        isSw
          ? `Usimamizi wa Jukwaa kwa "${res.merchantName}" umebadilishwa kuwa ${
              res.isPlatformManaged ? 'Msaada wa Jukwaa (Super Admin)' : 'Moja kwa Moja (Muuzaji)'
            }.`
          : `Updated platform management for "${res.merchantName}" to ${
              res.isPlatformManaged
                ? 'Platform Managed (Super Admin Helpdesk)'
                : 'Direct Merchant Terminal'
            }.`,
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to update Merchant flag');
      }
    } finally {
      setTogglingId(null);
    }
  };

  const handleDispatchLiveOrder = async () => {
    if (!selectedSellerId || !selectedProductId) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const receipt = await SokoApiClient.post<{
        orderRef: string;
        routingOutputCode: DispatchRoutingCode;
      }>('/marketplace/orders/submit-request', {
        sellerBusinessId: selectedSellerId,
        originChannel: 'PWA_ONLINE',
        paymentMethod: 'CASH',
        items: [
          {
            productId: selectedProductId,
            unitType: selectedUnitType,
            quantity: Math.max(1, testQuantity),
          },
        ],
      });

      setStatusNotice(
        isSw
          ? `Oda #${receipt.orderRef} imehifadhiwa PostgreSQL -> ${formatRoutingLabel(receipt.routingOutputCode, 'sw')}`
          : `Order #${receipt.orderRef} committed to PostgreSQL -> ${formatRoutingLabel(receipt.routingOutputCode, 'en')}`,
      );
      await loadData();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Order routing submission failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const helpdeskQueueCount = traces.filter(
    (t) => t.routingOutputCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK',
  ).length;
  const directDbCount = traces.filter(
    (t) => t.routingOutputCode === 'ROUTED_DIRECT_MERCHANT_DB',
  ).length;

  return (
    <div className="space-y-6">
      {backendOffline && (
        <BackendOfflineBanner locale={locale} onRetry={() => void loadData()} retrying={loading} />
      )}

      {errorMsg && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg p-3.5 text-xs font-medium text-red-900"
        >
          {errorMsg}
        </div>
      )}

      {statusNotice && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-3.5 flex items-center justify-between gap-3 text-xs font-semibold text-emerald-950"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{statusNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Platform-Managed Agent Toggle Matrix */}
      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>
                {isSw
                  ? 'Kidhibiti cha Wakala wa Jukwaa (Usimamizi wa Oda)'
                  : 'Platform-Managed Order Interceptor'}
              </span>
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              {isSw
                ? 'Ikiwa imewashwa, oda zote za POST /marketplace/orders/submit-request huelekezwa kwenye Super Admin Helpdesk.'
                : 'When enabled, inbound order requests are intercepted and routed to the Super Admin Helpdesk pipeline.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
          </button>
        </div>

        {merchants.length === 0 && !loading ? (
          <EmptyStateCard
            locale={locale}
            titleSw="Hakuna Wafanyabiashara bado"
            titleEn="No Merchants registered yet"
          />
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {merchants.map((hub) => (
              <div
                key={hub.merchantId}
                className="p-3.5 flex flex-wrap items-center justify-between gap-3 bg-white"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span>{hub.merchantName}</span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {hub.smsShortCode} · {hub.tier}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {hub.ward}, {hub.district}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`text-[11px] font-semibold ${
                      hub.isPlatformManaged ? 'text-emerald-700' : 'text-slate-600'
                    }`}
                  >
                    {hub.isPlatformManaged
                      ? isSw
                        ? 'Inasimamiwa na Jukwaa'
                        : 'Platform Managed'
                      : isSw
                        ? 'Muuzaji Mwenyewe'
                        : 'Direct Merchant'}
                  </span>

                  <button
                    type="button"
                    disabled={togglingId === hub.merchantId}
                    onClick={() => void handleToggleManagedFlag(hub)}
                    className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 ${
                      hub.isPlatformManaged
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {hub.isPlatformManaged ? (
                      <ToggleRight className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <ToggleLeft className="w-4 h-4 text-slate-500" aria-hidden="true" />
                    )}
                    <span>
                      {hub.isPlatformManaged
                        ? isSw
                          ? 'Helpdesk Kuu'
                          : 'Admin Helpdesk'
                        : isSw
                          ? 'Moja kwa Moja'
                          : 'Direct Vendor'}
                    </span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Live Interceptor Order Request */}
        {merchants.length > 0 && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px] space-y-1">
              <label className="text-[11px] font-semibold text-slate-700">
                {isSw ? 'Chagua Mfanyabiashara' : 'Target Merchant Profile'}
              </label>
              <select
                value={selectedSellerId}
                onChange={(e) => setSelectedSellerId(e.target.value)}
                className="w-full min-h-[38px] px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
              >
                {merchants.map((m) => (
                  <option key={m.merchantId} value={m.merchantId}>
                    {m.merchantName} ({m.isPlatformManaged ? 'MANAGED' : 'DIRECT'})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-w-[180px] space-y-1">
              <label className="text-[11px] font-semibold text-slate-700">
                {isSw ? 'Bidhaa Halisi ya Duka' : 'Active Merchant SKU'}
              </label>
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                disabled={sellerProducts.length === 0}
                className="w-full min-h-[38px] px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
              >
                {sellerProducts.length === 0 ? (
                  <option value="">
                    {isSw ? 'Hakuna bidhaa zilizopo kwa duka hili' : 'No active SKUs on this Merchant'}
                  </option>
                ) : (
                  sellerProducts.map((p) => (
                    <option key={p.productId} value={p.productId}>
                      {p.sku} · {isSw ? p.nameSw : p.nameEn}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="w-36 space-y-1">
              <label className="text-[11px] font-semibold text-slate-700">
                {isSw ? 'Kipimo' : 'Unit'}
              </label>
              <select
                value={selectedUnitType}
                onChange={(e) => setSelectedUnitType(e.target.value)}
                className="w-full min-h-[38px] px-2 rounded-md border border-slate-300 bg-white text-xs font-mono text-slate-900"
              >
                <option value="SINGLE_KILO_LITRE">1 KG/L</option>
                <option value="CARTON">CARTON</option>
                <option value="DOZEN">DOZEN</option>
                <option value="PACK">PACK</option>
              </select>
            </div>

            <div className="w-20 space-y-1">
              <label className="text-[11px] font-semibold text-slate-700">
                {isSw ? 'Idadi' : 'Qty'}
              </label>
              <input
                type="number"
                min={1}
                value={testQuantity}
                onChange={(e) => setTestQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full min-h-[38px] px-2.5 rounded-md border border-slate-300 bg-white text-xs font-mono text-slate-900"
              />
            </div>

            <button
              type="button"
              disabled={submitting || !selectedProductId}
              onClick={() => void handleDispatchLiveOrder()}
              className="min-h-[38px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-md flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {submitting
                  ? isSw
                    ? 'Inatuma...'
                    : 'Submitting...'
                  : 'POST /orders/submit-request'}
              </span>
            </button>
          </div>
        )}
      </section>

      {/* Real-Time Audit Dispatch Tracer */}
      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>
                {isSw
                  ? 'Kifuatiliaji cha Njia za Oda (Real-Time Audit Dispatch Tracer)'
                  : 'Real-Time Audit Dispatch Tracer'}
              </span>
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              {isSw
                ? 'Rekodi halisi za PostgreSQL zinazofuatilia njia za oda za Helpdesk Kuu dhidi ya Muuzaji.'
                : 'Live PostgreSQL traces tracking routing between corporate Helpdesk queue and direct Merchant terminals.'}
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
            <span className="text-emerald-700 font-bold">Helpdesk: {helpdeskQueueCount}</span>
            <span className="text-slate-700 font-bold">Direct DB: {directDbCount}</span>
          </div>
        </div>

        {traces.length === 0 ? (
          <EmptyStateCard
            locale={locale}
            titleSw="Hakuna njia za oda bado"
            titleEn="No order dispatch traces recorded yet"
          />
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {traces.map((trace) => {
              const isHelpdesk = trace.routingOutputCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK';
              return (
                <div
                  key={trace.traceId}
                  className="border border-slate-200 rounded-lg p-3 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 font-mono font-bold text-slate-900">
                      <span>#{trace.orderRef8}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-emerald-700">{trace.txIsolationLevel}</span>
                      <span className="text-slate-400">·</span>
                      <span>{trace.helpdeskStatus}</span>
                    </div>
                    <div className="text-slate-700 font-medium">
                      {trace.merchantName} ({trace.merchantShortCode})
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {isSw ? 'Njia' : 'Target'}: {formatPipelineLabel(trace.targetPipeline, locale)} ·{' '}
                      {new Date(trace.recordedAt).toLocaleString()}
                    </div>
                  </div>

                  <div className="text-right space-y-1 shrink-0">
                    <div
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded border ${
                        isHelpdesk
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-white border-slate-300 text-slate-800'
                      }`}
                    >
                      {formatRoutingLabel(trace.routingOutputCode, locale)}
                    </div>
                    <div className="font-mono font-bold text-slate-900 tabular-nums">
                      TZS {trace.expectedTotalTzs.toLocaleString('en-US')}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Global Standard Registry Lookup Preview (soko_global_catalog) */}
      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Globe className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            <span>
              {isSw ? 'Sajili ya Katalogi Kuu (Master Catalog)' : 'Master Catalog Registry'}
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
            <Database className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            <span>{catalogItems.length} Master SKUs</span>
          </span>
        </div>

        {catalogItems.length === 0 ? (
          <EmptyStateCard
            locale={locale}
            titleSw="Katalogi Kuu haina bidhaa bado"
            titleEn="No Master Catalog SKUs in PostgreSQL yet"
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {catalogItems.map((item) => (
              <div
                key={item.id}
                className="border border-slate-200 rounded-lg p-3 flex items-center gap-3 bg-white"
              >
                <img
                  src={item.imagekitCdnUrl}
                  alt={isSw ? item.fixedNameSw : item.fixedNameEn}
                  className="w-10 h-10 rounded object-cover border border-slate-100 shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-mono text-[11px] font-bold text-emerald-700 truncate">
                    {item.canonicalSku}
                  </div>
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {isSw ? item.fixedNameSw : item.fixedNameEn}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {item.categoryCode} · {item.baseQuantumUnit}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-[11px] text-slate-600 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            {isSw
              ? 'Wauzaji wanaonakili bidhaa kutoka Katalogi Kuu huanzishiwa hasa na 0 stock na 0 TZS kwenye wasifu wao wa ndani.'
              : 'Merchants cloning items from the Master Catalog receive an isolated local merchant storefront initialized with strictly 0 stock and 0 TZS pricing.'}
          </span>
        </div>
      </section>
    </div>
  );
}
