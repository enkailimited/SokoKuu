import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Languages, Play, RefreshCw } from 'lucide-react';
import { useSokoKuuI18n } from '../hooks/useSokoKuuI18n';
import { SOKOKUU_TRANSLATIONS, type SokoKuuPhraseDictionary } from '../data/sokokuuTranslations';
import type { Locale } from '../data/i18n';
import { SokoApiClient, isSokoNetworkError } from '../services/sokoApiClient';
import { BackendOfflineBanner } from './DatabaseStateBanner';

const PHRASE_KEYS = Object.keys(SOKOKUU_TRANSLATIONS.sw) as Array<keyof SokoKuuPhraseDictionary>;

interface RetentionStatsResponse {
  totalIdempotencyKeys: number;
  staleIdempotencyKeysCount: number;
  totalActiveLedgers: number;
  archiveEligibleLedgersCount: number;
  disputedLedgersCount: number;
  coldArchiveLedgersCount: number;
  pendingOutboxCount: number;
  deadLetterOutboxCount: number;
  sampledAt: string;
}

export function DevOpsRetentionPanel({ locale }: { locale: Locale }) {
  const isSw = locale === 'sw';
  const offlineI18n = useSokoKuuI18n('sw');

  const [sampleAmount, setSampleAmount] = useState(0);
  const [stats, setStats] = useState<RetentionStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningBatch, setRunningBatch] = useState(false);
  const [backendOffline, setBackendOffline] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSweepResult, setLastSweepResult] = useState<string | null>(null);

  const loadRetentionStats = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await SokoApiClient.get<RetentionStatsResponse>('/admin/retention/stats');
      setStats(data);
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load retention statistics');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRetentionStats();
  }, [loadRetentionStats]);

  const runMaintenanceSweep = async () => {
    setRunningBatch(true);
    setErrorMsg(null);
    try {
      const result = await SokoApiClient.post<{
        purgedKeys: number;
        archivedLedgers: number;
      }>('/admin/retention/run');
      setLastSweepResult(
        `Purged ${result.purgedKeys.toLocaleString('en-US')} idempotency_keys (>48h) · Archived ${result.archivedLedgers.toLocaleString('en-US')} settled ledgers (>90d) at ${new Date().toLocaleTimeString('en-GB')} EAT`,
      );
      await loadRetentionStats();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Retention batch execution failed');
      }
    } finally {
      setRunningBatch(false);
    }
  };

  return (
    <div className="space-y-6">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          onRetry={() => void loadRetentionStats()}
          retrying={loading}
        />
      )}

      {errorMsg && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg p-3.5 text-xs font-medium text-red-900"
        >
          {errorMsg}
        </div>
      )}

      {/* 1. Offline Localization Dictionary & Currency Formatter */}
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
                : 'Reads localStorage UI preference without network REST calls; formats TZS currency and Swahili phrases.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              aria-label="TZS formatter test value"
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

      {/* 2. Live PostgreSQL Retention & Maintenance Cron Control */}
      <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isSw
                ? 'Ratiba ya Usafishaji wa Hifadhidata ya SokoKuu (Jumapili 02:00 EAT)'
                : 'PostgreSQL Retention & Cold-Archival Scheduler (Sun 02:00 EAT)'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5 font-mono text-xs">
              POST /api/v1/admin/retention/run · Africa/Dar_es_Salaam
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void runMaintenanceSweep()}
              disabled={runningBatch || !stats}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {runningBatch
                  ? isSw
                    ? 'Inasafisha...'
                    : 'Running Batch...'
                  : isSw
                    ? 'Endesha Usafishaji Sasa'
                    : 'Run Weekly Retention Batch'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void loadRetentionStats()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-200">
          <div>
            <div className="text-xs text-slate-500">Expired idempotency_keys (&gt;48h)</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-1">
              {stats ? `${stats.staleIdempotencyKeysCount.toLocaleString('en-US')} / ${stats.totalIdempotencyKeys.toLocaleString('en-US')}` : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Eligible cash_delivery_ledgers (&gt;90d)</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-1">
              {stats ? `${stats.archiveEligibleLedgersCount.toLocaleString('en-US')} / ${stats.totalActiveLedgers.toLocaleString('en-US')}` : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Cold Archive (cash_delivery_ledgers_archive)</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-emerald-800 mt-1">
              {stats ? `${stats.coldArchiveLedgersCount.toLocaleString('en-US')} rows` : '—'}
            </div>
          </div>
        </div>

        {lastSweepResult && (
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3.5 py-2">
            <CalendarClock className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{lastSweepResult}</span>
          </div>
        )}
      </section>
    </div>
  );
}
