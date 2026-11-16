import { useState } from 'react';
import { AlertTriangle, Layers, ChevronDown, ChevronRight, ArrowUpRight } from 'lucide-react';
import type { Locale } from '../data/i18n';
import { formatUnitTypeLabel } from '../lib/sokoManagedState';

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

interface DeconstructionLogEntry {
  id: string;
  sku: string;
  parentUnit: string;
  creditedQuanta: number;
  timestamp: string;
}

const INITIAL_LOW_STOCK_ITEMS: LowStockSkuItem[] = [
  {
    productId: 'prod-sugar-50',
    sku: 'SK-KLM-50',
    nameSw: 'Sukari ya Kilombero (Robo / Nusu)',
    nameEn: 'Kilombero Sugar (Loose Fractions)',
    parentUnit: 'SACK_50KG',
    quantaPerBulkPackage: 200,
    sealedBulkStock: 14,
    looseQuantaStock: 18, // 4.5 KG left vs 64 Quanta (16 KG) daily velocity
    dailyVelocityQuanta: 64,
  },
  {
    productId: 'prod-oil-20',
    sku: 'MF-KOR-20',
    nameSw: 'Mafuta ya Korie (Robo / Lita 1)',
    nameEn: 'Korie Cooking Oil (Loose Litres)',
    parentUnit: 'CARTON',
    quantaPerBulkPackage: 80,
    sealedBulkStock: 22,
    looseQuantaStock: 12, // 3L left vs 40 Quanta (10L) daily velocity
    dailyVelocityQuanta: 40,
  },
  {
    productId: 'prod-rice-50',
    sku: 'MC-MBY-50',
    nameSw: 'Mchele wa Mbeya Super',
    nameEn: 'Mbeya Super Grade Rice',
    parentUnit: 'SACK_50KG',
    quantaPerBulkPackage: 200,
    sealedBulkStock: 9,
    looseQuantaStock: 148, // Healthy shelf stock
    dailyVelocityQuanta: 48,
  },
];

function formatTzs(amount: number): string {
  return `TZS ${amount.toLocaleString('en-US')}`;
}

export function HybridAnalyticsDashboard({ locale = 'en' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [stockItems, setStockItems] = useState<LowStockSkuItem[]>(INITIAL_LOW_STOCK_ITEMS);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);
  const [logs, setLogs] = useState<DeconstructionLogEntry[]>([
    {
      id: 'log-1',
      sku: 'MC-MBY-50',
      parentUnit: 'SACK_50KG',
      creditedQuanta: 200,
      timestamp: '08:14 EAT',
    },
  ]);

  // Comparative split revenue metrics (stored as integer TZS `long` on Spring Boot backend)
  const wholesaleRevenueTzs = 4_860_000;
  const wholesaleOrdersCount = 26;
  const retailRevenueTzs = 1_624_500;
  const retailOrdersCount = 148;
  const totalRevenueTzs = wholesaleRevenueTzs + retailRevenueTzs;
  const wholesaleSharePct = Math.round((wholesaleRevenueTzs / totalRevenueTzs) * 100);
  const retailSharePct = 100 - wholesaleSharePct;

  const lowStockAlerts = stockItems.filter(
    (item) => item.looseQuantaStock < item.dailyVelocityQuanta * 0.5
  );

  const handleBreakOnePackage = (productId: string) => {
    const target = stockItems.find((i) => i.productId === productId);
    if (!target || target.sealedBulkStock < 1) return;

    setStockItems((prev) =>
      prev.map((item) =>
        item.productId === productId
          ? {
              ...item,
              sealedBulkStock: item.sealedBulkStock - 1,
              looseQuantaStock: item.looseQuantaStock + item.quantaPerBulkPackage,
            }
          : item
      )
    );

    const time =
      new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' EAT';
    setLogs((prev) => [
      {
        id: crypto.randomUUID(),
        sku: target.sku,
        parentUnit: target.parentUnit,
        creditedQuanta: target.quantaPerBulkPackage,
        timestamp: time,
      },
      ...prev.slice(0, 4),
    ]);
  };

  return (
    <div className="space-y-6">
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
                ? 'Mgawanyo wa fedha halisi zilizokusanywa kwa Dual-PIN leo katika vitengo kamili vya TZS.'
                : 'Discrete daily CoD revenue reconciled via Dual-PIN, partitioned cleanly across Wholesale and Retail channels.'}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">
              {isSw ? 'Jumla ya Mapato ya Leo' : 'Combined Daily Revenue'}
            </div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
              {formatTzs(totalRevenueTzs)}
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
                {wholesaleOrdersCount} {isSw ? 'oda za magunia/katoni' : 'bulk orders'}
              </span>
            </div>
            <div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {formatTzs(wholesaleRevenueTzs)}
              </div>
              <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                {isSw ? 'Wastani wa oda:' : 'Avg order value:'}{' '}
                {formatTzs(Math.round(wholesaleRevenueTzs / wholesaleOrdersCount))}
              </div>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-sm overflow-hidden">
              <div
                className="h-full bg-slate-900"
                style={{ width: `${wholesaleSharePct}%` }}
              />
            </div>
          </div>

          {/* Retail Channel Card */}
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold text-emerald-800">
                B2C_RETAIL · {retailSharePct}%
              </span>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {retailOrdersCount} {isSw ? 'mauzo ya Robo/Nusu' : 'loose fraction sales'}
              </span>
            </div>
            <div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-800">
                {formatTzs(retailRevenueTzs)}
              </div>
              <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                {isSw ? 'Wastani wa mauzo:' : 'Avg ticket size:'}{' '}
                {formatTzs(Math.round(retailRevenueTzs / retailOrdersCount))}
              </div>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-sm overflow-hidden">
              <div
                className="h-full bg-emerald-700"
                style={{ width: `${retailSharePct}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 2. "Hisa ya Bidhaa Inayoisha" Low-Stock & Bulk-Breaking Drawer */}
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
            {lowStockAlerts.length} {isSw ? 'zinahitaji kuvunja gunia' : 'require bulk breakdown'}
          </span>
        </button>

        {drawerOpen && (
          <div className="divide-y divide-slate-200">
            {stockItems.map((item) => {
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
                      <span
                        className={`font-medium ${
                          isLow ? 'text-amber-800' : 'text-emerald-800'
                        }`}
                      >
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
                      Loose shelf: {item.looseQuantaStock} quanta ({(item.looseQuantaStock * 0.25).toFixed(2)} kg/L) ·
                      Sealed {formatUnitTypeLabel(item.parentUnit, locale)}: {item.sealedBulkStock} · Daily velocity: {item.dailyVelocityQuanta} quanta/day
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={item.sealedBulkStock < 1}
                    onClick={() => handleBreakOnePackage(item.productId)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {isSw
                        ? `Vunja 1 ${formatUnitTypeLabel(item.parentUnit, locale)} (+${item.quantaPerBulkPackage})`
                        : `Break 1 ${formatUnitTypeLabel(item.parentUnit, locale)} (+${item.quantaPerBulkPackage} quanta)`}
                    </span>
                  </button>
                </div>
              );
            })}

            {/* Recent Deconstruction Audit Trail */}
            <div className="px-5 py-3 bg-slate-50/70 space-y-1.5">
              <div className="text-xs font-medium text-slate-700">
                {isSw ? 'Kumbukumbu za Uvunjaji wa Magunia' : 'Recent Bulk-Breaking Ledger'}
              </div>
              {logs.map((entry) => (
                <div
                  key={entry.id}
                  className="text-xs font-mono text-slate-600 flex items-center justify-between gap-2"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <ArrowUpRight className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                    <span>
                      {entry.sku}: -1 {formatUnitTypeLabel(entry.parentUnit, locale)} → +{entry.creditedQuanta} loose quarter-quanta
                    </span>
                  </span>
                  <span className="tabular-nums text-slate-500">{entry.timestamp}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
