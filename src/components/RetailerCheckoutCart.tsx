import { useCallback, useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Search, CheckCircle2, Send, AlertTriangle } from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { putQueuedOrder } from '../lib/indexedDbDemo';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

export interface CatalogCartSku {
  productId: string;
  sellerBusinessId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitType: string;
  unitLabelSw: string;
  unitLabelEn: string;
  quarterQuantaPerUnit: number;
  wholesaleThresholdUnits: number;
  retailPriceTzs: number;
  wholesalePriceTzs: number;
}

interface MarketplaceMerchantOption {
  businessId: string;
  businessName: string;
  tier: string;
  ward: string;
}

interface ActiveProductDto {
  productId: string;
  sellerBusinessId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitPriceTzs: number;
  cartonPriceTzs: number;
  wholesaleThresholdUnits: number;
  priceTiers: Array<{
    unitType: string;
    quarterQuantaPerUnit: number;
    priceTzs: number;
    isWholesaleTier: boolean;
  }>;
}

export function RetailerCheckoutCart({
  locale = 'en',
  sellerBusinessId,
}: {
  locale?: Locale;
  sellerBusinessId?: string | null;
}) {
  const isSw = locale === 'sw';
  const [merchants, setMerchants] = useState<MarketplaceMerchantOption[]>([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState<string>(sellerBusinessId || '');
  const [catalogSkus, setCatalogSkus] = useState<CatalogCartSku[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(
    typeof window !== 'undefined' ? !window.navigator.onLine : false
  );
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [submissionNote, setSubmissionNote] = useState<{
    mode: 'API' | 'QUEUED_OFFLINE';
    orderRef: string;
    headline: string;
    summaryLine: string;
  } | null>(null);

  const loadMerchantsAndCatalog = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setLoading(true);
    setBackendOffline(false);
    setErrorNotice(null);

    try {
      const merchantList = await SokoApiClient.get<MarketplaceMerchantOption[]>(
        '/marketplace/merchants',
        false
      );
      const suppliers = (Array.isArray(merchantList) ? merchantList : []).filter(
        (m) => m.tier === 'WHOLESALE_HUB' || m.tier === 'HYBRID_STORE'
      );
      const selectable = suppliers.length > 0 ? suppliers : Array.isArray(merchantList) ? merchantList : [];
      setMerchants(selectable);

      const targetSellerId =
        selectedMerchantId && selectable.some((m) => m.businessId === selectedMerchantId)
          ? selectedMerchantId
          : selectable[0]?.businessId ?? '';

      if (!targetSellerId) {
        setSelectedMerchantId('');
        setCatalogSkus([]);
        return;
      }

      if (targetSellerId !== selectedMerchantId) {
        setSelectedMerchantId(targetSellerId);
      }

      const activeProducts = await SokoApiClient.get<ActiveProductDto[]>(
        `/products/active?businessId=${encodeURIComponent(targetSellerId)}`,
        false
      );

      const mapped: CatalogCartSku[] = (Array.isArray(activeProducts) ? activeProducts : []).map(
        (p) => {
          const retailTier =
            p.priceTiers?.find((t) => !t.isWholesaleTier) ?? p.priceTiers?.[0];
          const wholesaleTier =
            p.priceTiers?.find((t) => t.isWholesaleTier && t.unitType === retailTier?.unitType) ??
            p.priceTiers?.find((t) => t.isWholesaleTier) ??
            retailTier;
          const unitType = retailTier?.unitType ?? wholesaleTier?.unitType ?? 'SINGLE_KILO_LITRE';
          const retailPriceTzs = Number(retailTier?.priceTzs ?? p.unitPriceTzs ?? 0);
          const wholesalePriceTzs = Number(wholesaleTier?.priceTzs ?? retailPriceTzs);

          return {
            productId: p.productId,
            sellerBusinessId: p.sellerBusinessId,
            sku: p.sku,
            nameSw: p.nameSw,
            nameEn: p.nameEn,
            unitType,
            unitLabelSw: unitType,
            unitLabelEn: unitType,
            quarterQuantaPerUnit: Number(retailTier?.quarterQuantaPerUnit ?? 4),
            wholesaleThresholdUnits: Math.max(1, Number(p.wholesaleThresholdUnits ?? 10)),
            retailPriceTzs,
            wholesalePriceTzs,
          };
        }
      );

      setCatalogSkus(mapped);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else if (err instanceof SokoHttpError) {
        setErrorNotice(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedMerchantId]);

  useEffect(() => {
    void loadMerchantsAndCatalog();
  }, [loadMerchantsAndCatalog]);

  const visibleCatalog = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return catalogSkus;
    return catalogSkus.filter(
      (item) =>
        item.nameSw.toLowerCase().includes(q) ||
        item.nameEn.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q)
    );
  }, [catalogSkus, searchTerm]);

  const adjustQuantity = (productId: string, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [productId]: Math.max(0, (prev[productId] ?? 0) + delta),
    }));
    setSubmissionNote(null);
  };

  const cartSummary = useMemo(() => {
    let totalTzs = 0;
    let totalSavingsTzs = 0;
    let totalUnits = 0;
    const bareTokenItems: Array<{ productId: string; unitType: string; quantity: number }> = [];

    for (const item of catalogSkus) {
      const qty = quantities[item.productId] ?? 0;
      if (qty <= 0) continue;

      const wholesaleApplied = qty >= item.wholesaleThresholdUnits;
      const activeUnitPrice = wholesaleApplied ? item.wholesalePriceTzs : item.retailPriceTzs;
      totalTzs += qty * activeUnitPrice;
      totalUnits += qty;
      totalSavingsTzs += wholesaleApplied
        ? Math.max(0, qty * (item.retailPriceTzs - item.wholesalePriceTzs))
        : 0;

      bareTokenItems.push({
        productId: item.productId,
        unitType: item.unitType,
        quantity: qty,
      });
    }

    return { totalTzs, totalSavingsTzs, totalUnits, bareTokenItems };
  }, [catalogSkus, quantities]);

  const handleCompleteCheckout = async () => {
    if (cartSummary.bareTokenItems.length === 0 || !selectedMerchantId) return;
    setErrorNotice(null);
    setSubmissionNote(null);
    setSubmitting(true);

    try {
      const res = await SokoApiClient.post<{
        orderId: string;
        orderRef8: string;
        status: string;
        totalCashDueTzs: number;
      }>('/marketplace/orders/submit-request', {
        sellerBusinessId: selectedMerchantId,
        originChannel: 'PWA_ONLINE',
        paymentMethod: 'CASH',
        deliveryFeeTzs: 0,
        items: cartSummary.bareTokenItems,
      });

      setQuantities({});
      setSubmissionNote({
        mode: 'API',
        orderRef: res.orderRef8,
        headline: isSw
          ? `Ombi la Oda Limepokelewa · Hali: ${res.status}`
          : `B2B Purchase Request Placed · Status: ${res.status}`,
        summaryLine: isSw
          ? `Oda #${res.orderRef8} · Bidhaa ${cartSummary.bareTokenItems.length} (${cartSummary.totalUnits} vipimo) · TZS ${res.totalCashDueTzs.toLocaleString('en-US')}`
          : `Order #${res.orderRef8} · ${cartSummary.bareTokenItems.length} SKUs (${cartSummary.totalUnits} units) · Server-verified CoD TZS ${res.totalCashDueTzs.toLocaleString('en-US')}`,
      });
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        const idempotencyKey = crypto.randomUUID();
        const sellerName =
          merchants.find((m) => m.businessId === selectedMerchantId)?.businessName ??
          selectedMerchantId;
        await putQueuedOrder({
          idempotencyKey,
          sellerBusinessId: selectedMerchantId,
          sellerHub: sellerName,
          compactSmsBody: `${cartSummary.bareTokenItems.length} SKU(s) queued`,
          totalTzs: cartSummary.totalTzs,
          items: cartSummary.bareTokenItems,
          clientCreatedAt: new Date().toISOString(),
          syncStatus: 'QUEUED_OFFLINE',
          retryCount: 0,
        });
        setSubmissionNote({
          mode: 'QUEUED_OFFLINE',
          orderRef: idempotencyKey.slice(0, 8).toUpperCase(),
          headline: isSw
            ? 'Oda Imehifadhiwa kwenye Foleni ya Nje ya Mtandao (IndexedDB)'
            : 'Order Queued in Offline Outbox (IndexedDB)',
          summaryLine: isSw
            ? `Itatumwa kwa seva ya NestJS mtandao ukirejea · TZS ${cartSummary.totalTzs.toLocaleString('en-US')}`
            : `Will sync to NestJS backend when connectivity resumes · TZS ${cartSummary.totalTzs.toLocaleString('en-US')}`,
        });
      } else {
        setErrorNotice(
          err instanceof Error ? err.message : 'Order submission failed.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          onRetry={() => void loadMerchantsAndCatalog()}
          retrying={loading}
        />
      )}

      {errorNotice && (
        <div
          role="alert"
          className="border border-rose-200 bg-rose-50 rounded-lg p-4 flex items-center justify-between gap-3 text-xs font-semibold text-rose-900"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
            <span>{errorNotice}</span>
          </div>
          <button type="button" onClick={() => setErrorNotice(null)} className="cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Search & Supplier Selector */}
      <section className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 min-w-0">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={
              isSw ? 'Tafuta bidhaa au SKU...' : 'Search catalog products or SKU...'
            }
            className="w-full min-h-[44px] pl-10 pr-4 text-sm bg-white border border-slate-200 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
          />
        </div>

        {merchants.length > 0 && (
          <select
            value={selectedMerchantId}
            onChange={(e) => {
              setSelectedMerchantId(e.target.value);
              setQuantities({});
              setSubmissionNote(null);
            }}
            className="min-h-[44px] px-3 py-2 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-800"
          >
            {merchants.map((m) => (
              <option key={m.businessId} value={m.businessId}>
                {m.businessName} ({m.ward})
              </option>
            ))}
          </select>
        )}
      </section>

      {/* Checkout Item List */}
      <section className="bg-white border border-slate-100 rounded-lg shadow-sm divide-y divide-slate-100">
        {visibleCatalog.length === 0 ? (
          <div className="p-4">
            <EmptyStateCard
              locale={locale}
              titleSw="Hakuna bidhaa zilizopatikana"
              titleEn="No catalog items available"
              descriptionSw="Hakuna bidhaa zinazouzwa kwa mfanyabiashara aliyechaguliwa kwenye PostgreSQL."
              descriptionEn="No active PostgreSQL products found for the selected Merchant."
            />
          </div>
        ) : (
          visibleCatalog.map((item) => {
            const qty = quantities[item.productId] ?? 0;
            const wholesaleActive = qty >= item.wholesaleThresholdUnits;
            const activePrice = wholesaleActive ? item.wholesalePriceTzs : item.retailPriceTzs;

            return (
              <div
                key={item.productId}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900">
                    {isSw ? item.nameSw : item.nameEn}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span className="font-mono">{item.sku}</span>
                    <span aria-hidden="true">·</span>
                    <span>{isSw ? item.unitLabelSw : item.unitLabelEn}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {isSw
                        ? `Jumla kuanzia ${item.wholesaleThresholdUnits}+`
                        : `Wholesale at ${item.wholesaleThresholdUnits}+`}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <span
                      className={`text-sm font-bold font-mono tabular-nums ${
                        wholesaleActive ? 'text-emerald-600' : 'text-slate-900'
                      }`}
                    >
                      TZS {activePrice.toLocaleString('en-US')}
                    </span>

                    {wholesaleActive && (
                      <span className="text-xs font-semibold text-emerald-600">
                        Bei ya Jumla Applied
                      </span>
                    )}
                  </div>
                </div>

                {/* Increment Controls */}
                <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                  <div className="inline-flex items-center border border-slate-200 rounded-md bg-white">
                    <button
                      type="button"
                      aria-label={`Decrease ${item.sku}`}
                      onClick={() => adjustQuantity(item.productId, -1)}
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
                      onClick={() => adjustQuantity(item.productId, 1)}
                      className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="text-right font-mono tabular-nums">
                    <div className="text-sm font-bold text-slate-900">
                      TZS {(qty * activePrice).toLocaleString('en-US')}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Checkout Summary & Submit CTA */}
        <div className="p-4 sm:p-5 bg-slate-50/50 space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-xs font-medium text-slate-600">
              {isSw ? 'Makadirio ya Fedha Taslimu (CoD)' : 'Estimated CoD Total'}
            </span>
            <span className="text-2xl font-bold font-mono tabular-nums text-emerald-600">
              TZS {cartSummary.totalTzs.toLocaleString('en-US')}
            </span>
          </div>

          {cartSummary.totalSavingsTzs > 0 && (
            <div className="flex items-baseline justify-between gap-4 pt-1 border-t border-slate-200/70">
              <span className="text-xs text-slate-500">
                {isSw ? 'Punguzo la Bei ya Jumla' : 'Wholesale Tier Savings'}
              </span>
              <span className="text-sm font-bold font-mono tabular-nums text-emerald-600">
                -TZS {cartSummary.totalSavingsTzs.toLocaleString('en-US')}
              </span>
            </div>
          )}

          <button
            type="button"
            disabled={cartSummary.bareTokenItems.length === 0 || submitting}
            onClick={() => void handleCompleteCheckout()}
            className="w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white rounded-md transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer shadow-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-500"
          >
            <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {submitting
                ? isSw
                  ? 'Inatuma Oda...'
                  : 'Submitting...'
                : isSw
                  ? 'Tuma Ombi la Oda (CoD)'
                  : 'Submit B2B Purchase Request'}
            </span>
          </button>

          {submissionNote && (
            <div className="border border-emerald-200 bg-emerald-50/70 rounded-md p-3.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>{submissionNote.headline}</span>
              </div>
              <div className="text-xs text-slate-700">{submissionNote.summaryLine}</div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
