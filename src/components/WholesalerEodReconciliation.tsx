import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  formatExceptionFlagLabel,
  formatOrderStatusLabel,
} from '../lib/sokoManagedState';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

export type ExceptionFlag = 'PENDING_SMS_SYNC' | 'DISPUTED';

export interface DriverExceptionItem {
  orderId?: string;
  orderRef: string;
  retailerDuka: string;
  flag: ExceptionFlag;
  amountTzs: number;
  detailEn: string;
  detailSw: string;
  timestamp: string;
  resolved: boolean;
  paymentMethod?: string;
}

export interface DriverEodSummary {
  driverId: string;
  driverName: string;
  vehicleType: string;
  phone: string;
  handledOrdersCount: number;
  expectedCashTzs: number;
  collectedCashTzs: number;
  outstandingBalanceTzs: number;
  cashTotalTzs: number;
  mpesaTotalTzs: number;
  tigoPesaTotalTzs: number;
  disputedOrPendingCount: number;
  unverifiedMobileMoneyCount: number;
  isSettled: boolean;
  settledAt?: string;
  exceptions: DriverExceptionItem[];
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
    driverUserId: string | null;
    status: string;
    expectedTotalTzs: number;
    placedAt: string;
    cashLedger: {
      verificationStatus: string;
      collectedCashAmount: number;
      paymentMethod: string;
    } | null;
  }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}

function formatTzs(amount: number): string {
  return `TZS ${amount.toLocaleString('en-US')}`;
}

export function WholesalerEodReconciliation({
  locale = 'en',
  businessId,
}: {
  locale?: Locale;
  businessId?: string | null;
}) {
  const isSw = locale === 'sw';
  const [drivers, setDrivers] = useState<DriverEodSummary[]>([]);
  const [expandedDriverId, setExpandedDriverId] = useState<string | null>(null);
  const [declaredCashByDriver, setDeclaredCashByDriver] = useState<Record<string, string>>({});
  const [ackOutstandingByDriver, setAckOutstandingByDriver] = useState<Record<string, boolean>>({});
  const [notesByDriver, setNotesByDriver] = useState<Record<string, string>>({});
  const [statusBanner, setStatusBanner] = useState<{ type: 'error' | 'info'; text: string } | null>(
    null
  );
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [settlingDriverId, setSettlingDriverId] = useState<string | null>(null);

  const loadEodDrivers = useCallback(async () => {
    if (!SokoApiClient.hasAccessToken()) {
      setDrivers([]);
      return;
    }

    setLoading(true);
    setBackendOffline(false);
    try {
      const bizQuery = isUuid(businessId) ? `?businessId=${encodeURIComponent(businessId)}` : '';
      const [eodRes, ordersRes] = await Promise.all([
        SokoApiClient.get<BackendEodDriversResponse>(`/wholesale/eod/drivers${bizQuery}`),
        SokoApiClient.get<BackendOrdersResponse>('/orders/my-orders?scope=selling').catch(
          () => ({ count: 0, orders: [] }) as BackendOrdersResponse
        ),
      ]);

      const driverOrdersMap = new Map<string, DriverExceptionItem[]>();
      for (const o of ordersRes?.orders ?? []) {
        if (!o.driverUserId) continue;
        const isPendingOrDisputed =
          o.status === 'DISPUTED' || o.cashLedger?.verificationStatus !== 'SUCCESSFUL';
        if (!isPendingOrDisputed) continue;
        const list = driverOrdersMap.get(o.driverUserId) ?? [];
        list.push({
          orderId: o.orderId,
          orderRef: o.orderRef,
          retailerDuka: o.buyerName,
          flag: o.status === 'DISPUTED' ? 'DISPUTED' : 'PENDING_SMS_SYNC',
          amountTzs: Number(o.expectedTotalTzs),
          detailEn: `Order ${o.orderRef} (${o.status}) · Ledger: ${o.cashLedger?.verificationStatus ?? 'PENDING'} · Payment: ${o.cashLedger?.paymentMethod ?? 'CASH'}`,
          detailSw: `Oda ${o.orderRef} (${o.status}) · Leja: ${o.cashLedger?.verificationStatus ?? 'PENDING'} · Malipo: ${o.cashLedger?.paymentMethod ?? 'CASH'}`,
          timestamp: o.placedAt.slice(11, 16) + ' UTC',
          resolved: false,
          paymentMethod: o.cashLedger?.paymentMethod,
        });
        driverOrdersMap.set(o.driverUserId, list);
      }

      const mapped: DriverEodSummary[] = (eodRes?.drivers ?? []).map((d) => ({
        driverId: d.driverId,
        driverName: d.driverName,
        vehicleType: isSw ? 'Dereva wa Usambazaji' : 'Assigned Delivery Driver',
        phone: d.phoneE164,
        handledOrdersCount: d.unsettledOrdersCount,
        expectedCashTzs: d.expectedTotalTzs,
        collectedCashTzs: d.collectedTotalTzs,
        outstandingBalanceTzs: d.outstandingBalanceTzs,
        cashTotalTzs: d.cashTotalTzs,
        mpesaTotalTzs: d.mpesaTotalTzs,
        tigoPesaTotalTzs: d.tigoPesaTotalTzs,
        disputedOrPendingCount: d.disputedOrPendingCount,
        unverifiedMobileMoneyCount: d.unverifiedMobileMoneyCount,
        isSettled: false,
        exceptions: driverOrdersMap.get(d.driverId) ?? [],
      }));

      setDrivers(mapped);
      setDeclaredCashByDriver((prev) => {
        const next = { ...prev };
        for (const d of mapped) {
          if (next[d.driverId] === undefined) {
            next[d.driverId] = String(d.cashTotalTzs);
          }
        }
        return next;
      });
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setDrivers([]);
      } else {
        setStatusBanner({
          type: 'error',
          text:
            err instanceof SokoHttpError
              ? err.message
              : isSw
                ? 'Imeshindikana kupakia hesabu za EOD za madereva.'
                : 'Failed to load driver EOD reconciliation summary.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [businessId, isSw]);

  useEffect(() => {
    void loadEodDrivers();
  }, [loadEodDrivers]);

  const totalExpected = drivers.reduce((acc, d) => acc + d.expectedCashTzs, 0);
  const totalSettled = drivers
    .filter((d) => d.isSettled)
    .reduce((acc, d) => acc + d.collectedCashTzs, 0);
  const openExceptionsCount = drivers.reduce(
    (acc, d) =>
      acc + Math.max(d.disputedOrPendingCount, d.exceptions.filter((e) => !e.resolved).length),
    0
  );

  const toggleExpand = (driverId: string) => {
    setExpandedDriverId((prev) => (prev === driverId ? null : driverId));
  };

  const handleCheckSyncStatus = async (orderRef: string) => {
    setStatusBanner({
      type: 'info',
      text: isSw
        ? `Oda ${orderRef} inahitaji kukamilishwa na Dual-PIN au kughairiwa kwenye seva kabla ya kufunga EOD.`
        : `Order ${orderRef} requires Dual-PIN completion or cancellation on PostgreSQL before EOD settlement.`,
    });
    await loadEodDrivers();
  };

  const handleReconcileAndSettle = async (driverId: string) => {
    const target = drivers.find((d) => d.driverId === driverId);
    if (!target || target.isSettled) return;

    const declaredCashRaw = declaredCashByDriver[driverId] ?? String(target.cashTotalTzs);
    const declaredCashTzs = Math.max(0, Number(declaredCashRaw.replace(/[^0-9]/g, '') || 0));
    const acknowledgeOutstandingBalance = Boolean(ackOutstandingByDriver[driverId]);
    const notes = (notesByDriver[driverId] ?? '').trim();

    setSettlingDriverId(driverId);
    setStatusBanner(null);
    try {
      const res = await SokoApiClient.post<{
        batchId: string;
        ordersSettledCount: number;
        totalSettledCashTzs: number;
        totalOutstandingBalanceTzs: number;
      }>(`/wholesale/eod-settle/${driverId}`, {
        declaredCashTzs,
        acknowledgeOutstandingBalance,
        ...(notes ? { notes } : {}),
      });

      setStatusBanner({
        type: 'info',
        text: isSw
          ? `Hesabu ya ${target.driverName} imefungwa! Oda ${res.ordersSettledCount} · Taslimu: ${formatTzs(res.totalSettledCashTzs)}`
          : `EOD batch committed for ${target.driverName}: ${res.ordersSettledCount} orders · ${formatTzs(res.totalSettledCashTzs)}.`,
      });
      await loadEodDrivers();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setExpandedDriverId(driverId);
        setStatusBanner({
          type: 'error',
          text:
            err instanceof SokoHttpError
              ? err.message
              : isSw
                ? 'Imeshindikana kufunga hesabu ya EOD.'
                : 'EOD settlement failed.',
        });
      }
    } finally {
      setSettlingDriverId(null);
    }
  };

  return (
    <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
      {backendOffline && (
        <div className="p-4 border-b border-slate-200">
          <BackendOfflineBanner locale={locale} onRetry={() => void loadEodDrivers()} />
        </div>
      )}

      {/* Header & EOD Summary Metrics */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {isSw
              ? 'Uhakiki wa Hesabu za Jioni za Madereva (EOD Settlement)'
              : 'Wholesaler End-of-Day Cash Reconciliation'}
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            {isSw
              ? 'Kagua madereva wanaorudi, linganisha taslimu ya TZS, na shughulikia oda za SMS au zilizokataliwa.'
              : 'Audit returning delivery staff, reconcile declared TZS cash, and commit atomic evening EOD settlement.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-right">
          <button
            type="button"
            onClick={() => void loadEodDrivers()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
          </button>
          <div>
            <div className="text-xs text-slate-500">
              {isSw ? 'Jumla Inayotarajiwa' : 'Total Expected CoD'}
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
              {formatTzs(totalExpected)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">
              {isSw ? 'Taslimu Iliyofungwa' : 'Settled Cash'}
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-emerald-800 mt-0.5">
              {formatTzs(totalSettled)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">
              {isSw ? 'Hitilafu / Wazi' : 'Pending / Disputed'}
            </div>
            <div
              className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${
                openExceptionsCount > 0 ? 'text-amber-800' : 'text-slate-900'
              }`}
            >
              {openExceptionsCount}
            </div>
          </div>
        </div>
      </div>

      {statusBanner && (
        <div
          role={statusBanner.type === 'error' ? 'alert' : 'status'}
          className={`px-5 py-2.5 border-b text-xs font-medium flex items-center justify-between gap-4 ${
            statusBanner.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <span>{statusBanner.text}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="opacity-75 hover:opacity-100 whitespace-nowrap cursor-pointer"
          >
            {isSw ? 'Funga' : 'Dismiss'}
          </button>
        </div>
      )}

      {drivers.length === 0 ? (
        <div className="p-6">
          <EmptyStateCard
            locale={locale}
            titleSw={loading ? 'Inapakia hesabu za EOD...' : 'Hakuna rekodi bado'}
            titleEn={
              loading
                ? 'Loading unsettled driver ledgers...'
                : 'No unsettled driver EOD balances in PostgreSQL'
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                <th className="py-2.5 px-5 w-10" aria-label="Expand row" />
                <th className="py-2.5 px-4">{isSw ? 'Dereva' : 'Driver Name'}</th>
                <th className="py-2.5 px-4 text-right">{isSw ? 'Idadi ya Oda' : 'Orders'}</th>
                <th className="py-2.5 px-4 text-right">
                  {isSw ? 'Taslimu / Iliyokusanywa' : 'Expected / Cash'}
                </th>
                <th className="py-2.5 px-4">{isSw ? 'Hali / Hitilafu' : 'Queue & Exceptions'}</th>
                <th className="py-2.5 px-5 text-right">{isSw ? 'Hatua' : 'Action'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {drivers.map((driver) => {
                const isExpanded = expandedDriverId === driver.driverId;
                const openItems = driver.exceptions.filter((e) => !e.resolved);

                return (
                  <Fragment key={driver.driverId}>
                    <tr className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-5">
                        <button
                          type="button"
                          onClick={() => toggleExpand(driver.driverId)}
                          aria-expanded={isExpanded}
                          aria-label={`Toggle details for ${driver.driverName}`}
                          className="p-1 text-slate-500 hover:text-slate-900 rounded cursor-pointer"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{driver.driverName}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {driver.vehicleType} · {driver.phone}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                        {driver.handledOrdersCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs whitespace-nowrap">
                        <div className="font-semibold text-slate-900">
                          {formatTzs(driver.expectedCashTzs)}
                        </div>
                        <div className="text-slate-500">
                          Cash: {formatTzs(driver.cashTotalTzs)}
                          {driver.mpesaTotalTzs > 0
                            ? ` · M-Pesa: ${formatTzs(driver.mpesaTotalTzs)}`
                            : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono whitespace-nowrap">
                        {driver.isSettled ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-800 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>
                              {formatOrderStatusLabel('SETTLED', locale)} · {driver.settledAt}
                            </span>
                          </span>
                        ) : driver.disputedOrPendingCount > 0 || openItems.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggleExpand(driver.driverId)}
                            className="inline-flex items-center gap-1.5 text-amber-800 font-medium hover:underline cursor-pointer"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>
                              {driver.disputedOrPendingCount || openItems.length} pending/disputed
                            </span>
                          </button>
                        ) : (
                          <span className="text-emerald-700 font-medium">
                            {isSw ? 'Tayari Kufunga' : 'Ready to Settle'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          disabled={driver.isSettled || settlingDriverId === driver.driverId}
                          onClick={() => void handleReconcileAndSettle(driver.driverId)}
                          className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            driver.isSettled
                              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                              : 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer disabled:opacity-60'
                          }`}
                        >
                          {settlingDriverId === driver.driverId
                            ? isSw
                              ? 'Inafunga...'
                              : 'Settling...'
                            : driver.isSettled
                              ? isSw
                                ? 'Imefungwa'
                                : 'Settled'
                              : isSw
                                ? 'Hakiki & Funga Hesabu'
                                : 'Reconcile & Settle'}
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={6} className="px-6 py-4 border-t border-slate-200 space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-white border border-slate-200 rounded-md p-3.5">
                            <label className="space-y-1 text-xs">
                              <span className="font-semibold text-slate-700">
                                {isSw ? 'Taslimu Iliyohesabiwa (TZS)' : 'Declared Physical Cash (TZS)'}
                              </span>
                              <input
                                type="number"
                                min={0}
                                value={declaredCashByDriver[driver.driverId] ?? String(driver.cashTotalTzs)}
                                onChange={(e) =>
                                  setDeclaredCashByDriver((prev) => ({
                                    ...prev,
                                    [driver.driverId]: e.target.value,
                                  }))
                                }
                                className="w-full px-3 py-1.5 font-mono text-xs border border-slate-300 rounded-md"
                              />
                            </label>

                            <label className="space-y-1 text-xs">
                              <span className="font-semibold text-slate-700">
                                {isSw ? 'Maelezo ya EOD (Hiari)' : 'Settlement Notes (Optional)'}
                              </span>
                              <input
                                type="text"
                                value={notesByDriver[driver.driverId] ?? ''}
                                onChange={(e) =>
                                  setNotesByDriver((prev) => ({
                                    ...prev,
                                    [driver.driverId]: e.target.value,
                                  }))
                                }
                                placeholder={isSw ? 'Mf. Imethibitishwa ghalani' : 'e.g. Verified at counter'}
                                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                              />
                            </label>

                            <div className="flex items-end">
                              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={Boolean(ackOutstandingByDriver[driver.driverId])}
                                  onChange={(e) =>
                                    setAckOutstandingByDriver((prev) => ({
                                      ...prev,
                                      [driver.driverId]: e.target.checked,
                                    }))
                                  }
                                />
                                <span>
                                  {isSw
                                    ? `Kubali salio baki (${formatTzs(driver.outstandingBalanceTzs)})`
                                    : `Acknowledge outstanding (${formatTzs(driver.outstandingBalanceTzs)})`}
                                </span>
                              </label>
                            </div>
                          </div>

                          <div className="text-xs font-medium text-slate-700">
                            {isSw
                              ? 'Oda Zisizosawazishwa & Mizozo'
                              : 'Open Orders, Unverified Payments & Disputed Shipments'}
                          </div>

                          {driver.exceptions.length === 0 ? (
                            <div className="text-xs text-slate-500 py-1 flex items-center gap-1.5">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                              <span>
                                {isSw
                                  ? 'Hakuna oda zinazosubiri SMS au zenye mzozo kwa dereva huyu.'
                                  : 'No Pending SMS Sync or Disputed records for this driver.'}
                              </span>
                            </div>
                          ) : (
                            <div className="divide-y divide-slate-200 border border-slate-200 bg-white rounded-md">
                              {driver.exceptions.map((ex) => (
                                <div
                                  key={ex.orderRef}
                                  className="px-4 py-3 flex flex-wrap items-center justify-between gap-4"
                                >
                                  <div className="min-w-0 space-y-0.5">
                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                      <span className="font-mono font-semibold text-slate-900">
                                        {ex.orderRef}
                                      </span>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-medium text-slate-800">
                                        {ex.retailerDuka}
                                      </span>
                                      <span aria-hidden="true">·</span>
                                      <span
                                        className={`font-medium ${
                                          ex.flag === 'DISPUTED' ? 'text-red-700' : 'text-amber-800'
                                        }`}
                                      >
                                        {formatExceptionFlagLabel(ex.flag, locale)}
                                      </span>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono tabular-nums text-slate-600">
                                        {formatTzs(ex.amountTzs)}
                                      </span>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-slate-500">{ex.timestamp}</span>
                                    </div>
                                    <p className="text-xs text-slate-600">
                                      {isSw ? ex.detailSw : ex.detailEn}
                                    </p>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => void handleCheckSyncStatus(ex.orderRef)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                                    <span>
                                      {isSw ? 'Kagua Hali Seva' : 'Refresh Server Status'}
                                    </span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
