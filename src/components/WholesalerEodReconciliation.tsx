import { Fragment, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  formatExceptionFlagLabel,
  formatOrderStatusLabel,
} from '../lib/sokoManagedState';

export type ExceptionFlag = 'PENDING_SMS_SYNC' | 'DISPUTED';

export interface DriverExceptionItem {
  orderRef: string;
  retailerDuka: string;
  flag: ExceptionFlag;
  amountTzs: number;
  detailEn: string;
  detailSw: string;
  timestamp: string;
  resolved: boolean;
}

export interface DriverEodSummary {
  driverId: string;
  driverName: string;
  vehicleType: string;
  phone: string;
  handledOrdersCount: number;
  expectedCashTzs: number;
  collectedCashTzs: number;
  isSettled: boolean;
  settledAt?: string;
  exceptions: DriverExceptionItem[];
}

const INITIAL_DRIVERS: DriverEodSummary[] = [
  {
    driverId: 'drv-01',
    driverName: 'Juma Mwinyi',
    vehicleType: 'Boda-Boda · MC 412 DKL',
    phone: '+255 713 442 819',
    handledOrdersCount: 14,
    expectedCashTzs: 1_485_000,
    collectedCashTzs: 1_485_000,
    isSettled: false,
    exceptions: [
      {
        orderRef: 'K9M2P4X8',
        retailerDuka: 'Msimbazi Corner Duka',
        flag: 'PENDING_SMS_SYNC',
        amountTzs: 163_200,
        detailEn: 'Offline SMS SK#K9M2P4X8#S12#P01:C:2#9A4C1E awaiting carrier delivery receipt.',
        detailSw: 'SMS ya nje ya mtandao SK#K9M2P4X8#S12#P01:C:2#9A4C1E inasubiri uthibitisho wa mtandao.',
        timestamp: '16:42 EAT',
        resolved: false,
      },
    ],
  },
  {
    driverId: 'drv-02',
    driverName: 'Hassan Bakari',
    vehicleType: 'Kirikuu Mini-Truck · T 884 DQP',
    phone: '+255 754 908 331',
    handledOrdersCount: 9,
    expectedCashTzs: 2_940_000,
    collectedCashTzs: 2_658_000,
    isSettled: false,
    exceptions: [
      {
        orderRef: 'R4T7N2W5',
        retailerDuka: 'Buguruni Rozana Store',
        flag: 'DISPUTED',
        amountTzs: 282_000,
        detailEn: 'Rejected at doorstep via SK#CANCEL#R4T7N2W5#4E7B11 (damaged cooking oil cartons).',
        detailSw: 'Imekataliwa mlangoni kupitia SK#CANCEL#R4T7N2W5#4E7B11 (katoni za mafuta zimeharibika).',
        timestamp: '15:18 EAT',
        resolved: false,
      },
    ],
  },
  {
    driverId: 'drv-03',
    driverName: 'Neema Mushi',
    vehicleType: 'Boda-Boda · MC 709 BZN',
    phone: '+255 786 215 604',
    handledOrdersCount: 11,
    expectedCashTzs: 964_000,
    collectedCashTzs: 964_000,
    isSettled: true,
    settledAt: '17:05 EAT',
    exceptions: [],
  },
];

function formatTzs(amount: number): string {
  return `TZS ${amount.toLocaleString('en-US')}`;
}

export function WholesalerEodReconciliation({ locale = 'en' }: { locale?: Locale }) {
  const [drivers, setDrivers] = useState<DriverEodSummary[]>(INITIAL_DRIVERS);
  const [expandedDriverId, setExpandedDriverId] = useState<string | null>('drv-02');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const isSw = locale === 'sw';

  const totalExpected = drivers.reduce((acc, d) => acc + d.expectedCashTzs, 0);
  const totalSettled = drivers
    .filter((d) => d.isSettled)
    .reduce((acc, d) => acc + d.collectedCashTzs, 0);
  const openExceptionsCount = drivers.reduce(
    (acc, d) => acc + d.exceptions.filter((e) => !e.resolved).length,
    0
  );

  const toggleExpand = (driverId: string) => {
    setExpandedDriverId((prev) => (prev === driverId ? null : driverId));
  };

  const handleResolveException = (driverId: string, orderRef: string) => {
    setDrivers((prev) =>
      prev.map((driver) => {
        if (driver.driverId !== driverId) return driver;
        const target = driver.exceptions.find((e) => e.orderRef === orderRef);
        const updatedExceptions = driver.exceptions.map((ex) =>
          ex.orderRef === orderRef ? { ...ex, resolved: true } : ex
        );
        // If a DISPUTED order was cancelled/returned to warehouse, reduce expected cash by its amount
        const adjustedExpected =
          target && target.flag === 'DISPUTED' && !target.resolved
            ? Math.max(0, driver.expectedCashTzs - target.amountTzs)
            : driver.expectedCashTzs;

        return {
          ...driver,
          expectedCashTzs: adjustedExpected,
          exceptions: updatedExceptions,
        };
      })
    );
    setStatusBanner(
      isSw
        ? `Hitilafu ya oda ${orderRef} imeshughulikiwa na kurekebishwa kwenye leja.`
        : `Exception ${orderRef} resolved and cash ledger adjusted.`
    );
  };

  const handleReconcileAndSettle = (driverId: string) => {
    const target = drivers.find((d) => d.driverId === driverId);
    if (!target || target.isSettled) return;

    const unresolved = target.exceptions.some((ex) => !ex.resolved);
    if (unresolved) {
      setExpandedDriverId(driverId);
      setStatusBanner(
        isSw
          ? `Maliza kwanza oda zinazosubiri SMS au zenye mzozo za ${target.driverName} kabla ya kufunga hesabu.`
          : `Resolve open Pending SMS Sync / Disputed items for ${target.driverName} before settling.`
      );
      return;
    }

    const nowTime = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    }) + ' EAT';

    setDrivers((prev) =>
      prev.map((d) =>
        d.driverId === driverId ? { ...d, isSettled: true, settledAt: nowTime } : d
      )
    );
    setStatusBanner(
      isSw
        ? `Hesabu ya ${target.driverName} (${formatTzs(target.expectedCashTzs)}) imethibitishwa na kufungwa.`
        : `Settled ${target.driverName}: ${formatTzs(target.expectedCashTzs)} verified and locked.`
    );
  };

  return (
    <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
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
              : 'Audit returning delivery staff, resolve Pending SMS Sync and Disputed exceptions, and commit evening TZS settlement.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-right">
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
              {isSw ? 'Hitilafu Wazi' : 'Open Exceptions'}
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
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-800 flex items-center justify-between gap-4">
          <span>{statusBanner}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-slate-500 hover:text-slate-900 whitespace-nowrap cursor-pointer"
          >
            {isSw ? 'Funga' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* Driver Reconciliation Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
              <th className="py-2.5 px-5 w-10" aria-label="Expand row" />
              <th className="py-2.5 px-4">{isSw ? 'Dereva' : 'Driver Name'}</th>
              <th className="py-2.5 px-4 text-right">
                {isSw ? 'Idadi ya Oda' : 'Handled Orders'}
              </th>
              <th className="py-2.5 px-4 text-right">
                {isSw ? 'Taslimu Inayotarajiwa' : 'Expected Cash'}
              </th>
              <th className="py-2.5 px-4">{isSw ? 'Hali / Hitilafu' : 'Queue & Exceptions'}</th>
              <th className="py-2.5 px-5 text-right">{isSw ? 'Hatua' : 'Action'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {drivers.map((driver) => {
              const isExpanded = expandedDriverId === driver.driverId;
              const openItems = driver.exceptions.filter((e) => !e.resolved);
              const hasExceptions = driver.exceptions.length > 0;

              return (
                <Fragment key={driver.driverId}>
                  <tr
                    className="hover:bg-slate-50/70 transition-colors"
                  >
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
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                      {formatTzs(driver.expectedCashTzs)}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono whitespace-nowrap">
                      {driver.isSettled ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-800 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>
                            {formatOrderStatusLabel('SETTLED', locale)} · {driver.settledAt}
                          </span>
                        </span>
                      ) : openItems.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleExpand(driver.driverId)}
                          className="inline-flex items-center gap-1.5 text-amber-800 font-medium hover:underline cursor-pointer"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>
                            {openItems.map((i) => formatExceptionFlagLabel(i.flag, locale)).join(' / ')} ({openItems.length})
                          </span>
                        </button>
                      ) : (
                        <span className="text-slate-500">
                          {isSw ? 'Tayari Kufunga' : 'Ready to Settle'}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={driver.isSettled}
                        onClick={() => handleReconcileAndSettle(driver.driverId)}
                        className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          driver.isSettled
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            : 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                        }`}
                      >
                        {driver.isSettled
                          ? isSw
                            ? 'Imefungwa'
                            : 'Settled'
                          : isSw
                            ? 'Hakiki & Funga Hesabu'
                            : 'Reconcile & Settle'}
                      </button>
                    </td>
                  </tr>

                  {/* Expandable Sub-list for PENDING_SMS_SYNC and DISPUTED Orders */}
                  {isExpanded && (
                    <tr key={`${driver.driverId}-drawer`} className="bg-slate-50/80">
                      <td colSpan={6} className="px-6 py-4 border-t border-slate-200">
                        <div className="text-xs font-medium text-slate-700 mb-2.5">
                          {isSw
                            ? 'Oda Zisizosawazishwa & Mizozo (Offline / NextSMS)'
                            : 'Unsynchronized Offline Actions & Disputed Shipments'}
                        </div>

                        {!hasExceptions ? (
                          <div className="text-xs text-slate-500 py-2">
                            {isSw
                              ? 'Hakuna oda zinazosubiri SMS au zenye mzozo kwa dereva huyu.'
                              : 'No Pending SMS Sync or Disputed records for this driver.'}
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
                                        ex.resolved
                                          ? 'text-emerald-800'
                                          : ex.flag === 'DISPUTED'
                                            ? 'text-red-700'
                                            : 'text-amber-800'
                                      }`}
                                    >
                                      {ex.resolved
                                        ? formatExceptionFlagLabel('RESOLVED', locale)
                                        : formatExceptionFlagLabel(ex.flag, locale)}
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

                                {!ex.resolved && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleResolveException(driver.driverId, ex.orderRef)
                                    }
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                                    <span>
                                      {ex.flag === 'DISPUTED'
                                        ? isSw
                                          ? 'Thibitisha Kurudi kwa Mizigo'
                                          : 'Confirm Stock Return & Deduct'
                                        : isSw
                                          ? 'Sawazisha SMS Sasa'
                                          : 'Force SMS Reconciliation'}
                                    </span>
                                  </button>
                                )}
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
    </section>
  );
}
