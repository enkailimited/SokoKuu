import { useDynamicCartCalculator } from '../hooks/useDynamicCartCalculator';
import type { Locale } from '../data/i18n';
import { formatBusinessTierLabel, formatUnitTypeLabel } from '../lib/sokoManagedState';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';
import { NumberDraftInput } from './NumberDraftInput';

function formatTzs(amount: number): string {
  return `TZS ${amount.toLocaleString('en-US')}`;
}

export function DynamicPricingRouterPanel({ locale }: { locale: Locale }) {
  const isSw = locale === 'sw';
  const {
    cartLines,
    grandTotalTzs,
    totalSavingsTzs,
    updateQuantity,
    loading,
    backendOffline,
    apiError,
    reload,
  } = useDynamicCartCalculator();

  return (
    <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {isSw
              ? 'Kipanga Bei Kiotomatiki Kulingana na Kiasi (Dynamic Pricing Router)'
              : 'Dynamic Volume-Based Pricing Router (PostgreSQL Live)'}
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            {isSw
              ? 'Badili idadi ya vipimo kwenye bidhaa hai za PostgreSQL kuona mabadiliko ya bei ya Rejareja kwenda Jumla papo hapo.'
              : 'Adjust unit quantities on live PostgreSQL products to evaluate Retail-to-Wholesale tier crossover pricing.'}
          </p>
        </div>

        <div className="flex items-center gap-6 text-right">
          <div>
            <div className="text-xs text-slate-500">
              {isSw ? 'Akiba ya Bei ya Jumla' : 'Wholesale Tier Savings'}
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-emerald-800 mt-0.5">
              {formatTzs(totalSavingsTzs)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">
              {isSw ? 'Jumla ya Kikapu' : 'Cart Total'}
            </div>
            <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
              {formatTzs(grandTotalTzs)}
            </div>
          </div>
        </div>
      </div>

      {backendOffline && (
        <div className="p-4 border-b border-slate-200">
          <BackendOfflineBanner locale={locale} onRetry={() => void reload()} retrying={loading} />
        </div>
      )}

      {apiError && (
        <div role="alert" className="m-4 p-3 rounded border border-rose-200 bg-rose-50 text-xs text-rose-900">
          {apiError}
        </div>
      )}

      {cartLines.length === 0 ? (
        <div className="p-5">
          <EmptyStateCard
            locale={locale}
            titleSw="Hakuna bidhaa za kupanga bei bado"
            titleEn="No products loaded for pricing evaluation"
            descriptionSw="Sajili bidhaa zenye vipimo vya bei kwenye PostgreSQL au unganisha seva."
            descriptionEn="Create active Merchant products with price tiers in PostgreSQL to test dynamic tier routing."
          />
        </div>
      ) : (
        <div className="divide-y divide-slate-200">
          {cartLines.map((line) => (
            <div
              key={line.productId}
              className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-5"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono text-slate-500">{line.sku}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-600 font-medium">
                    {formatBusinessTierLabel(line.sellerTier, locale)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-semibold ${
                      line.isWholesaleApplied ? 'text-emerald-800' : 'text-amber-800'
                    }`}
                  >
                    {line.appliedTierLabel}
                  </span>
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {isSw ? line.nameSw : line.nameEn}
                </div>
                <div className="text-xs text-slate-600 font-mono tabular-nums">
                  Retail: {formatTzs(line.retailUnitPriceTzs)} · Wholesale (≥{line.wholesaleMinUnitsThreshold}{' '}
                  {formatUnitTypeLabel(line.unitLabelEn, locale)}): {formatTzs(line.wholesaleUnitPriceTzs)}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateQuantity(line.productId, line.quantity - 1)}
                    className="h-9 w-9 border border-slate-300 rounded-md text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    aria-label="Decrease quantity"
                  >
                    -
                  </button>
                  <NumberDraftInput
                    min={0}
                    max={200}
                    aria-label={`Quantity for ${line.sku}`}
                    value={line.quantity}
                    fallback={0}
                    onValueChange={(next) => updateQuantity(line.productId, next)}
                    className="h-9 w-16 px-2 text-center text-sm font-mono tabular-nums border border-slate-300 rounded-md text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => updateQuantity(line.productId, line.quantity + 1)}
                    className="h-9 w-9 border border-slate-300 rounded-md text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => updateQuantity(line.productId, line.wholesaleMinUnitsThreshold)}
                    className="px-3 py-2 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap cursor-pointer"
                  >
                    Jump to {line.wholesaleMinUnitsThreshold}
                  </button>
                </div>

                <div className="text-right min-w-[140px]">
                  <div className="text-xs text-slate-500 font-mono tabular-nums">
                    {line.quantity} × {formatTzs(line.activeUnitPriceTzs)} ({line.totalQuarterQuanta} quanta)
                  </div>
                  <div className="text-base font-semibold font-mono tabular-nums text-slate-900">
                    {formatTzs(line.lineTotalTzs)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
