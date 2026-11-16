import { useState } from 'react';
import {
  Activity,
  ArrowRightLeft,
  CheckCircle2,
  Database,
  Globe,
  Send,
  ShieldAlert,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  formatPipelineLabel,
  formatRoutingLabel,
  GLOBAL_CATALOG_SEED,
  loadDispatchAuditTraces,
  loadManagedWholesalers,
  recordOrderDispatchAuditTrace,
  saveManagedWholesalers,
  type ManagedWholesaleProfile,
  type OrderDispatchAuditTrace,
} from '../lib/sokoManagedState';

// ============================================================================
// ManagedOrderInterceptorPanel.tsx
// Dashibodi ya Super Admin ya kudhibiti is_platform_managed na kufuatilia
// uelekezaji wa oda (Real-Time Audit Dispatch Tracer) chini ya REPEATABLE_READ.
// ============================================================================
export function ManagedOrderInterceptorPanel({ locale = 'en' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [wholesalers, setWholesalers] = useState<ManagedWholesaleProfile[]>(() =>
    loadManagedWholesalers()
  );
  const [traces, setTraces] = useState<OrderDispatchAuditTrace[]>(() =>
    loadDispatchAuditTraces()
  );
  const [selectedSellerId, setSelectedSellerId] = useState<string>(
    () => wholesalers[0]?.businessId ?? ''
  );
  const [simTotalTzs, setSimTotalTzs] = useState<number>(64000);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const handleToggleManagedFlag = (businessId: string) => {
    setWholesalers((prev) => {
      const next = prev.map((w) =>
        w.businessId === businessId
          ? {
              ...w,
              isPlatformManaged: !w.isPlatformManaged,
              updatedAtEat: new Date().toLocaleTimeString(),
            }
          : w
      );
      saveManagedWholesalers(next);
      const changed = next.find((w) => w.businessId === businessId);
      if (changed) {
        setStatusNotice(
          isSw
            ? `Usimamizi wa Jukwaa kwa "${changed.businessName}" umebadilishwa kuwa ${
                changed.isPlatformManaged ? 'Msaada wa Jukwaa (Super Admin)' : 'Moja kwa Moja (Muuzaji)'
              }.`
            : `Updated platform management for "${changed.businessName}" to ${
                changed.isPlatformManaged ? 'Platform Managed (Super Admin Helpdesk)' : 'Direct Merchant Terminal'
              }.`
        );
      }
      return next;
    });
  };

  const handleSimulateOrderDispatch = () => {
    const target = wholesalers.find((w) => w.businessId === selectedSellerId) ?? wholesalers[0];
    if (!target) return;

    const orderRef8 = 'SK' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const newTrace = recordOrderDispatchAuditTrace({
      orderRef8,
      sellerBusinessId: target.businessId,
      sellerBusinessName: target.businessName,
      totalCashDueTzs: simTotalTzs,
      itemsSummary: 'GC-AZN-WHEAT (16Q) + GC-KOR-OIL (8Q)',
    });

    setTraces(loadDispatchAuditTraces());
    setStatusNotice(
      isSw
        ? `Oda #${orderRef8} imechakatwa -> ${formatRoutingLabel(newTrace.routingCode, 'sw')}`
        : `Order #${orderRef8} processed -> ${formatRoutingLabel(newTrace.routingCode, 'en')}`
    );
  };

  const helpdeskQueueCount = traces.filter(
    (t) => t.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK'
  ).length;
  const directDbCount = traces.filter(
    (t) => t.routingCode === 'ROUTED_DIRECT_MERCHANT_DB'
  ).length;

  return (
    <div className="space-y-6">
      {statusNotice && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-3.5 flex items-center justify-between gap-3 text-xs font-semibold text-emerald-950"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{statusNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Platform-Managed Agent Toggle Matrix */}
      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>
                {isSw
                  ? 'Kidhibiti cha Wakala wa Jukwaa (Usimamizi wa Oda)'
                  : 'Platform-Managed Order Interceptor'}
              </span>
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              {isSw
                ? 'Ikiwa imewashwa, oda zote za POST /orders/submit-request huelekezwa kwenye Super Admin Helpdesk badala ya terminal ya muuzaji.'
                : 'When enabled, inbound order requests are intercepted and routed to the Super Admin Helpdesk pipeline.'}
            </p>
          </div>
          <span className="text-[11px] font-mono text-emerald-700 font-semibold">
            {isSw ? 'Uthibitisho: Repeatable Read' : 'Isolation: Repeatable Read'}
          </span>
        </div>

        <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
          {wholesalers.map((hub) => (
            <div
              key={hub.businessId}
              className="p-3.5 flex flex-wrap items-center justify-between gap-3 bg-white"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                  <span>{hub.businessName}</span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {hub.businessId.slice(0, 8)}...
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {hub.ward} · {isSw ? 'Ilisasishwa:' : 'Updated:'} {hub.updatedAtEat}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`text-[11px] font-semibold ${
                    hub.isPlatformManaged ? 'text-emerald-700' : 'text-slate-600'
                  }`}
                >
                  {hub.isPlatformManaged
                    ? isSw
                      ? 'Inasimamiwa na Jukwaa'
                      : 'Platform Managed'
                    : isSw
                      ? 'Muuzaji Mwenyewe'
                      : 'Direct Merchant'}
                </span>

                <button
                  type="button"
                  onClick={() => handleToggleManagedFlag(hub.businessId)}
                  className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                    hub.isPlatformManaged
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {hub.isPlatformManaged ? (
                    <ToggleRight className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <ToggleLeft className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  )}
                  <span>
                    {hub.isPlatformManaged
                      ? isSw
                        ? 'Helpdesk Kuu'
                        : 'Admin Helpdesk'
                      : isSw
                        ? 'Moja kwa Moja'
                        : 'Direct Vendor'}
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Live Interceptor Test Trigger */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px] space-y-1">
            <label className="text-[11px] font-semibold text-slate-700">
              {isSw ? 'Chagua Duka la Jumla (Target Wholesaler)' : 'Target Wholesaler Profile'}
            </label>
            <select
              value={selectedSellerId}
              onChange={(e) => setSelectedSellerId(e.target.value)}
              className="w-full min-h-[38px] px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
            >
              {wholesalers.map((w) => (
                <option key={w.businessId} value={w.businessId}>
                  {w.businessName} ({w.isPlatformManaged ? 'MANAGED' : 'DIRECT'})
                </option>
              ))}
            </select>
          </div>

          <div className="w-36 space-y-1">
            <label className="text-[11px] font-semibold text-slate-700">
              {isSw ? 'Kiasi (TZS)' : 'Order Value (TZS)'}
            </label>
            <input
              type="number"
              min="1000"
              step="500"
              value={simTotalTzs}
              onChange={(e) => setSimTotalTzs(parseInt(e.target.value, 10) || 1000)}
              className="w-full min-h-[38px] px-2.5 rounded-md border border-slate-300 bg-white text-xs font-mono text-slate-900"
            />
          </div>

          <button
            type="button"
            onClick={handleSimulateOrderDispatch}
            className="min-h-[38px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-md flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Jaribu /orders/submit-request' : 'Test /orders/submit-request'}</span>
          </button>
        </div>
      </section>

      {/* Real-Time Audit Dispatch Tracer */}
      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>
                {isSw
                  ? 'Kifuatiliaji cha Njia za Oda (Real-Time Audit Dispatch Tracer)'
                  : 'Real-Time Audit Dispatch Tracer'}
              </span>
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              {isSw
                ? 'Hurekodi kila njia ya oda (Helpdesk Kuu vs Hifadhidata ya Muuzaji) kwa usalama wa Repeatable Read.'
                : 'Tracks explicit routing paths between corporate Helpdesk queue and direct merchant terminals.'}
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
            <span className="text-emerald-700 font-bold">
              Helpdesk: {helpdeskQueueCount}
            </span>
            <span className="text-slate-700 font-bold">
              Direct DB: {directDbCount}
            </span>
          </div>
        </div>

        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {traces.map((trace) => {
            const isHelpdesk = trace.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK';
            return (
              <div
                key={trace.traceId}
                className="border border-slate-200 rounded-lg p-3 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 font-mono font-bold text-slate-900">
                    <span>{trace.traceId}</span>
                    <span className="text-slate-400">·</span>
                    <span>#{trace.orderRef8}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-emerald-700">Repeatable Read</span>
                  </div>
                  <div className="text-slate-700 font-medium">
                    {trace.sellerBusinessName} · {trace.itemsSummary}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {isSw ? 'Njia' : 'Target'}: {formatPipelineLabel(trace.targetPipeline, locale)} ·{' '}
                    {trace.recordedAtEat}
                  </div>
                </div>

                <div className="text-right space-y-1 shrink-0">
                  <div
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded border ${
                      isHelpdesk
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-white border-slate-300 text-slate-800'
                    }`}
                  >
                    {formatRoutingLabel(trace.routingCode, locale)}
                  </div>
                  <div className="font-mono font-bold text-slate-900 tabular-nums">
                    TZS {trace.totalCashDueTzs.toLocaleString('en-US')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Global Standard Registry Lookup Preview (soko_global_catalog) */}
      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Globe className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            <span>
              {isSw
                ? 'Sajili ya Katalogi Kuu (Master Catalog)'
                : 'Master Catalog Registry'}
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
            <Database className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            <span>{GLOBAL_CATALOG_SEED.length} Master SKUs</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {GLOBAL_CATALOG_SEED.map((item) => (
            <div
              key={item.globalCatalogId}
              className="border border-slate-200 rounded-lg p-3 flex items-center gap-3 bg-white"
            >
              <img
                src={item.staticImageUrl}
                alt={isSw ? item.fixedNameSw : item.fixedNameEn}
                className="w-10 h-10 rounded object-cover border border-slate-100 shrink-0"
              />
              <div className="min-w-0">
                <div className="font-mono text-[11px] font-bold text-emerald-700 truncate">
                  {item.canonicalSku}
                </div>
                <div className="text-xs font-semibold text-slate-900 truncate">
                  {isSw ? item.fixedNameSw : item.fixedNameEn}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {item.category} · {isSw ? item.defaultBaseUnitSw : item.defaultBaseUnitEn}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-[11px] text-slate-600 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            {isSw
              ? 'Wauzaji wanaonakili bidhaa kutoka Katalogi Kuu huanzishiwa hasa na 0 stock na 0 TZS kwenye wasifu wao wa ndani.'
              : 'Merchants cloning items from the Master Catalog receive an isolated local shop entry initialized with strictly 0 stock and 0 TZS pricing.'}
          </span>
        </div>
      </section>
    </div>
  );
}
