import { useState } from 'react';
import { Truck, Download, Search, Banknote, ClipboardCheck, BarChart3 } from 'lucide-react';
import type { Locale } from '../data/i18n';
import { formatOrderStatusLabel } from '../lib/sokoManagedState';
import { WholesalerEodReconciliation } from './WholesalerEodReconciliation';
import { HybridAnalyticsDashboard } from './HybridAnalyticsDashboard';

type WholesalerTab = 'riders' | 'eod' | 'analytics';

interface ActiveRiderTrack {
  riderId: string;
  riderName: string;
  vehiclePlate: string;
  vehicleType: 'Bodaboda' | 'Kirikuu Van' | 'Canter 3T';
  activeWard: string;
  activeDropsCount: number;
  completedDropsCount: number;
  cashOnStreetsTzs: number;
  lastPinSyncEat: string;
  routeStatus: 'ON_ROUTE' | 'RETURNING_WITH_CASH' | 'CLEARED';
}

const ACTIVE_RIDERS: ActiveRiderTrack[] = [
  {
    riderId: 'RDR-101',
    riderName: 'Juma Bakari',
    vehiclePlate: 'MC 418 DKP',
    vehicleType: 'Bodaboda',
    activeWard: 'Kariakoo',
    activeDropsCount: 3,
    completedDropsCount: 5,
    cashOnStreetsTzs: 745_000,
    lastPinSyncEat: '14:18 EAT',
    routeStatus: 'ON_ROUTE',
  },
  {
    riderId: 'RDR-104',
    riderName: 'Hamisi Mtumwa',
    vehiclePlate: 'T 882 DQR',
    vehicleType: 'Kirikuu Van',
    activeWard: 'Sinza',
    activeDropsCount: 2,
    completedDropsCount: 7,
    cashOnStreetsTzs: 1_920_000,
    lastPinSyncEat: '14:04 EAT',
    routeStatus: 'RETURNING_WITH_CASH',
  },
  {
    riderId: 'RDR-109',
    riderName: 'Neema Mwasaga',
    vehiclePlate: 'T 304 EBT',
    vehicleType: 'Canter 3T',
    activeWard: 'Temeke',
    activeDropsCount: 4,
    completedDropsCount: 4,
    cashOnStreetsTzs: 2_680_000,
    lastPinSyncEat: '13:51 EAT',
    routeStatus: 'ON_ROUTE',
  },
  {
    riderId: 'RDR-112',
    riderName: 'Rajabu Kondo',
    vehiclePlate: 'MC 902 DZL',
    vehicleType: 'Bodaboda',
    activeWard: 'Kinondoni',
    activeDropsCount: 0,
    completedDropsCount: 8,
    cashOnStreetsTzs: 0,
    lastPinSyncEat: '13:30 EAT',
    routeStatus: 'CLEARED',
  },
];

export function WholesalerOperationsView({ locale = 'en' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [subTab, setSubTab] = useState<WholesalerTab>('riders');
  const [wardFilter, setWardFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const totalCashOutTzs = ACTIVE_RIDERS.reduce((sum, r) => sum + r.cashOnStreetsTzs, 0);
  const activeRidersCount = ACTIVE_RIDERS.filter((r) => r.routeStatus !== 'CLEARED').length;
  const openDropsCount = ACTIVE_RIDERS.reduce((sum, r) => sum + r.activeDropsCount, 0);

  const filteredRiders = ACTIVE_RIDERS.filter((rider) => {
    const matchesWard = wardFilter === 'ALL' || rider.activeWard === wardFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      rider.riderName.toLowerCase().includes(q) ||
      rider.vehiclePlate.toLowerCase().includes(q) ||
      rider.activeWard.toLowerCase().includes(q);
    return matchesWard && matchesSearch;
  });

  const handleDownloadSwahiliCsv = () => {
    const headers = [
      'Namba ya Dereva',
      'Jina la Dereva',
      'Kata ya Kazi',
      'Fedha Taslimu Mtaani (TZS)',
      'Muda wa Mwisho wa PIN',
    ];
    const rows = ACTIVE_RIDERS.map((r) => [
      r.riderId,
      r.riderName,
      r.activeWard,
      String(r.cashOnStreetsTzs),
      r.lastPinSyncEat,
    ]);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map((c) => `"${c}"`).join(',')).join('\r\n')}\r\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sokokuu-madereva-taslimu.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation inside Wholesaler Workspace */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('riders')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              subTab === 'riders' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Truck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Madereva & Taslimu Mtaani' : 'Active Riders & Street Cash'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('eod')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              subTab === 'eod' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Hesabu za Jioni (EOD)' : 'Evening EOD Settlement'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('analytics')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              subTab === 'analytics' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Mapato & Uvunjaji Magunia' : 'Split Revenue & Stock'}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleDownloadSwahiliCsv}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{isSw ? 'Pakua Ripoti (CSV)' : 'Export Ledger CSV'}</span>
        </button>
      </div>

      {subTab === 'riders' && (
        <div className="space-y-6">
          {/* Top Summary Strip */}
          <section className="grid grid-cols-1 md:grid-cols-3 border border-slate-200 bg-white rounded-lg divide-y md:divide-y-0 md:divide-x divide-slate-200">
            <div className="p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                <Banknote className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                <span>{isSw ? 'Jumla ya Taslimu Mtaani (CoD)' : 'Total Physical Cash on Streets'}</span>
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                TZS {totalCashOutTzs.toLocaleString('en-US')}
              </div>
              <div className="text-xs text-slate-500">
                {isSw ? 'Inasubiri kurejeshwa ghalani' : 'Unsettled CoD cash held by active fleet'}
              </div>
            </div>

            <div className="p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Madereva Waliopo Kazini' : 'Live Active Delivery Riders'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-800">
                {activeRidersCount} / {ACTIVE_RIDERS.length}
              </div>
              <div className="text-xs text-slate-500">
                {isSw ? 'Bodaboda, Kirikuu & Canter' : 'In-house riders & trusted bodabodas'}
              </div>
            </div>

            <div className="p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Oda Zinazoendelea Kushushwa' : 'Pending Street Drop-Offs'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {openDropsCount}
              </div>
              <div className="text-xs text-slate-500">
                {isSw ? 'Zinasubiri uhakiki wa Dual-PIN' : 'Awaiting Dual-PIN handover consensus'}
              </div>
            </div>
          </section>

          {/* Live Fleet Cash Table */}
          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-slate-900">
                {isSw ? 'Ufuatiliaji wa Madereva & Fedha za Leo' : 'Live Fleet Cash Tracking Ledger'}
              </h2>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search
                    className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={isSw ? 'Tafuta dereva au namba...' : 'Search rider or plate...'}
                    className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                  />
                </div>

                <select
                  value={wardFilter}
                  onChange={(e) => setWardFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                >
                  <option value="ALL">{isSw ? 'Kata Zote' : 'All Wards'}</option>
                  <option value="Kariakoo">Kariakoo</option>
                  <option value="Sinza">Sinza</option>
                  <option value="Temeke">Temeke</option>
                  <option value="Kinondoni">Kinondoni</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                    <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Dereva / Chombo' : 'Rider & Vehicle'}</th>
                    <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Kata' : 'Active Ward'}</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">{isSw ? 'Zilizoshushwa / Zilizobaki' : 'Delivered / Open'}</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">{isSw ? 'Taslimu Mkononi (TZS)' : 'Cash on Street (TZS)'}</th>
                    <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Mwisho Kusawazisha' : 'Last PIN Sync'}</th>
                    <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Hali' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredRiders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 px-4 text-center text-slate-500">
                        {isSw
                          ? 'Hakuna dereva anayelingana na utafutaji wako.'
                          : 'No active delivery riders match the current filter.'}
                      </td>
                    </tr>
                  ) : (
                    filteredRiders.map((rider) => (
                      <tr key={rider.riderId} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{rider.riderName}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {rider.vehicleType} · {rider.vehiclePlate}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 whitespace-nowrap">{rider.activeWard}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {rider.completedDropsCount} / {rider.activeDropsCount}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold tabular-nums text-slate-900 whitespace-nowrap">
                          TZS {rider.cashOnStreetsTzs.toLocaleString('en-US')}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {rider.lastPinSyncEat}
                        </td>
                        <td className="py-3 px-4 font-semibold whitespace-nowrap">
                          <span
                            className={
                              rider.routeStatus === 'CLEARED'
                                ? 'text-emerald-800'
                                : rider.routeStatus === 'RETURNING_WITH_CASH'
                                  ? 'text-amber-800'
                                  : 'text-slate-800'
                            }
                          >
                            {formatOrderStatusLabel(rider.routeStatus, locale)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {subTab === 'eod' && <WholesalerEodReconciliation locale={locale} />}
      {subTab === 'analytics' && <HybridAnalyticsDashboard locale={locale} />}
    </div>
  );
}
