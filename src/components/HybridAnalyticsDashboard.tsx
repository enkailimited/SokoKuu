import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { formatUnitTypeLabel } from '../lib/sokoManagedState';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

interface LowStockSkuItem {
  productId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  parentUnit: string;
  quantaPerBulkPackage: number;
  sealedBulkStock: number;
  looseQuantaStock: number;
  dailyVelocityQuanta: number;
}

interface DailyRevenueAnalytics {
  sellerBusinessId: string;
  currency: string;
  deliveredOrdersCount: number;
  posReceiptsCount: number;
  b2bWholesaleRevenueTzs: number;
  b2cRetailRevenueTzs: number;
  posWalkinRevenueTzs: number;
  totalCollectedTzs: number;
  totalOutstandingTzs: number;
  byPaymentMethod: {
    CASH: number;
    'M-PESA': number;
    'TIGO-PESA': number;
  };
}

interface BackendProductDto {
  productId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  availableQuarterQuanta: number;
  sealedBulkPackagesStock: number;
  wholesaleThresholdUnits: number;
  priceTiers?: Array<{
    unitType: string;
    quarterQuantaPerUnit: number;
    isWholesaleTier: boolean;
  }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}

function formatTzs(amount: number): string {
  return `TZS ${amount.toLocaleString('en-US')}`;
}

async function resolveAnalyticsBusinessId(
  businessId?: string | null,
): Promise<string | null> {
  let targetBusinessId = isUuid(businessId)
    ? businessId
    : SokoApiClient.getActiveUser()?.businessId ?? null;

  if (!isUuid(targetBusinessId) && SokoApiClient.hasAccessToken()) {
    const me = await SokoApiClient.get<{ businessId?: string | null }>('/auth/me');
    targetBusinessId = me?.businessId ?? null;
  }

  return isUuid(targetBusinessId) ? targetBusinessId : null;
}

export function HybridAnalyticsDashboard({
  locale = 'en',
  businessId,
}: {
  locale?: Locale;
  businessId?: string | null;
}) {
  const isSw = locale === 'sw';

  const [stockItems, setStockItems] = useState<LowStockSkuItem[]>([]);
  const [analytics, setAnalytics] = useState<DailyRevenueAnalytics | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setLoading(true);
    setApiError(null);
    setBackendOffline(false);

    try {
      const targetBusinessId = await resolveAnalyticsBusinessId(businessId);

      if (!targetBusinessId) {
        setAnalytics(null);
        setStockItems([]);
        return;
      }

      const [revRes, prodRes] = await Promise.all([
        SokoApiClient.get<DailyRevenueAnalytics>(
          `/hybrid/analytics/${encodeURIComponent(targetBusinessId)}/daily-revenue`,
        ),
        SokoApiClient.get<BackendProductDto[]>(
          `/products/active?businessId=${encodeURIComponent(targetBusinessId)}`,
        ),
      ]);

      setAnalytics(revRes);
      setStockItems(
        (Array.isArray(prodRes) ? prodRes : []).map((p) => {
          const bulkTier =
            p.priceTiers?.find((t) => t.isWholesaleTier) ?? p.priceTiers?.[0];
          const quantaPerBulkPackage = Number(bulkTier?.quarterQuantaPerUnit ?? 200);
          // Derive the reorder trigger from the live wholesale MOQ returned by
          // NestJS instead of a static demo velocity.
          const dailyVelocityQuanta = Math.max(
            1,
            Math.round(Number(p.wholesaleThresholdUnits ?? 1) * quantaPerBulkPackage),
          );
          return {
            productId: p.productId,
            sku: p.sku,
            nameSw: p.nameSw,
            nameEn: p.nameEn,
            parentUnit: bulkTier?.unitType ?? 'SACK_50KG',
            quantaPerBulkPackage,
            sealedBulkStock: Number(p.sealedBulkPackagesStock ?? 0),
            looseQuantaStock: Number(p.availableQuarterQuanta ?? 0),
            dailyVelocityQuanta,
          };
        }),
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia takwimu za mapato.'
              : 'Failed to load daily revenue analytics.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [businessId, isSw]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const wholesaleRevenueTzs = analytics ? Number(analytics.b2bWholesaleRevenueTzs ?? 0) : 0;
  const wholesaleOrdersCount = analytics ? Number(analytics.deliveredOrdersCount ?? 0) : 0;
  const retailRevenueTzs = analytics ? Number(analytics.b2cRetailRevenueTzs ?? 0) : 0;
  const retailOrdersCount = analytics ? Number(analytics.posReceiptsCount ?? 0) : 0;
  const totalRevenueTzs = analytics ? Number(analytics.totalCollectedTzs ?? 0) : 0;

  const combinedChannelTzs = wholesaleRevenueTzs + retailRevenueTzs;
  const wholesaleSharePct =
    combinedChannelTzs === 0
      ? 0
      : Math.round((wholesaleRevenueTzs / combinedChannelTzs) * 100);
  const retailSharePct = combinedChannelTzs === 0 ? 0 : 100 - wholesaleSharePct;

  const lowStockAlerts = stockItems.filter(
    (item) => item.looseQuantaStock < item.dailyVelocityQuanta * 0.5,
  );

  const handleExportCsv = async () => {
    setApiError(null);
    setBackendOffline(false);
    try {
      const targetId = await resolveAnalyticsBusinessId(businessId);
      const query = targetId ? `?businessId=${encodeURIComponent(targetId)}` : '';
      const blob = await SokoApiClient.downloadBlob(`/hybrid/analytics/export-csv${query}`);
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
              ? 'Imeshindikana kupakua CSV.'
              : 'Failed to export analytics CSV.',
        );
      }
    }
  };

  return (
    <div className="space-y-6">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          retrying={loading}
          onRetry={() => void loadAnalytics()}
        />
      )}

      {apiError && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg p-3.5 text-xs text-red-900"
        >
          {apiError}
        </div>
      )}

      {/* 1. Side-by-Side Split Revenue Comparative Panel */}
      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isSw
                ? 'Mapato ya Duka Mseto: Jumla (B2B) dhidi ya Rejareja (B2C)'
                : 'Hybrid Store Split Revenue Analytics (B2B vs. B2C)'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              {isSw
                ? 'Mgawanyo wa fedha halisi zilizokusanywa kwa Dual-PIN na POS leo katika vitengo kamili vya TZS.'
                : 'Discrete daily revenue reconciled via Dual-PIN and POS, partitioned across Wholesale and Retail channels.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void loadAnalytics()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleExportCsv()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
            <div className="text-right">
              <div className="text-xs text-slate-500">
                {isSw ? 'Jumla Iliyokusanywa' : 'Total Collected'}
              </div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                {formatTzs(totalRevenueTzs)}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
          {/* Wholesale Channel Card */}
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold text-slate-700">
                B2B_WHOLESALE · {wholesaleSharePct}%
              </span>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {wholesaleOrdersCount} {isSw ? 'oda zilizowasilishwa' : 'delivered orders'}
              </span>
            </div>
            <div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {formatTzs(wholesaleRevenueTzs)}
              </div>
              <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                {isSw ? 'Wastani wa oda:' : 'Avg order value:'}{' '}
                {formatTzs(
                  wholesaleOrdersCount > 0
                    ? Math.round(wholesaleRevenueTzs / wholesaleOrdersCount)
                    : 0,
                )}
              </div>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-sm overflow-hidden">
              <div className="h-full bg-slate-900" style={{ width: `${wholesaleSharePct}%` }} />
            </div>
          </div>

          {/* Retail Channel Card */}
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold text-emerald-800">
                B2C_RETAIL · {retailSharePct}%
              </span>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {retailOrdersCount} {isSw ? 'risiti za POS' : 'POS walk-in receipts'}
              </span>
            </div>
            <div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-800">
                {formatTzs(retailRevenueTzs)}
              </div>
              <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                {isSw ? 'Wastani wa mauzo:' : 'Avg ticket size:'}{' '}
                {formatTzs(
                  retailOrdersCount > 0 ? Math.round(retailRevenueTzs / retailOrdersCount) : 0,
                )}
              </div>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-sm overflow-hidden">
              <div className="h-full bg-emerald-700" style={{ width: `${retailSharePct}%` }} />
            </div>
          </div>
        </div>

        {analytics && (
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-slate-700">
            <span>
              CASH: <strong>{formatTzs(analytics.byPaymentMethod.CASH)}</strong> · M-PESA:{' '}
              <strong>{formatTzs(analytics.byPaymentMethod['M-PESA'])}</strong> · TIGO-PESA:{' '}
              <strong>{formatTzs(analytics.byPaymentMethod['TIGO-PESA'])}</strong>
            </span>
            <span className="text-amber-800">
              {isSw ? 'Salio Baki:' : 'Outstanding:'}{' '}
              <strong>{formatTzs(analytics.totalOutstandingTzs)}</strong>
            </span>
          </div>
        )}
      </section>

      {/* 2. Low-Stock & Bulk-Breaking Drawer */}
      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen((prev) => !prev)}
          className="w-full px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4 text-left cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            {drawerOpen ? (
              <ChevronDown className="w-4 h-4 text-slate-500" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
            )}
            <AlertTriangle className="w-4 h-4 text-amber-700" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-900">
              Hisa ya Bidhaa Inayoisha (Low Stock &amp; Bulk-Breaking Alert Drawer)
            </span>
          </div>
          <span className="text-xs font-mono font-medium text-amber-800 tabular-nums whitespace-nowrap">
            {lowStockAlerts.length} {isSw ? 'zinahitaji uvunjaji' : 'low shelf stock'}
          </span>
        </button>

        {drawerOpen && (
          <div className="divide-y divide-slate-200">
            {loading && stockItems.length === 0 ? (
              <div className="px-5 py-6 text-center text-xs text-slate-500">
                {isSw ? 'Inapakia orodha ya hisa...' : 'Loading product inventory...'}
              </div>
            ) : stockItems.length === 0 ? (
              <div className="p-4">
                <EmptyStateCard
                  locale={locale}
                  titleSw="Hakuna rekodi bado"
                  titleEn="No records yet"
                  descriptionSw="Hakuna bidhaa zilizosajiliwa kwenye rafu kwa duka hili katika PostgreSQL."
                  descriptionEn="No active catalog SKUs exist in PostgreSQL for this store yet."
                />
              </div>
            ) : (
              stockItems.map((item) => {
                const isLow = item.looseQuantaStock < item.dailyVelocityQuanta * 0.5;
                return (
                  <div
                    key={item.productId}
                    className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-semibold text-slate-900">{item.sku}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-slate-900">
                          {isSw ? item.nameSw : item.nameEn}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className={`font-medium ${isLow ? 'text-amber-800' : 'text-emerald-800'}`}>
                          {isLow
                            ? isSw
                              ? 'Hisa ya Chini'
                              : 'Low Loose Stock'
                            : isSw
                              ? 'Hali Nzuri'
                              : 'Nominal'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 font-mono tabular-nums">
                        Loose shelf: {item.looseQuantaStock} quanta (
                        {(item.looseQuantaStock * 0.25).toFixed(2)} kg/L) · Sealed{' '}
                        {formatUnitTypeLabel(item.parentUnit, locale)}: {item.sealedBulkStock}
                      </div>
                    </div>

                    <span className="text-[11px] font-mono text-slate-600 bg-slate-100 px-2.5 py-1.5 rounded">
                      {isSw
                        ? 'Huvunjwa kiotomatiki mauzo yakipungua'
                        : 'Auto-deconstructs on POS / Order'}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
    </div>
  );
}
