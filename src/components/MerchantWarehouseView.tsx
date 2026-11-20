import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Package,
  RefreshCw,
  Search,
  TrendingDown,
  Warehouse,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { resolveBackendImageUrl } from '../lib/sokoProductImage';
import { formatQuantaMeasurement } from '../utils/formatProductUnit';

interface WarehouseUnitPricingOverride {
  unitCode: string;
  category?: string;
  abbreviation?: string;
  displayLabelSw: string;
  displayLabelEn: string;
  quarterQuantaPerUnit: number;
  effectiveSellingPriceTzs?: number;
}

interface WarehouseCloneItem {
  clonedProductId: string;
  globalCatalogId?: string;
  canonicalSku: string;
  categoryCode?: string;
  baseQuantumUnit?: string;
  fixedNameSw: string;
  fixedNameEn: string;
  imagekitCdnUrl?: string;
  availableQuantaStock: number;
  lowStockThresholdQuanta: number;
  unitPriceTzs?: number;
  sellingPriceTzs?: number;
  inventoryValueTzs: number;
  isPublishedToMarket?: boolean;
  isActiveForSale?: boolean;
  unitPricingOverrides?: WarehouseUnitPricingOverride[];
}

function formatTzs(value: number | string | null | undefined): string {
  try {
    return BigInt(Math.trunc(Number(value ?? 0))).toLocaleString('en-US');
  } catch {
    return Number(value ?? 0).toLocaleString('en-US');
  }
}

function formatQuanta(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString('en-US');
}

export function MerchantWarehouseView({ locale }: { locale: Locale }) {
  const isSw = locale === 'sw';
  const [items, setItems] = useState<WarehouseCloneItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await SokoApiClient.get<WarehouseCloneItem[]>('/merchant/catalog/clones');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err instanceof SokoHttpError) {
        setError(`HTTP ${err.status}: ${err.message}`);
      } else if (isSokoNetworkError(err)) {
        setError(
          isSw
            ? 'Imeshindikana kuunganisha na seva. Tafadhali angalia mtandao wako.'
            : 'Unable to reach the server. Please check your connection.'
        );
      } else {
        setError(
          err instanceof Error
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia data ya ghala.'
              : 'Failed to load warehouse data.'
        );
      }
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [isSw]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const totalSkus = items.length;
    let totalQuanta = 0;
    let totalValueTzs = 0;
    let lowStockCount = 0;
    let stockedCount = 0;

    for (const item of items) {
      const q = Number(item.availableQuantaStock ?? 0);
      totalQuanta += q;
      totalValueTzs += Number(item.inventoryValueTzs ?? 0);
      if (q > 0) stockedCount += 1;
      if (q <= Number(item.lowStockThresholdQuanta ?? 0)) lowStockCount += 1;
    }

    return { totalSkus, totalQuanta, totalValueTzs, lowStockCount, stockedCount };
  }, [items]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => {
      const name = (isSw ? item.fixedNameSw : item.fixedNameEn) ?? '';
      return (
        name.toLowerCase().includes(term) ||
        (item.canonicalSku ?? '').toLowerCase().includes(term) ||
        (item.categoryCode ?? '').toLowerCase().includes(term)
      );
    });
  }, [items, search, isSw]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-[#0054A6]">
            <Warehouse className="w-4 h-4" aria-hidden="true" />
            <span>{isSw ? 'GHALA LA BIASHARA' : 'BUSINESS WAREHOUSE'}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            {isSw ? 'Ghala Langu' : 'My Warehouse'}
          </h2>
          <p className="text-xs text-slate-500 max-w-2xl">
            {isSw
              ? 'Muhtasari wa hisa, thamani na hali ya bidhaa zako zilizopo ghalani.'
              : 'Overview of your stock, value, and the current state of products in your warehouse.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg p-3.5 text-xs text-red-900 flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="border border-slate-200 bg-white rounded-lg p-4 sm:p-5 space-y-1">
          <div className="text-[11px] sm:text-xs font-medium text-slate-500 flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5 text-[#0054A6]" aria-hidden="true" />
            {isSw ? 'Jumla ya Hisa (Quanta)' : 'Total Stock (Quanta)'}
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900">
            {formatQuanta(stats.totalQuanta)}
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500">
            {isSw ? 'Vipimo vyote vimejumuishwa' : 'Across all products'}
          </div>
        </div>

        <div className="border border-slate-200 bg-white rounded-lg p-4 sm:p-5 space-y-1">
          <div className="text-[11px] sm:text-xs font-medium text-slate-500 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-[#0054A6]" aria-hidden="true" />
            {isSw ? 'Bidhaa Ghalani' : 'Warehouse SKUs'}
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900">
            {stats.totalSkus.toLocaleString('en-US')}
          </div>
          <div className="text-[10px] sm:text-[11px] text-emerald-700 font-medium">
            {stats.stockedCount.toLocaleString('en-US')} {isSw ? 'zina hisa' : 'in stock'}
          </div>
        </div>

        <div className="border border-slate-200 bg-white rounded-lg p-4 sm:p-5 space-y-1">
          <div className="text-[11px] sm:text-xs font-medium text-slate-500 flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
            {isSw ? 'Tahadhari ya Hisa' : 'Low Stock Alerts'}
          </div>
          <div
            className={`text-xl sm:text-2xl font-bold font-mono tabular-nums ${
              stats.lowStockCount > 0 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {stats.lowStockCount.toLocaleString('en-US')}
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500">
            {isSw ? 'Bidhaa zilizo chini ya kiwango' : 'Items at or below threshold'}
          </div>
        </div>

        <div className="border border-slate-200 bg-white rounded-lg p-4 sm:p-5 space-y-1">
          <div className="text-[11px] sm:text-xs font-medium text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" aria-hidden="true" />
            {isSw ? 'Thamani ya Ghala (TZS)' : 'Warehouse Value (TZS)'}
          </div>
          <div className="text-lg sm:text-xl font-bold font-mono tabular-nums text-slate-900 break-all">
            {formatTzs(stats.totalValueTzs)}
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500">
            {isSw ? 'Makadirio ya thamani ya hisa' : 'Estimated stock value'}
          </div>
        </div>
      </section>

      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Boxes className="w-4 h-4 text-[#0054A6]" aria-hidden="true" />
              {isSw ? 'Bidhaa Zilizopo Ghalani' : 'Products in Warehouse'}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isSw
                ? 'Orodha ya bidhaa zako na kiwango cha hisa kilichopo sasa.'
                : 'Your products and their current stock levels.'}
            </p>
          </div>
          <label className="relative w-full sm:w-72">
            <Search
              className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isSw ? 'Tafuta jina au SKU...' : 'Search name or SKU...'}
              className="w-full min-h-[40px] pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400"
            />
          </label>
        </div>

        {loading ? (
          <div className="p-6 flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
            <span>{isSw ? 'Inapakia ghala lako...' : 'Loading your warehouse...'}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <Warehouse className="w-10 h-10 text-slate-300 mx-auto" aria-hidden="true" />
            <div className="text-sm font-semibold text-slate-800">
              {isSw ? 'Ghala lako bado halina bidhaa' : 'Your warehouse has no products yet'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {isSw
                ? 'Ongeza au nakili bidhaa kwenye orodha yako ili kuanza kuona hisa hapa.'
                : 'Add or clone products into your catalog to start seeing stock here.'}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">
            {isSw ? 'Hakuna bidhaa zinazolingana na utafutaji.' : 'No products match your search.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                  <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Bidhaa' : 'Product'}</th>
                  <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'SKU' : 'SKU'}</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">
                    {isSw ? 'Hisa (Quanta)' : 'Stock (Quanta)'}
                  </th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">
                    {isSw ? 'Thamani (TZS)' : 'Value (TZS)'}
                  </th>
                  <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Hali' : 'Status'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filtered.map((item) => {
                  const quanta = Number(item.availableQuantaStock ?? 0);
                  const threshold = Number(item.lowStockThresholdQuanta ?? 0);
                  const isLow = quanta <= threshold;
                  const isOut = quanta <= 0;
                  const name = isSw ? item.fixedNameSw : item.fixedNameEn;
                  const baseUnit = item.baseQuantumUnit;
                  const measurement =
                    baseUnit === 'WEIGHT' || baseUnit === 'VOLUME' || baseUnit === 'PACKAGING'
                      ? formatQuantaMeasurement(quanta, baseUnit)
                      : null;

                  return (
                    <tr key={item.clonedProductId} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          {item.imagekitCdnUrl ? (
                            <img
                              src={resolveBackendImageUrl(item.imagekitCdnUrl) || item.imagekitCdnUrl}
                              alt={name}
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              className="w-10 h-10 rounded-md object-cover border border-slate-200 bg-white shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
                              <Package className="w-4 h-4 text-slate-400" aria-hidden="true" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate max-w-[220px] sm:max-w-xs">
                              {name}
                            </div>
                            {measurement && (
                              <div className="text-[11px] text-slate-500">{measurement}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                        {item.canonicalSku || '—'}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono font-bold tabular-nums whitespace-nowrap ${
                          isOut ? 'text-red-700' : isLow ? 'text-amber-700' : 'text-emerald-800'
                        }`}
                      >
                        {formatQuanta(quanta)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                        {formatTzs(item.inventoryValueTzs)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1.5">
                          {isOut ? (
                            <span className="px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 font-mono text-[10px] font-semibold">
                              {isSw ? 'IMEISHA' : 'OUT'}
                            </span>
                          ) : isLow ? (
                            <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-mono text-[10px] font-semibold">
                              {isSw ? 'HISA CHINI' : 'LOW'}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10px] font-semibold">
                              {isSw ? 'IPO' : 'IN STOCK'}
                            </span>
                          )}
                          {item.isPublishedToMarket && (
                            <span className="px-2 py-0.5 rounded-md bg-[#0054A6]/10 text-[#0054A6] border border-[#0054A6]/20 font-mono text-[10px] font-semibold">
                              {isSw ? 'SOKONI' : 'PUBLISHED'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
