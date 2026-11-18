import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Download,
  KeyRound,
  RefreshCw,
  Search,
  Send,
  Truck,
  X,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { formatOrderStatusLabel } from '../lib/sokoManagedState';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { WholesalerEodReconciliation } from './WholesalerEodReconciliation';
import { HybridAnalyticsDashboard } from './HybridAnalyticsDashboard';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

type WholesalerTab = 'riders' | 'eod' | 'analytics';

interface ActiveRiderTrack {
  riderId: string;
  riderName: string;
  vehiclePlate: string;
  vehicleType: string;
  activeWard: string;
  activeDropsCount: number;
  completedDropsCount: number;
  cashOnStreetsTzs: number;
  lastPinSyncEat: string;
  routeStatus: 'ON_ROUTE' | 'RETURNING_WITH_CASH' | 'CLEARED';
}

interface SellingOrderSummary {
  orderId: string;
  orderRef: string;
  buyerName: string;
  buyerPhoneE164: string;
  expectedTotalTzs: number;
  status: 'PLACED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED' | 'DISPUTED';
  placedAt: string;
  itemsSummary: string;
}

interface BackendEodDriversResponse {
  sellerBusinessId: string;
  count: number;
  drivers: Array<{
    driverId: string;
    driverName: string;
    phoneE164: string;
    unsettledOrdersCount: number;
    expectedTotalTzs: number;
    collectedTotalTzs: number;
    outstandingBalanceTzs: number;
    cashTotalTzs: number;
    mpesaTotalTzs: number;
    tigoPesaTotalTzs: number;
    disputedOrPendingCount: number;
    unverifiedMobileMoneyCount: number;
  }>;
}

interface BackendOrdersResponse {
  count: number;
  orders: Array<{
    orderId: string;
    orderRef: string;
    buyerName: string;
    buyerPhoneE164: string;
    expectedTotalTzs: number;
    status: 'PLACED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED' | 'DISPUTED';
    placedAt: string;
    items: Array<{
      smsItemCode?: string;
      nameSw?: string;
      unitType: string;
      quantity: number;
    }>;
  }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}

export function WholesalerOperationsView({
  locale = 'en',
  businessId,
}: {
  locale?: Locale;
  businessId?: string | null;
}) {
  const isSw = locale === 'sw';
  const [subTab, setSubTab] = useState<WholesalerTab>('riders');
  const [wardFilter, setWardFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [riders, setRiders] = useState<ActiveRiderTrack[]>([]);
  const [sellingOrders, setSellingOrders] = useState<SellingOrderSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [dispatchingOrderId, setDispatchingOrderId] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [dispatchNotice, setDispatchNotice] = useState<{
    orderRef: string;
    buyerPin: string;
    driverPin: string;
    expectedCashTzs: number;
  } | null>(null);

  const loadWholesalerData = useCallback(async () => {
    if (!SokoApiClient.hasAccessToken()) {
      setRiders([]);
      setSellingOrders([]);
      return;
    }

    setLoading(true);
    setApiError(null);
    setBackendOffline(false);
    try {
      const bizQuery = isUuid(businessId) ? `?businessId=${encodeURIComponent(businessId)}` : '';
      const [eodRes, ordersRes] = await Promise.all([
        SokoApiClient.get<BackendEodDriversResponse>(`/wholesale/eod/drivers${bizQuery}`),
        SokoApiClient.get<BackendOrdersResponse>('/orders/my-orders?scope=selling'),
      ]);

      const driverTracks: ActiveRiderTrack[] = (eodRes?.drivers ?? []).map((d) => ({
        riderId: d.driverId,
        riderName: d.driverName,
        vehiclePlate: d.phoneE164,
        vehicleType: isSw ? 'Dereva wa Usambazaji' : 'Delivery Fleet',
        activeWard: 'Dar es Salaam',
        activeDropsCount: d.disputedOrPendingCount,
        completedDropsCount: Math.max(0, d.unsettledOrdersCount - d.disputedOrPendingCount),
        cashOnStreetsTzs: d.cashTotalTzs,
        lastPinSyncEat: `${d.unsettledOrdersCount} orders`,
        routeStatus:
          d.cashTotalTzs > 0
            ? d.disputedOrPendingCount > 0
              ? 'ON_ROUTE'
              : 'RETURNING_WITH_CASH'
            : 'CLEARED',
      }));
      setRiders(driverTracks);

      setSellingOrders(
        (ordersRes?.orders ?? []).map((o) => ({
          orderId: o.orderId,
          orderRef: o.orderRef,
          buyerName: o.buyerName,
          buyerPhoneE164: o.buyerPhoneE164,
          expectedTotalTzs: Number(o.expectedTotalTzs ?? 0),
          status: o.status,
          placedAt: o.placedAt,
          itemsSummary: o.items
            .map((i) => `${i.smsItemCode ?? i.nameSw ?? 'SKU'} (${i.quantity} × ${i.unitType})`)
            .join(' + '),
        }))
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setRiders([]);
        setSellingOrders([]);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia taarifa za usambazaji.'
              : 'Failed to load wholesaler fleet and order queue.'
        );
      }
    } finally {
      setLoading(false);
    }
  }, [businessId, isSw]);

  useEffect(() => {
    void loadWholesalerData();
  }, [loadWholesalerData]);

  const handleDispatchOrder = async (orderId: string) => {
    setApiError(null);
    setDispatchingOrderId(orderId);
    try {
      const resp = await SokoApiClient.post<{
        orderId: string;
        orderRef: string;
        expectedCashAmountTzs: number;
        buyerConfirmationPin: string;
        driverConfirmationPin: string;
      }>(`/orders/${orderId}/dispatch`, {});

      setDispatchNotice({
        orderRef: resp.orderRef,
        buyerPin: resp.buyerConfirmationPin,
        driverPin: resp.driverConfirmationPin,
        expectedCashTzs: resp.expectedCashAmountTzs,
      });
      await loadWholesalerData();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kutuma mzigo kwa dereva.'
              : 'Failed to dispatch order.'
        );
      }
    } finally {
      setDispatchingOrderId(null);
    }
  };

  const totalCashOutTzs = riders.reduce((sum, r) => sum + r.cashOnStreetsTzs, 0);
  const activeRidersCount = riders.filter((r) => r.routeStatus !== 'CLEARED').length;
  const openDropsCount = riders.reduce((sum, r) => sum + r.activeDropsCount, 0);

  const filteredRiders = riders.filter((rider) => {
    const matchesWard = wardFilter === 'ALL' || rider.activeWard === wardFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      rider.riderName.toLowerCase().includes(q) ||
      rider.vehiclePlate.toLowerCase().includes(q) ||
      rider.activeWard.toLowerCase().includes(q);
    return matchesWard && matchesSearch;
  });

  const handleDownloadSwahiliCsv = async () => {
    setApiError(null);
    try {
      const bizQuery = isUuid(businessId) ? `?businessId=${encodeURIComponent(businessId)}` : '';
      const blob = await SokoApiClient.downloadBlob(`/hybrid/analytics/export-csv${bizQuery}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sokokuu-mauzo.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakua ripoti ya CSV.'
              : 'Failed to export Swahili ledger CSV.'
        );
      }
    }
  };

  const placedOrders = sellingOrders.filter((o) => o.status === 'PLACED');

  return (
    <div className="space-y-6">
      {backendOffline && (
        <BackendOfflineBanner locale={locale} onRetry={() => void loadWholesalerData()} />
      )}

      {/* Sub-navigation inside Wholesaler Workspace */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('riders')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              subTab === 'riders'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Truck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Madereva & Oda Zinazoingia' : 'Active Riders & Dispatch Queue'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('eod')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              subTab === 'eod'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Hesabu za Jioni (EOD)' : 'Evening EOD Settlement'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('analytics')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              subTab === 'analytics'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Mapato & Uvunjaji Magunia' : 'Split Revenue & Stock'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadWholesalerData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleDownloadSwahiliCsv()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Pakua Ripoti (CSV)' : 'Export Ledger CSV'}</span>
          </button>
        </div>
      </div>

      {apiError && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg p-3.5 text-xs text-red-900 flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{apiError}</span>
          </div>
          <button
            type="button"
            onClick={() => setApiError(null)}
            className="text-red-700 hover:text-red-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {dispatchNotice && (
        <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-slate-900">
                {isSw
                  ? `Oda #${dispatchNotice.orderRef} Imetumwa kwa Dereva!`
                  : `Order #${dispatchNotice.orderRef} Dispatched & Dual-PIN Issued`}
              </div>
              <div className="font-mono text-slate-800 flex flex-wrap gap-3">
                <span>
                  <KeyRound className="w-3.5 h-3.5 inline mr-1 text-emerald-700" />
                  Buyer PIN: <strong>{dispatchNotice.buyerPin}</strong>
                </span>
                <span>
                  Driver PIN: <strong>{dispatchNotice.driverPin}</strong>
                </span>
                <span>
                  CoD: <strong>TZS {dispatchNotice.expectedCashTzs.toLocaleString('en-US')}</strong>
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDispatchNotice(null)}
            className="text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {subTab === 'riders' && (
        <div className="space-y-6">
          {placedOrders.length > 0 && (
            <section className="border border-emerald-200 bg-emerald-50/40 rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-emerald-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  {isSw
                    ? 'Oda Mpya Zinazosubiri Kutumwa (PLACED)'
                    : 'Incoming Orders Ready for Dispatch (PLACED)'}
                </h2>
                <span className="text-xs font-mono font-semibold text-emerald-800">
                  {placedOrders.length} {isSw ? 'oda' : 'pending'}
                </span>
              </div>
              <div className="divide-y divide-emerald-100 bg-white">
                {placedOrders.map((order) => (
                  <div
                    key={order.orderId}
                    className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div className="space-y-0.5 text-xs">
                      <div className="font-semibold text-slate-900">
                        <span className="font-mono">{order.orderRef}</span> · {order.buyerName} (
                        {order.buyerPhoneE164})
                      </div>
                      <div className="text-slate-500">{order.itemsSummary}</div>
                      <div className="font-mono font-bold text-emerald-700">
                        TZS {order.expectedTotalTzs.toLocaleString('en-US')}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={dispatchingOrderId === order.orderId}
                      onClick={() => void handleDispatchOrder(order.orderId)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer disabled:opacity-60"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>
                        {dispatchingOrderId === order.orderId
                          ? isSw
                            ? 'Inatuma...'
                            : 'Dispatching...'
                          : isSw
                            ? 'Tuma kwa Dereva & Toa PIN'
                            : 'Dispatch & Issue Dual-PIN'}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Top Summary Strip */}
          <section className="grid grid-cols-1 md:grid-cols-3 border border-slate-200 bg-white rounded-lg divide-y md:divide-y-0 md:divide-x divide-slate-200">
            <div className="p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                <Banknote className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                <span>{isSw ? 'Jumla ya Taslimu Mtaani (CoD)' : 'Total Physical Cash on Streets'}</span>
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                TZS {totalCashOutTzs.toLocaleString('en-US')}
              </div>
              <div className="text-xs text-slate-500">
                {isSw ? 'Inasubiri kurejeshwa ghalani' : 'Unsettled CoD cash held by active fleet'}
              </div>
            </div>

            <div className="p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Madereva Waliopo Kazini' : 'Live Active Delivery Riders'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-800">
                {activeRidersCount} / {riders.length}
              </div>
              <div className="text-xs text-slate-500">
                {isSw ? 'Madereva waliosajiliwa' : 'In-house riders & trusted fleet'}
              </div>
            </div>

            <div className="p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Oda Zinazoendelea Kushushwa' : 'Pending Street Drop-Offs'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {openDropsCount}
              </div>
              <div className="text-xs text-slate-500">
                {isSw ? 'Zinasubiri uhakiki wa Dual-PIN' : 'Awaiting Dual-PIN handover consensus'}
              </div>
            </div>
          </section>

          {/* Live Fleet Cash Table */}
          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-slate-900">
                {isSw ? 'Ufuatiliaji wa Madereva & Fedha za Leo' : 'Live Fleet Cash Tracking Ledger'}
              </h2>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search
                    className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={isSw ? 'Tafuta dereva au namba...' : 'Search rider or phone...'}
                    className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                  />
                </div>

                <select
                  value={wardFilter}
                  onChange={(e) => setWardFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                >
                  <option value="ALL">{isSw ? 'Kata Zote' : 'All Wards'}</option>
                  <option value="Dar es Salaam">Dar es Salaam</option>
                </select>
              </div>
            </div>

            {filteredRiders.length === 0 ? (
              <div className="p-6">
                <EmptyStateCard
                  locale={locale}
                  titleSw={loading ? 'Inapakia madereva...' : 'Hakuna rekodi bado'}
                  titleEn={
                    loading
                      ? 'Loading fleet ledger...'
                      : 'No unsettled riders or street drop-offs right now'
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                      <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Dereva / Mawasiliano' : 'Rider & Contact'}</th>
                      <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Kata' : 'Active Ward'}</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">{isSw ? 'Zilizoshushwa / Zilizobaki' : 'Delivered / Open'}</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">{isSw ? 'Taslimu Mkononi (TZS)' : 'Cash on Street (TZS)'}</th>
                      <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Kiasi cha Oda' : 'Activity'}</th>
                      <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Hali' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredRiders.map((rider) => (
                      <tr key={rider.riderId} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{rider.riderName}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {rider.vehicleType} · {rider.vehiclePlate}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 whitespace-nowrap">{rider.activeWard}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {rider.completedDropsCount} / {rider.activeDropsCount}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold tabular-nums text-slate-900 whitespace-nowrap">
                          TZS {rider.cashOnStreetsTzs.toLocaleString('en-US')}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {rider.lastPinSyncEat}
                        </td>
                        <td className="py-3 px-4 font-semibold whitespace-nowrap">
                          <span
                            className={
                              rider.routeStatus === 'CLEARED'
                                ? 'text-emerald-800'
                                : rider.routeStatus === 'RETURNING_WITH_CASH'
                                  ? 'text-amber-800'
                                  : 'text-slate-800'
                            }
                          >
                            {formatOrderStatusLabel(rider.routeStatus, locale)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {subTab === 'eod' && <WholesalerEodReconciliation locale={locale} businessId={businessId} />}
      {subTab === 'analytics' && (
        <HybridAnalyticsDashboard locale={locale} businessId={businessId} />
      )}
    </div>
  );
}
