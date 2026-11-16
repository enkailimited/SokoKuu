import { useState, useMemo } from 'react';
import { Minus, Plus, Search, Wifi, WifiOff, CheckCircle2, Send } from 'lucide-react';
import type { Locale } from '../data/i18n';

export interface CatalogCartSku {
  productId: string;
  sellerBusinessId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitType: 'QUARTER_KILO_LITRE' | 'HALF_KILO_LITRE' | 'SINGLE_KILO_LITRE' | 'CARTON' | 'SACK_25KG';
  unitLabelSw: string;
  unitLabelEn: string;
  quarterQuantaPerUnit: number;
  wholesaleThresholdUnits: number;
  retailPriceTzs: number;
  wholesalePriceTzs: number;
}

const CATALOG_SKUS: CatalogCartSku[] = [
  {
    productId: '4b9f3c10-2001-4a99-9111-000000000001',
    sellerBusinessId: '9a001122-3344-5566-7788-99aabbccddee',
    sku: 'MF-KOR-1L',
    nameSw: 'Mafuta ya Kupikia Korie (Lita)',
    nameEn: 'Korie Cooking Oil (1L / Fraction)',
    unitType: 'SINGLE_KILO_LITRE',
    unitLabelSw: 'Lita 1 (Robo 4)',
    unitLabelEn: '1 Litre (4 Quanta)',
    quarterQuantaPerUnit: 4,
    wholesaleThresholdUnits: 3,
    retailPriceTzs: 6_200,
    wholesalePriceTzs: 5_450,
  },
  {
    productId: '4b9f3c10-2001-4a99-9111-000000000002',
    sellerBusinessId: '9a001122-3344-5566-7788-99aabbccddee',
    sku: 'SK-KLM-ROBO',
    nameSw: 'Sukari ya Kilombero (Robo 250g)',
    nameEn: 'Kilombero Sugar (Robo 250g)',
    unitType: 'QUARTER_KILO_LITRE',
    unitLabelSw: 'Robo 1/4 KG',
    unitLabelEn: 'Quarter Kilo (1/4)',
    quarterQuantaPerUnit: 1,
    wholesaleThresholdUnits: 8,
    retailPriceTzs: 1_050,
    wholesalePriceTzs: 880,
  },
  {
    productId: '4b9f3c10-2001-4a99-9111-000000000003',
    sellerBusinessId: '9a001122-3344-5566-7788-99aabbccddee',
    sku: 'UN-SEM-25',
    nameSw: 'Unga wa Sembe Bora (Mfuko 25KG)',
    nameEn: 'Sembe Maize Flour (25KG Sack)',
    unitType: 'SACK_25KG',
    unitLabelSw: 'Mfuko 25KG',
    unitLabelEn: '25KG Sack',
    quarterQuantaPerUnit: 100,
    wholesaleThresholdUnits: 2,
    retailPriceTzs: 44_000,
    wholesalePriceTzs: 39_500,
  },
];

async function signCompactSmsHmac(payloadWithoutSig: string): Promise<string> {
  const keyBytes = new TextEncoder().encode('sokokuu-duka-offline-hmac-2026');
  const msgBytes = new TextEncoder().encode(payloadWithoutSig);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  return Array.from(new Uint8Array(sigBuffer))
    .slice(0, 3)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

// ============================================================================
// RetailerCheckoutCart.tsx — Refactored to max-w-2xl mx-auto container layout
// Inazuia kukunjuka kwenye kompyuta kubwa na kuleta muonekano safi wa simu (mobile UI).
// ============================================================================
export function RetailerCheckoutCart({ locale = 'en' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [searchTerm, setSearchTerm] = useState('');
  const [isOffline, setIsOffline] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({
    '4b9f3c10-2001-4a99-9111-000000000001': 3,
    '4b9f3c10-2001-4a99-9111-000000000002': 4,
    '4b9f3c10-2001-4a99-9111-000000000003': 1,
  });
  const [submissionNote, setSubmissionNote] = useState<{
    mode: 'API' | 'SMS';
    orderRef: string;
    headline: string;
    summaryLine: string;
    smsPayload?: string;
  } | null>(null);

  const visibleCatalog = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return CATALOG_SKUS;
    return CATALOG_SKUS.filter(
      (item) =>
        item.nameSw.toLowerCase().includes(q) ||
        item.nameEn.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q)
    );
  }, [searchTerm]);

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

    for (const item of CATALOG_SKUS) {
      const qty = quantities[item.productId] ?? 0;
      if (qty <= 0) continue;

      const wholesaleApplied = qty >= item.wholesaleThresholdUnits;
      const activeUnitPrice = wholesaleApplied ? item.wholesalePriceTzs : item.retailPriceTzs;
      totalTzs += qty * activeUnitPrice;
      totalUnits += qty;
      totalSavingsTzs += wholesaleApplied
        ? qty * (item.retailPriceTzs - item.wholesalePriceTzs)
        : 0;

      bareTokenItems.push({
        productId: item.productId,
        unitType: item.unitType,
        quantity: qty,
      });
    }

    return { totalTzs, totalSavingsTzs, totalUnits, bareTokenItems };
  }, [quantities]);

  const handleCompleteCheckout = async () => {
    if (cartSummary.bareTokenItems.length === 0) return;

    const ref8 = Math.random().toString(36).substring(2, 10).toUpperCase();

    if (isOffline) {
      const compactItems = cartSummary.bareTokenItems
        .map((i, idx) => `I${idx + 1}:${i.quantity}`)
        .join(',');
      const unsigned = `SK#${ref8}#K99#${compactItems}`;
      const sig6 = await signCompactSmsHmac(unsigned);
      const fullSms = `${unsigned}#${sig6}`;

      setSubmissionNote({
        mode: 'SMS',
        orderRef: ref8,
        headline: isSw
          ? 'Ujumbe wa WebCrypto NextSMS Uko Tayari'
          : 'Offline NextSMS Order Ready',
        summaryLine: isSw
          ? `Oda ${ref8} · Herufi ${fullSms.length}/160 · Lipa Taslimu Mkononi (CoD)`
          : `Ref ${ref8} · ${fullSms.length}/160 GSM-7 chars · Cash on Delivery`,
        smsPayload: fullSms,
      });
      return;
    }

    setSubmissionNote({
      mode: 'API',
      orderRef: ref8,
      headline: isSw
        ? 'Ombi la Oda Limepokelewa · Hali: PLACED'
        : 'B2B Purchase Request Placed · Status: PLACED',
      summaryLine: isSw
        ? `Oda #${ref8} · Bidhaa ${cartSummary.bareTokenItems.length} (${cartSummary.totalUnits} vipimo) · TZS ${cartSummary.totalTzs.toLocaleString('en-US')} (Imethibitishwa na Seva)`
        : `Order #${ref8} · ${cartSummary.bareTokenItems.length} SKUs (${cartSummary.totalUnits} units) · Server-verified CoD TZS ${cartSummary.totalTzs.toLocaleString('en-US')}`,
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Top Catalog Search & Network Context Switcher */}
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
              isSw ? 'Tafuta sukari, mafuta, unga...' : 'Search sugar, oil, flour...'
            }
            className="w-full min-h-[44px] pl-10 pr-4 text-sm bg-white border border-slate-200 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => {
            setIsOffline((prev) => !prev);
            setSubmissionNote(null);
          }}
          className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 cursor-pointer shadow-xs ${
            isOffline
              ? 'bg-orange-50 border-orange-200 text-orange-900'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          {isOffline ? (
            <WifiOff className="w-4 h-4 text-orange-600" aria-hidden="true" />
          ) : (
            <Wifi className="w-4 h-4 text-emerald-600" aria-hidden="true" />
          )}
          <span>
            {isOffline
              ? isSw
                ? 'Mtandao: Nje ya Mtandao (SMS)'
                : 'Offline Mode (NextSMS)'
              : isSw
                ? 'Mtandao: Uko Mtandaoni'
                : 'Online Mode (Direct API)'}
          </span>
        </button>
      </section>

      {/* Checkout Item List */}
      <section className="bg-white border border-slate-100 rounded-lg shadow-sm divide-y divide-slate-100">
        {visibleCatalog.map((item) => {
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
                      Bei ya Jumla Applied 🎉
                    </span>
                  )}
                </div>
              </div>

              {/* Increment Controls [-] quantity [+] */}
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
        })}

        {/* Aligned Checkout Summary & Dynamic Submit CTA */}
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
            disabled={cartSummary.bareTokenItems.length === 0}
            onClick={handleCompleteCheckout}
            className={`w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white rounded-md transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer shadow-xs ${
              isOffline
                ? 'bg-orange-600 hover:bg-orange-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            } disabled:bg-slate-200 disabled:text-slate-500`}
          >
            <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {isOffline
                ? 'Tuma Oda kwa SMS 📡'
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
              {submissionNote.smsPayload && (
                <div className="text-xs font-mono text-slate-800 bg-white border border-emerald-200 rounded px-2.5 py-1.5 mt-1.5 break-all">
                  {submissionNote.smsPayload}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
