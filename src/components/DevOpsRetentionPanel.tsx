import { useState } from 'react';
import { CalendarClock, Languages, Play, RotateCcw } from 'lucide-react';
import { useSokoKuuI18n } from '../hooks/useSokoKuuI18n';
import { SOKOKUU_TRANSLATIONS, type SokoKuuPhraseDictionary } from '../data/sokokuuTranslations';
import type { Locale } from '../data/i18n';

const PHRASE_KEYS = Object.keys(SOKOKUU_TRANSLATIONS.sw) as Array<keyof SokoKuuPhraseDictionary>;

export function DevOpsRetentionPanel({ locale }: { locale: Locale }) {
  const isSw = locale === 'sw';
  const offlineI18n = useSokoKuuI18n('sw');

  const [sampleAmount, setSampleAmount] = useState(163200);
  const [staleIdempotencyCount, setStaleIdempotencyCount] = useState(14280);
  const [archiveLedgersCount, setArchiveLedgersCount] = useState(8940);
  const [archivedTotal, setArchivedTotal] = useState(41200);
  const [lastSweepTime, setLastSweepTime] = useState<string | null>(null);

  const runMaintenanceSweep = () => {
    const purgedKeys = Math.min(5000, staleIdempotencyCount);
    const movedLedgers = Math.min(2500, archiveLedgersCount);
    setStaleIdempotencyCount((prev) => prev - purgedKeys);
    setArchiveLedgersCount((prev) => prev - movedLedgers);
    setArchivedTotal((prev) => prev + movedLedgers);
    setLastSweepTime(
      `Purged ${purgedKeys.toLocaleString('en-US')} idempotency_keys (>48h) · Archived ${movedLedgers.toLocaleString('en-US')} settled ledgers (>90d) at ${new Date().toLocaleTimeString('en-GB')} EAT`
    );
  };

  const resetSweep = () => {
    setStaleIdempotencyCount(14280);
    setArchiveLedgersCount(8940);
    setArchivedTotal(41200);
    setLastSweepTime(null);
  };

  return (
    <div className="space-y-6">
      {/* 1. Offline Localization Matrix & Currency Formatter */}
      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isSw
                ? 'Kamusi ya Nje ya Mtandao (useSokoKuuI18n)'
                : 'Offline Localization Engine (useSokoKuuI18n)'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              {isSw
                ? 'Inasoma lugha kutoka localStorage bila kuuliza seva; inafaa kwa mazingira yasiyo na intaneti.'
                : 'Reads localStorage fallback without network REST calls; formats TZS currency and Swahili street phrases offline.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              aria-label="Sample TZS amount"
              value={sampleAmount}
              onChange={(e) => setSampleAmount(Number(e.target.value) || 0)}
              className="h-9 w-32 px-3 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900"
            />
            <button
              type="button"
              onClick={offlineI18n.toggleLocale}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Languages className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Hook Locale: {offlineI18n.locale.toUpperCase()}</span>
            </button>
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-mono text-slate-600">
            formatCurrency({sampleAmount}) →{' '}
            <strong className="text-slate-900">{offlineI18n.formatCurrency(sampleAmount)}</strong>
          </span>
          <span className="font-mono text-slate-500">
            localStorage[&apos;sokokuu_offline_locale&apos;] = &apos;{offlineI18n.locale}&apos;
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-medium">
                <th className="py-2 px-5">Phrase Key</th>
                <th className="py-2 px-4">Active Offline Output ({offlineI18n.locale.toUpperCase()})</th>
                <th className="py-2 px-4 text-slate-500">Counterpart</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {PHRASE_KEYS.map((key) => {
                const other = offlineI18n.locale === 'sw' ? 'en' : 'sw';
                return (
                  <tr key={key} className="hover:bg-slate-50/70">
                    <td className="py-2 px-5 font-mono text-slate-600 whitespace-nowrap">{key}</td>
                    <td className="py-2 px-4 font-medium text-slate-900">{offlineI18n.t(key)}</td>
                    <td className="py-2 px-4 text-slate-500">{SOKOKUU_TRANSLATIONS[other][key]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Serverless SQL Cluster Retention & Maintenance Cron Simulator */}
      <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isSw
                ? 'Ratiba ya Usafishaji wa Hifadhidata ya SokoKuu (Jumapili 02:00 EAT)'
                : 'SokoKuu Cloud SQL Cluster Auto-Cleanup & Retention (Sun 02:00 EAT)'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5 font-mono text-xs">
              @Scheduled(cron = &quot;0 0 2 * * SUN&quot;, zone = &quot;Africa/Dar_es_Salaam&quot;)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runMaintenanceSweep}
              disabled={staleIdempotencyCount === 0 && archiveLedgersCount === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSw ? 'Endesha Usafishaji Sasa' : 'Run Weekly Retention Batch'}</span>
            </button>
            <button
              type="button"
              onClick={resetSweep}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSw ? 'Weka Upya' : 'Reset'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-200">
          <div>
            <div className="text-xs text-slate-500">Resolved idempotency_keys (&gt;48h)</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-1">
              {staleIdempotencyCount.toLocaleString('en-US')} rows
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Active cash_delivery_ledgers (&gt;90d)</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-1">
              {archiveLedgersCount.toLocaleString('en-US')} rows
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Cold Archive (cash_delivery_ledgers_archive)</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-emerald-800 mt-1">
              {archivedTotal.toLocaleString('en-US')} rows
            </div>
          </div>
        </div>

        {lastSweepTime && (
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3.5 py-2">
            <CalendarClock className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{lastSweepTime}</span>
          </div>
        )}
      </section>
    </div>
  );
}
