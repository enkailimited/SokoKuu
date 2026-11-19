import { useCallback, useEffect, useState } from 'react';
import { Store, ShieldAlert, ArrowRightLeft, RefreshCw } from 'lucide-react';
import { useHybridMode } from '../context/HybridModeContext';
import type { Locale } from '../data/i18n';
import {
  formatBusinessTierLabel,
  formatUnitTypeLabel,
} from '../lib/sokoManagedState';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

interface LiveTierCatalogItem {
  id: string;
  merchantName: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  channel: 'WHOLESALE' | 'RETAIL';
  unit: string;
  quarterQuanta: number;
  priceTzs: number;
}

interface BackendMerchantDto {
  merchantId: string;
  merchantName: string;
  tier: string;
}

interface BackendProductDto {
  productId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  priceTiers?: Array<{
    id: string;
    unitType: string;
    quarterQuantaPerUnit: number;
    priceTzs: number;
    isWholesaleTier: boolean;
  }>;
}

export function HybridStorefrontPanel({ locale }: { locale: Locale }) {
  const isSw = locale === 'sw';
  const { activeViewChannel, setViewChannel } = useHybridMode();
  const [items, setItems] = useState<LiveTierCatalogItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [sellerTierTest, setSellerTierTest] = useState<'WHOLESALE' | 'HYBRID_STORE'>('WHOLESALE');
  const [guardMessage, setGuardMessage] = useState<string | null>(null);

  const loadLiveCatalogByChannel = useCallback(async () => {
    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }
    setLoading(true);
    setBackendOffline(false);
    setApiError(null);
    try {
      const merchants = await SokoApiClient.get<BackendMerchantDto[]>('/marketplace/merchants');
      const targetMerchants = (Array.isArray(merchants) ? merchants : []).filter((m) =>
        activeViewChannel === 'WHOLESALE'
          ? m.tier === 'WHOLESALE' || m.tier === 'HYBRID_STORE'
          : m.tier === 'RETAIL_DUKA' || m.tier === 'HYBRID_STORE',
      );

      const productLists = await Promise.all(
        targetMerchants.slice(0, 6).map(async (m) => ({
          merchant: m,
          products: await SokoApiClient.get<BackendProductDto[]>(
            `/products/active?businessId=${encodeURIComponent(m.merchantId)}`,
          ).catch(() => [] as BackendProductDto[]),
        })),
      );

      const rows: LiveTierCatalogItem[] = [];
      for (const entry of productLists) {
        for (const p of entry.products) {
          for (const tier of p.priceTiers ?? []) {
            const matchesChannel =
              activeViewChannel === 'WHOLESALE' ? tier.isWholesaleTier : !tier.isWholesaleTier;
            if (!matchesChannel) continue;
            rows.push({
              id: `${p.productId}:${tier.id}`,
              merchantName: entry.merchant.merchantName,
              sku: p.sku,
              nameSw: p.nameSw,
              nameEn: p.nameEn,
              channel: activeViewChannel,
              unit: tier.unitType,
              quarterQuanta: tier.quarterQuantaPerUnit,
              priceTzs: Number(tier.priceTzs),
            });
          }
        }
      }
      setItems(rows);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia orodha ya chaneli.'
              : 'Failed to load channel price tiers.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [activeViewChannel, isSw]);

  useEffect(() => {
    void loadLiveCatalogByChannel();
  }, [loadLiveCatalogByChannel]);

  const handleTestTierConstraint = () => {
    if (sellerTierTest === 'WHOLESALE') {
      setGuardMessage(
        isSw
          ? 'Kizuizi cha Mfumo (P0001): Duka la Jumla haliruhusiwi kuweka bei ya Robo/Nusu/Tatu-Robo ili kulinda maduka ya rejareja.'
          : 'Tier Guardrail (P0001): Wholesale Hub cannot list fractional Robo/Nusu retail fractions.',
      );
    } else {
      setGuardMessage(
        isSw
          ? 'IMERUHUSIWA (Duka Mseto): Duka mseto linaruhusiwa kuuza Gunia 50 KG (B2B) na Robo/Nusu Kilo (B2C).'
          : 'ALLOWED (Hybrid Store): Hybrid store is authorized to sell 50 KG Sacks (B2B) and Robo/Nusu fractions (B2C).',
      );
    }
  };

  return (
    <div className="space-y-6">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          retrying={loading}
          onRetry={() => void loadLiveCatalogByChannel()}
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

      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Store className="w-5 h-5 text-emerald-700 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {isSw
                  ? 'Badili Hali ya Duka (HybridModeContext)'
                  : 'Badili Hali ya Duka — Dual-Mode Channel Switch'}
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                {isSw
                  ? 'Huchuja bei za PostgreSQL kulingana na mkondo wa Jumla (B2B) au Rejareja (B2C).'
                  : 'Queries live PostgreSQL price tiers partitioned between B2B bulk units and B2C market fractions.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => setViewChannel('WHOLESALE')}
                className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  activeViewChannel === 'WHOLESALE'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                Niko kama Jumla (B2B)
              </button>
              <button
                type="button"
                onClick={() => setViewChannel('RETAIL')}
                className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  activeViewChannel === 'RETAIL'
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                Niko kama Rejareja (B2C)
              </button>
            </div>
            <button
              type="button"
              onClick={() => void loadLiveCatalogByChannel()}
              disabled={loading}
              className="p-2 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 cursor-pointer"
              aria-label="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            {isSw ? 'Inapakia bei za chaneli...' : 'Loading live channel tiers...'}
          </div>
        ) : items.length === 0 ? (
          <div className="p-4">
            <EmptyStateCard
              locale={locale}
              titleSw="Hakuna rekodi bado"
              titleEn="No records yet"
              descriptionSw="Hakuna bei za bidhaa kwa mkondo huu katika PostgreSQL bado."
              descriptionEn="No product price tiers exist in PostgreSQL for this channel yet."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="py-2.5 px-5">SKU</th>
                  <th className="py-2.5 px-4">{isSw ? 'Mfanyabiashara' : 'Merchant'}</th>
                  <th className="py-2.5 px-4">{isSw ? 'Bidhaa' : 'Product'}</th>
                  <th className="py-2.5 px-4">{isSw ? 'Kipimo (Enum)' : 'Packaging Enum'}</th>
                  <th className="py-2.5 px-5 text-right">{isSw ? 'Bei (TZS)' : 'Price (TZS)'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-5 font-mono text-xs text-slate-600 whitespace-nowrap">
                      {item.sku}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-700">{item.merchantName}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">
                      {isSw ? item.nameSw : item.nameEn}
                    </td>
                    <td className="py-2.5 px-4 text-xs font-medium text-emerald-800 whitespace-nowrap">
                      {formatUnitTypeLabel(item.unit, locale)} ({item.quarterQuanta}Q)
                    </td>
                    <td className="py-2.5 px-5 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                      TZS {item.priceTzs.toLocaleString('en-US')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-700" aria-hidden="true" />
            <span>
              {isSw
                ? 'Kithibitisha Sheria za Duka (PostgreSQL Trigger & Tier Validator)'
                : 'Tier Rule Reference (PostgreSQL Trigger & Tier Guard)'}
            </span>
          </h3>
          <p className="text-xs text-slate-600 mt-1">
            {isSw
              ? 'Chagua daraja la mfanyabiashara kuona uthibitisho wa P0001 kwa vipimo vya Robo (1/4).'
              : 'Inspect the PostgreSQL trigger constraint enforced when listing Quarter Kilo / Litre (Robo) SKUs.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Seller Business Tier"
            value={sellerTierTest}
            onChange={(e) => setSellerTierTest(e.target.value as 'WHOLESALE' | 'HYBRID_STORE')}
            className="h-9 px-3 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
          >
            <option value="WHOLESALE">
              {formatBusinessTierLabel('WHOLESALE', locale)} (Pure Bulk)
            </option>
            <option value="HYBRID_STORE">
              {formatBusinessTierLabel('HYBRID_STORE', locale)} (Dual-Mode)
            </option>
          </select>
          <button
            type="button"
            onClick={handleTestTierConstraint}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap cursor-pointer"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Test Robo (1/4) Rule</span>
          </button>
        </div>

        {guardMessage && (
          <div
            className={`text-xs font-mono rounded-md px-4 py-3 border ${
              guardMessage.includes('P0001')
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            {guardMessage}
          </div>
        )}
      </section>
    </div>
  );
}
