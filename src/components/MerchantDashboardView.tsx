import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Boxes,
  ChevronRight,
  ClipboardList,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  Warehouse,
} from 'lucide-react';
import { t, type Locale } from '../i18n';
import type { UserProfile } from '../types/auth';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

interface DashboardOrderRow {
  orderId: string;
  orderRef: string;
  buyerName: string;
  sellerBusinessId: string;
  sellerBusinessName: string;
  status: 'PLACED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED' | 'DISPUTED';
  orderMode?: 'INSTANT' | 'SCHEDULED';
  scheduledDeliveryDate?: string | null;
  expectedTotalTzs: number;
  placedAt: string;
  items: Array<{
    nameSw: string;
    nameEn: string;
    quantity: number;
    unitType: string;
  }>;
}

interface DailyRevenuePayload {
  deliveredOrdersCount: number;
  posReceiptsCount: number;
  b2bWholesaleRevenueTzs: number;
  b2cRetailRevenueTzs: number;
  posWalkinRevenueTzs: number;
  totalCollectedTzs: number;
  totalOutstandingTzs: number;
}

interface ActiveProductPayload {
  productId: string;
  availableQuarterQuanta?: number;
  sealedBulkPackagesStock?: number;
  quantaPerSealedPackage?: number;
  lowStockThresholdQuanta?: number;
}

interface SupplierInventoryPayload {
  totalWarehouseQuanta: number;
  items: Array<{
    productId: string;
    availableQuantaStock: number;
    lowStockThresholdQuanta: number;
  }>;
}

interface SupplierReportPayload {
  totalB2bRevenueTzs: string;
  totalOrdersFulfilled: number;
  pendingDispatchCount: number;
  warehouseValuationTzs: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function eatDateString(isoOrNow?: string): string {
  const ms = isoOrNow ? new Date(isoOrNow).getTime() : Date.now();
  if (Number.isNaN(ms)) return '';
  return new Date(ms + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatTzs(amount: number): string {
  return `TZS ${Math.round(amount).toLocaleString('en-US')}`;
}

function statusBadgeStyle(status: DashboardOrderRow['status']): string {
  switch (status) {
    case 'DELIVERED':
      return 'bg-[#15AC49]/10 text-[#15AC49] border-[#15AC49]/25';
    case 'DISPATCHED':
      return 'bg-[#0054A6]/10 text-[#0054A6] border-[#0054A6]/25';
    case 'CANCELLED':
    case 'DISPUTED':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return 'bg-amber-50 text-amber-800 border-amber-200';
  }
}

export function MerchantDashboardView({
  locale,
  profile,
  onOpenSokoni,
  onOpenOrders,
  onOpenInventory,
  onOpenWarehouse,
  onOpenReports,
  onOpenPos,
  onSelectOrder,
}: {
  locale: Locale;
  profile: UserProfile;
  onOpenSokoni: () => void;
  onOpenOrders: () => void;
  onOpenInventory: () => void;
  onOpenWarehouse: () => void;
  onOpenReports: () => void;
  onOpenPos: () => void;
  onSelectOrder?: (orderId: string, orderRef: string) => void;
}) {
  const isSw = locale === 'sw';
  const [loading, setLoading] = useState(true);
  const [backendOffline, setBackendOffline] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [orders, setOrders] = useState<DashboardOrderRow[]>([]);
  const [todaySalesTzs, setTodaySalesTzs] = useState(0);
  const [wholesaleSalesTzs, setWholesaleSalesTzs] = useState(0);
  const [retailSalesTzs, setRetailSalesTzs] = useState(0);
  const [activeSkusCount, setActiveSkusCount] = useState(0);
  const [totalQuantaOnHand, setTotalQuantaOnHand] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [inventoryValueTzs, setInventoryValueTzs] = useState<number | null>(null);

  const loadDashboard = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setBackendOffline(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setBackendOffline(false);
    setErrorMsg(null);

    try {
      const ordersPromise = SokoApiClient.get<{ orders?: DashboardOrderRow[] }>(
        '/orders/my-orders?scope=all',
      );

      if (profile.role === 'SUPPLIER') {
        const [ordersRes, invRes, reportRes] = await Promise.all([
          ordersPromise,
          SokoApiClient.get<SupplierInventoryPayload>('/supplier/inventory').catch(() => null),
          SokoApiClient.get<SupplierReportPayload>('/supplier/reports/summary').catch(() => null),
        ]);

        const list = Array.isArray(ordersRes?.orders) ? ordersRes.orders : [];
        setOrders(list);

        const todayEat = eatDateString();
        const todaySupplierRevenue = list
          .filter(
            (o) =>
              eatDateString(o.placedAt) === todayEat &&
              o.status !== 'CANCELLED' &&
              o.status !== 'DISPUTED',
          )
          .reduce((sum, o) => sum + Number(o.expectedTotalTzs || 0), 0);

        const reportB2b = Number(reportRes?.totalB2bRevenueTzs ?? 0);
        setTodaySalesTzs(todaySupplierRevenue > 0 ? todaySupplierRevenue : reportB2b);
        setWholesaleSalesTzs(reportB2b);
        setRetailSalesTzs(0);

        const items = invRes?.items ?? [];
        setActiveSkusCount(items.length);
        setTotalQuantaOnHand(Number(invRes?.totalWarehouseQuanta ?? 0));
        setLowStockCount(
          items.filter((i) => i.availableQuantaStock <= i.lowStockThresholdQuanta).length,
        );
        setInventoryValueTzs(
          reportRes?.warehouseValuationTzs ? Number(reportRes.warehouseValuationTzs) : null,
        );
      } else {
        const validBizId =
          profile.businessId && UUID_REGEX.test(profile.businessId) ? profile.businessId : null;

        const [ordersRes, revenueRes, productsRes, clonesRes] = await Promise.all([
          ordersPromise,
          validBizId
            ? SokoApiClient.get<DailyRevenuePayload>(
                `/hybrid/analytics/${encodeURIComponent(validBizId)}/daily-revenue`,
              ).catch(() => null)
            : Promise.resolve(null),
          validBizId
            ? SokoApiClient.get<ActiveProductPayload[]>(
                `/products/active?businessId=${encodeURIComponent(validBizId)}`,
              ).catch(() => [])
            : Promise.resolve([] as ActiveProductPayload[]),
          validBizId
            ? SokoApiClient.get<
                Array<{ availableQuantaStock: number; lowStockThresholdQuanta: number; inventoryValueTzs: number }>
              >(`/merchant/catalog/clones?businessId=${encodeURIComponent(validBizId)}`).catch(
                () => [],
              )
            : Promise.resolve([]),
        ]);

        const list = Array.isArray(ordersRes?.orders) ? ordersRes.orders : [];
        setOrders(list);

        const collectedToday = Number(revenueRes?.totalCollectedTzs ?? 0);
        const todayEat = eatDateString();
        const fallbackTodayOrdersTotal = list
          .filter(
            (o) =>
              o.sellerBusinessId === validBizId &&
              eatDateString(o.placedAt) === todayEat &&
              o.status !== 'CANCELLED',
          )
          .reduce((sum, o) => sum + Number(o.expectedTotalTzs || 0), 0);

        setTodaySalesTzs(collectedToday > 0 ? collectedToday : fallbackTodayOrdersTotal);
        setWholesaleSalesTzs(Number(revenueRes?.b2bWholesaleRevenueTzs ?? 0));
        setRetailSalesTzs(
          Number(revenueRes?.b2cRetailRevenueTzs ?? 0) +
            Number(revenueRes?.posWalkinRevenueTzs ?? 0),
        );

        const prods = Array.isArray(productsRes) ? productsRes : [];
        const clones = Array.isArray(clonesRes) ? clonesRes : [];

        setActiveSkusCount(Math.max(prods.length, clones.length));
        const prodQuanta = prods.reduce((sum, p) => {
          const base = Number(p.availableQuarterQuanta ?? 0);
          const bulk =
            Number(p.sealedBulkPackagesStock ?? 0) *
            Math.max(1, Number(p.quantaPerSealedPackage ?? 0));
          return sum + base + bulk;
        }, 0);
        const cloneQuanta = clones.reduce(
          (sum, c) => sum + Number(c.availableQuantaStock ?? 0),
          0,
        );
        setTotalQuantaOnHand(Math.max(prodQuanta, cloneQuanta));

        const prodLow = prods.filter((p) => {
          const totalQ =
            Number(p.availableQuarterQuanta ?? 0) +
            Number(p.sealedBulkPackagesStock ?? 0) *
              Math.max(1, Number(p.quantaPerSealedPackage ?? 0));
          return totalQ <= Number(p.lowStockThresholdQuanta ?? 0);
        }).length;
        const cloneLow = clones.filter(
          (c) => Number(c.availableQuantaStock ?? 0) <= Number(c.lowStockThresholdQuanta ?? 0),
        ).length;
        setLowStockCount(Math.max(prodLow, cloneLow));

        if (clones.length > 0) {
          setInventoryValueTzs(
            clones.reduce((sum, c) => sum + Number(c.inventoryValueTzs ?? 0), 0),
          );
        } else {
          setInventoryValueTzs(null);
        }
      }
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorMsg(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia muhtasari wa biashara.'
              : 'Failed to load dashboard summary.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [isSw, profile.businessId, profile.role]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const { todaysOrdersCount, pendingOrdersCount, recentOrders } = useMemo(() => {
    const todayEat = eatDateString();
    const todayOrders = orders.filter((o) => eatDateString(o.placedAt) === todayEat);
    const pending = orders.filter(
      (o) => o.status === 'PLACED' || o.status === 'DISPATCHED',
    );
    return {
      todaysOrdersCount: todayOrders.length > 0 ? todayOrders.length : orders.length,
      pendingOrdersCount: pending.length,
      recentOrders: orders.slice(0, 8),
    };
  }, [orders]);

  const quickActions = useMemo(
    () => [
      {
        key: 'sokoni',
        label: t(locale, 'nav.sokoni'),
        icon: ShoppingBag,
        color: 'bg-[#15AC49]/10 text-[#15AC49] border-[#15AC49]/30 hover:bg-[#15AC49]/15',
        onClick: onOpenSokoni,
      },
      {
        key: 'orders',
        label: t(locale, 'nav.orders'),
        icon: ClipboardList,
        color: 'bg-[#0054A6]/10 text-[#0054A6] border-[#0054A6]/30 hover:bg-[#0054A6]/15',
        onClick: onOpenOrders,
      },
      {
        key: 'inventory',
        label: t(locale, 'nav.inventory'),
        icon: Boxes,
        color: 'bg-[#15AC49]/10 text-[#15AC49] border-[#15AC49]/30 hover:bg-[#15AC49]/15',
        onClick: onOpenInventory,
      },
      {
        key: 'warehouse',
        label: t(locale, 'nav.warehouse'),
        icon: Warehouse,
        color: 'bg-[#0054A6]/10 text-[#0054A6] border-[#0054A6]/30 hover:bg-[#0054A6]/15',
        onClick: onOpenWarehouse,
      },
      {
        key: 'reports',
        label: t(locale, 'nav.reports'),
        icon: BarChart3,
        color: 'bg-[#15AC49]/10 text-[#15AC49] border-[#15AC49]/30 hover:bg-[#15AC49]/15',
        onClick: onOpenReports,
      },
    ],
    [locale, onOpenInventory, onOpenOrders, onOpenReports, onOpenSokoni, onOpenWarehouse],
  );

  const statusText = (status: DashboardOrderRow['status']): string => {
    switch (status) {
      case 'PLACED':
        return t(locale, 'status.PLACED');
      case 'DISPATCHED':
        return t(locale, 'status.DISPATCHED');
      case 'DELIVERED':
        return t(locale, 'status.DELIVERED');
      case 'CANCELLED':
        return t(locale, 'status.CANCELLED');
      default:
        return t(locale, 'status.DISPUTED');
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          onRetry={() => void loadDashboard()}
          retrying={loading}
        />
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800"
        >
          {errorMsg}
        </div>
      )}

      {/* WIREFRAME SECTION 1: OVERVIEW (2 side-by-side KPI cards + 1 full-width Statistics card) */}
      <section className="space-y-3" aria-labelledby="merchant-overview-heading">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1
              id="merchant-overview-heading"
              className="text-lg sm:text-xl font-bold tracking-tight text-slate-900"
            >
              {t(locale, 'dashboard.overview')}
            </h1>
            <p className="text-xs text-slate-500">
              {profile.businessLabel}
              {profile.ward ? ` · ${profile.ward}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={loading}
            aria-label={isSw ? 'Onyesha upya' : 'Refresh'}
            className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
          >
            <RefreshCw className={`w-4 h-4 text-[#0054A6] ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isSw ? 'Sasisha' : 'Refresh'}</span>
          </button>
        </div>

        {/* Row 1: Two side-by-side KPI Stat Cards */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">
                {t(locale, 'dashboard.todaysOrders')}
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#0054A6]/10 text-[#0054A6] flex items-center justify-center shrink-0">
                <ClipboardList className="w-4 h-4" aria-hidden="true" />
              </span>
            </div>
            <div>
              {loading ? (
                <div className="h-8 w-16 bg-slate-100 rounded animate-pulse" />
              ) : (
                <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-[#0054A6]">
                  {todaysOrdersCount}
                </div>
              )}
              <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {pendingOrdersCount} {t(locale, 'dashboard.pendingCountSuffix')}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">
                {t(locale, 'dashboard.todaysSales')}
              </span>
              <span className="w-8 h-8 rounded-lg bg-[#15AC49]/10 text-[#15AC49] flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4" aria-hidden="true" />
              </span>
            </div>
            <div>
              {loading ? (
                <div className="h-8 w-28 bg-slate-100 rounded animate-pulse" />
              ) : (
                <div className="text-lg sm:text-2xl font-bold font-mono tabular-nums text-[#15AC49] truncate">
                  {formatTzs(todaySalesTzs)}
                </div>
              )}
              <div className="text-[11px] text-slate-500 mt-1 tabular-nums truncate">
                {wholesaleSalesTzs > 0 || retailSalesTzs > 0
                  ? `B2B ${wholesaleSalesTzs.toLocaleString('en-US')} · Retail ${retailSalesTzs.toLocaleString('en-US')}`
                  : isSw
                    ? 'Mapato ya leo'
                    : 'Today live ledger'}
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Full-width Store Statistics Summary Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              {t(locale, 'dashboard.storeStats')}
            </h2>
            <button
              type="button"
              onClick={onOpenReports}
              className="text-xs font-semibold text-[#0054A6] hover:underline inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>{t(locale, 'nav.reports')}</span>
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-1 border-t border-slate-100">
            <div>
              <div className="text-[11px] text-slate-500">
                {t(locale, 'dashboard.activeSkus')}
              </div>
              <div className="text-base sm:text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {loading ? '—' : activeSkusCount}
              </div>
            </div>

            <div>
              <div className="text-[11px] text-slate-500">
                {inventoryValueTzs !== null
                  ? t(locale, 'dashboard.inventoryValue')
                  : t(locale, 'dashboard.totalStockUnits')}
              </div>
              <div className="text-base sm:text-lg font-bold font-mono tabular-nums text-[#0054A6] mt-0.5 truncate">
                {loading
                  ? '—'
                  : inventoryValueTzs !== null
                    ? formatTzs(inventoryValueTzs)
                    : `${totalQuantaOnHand.toLocaleString('en-US')} Q`}
              </div>
            </div>

            <div>
              <div className="text-[11px] text-slate-500">
                {t(locale, 'dashboard.lowStock')}
              </div>
              <div
                className={`text-base sm:text-lg font-bold font-mono tabular-nums mt-0.5 ${
                  lowStockCount > 0 ? 'text-amber-700' : 'text-[#15AC49]'
                }`}
              >
                {loading ? '—' : lowStockCount}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WIREFRAME SECTION 2: QUICK ACTIONS (5 Circular Icon Buttons in a horizontal row) */}
      <section className="space-y-3" aria-labelledby="quick-actions-heading">
        <h2 id="quick-actions-heading" className="text-sm font-bold text-slate-900">
          {t(locale, 'dashboard.quickActions')}
        </h2>

        <div className="grid grid-cols-5 gap-2 sm:gap-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.key}
                type="button"
                onClick={action.onClick}
                className="flex flex-col items-center gap-1.5 group cursor-pointer focus-visible:outline-none"
              >
                <span
                  className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full border flex items-center justify-center transition-transform group-hover:scale-105 ${action.color}`}
                >
                  <Icon className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
                </span>
                <span className="text-[11px] sm:text-xs font-semibold text-slate-700 text-center whitespace-nowrap truncate max-w-full">
                  {action.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* WIREFRAME SECTION 3: RECENTLY ORDERS */}
      <section className="space-y-3" aria-labelledby="recent-orders-heading">
        <div className="flex items-center justify-between gap-2">
          <h2 id="recent-orders-heading" className="text-sm font-bold text-slate-900">
            {t(locale, 'dashboard.recentOrders')}
          </h2>
          {orders.length > 0 && (
            <button
              type="button"
              onClick={onOpenOrders}
              className="text-xs font-semibold text-[#0054A6] hover:underline inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>{t(locale, 'dashboard.viewAll')}</span>
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
            {[0, 1, 2].map((idx) => (
              <div key={idx} className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 animate-pulse" />
                  <div className="space-y-1.5">
                    <div className="h-3.5 w-32 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3 w-44 bg-slate-100 rounded animate-pulse" />
                  </div>
                </div>
                <div className="h-6 w-20 bg-slate-100 rounded-full animate-pulse" />
              </div>
            ))}
          </div>
        ) : recentOrders.length === 0 ? (
          <EmptyStateCard
            locale={locale}
            titleSw={t('sw', 'dashboard.noOrdersTitle')}
            titleEn={t('en', 'dashboard.noOrdersTitle')}
            descriptionSw={t('sw', 'dashboard.noOrdersDesc')}
            descriptionEn={t('en', 'dashboard.noOrdersDesc')}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={onOpenSokoni}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-[#15AC49] hover:bg-[#12963f] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  {t(locale, 'dashboard.goToSokoni')}
                </button>
                <button
                  type="button"
                  onClick={onOpenPos}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  {t(locale, 'dashboard.openPos')}
                </button>
              </div>
            }
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
            {recentOrders.map((order) => {
              const counterparty =
                order.sellerBusinessId === profile.businessId
                  ? order.buyerName
                  : order.sellerBusinessName;
              const itemsText =
                order.items
                  ?.slice(0, 2)
                  .map((i) => `${isSw ? i.nameSw : i.nameEn} (${i.quantity})`)
                  .join(' · ') || '—';

              return (
                <button
                  key={order.orderId}
                  type="button"
                  onClick={() =>
                    onSelectOrder
                      ? onSelectOrder(order.orderId, order.orderRef)
                      : onOpenOrders()
                  }
                  className="w-full text-left px-4 py-3.5 hover:bg-slate-50/70 transition-colors flex items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-[#0054A6]/10 text-[#0054A6] font-mono text-xs font-bold flex items-center justify-center shrink-0">
                      {order.orderRef.slice(0, 2)}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-xs sm:text-sm font-semibold text-slate-900 truncate">
                        <span className="font-mono text-[#0054A6]">#{order.orderRef}</span>
                        {' · '}
                        {counterparty}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {itemsText}
                        {order.orderMode === 'SCHEDULED' && order.scheduledDeliveryDate
                          ? ` · ${t(locale, 'dashboard.scheduledFor')} ${order.scheduledDeliveryDate}`
                          : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-xs font-bold font-mono tabular-nums text-slate-900">
                      {formatTzs(Number(order.expectedTotalTzs || 0))}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap ${statusBadgeStyle(
                        order.status,
                      )}`}
                    >
                      {statusText(order.status)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
