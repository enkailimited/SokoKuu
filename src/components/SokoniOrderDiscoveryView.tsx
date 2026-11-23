import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  LoaderCircle,
  MapPin,
  Search,
  ShoppingBag,
  Truck,
  X,
  Zap,
} from 'lucide-react';
import { t, type Locale } from '../i18n';
import { resolveBackendImageUrl } from '../lib/sokoProductImage';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

export interface SokoniSelectionItem {
  globalCatalogId: string;
  canonicalSku: string;
  fixedNameSw: string;
  fixedNameEn: string;
  imageUrl: string;
  systemUnitId?: string;
  unitLabelSw: string;
  unitLabelEn: string;
  quantity: number;
}

interface MatchedMerchantItem {
  productId: string;
  globalCatalogId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  imageUrl: string;
  quantity: number;
  unitType: string;
  unitLabelSw: string;
  unitLabelEn: string;
  quarterQuantaPerUnit: number;
  unitPriceTzs: number;
  lineTotalTzs: number;
  supplierListingId?: string;
  isWholesaleTierApplied: boolean;
}

interface MissingMerchantItem {
  globalCatalogId: string;
  nameSw: string;
  nameEn: string;
  requestedQuantity: number;
}

interface DiscoveredMerchantCard {
  merchantId: string;
  businessName: string;
  storeImageUrl: string;
  wardName: string;
  district: string;
  distanceKm: number;
  isFreeDeliveryEnabled: boolean;
  freeDeliveryMinOrderTzs: number;
  standardDeliveryFeeTzs: number;
  tier: string;
  orderChannel: 'RETAIL_MARKETPLACE' | 'SUPPLIER_TO_WHOLESALER';
  matchedItems: MatchedMerchantItem[];
  merchantSubtotalTzs: number;
  estimatedDeliveryFeeTzs: number;
  missingItems: MissingMerchantItem[];
}

interface DiscoverMerchantsResponse {
  buyerLocation: { latitude: number; longitude: number };
  requestedCount: number;
  matchedMerchantsCount: number;
  merchants: DiscoveredMerchantCard[];
}

interface BatchOrderReceipt {
  orderId: string;
  orderRef: string;
  sellerBusinessId: string;
  expectedTotalTzs: number;
  deliveryFeeTzs: number;
  orderMode: 'INSTANT' | 'SCHEDULED';
  scheduledDeliveryDate: string | null;
}

interface SubmitBatchResponse {
  batchCount: number;
  orderMode: 'INSTANT' | 'SCHEDULED';
  scheduledDeliveryDate: string | null;
  totalBatchTzs: number;
  orders: BatchOrderReceipt[];
}

function getTodayEatYyyyMmDd(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function makeClientIdempotencyKey(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${Date.now()}-${rand}`;
}

export function SokoniOrderDiscoveryView({
  locale,
  selectedItems,
  onBackToSokoni,
  onViewMyOrders,
  onBackToDashboard,
}: {
  locale: Locale;
  selectedItems: SokoniSelectionItem[];
  onBackToSokoni: () => void;
  onViewMyOrders: () => void;
  onBackToDashboard?: () => void;
}) {
  const isSw = locale === 'sw';
  const [searching, setSearching] = useState(true);
  const [backendOffline, setBackendOffline] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [merchants, setMerchants] = useState<DiscoveredMerchantCard[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submittingSingleId, setSubmittingSingleId] = useState<string | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(() => getTodayEatYyyyMmDd());
  const [batchReceipt, setBatchReceipt] = useState<{
    result: SubmitBatchResponse;
    merchantNames: Record<string, string>;
  } | null>(null);

  const runDiscovery = useCallback(async () => {
    if (selectedItems.length === 0) {
      setMerchants([]);
      setSearching(false);
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setBackendOffline(true);
      setSearching(false);
      return;
    }

    setSearching(true);
    setBackendOffline(false);
    setErrorMsg(null);

    let coords: { latitude?: number; longitude?: number } = {};
    if (
      typeof navigator !== 'undefined' &&
      'geolocation' in navigator &&
      typeof navigator.permissions?.query === 'function'
    ) {
      try {
        const perm = await navigator.permissions.query({ name: 'geolocation' });
        if (perm.state === 'granted') {
          coords = await new Promise<{ latitude?: number; longitude?: number }>((resolve) => {
            navigator.geolocation.getCurrentPosition(
              (pos) =>
                resolve({
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                }),
              () => resolve({}),
              { timeout: 1500, maximumAge: 60_000 },
            );
          });
        }
      } catch {
        // Ignore geolocation permissions errors; backend uses business profile GPS
      }
    }

    try {
      const res = await SokoApiClient.post<DiscoverMerchantsResponse>(
        '/marketplace/discover-merchants',
        {
          ...coords,
          items: selectedItems.map((item) => ({
            globalCatalogId: item.globalCatalogId,
            ...(item.systemUnitId ? { systemUnitId: item.systemUnitId } : {}),
            quantity: item.quantity,
          })),
        },
      );
      setMerchants(Array.isArray(res?.merchants) ? res.merchants : []);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorMsg(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kutafuta wauzaji waliothibitishwa.'
              : 'Failed to discover matched merchants.',
        );
      }
    } finally {
      setSearching(false);
    }
  }, [isSw, selectedItems]);

  useEffect(() => {
    void runDiscovery();
  }, [runDiscovery]);

  const merchantNamesMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of merchants) {
      map[m.merchantId] = m.businessName;
    }
    return map;
  }, [merchants]);

  const submitOrders = async (
    targetMerchants: DiscoveredMerchantCard[],
    mode: 'INSTANT' | 'SCHEDULED',
    dateStr?: string,
    singleId?: string,
  ) => {
    if (targetMerchants.length === 0) return;
    setErrorMsg(null);
    setSubmitting(true);
    setSubmittingSingleId(singleId ?? null);

    try {
      const idempotencyKey = makeClientIdempotencyKey('sokobatch');
      const res = await SokoApiClient.post<SubmitBatchResponse>(
        '/marketplace/orders/submit-batch',
        {
          orderMode: mode,
          ...(mode === 'SCHEDULED' && dateStr ? { scheduledDeliveryDate: dateStr } : {}),
          originChannel: 'PWA_ONLINE',
          paymentMethod: 'CASH',
          orders: targetMerchants.map((merchant) => ({
            sellerBusinessId: merchant.merchantId,
            orderChannel: merchant.orderChannel,
            deliveryFeeTzs: merchant.estimatedDeliveryFeeTzs,
            items: merchant.matchedItems.map((line) => ({
              productId: line.productId,
              unitType: line.unitType,
              quantity: line.quantity,
              ...(line.supplierListingId ? { supplierListingId: line.supplierListingId } : {}),
            })),
          })),
        },
        true,
        { 'X-Idempotency-Key': idempotencyKey },
      );

      setScheduleModalOpen(false);
      setBatchReceipt({
        result: res,
        merchantNames: merchantNamesMap,
      });
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorMsg(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kuwasilisha oda.'
              : 'Failed to submit order(s).',
        );
      }
    } finally {
      setSubmitting(false);
      setSubmittingSingleId(null);
    }
  };

  if (batchReceipt) {
    return (
      <div className="space-y-5 pb-24">
        <div className="bg-white border border-[#15AC49]/30 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-full bg-[#15AC49]/15 text-[#15AC49] flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                {t(locale, 'discovery.receiptTitle')}
              </h2>
              <p className="text-xs text-slate-600">{t(locale, 'discovery.receiptSubtitle')}</p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {batchReceipt.result.orders.map((ord) => (
              <div
                key={ord.orderId}
                className="p-3.5 bg-white flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-bold text-slate-900">
                    <span className="font-mono text-[#0054A6]">#{ord.orderRef}</span>
                    {' · '}
                    {batchReceipt.merchantNames[ord.sellerBusinessId] ?? 'Merchant'}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {ord.orderMode === 'SCHEDULED' && ord.scheduledDeliveryDate
                      ? `${t(locale, 'dashboard.scheduledFor')} ${ord.scheduledDeliveryDate}`
                      : t(locale, 'dashboard.instantOrder')}
                  </div>
                </div>
                <div className="font-mono font-bold tabular-nums text-[#15AC49]">
                  TZS {Number(ord.expectedTotalTzs).toLocaleString('en-US')}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div className="text-xs text-slate-600">
              {isSw ? 'Jumla ya Malipo (CoD):' : 'Total CoD Payable:'}{' '}
              <span className="font-mono font-bold tabular-nums text-slate-900">
                TZS {Number(batchReceipt.result.totalBatchTzs).toLocaleString('en-US')}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 ml-auto">
              {onBackToDashboard && (
                <button
                  type="button"
                  onClick={onBackToDashboard}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap"
                >
                  {t(locale, 'discovery.backDashboardBtn')}
                </button>
              )}
              <button
                type="button"
                onClick={onViewMyOrders}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-[#15AC49] hover:bg-[#12963f] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                {t(locale, 'discovery.viewOrdersBtn')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-32 md:pb-8">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackToSokoni}
          className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-semibold text-[#0054A6] hover:underline cursor-pointer whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>{t(locale, 'discovery.backToSokoni')}</span>
        </button>

        <div className="text-xs font-medium text-slate-500 tabular-nums">
          {selectedItems.length} {isSw ? 'bidhaa zimechaguliwa' : 'items selected'}
        </div>
      </div>

      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          onRetry={() => void runDiscovery()}
          retrying={searching}
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

      {searching ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 flex flex-col items-center justify-center text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-[#0054A6]/10 border border-[#0054A6]/20 flex items-center justify-center">
            <Search className="w-7 h-7 text-[#0054A6] animate-bounce" aria-hidden="true" />
          </div>
          <div className="space-y-1 max-w-sm">
            <h2 className="text-base font-bold text-slate-900">
              {t(locale, 'discovery.searchingTitle')}
            </h2>
            <p className="text-xs text-slate-500">
              {t(locale, 'discovery.searchingSubtitle')}
            </p>
          </div>
        </div>
      ) : merchants.length === 0 ? (
        <EmptyStateCard
          locale={locale}
          titleSw={t('sw', 'discovery.noMerchantsTitle')}
          titleEn={t('en', 'discovery.noMerchantsTitle')}
          descriptionSw={t('sw', 'discovery.noMerchantsDesc')}
          descriptionEn={t('en', 'discovery.noMerchantsDesc')}
          action={
            <button
              type="button"
              onClick={onBackToSokoni}
              className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0054A6] hover:bg-[#00448a] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              {t(locale, 'discovery.backToSokoni')}
            </button>
          }
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
              {t(locale, 'discovery.merchantsFound')} ({merchants.length})
            </h1>
          </div>

          {/* WIREFRAME 3: Horizontal Matched Merchant Cards */}
          <div className="space-y-3">
            {merchants.map((merchant) => {
              const totalDue =
                merchant.merchantSubtotalTzs + merchant.estimatedDeliveryFeeTzs;
              const isSubmittingThis =
                submitting && submittingSingleId === merchant.merchantId;

              return (
                <article
                  key={merchant.merchantId}
                  className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4 flex items-start sm:items-center gap-3 sm:gap-4"
                >
                  {/* Left: Merchant Storefront Image */}
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden shrink-0 flex items-center justify-center">
                    <img
                      src={resolveBackendImageUrl(merchant.storeImageUrl)}
                      alt={merchant.businessName}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Middle: Merchant Details + Matched Items + Missing Notice */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                        {merchant.businessName}
                      </h3>
                      {merchant.isFreeDeliveryEnabled && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#15AC49]">
                          <Truck className="w-3 h-3" aria-hidden="true" />
                          <span>{t(locale, 'discovery.freeDelivery')}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <MapPin className="w-3.5 h-3.5 text-[#0054A6] shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {merchant.wardName}
                        {merchant.district ? `, ${merchant.district}` : ''}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-700 whitespace-nowrap">
                        {merchant.distanceKm.toFixed(1)} km
                      </span>
                    </div>

                    <div className="space-y-0.5 pt-1">
                      {merchant.matchedItems.map((line) => (
                        <div
                          key={`${merchant.merchantId}:${line.globalCatalogId}`}
                          className="text-xs text-slate-700 flex items-center justify-between gap-2"
                        >
                          <span className="truncate">
                            {isSw ? line.nameSw : line.nameEn} ({line.quantity} ×{' '}
                            {isSw ? line.unitLabelSw : line.unitLabelEn})
                          </span>
                          <span className="font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                            TZS {line.lineTotalTzs.toLocaleString('en-US')}
                          </span>
                        </div>
                      ))}
                    </div>

                    {merchant.missingItems.length > 0 && (
                      <div className="text-[11px] text-amber-700 font-medium">
                        {t(locale, 'discovery.missingLabel')}{' '}
                        {merchant.missingItems
                          .map((mi) => (isSw ? mi.nameSw : mi.nameEn))
                          .join(', ')}
                      </div>
                    )}

                    <div className="pt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      <span className="font-bold font-mono tabular-nums text-[#0054A6]">
                        {t(locale, 'discovery.subtotalLabel')}: TZS{' '}
                        {totalDue.toLocaleString('en-US')}
                      </span>
                      {merchant.estimatedDeliveryFeeTzs > 0 && (
                        <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                          ({t(locale, 'discovery.deliveryFee')}: TZS{' '}
                          {merchant.estimatedDeliveryFeeTzs.toLocaleString('en-US')})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Single Merchant Order Button */}
                  <div className="shrink-0 self-center">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void submitOrders([merchant], 'INSTANT', undefined, merchant.merchantId)}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-[#15AC49] hover:bg-[#12963f] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
                    >
                      {isSubmittingThis ? (
                        <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                      )}
                      <span>{t(locale, 'discovery.orderSingle')}</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* WIREFRAME 3: Split Bottom Action Bar (Scheduled Order + Instant Order) */}
          <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2.5 sm:px-6">
            <div className="max-w-6xl mx-auto grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setScheduleModalOpen(true)}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-[#0054A6] hover:bg-[#00448a] text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                <CalendarClock className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{t(locale, 'discovery.scheduledOrder')}</span>
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => void submitOrders(merchants, 'INSTANT')}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-[#15AC49] hover:bg-[#12963f] text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                {submitting && !submittingSingleId ? (
                  <LoaderCircle className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                ) : (
                  <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
                <span>
                  {submitting && !submittingSingleId
                    ? t(locale, 'discovery.submitting')
                    : t(locale, 'discovery.instantOrder')}
                </span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Scheduled Order Date Modal */}
      {scheduleModalOpen && (
        <div
          className="sk-dialog-overlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setScheduleModalOpen(false);
          }}
        >
          <div className="sk-dialog-panel">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {t(locale, 'discovery.scheduleModalTitle')}
              </h3>
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                aria-label={t(locale, 'discovery.cancel')}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 sk-safe-bottom">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  {t(locale, 'discovery.scheduleDateLabel')}
                </span>
                <input
                  type="date"
                  min={getTodayEatYyyyMmDd()}
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm font-mono text-slate-900 bg-white focus:border-[#0054A6] focus:outline-none"
                />
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {t(locale, 'discovery.cancel')}
                </button>
                <button
                  type="button"
                  disabled={submitting || !scheduledDate}
                  onClick={() => void submitOrders(merchants, 'SCHEDULED', scheduledDate)}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0054A6] hover:bg-[#00448a] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {submitting && <LoaderCircle className="w-4 h-4 animate-spin" />}
                  <span>{t(locale, 'discovery.confirmSchedule')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
