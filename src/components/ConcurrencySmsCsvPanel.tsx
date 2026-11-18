import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, Send } from 'lucide-react';
import type { Locale } from '../data/i18n';
import { SokoApiClient, isSokoNetworkError } from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

interface RetentionStats {
  totalIdempotencyKeys: number;
  pendingOutboxCount: number;
  deadLetterOutboxCount: number;
  disputedLedgersCount: number;
  coldArchiveLedgersCount: number;
}

interface SmsDeliveryRow {
  id: string;
  recipientPhoneE164: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
}

interface FinancialLogRow {
  id: string;
  orderId: string | null;
  eventType: string;
  amountTzs: number;
  previousState: string | null;
  newState: string | null;
  createdAt: string;
}

export function ConcurrencySmsCsvPanel({ locale = 'en' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [retention, setRetention] = useState<RetentionStats | null>(null);
  const [smsLogs, setSmsLogs] = useState<SmsDeliveryRow[]>([]);
  const [financialLogs, setFinancialLogs] = useState<FinancialLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingSms, setRetryingSms] = useState(false);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [backendOffline, setBackendOffline] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [retRes, smsRes, finRes] = await Promise.all([
        SokoApiClient.get<RetentionStats>('/admin/retention/stats'),
        SokoApiClient.get<{ logs: SmsDeliveryRow[] }>('/notifications/sms/logs'),
        SokoApiClient.get<{ logs: FinancialLogRow[] }>('/audit/financial-logs'),
      ]);
      setRetention(retRes);
      setSmsLogs(smsRes.logs ?? []);
      setFinancialLogs(finRes.logs ?? []);
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load logs');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleRetryDueSms = async () => {
    setRetryingSms(true);
    setErrorMsg(null);
    try {
      const res = await SokoApiClient.post<{
        processed: number;
        sent: number;
        deadLettered: number;
      }>('/notifications/sms/retry-due');
      setRetryNotice(
        `Processed ${res.processed} due SMS jobs (${res.sent} sent, ${res.deadLettered} dead-lettered).`,
      );
      await loadAll();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to process SMS retries');
      }
    } finally {
      setRetryingSms(false);
    }
  };

  const handleDownloadCsv = async () => {
    setDownloadingCsv(true);
    setErrorMsg(null);
    try {
      const blob = await SokoApiClient.downloadBlob('/hybrid/analytics/export-csv');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sokokuu-financial-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'CSV export failed');
      }
    } finally {
      setDownloadingCsv(false);
    }
  };

  return (
    <div className="space-y-6">
      {backendOffline && (
        <BackendOfflineBanner locale={locale} onRetry={() => void loadAll()} retrying={loading} />
      )}

      {errorMsg && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg p-3.5 text-xs font-medium text-red-900"
        >
          {errorMsg}
        </div>
      )}

      {/* 1. Live Outbox & Idempotency Telemetry */}
      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isSw
                ? 'Hali ya Outbox, Idempotency & Mizozo (PostgreSQL)'
                : 'PostgreSQL Transactional Outbox & Idempotency Telemetry'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              {isSw
                ? 'Takwimu halisi za domain_outbox_events, idempotency_keys na leja zenye mizozo.'
                : 'Live database row counts across domain_outbox_events, idempotency_keys, and disputed ledgers.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
          </button>
        </div>

        <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="border border-slate-200 rounded-md p-3.5">
            <div className="text-xs text-slate-500">Idempotency Keys</div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {retention ? retention.totalIdempotencyKeys.toLocaleString('en-US') : '—'}
            </div>
          </div>
          <div className="border border-slate-200 rounded-md p-3.5">
            <div className="text-xs text-slate-500">Pending Outbox</div>
            <div className="text-xl font-bold font-mono tabular-nums text-emerald-800 mt-1">
              {retention ? retention.pendingOutboxCount.toLocaleString('en-US') : '—'}
            </div>
          </div>
          <div className="border border-slate-200 rounded-md p-3.5">
            <div className="text-xs text-slate-500">Dead-Letter Outbox</div>
            <div className="text-xl font-bold font-mono tabular-nums text-red-700 mt-1">
              {retention ? retention.deadLetterOutboxCount.toLocaleString('en-US') : '—'}
            </div>
          </div>
          <div className="border border-slate-200 rounded-md p-3.5">
            <div className="text-xs text-slate-500">Disputed Cash Ledgers</div>
            <div className="text-xl font-bold font-mono tabular-nums text-amber-800 mt-1">
              {retention ? retention.disputedLedgersCount.toLocaleString('en-US') : '—'}
            </div>
          </div>
        </div>
      </section>

      {/* 2. Live Outbound NextSMS Delivery Queue */}
      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isSw
                ? 'Kumbukumbu ya Utumaji wa NextSMS (sms_delivery_logs)'
                : 'Outbound NextSMS Delivery Queue (sms_delivery_logs)'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              {isSw
                ? 'Orodha halisi ya jumbe fupi zilizotumwa au zinazosubiri marudio.'
                : 'Live delivery tracking and exponential backoff retry queue from PostgreSQL.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleRetryDueSms()}
            disabled={retryingSms}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-emerald-800 rounded-md hover:bg-emerald-900 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {retryingSms
                ? isSw
                  ? 'Inarudia...'
                  : 'Retrying...'
                : isSw
                  ? 'Rudia SMS Zilizoshindwa'
                  : 'Process Due SMS Retries'}
            </span>
          </button>
        </div>

        {retryNotice && (
          <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-200 text-xs font-mono text-emerald-900">
            {retryNotice}
          </div>
        )}

        <div className="p-4">
          {smsLogs.length === 0 ? (
            <EmptyStateCard
              locale={locale}
              titleSw="Hakuna kumbukumbu za NextSMS bado"
              titleEn="No NextSMS delivery logs recorded yet"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                    <th className="py-2 px-3">MSISDN</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Attempts</th>
                    <th className="py-2 px-3">Last Error</th>
                    <th className="py-2 px-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono">
                  {smsLogs.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70">
                      <td className="py-2 px-3 text-slate-900">{row.recipientPhoneE164}</td>
                      <td className="py-2 px-3 font-semibold text-emerald-800">{row.status}</td>
                      <td className="py-2 px-3">
                        {row.attemptCount}/{row.maxAttempts}
                      </td>
                      <td className="py-2 px-3 text-slate-500">{row.lastError ?? '—'}</td>
                      <td className="py-2 px-3 text-slate-500">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* 3. Financial Audit Logs & Authentic UTF-8 BOM Swahili CSV Exporter */}
      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isSw
                ? 'Leja ya Ukaguzi wa Fedha & CSV ya Kiswahili'
                : 'Financial Audit Ledger & Swahili Split Revenue CSV Exporter'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              {isSw
                ? 'Hupakua faili halisi la UTF-8 BOM CSV moja kwa moja kutoka seva ya NestJS.'
                : 'Streams an authoritative UTF-8 BOM CSV directly from PostgreSQL via GET /hybrid/analytics/export-csv.'}
            </p>
          </div>
          <button
            type="button"
            disabled={downloadingCsv}
            onClick={() => void handleDownloadCsv()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {downloadingCsv
                ? isSw
                  ? 'Inapakua...'
                  : 'Downloading...'
                : isSw
                  ? 'Pakua CSV ya Kiswahili'
                  : 'Download Swahili CSV'}
            </span>
          </button>
        </div>

        <div className="p-4">
          {financialLogs.length === 0 ? (
            <EmptyStateCard
              locale={locale}
              titleSw="Hakuna kumbukumbu za ukaguzi wa fedha bado"
              titleEn="No financial audit logs recorded yet"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                    <th className="py-2 px-3">Event Type</th>
                    <th className="py-2 px-3">Transition</th>
                    <th className="py-2 px-3 text-right">Amount (TZS)</th>
                    <th className="py-2 px-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono">
                  {financialLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="py-2 px-3 font-semibold text-slate-900">{log.eventType}</td>
                      <td className="py-2 px-3 text-slate-600">
                        {log.previousState ?? 'INIT'} → {log.newState ?? 'OK'}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-emerald-800">
                        {log.amountTzs.toLocaleString('en-US')}
                      </td>
                      <td className="py-2 px-3 text-slate-500">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
