import { Inbox, RefreshCw, WifiOff } from 'lucide-react';
import type { Locale } from '../data/i18n';

export function BackendOfflineBanner({
  locale,
  onRetry,
  retrying = false,
  detail,
}: {
  locale: Locale;
  onRetry?: () => void;
  retrying?: boolean;
  detail?: string | null;
}) {
  const isSw = locale === 'sw';
  return (
    <div
      role="alert"
      className="border border-red-200 bg-red-50 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3"
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0">
          <WifiOff className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="space-y-0.5 min-w-0">
          <div className="text-xs sm:text-sm font-bold text-red-900">
            Backend Offline — Connect to NestJS API
          </div>
          <p className="text-xs text-red-800">
            {isSw
              ? 'Seva ya SokoKuu (PostgreSQL / NestJS) haipatikani kwa sasa. Unganisha seva kisha jaribu tena.'
              : 'Unable to reach the live SokoKuu NestJS / PostgreSQL backend. Start or connect the API server and retry.'}
          </p>
          {detail && (
            <div className="text-[11px] font-mono text-red-700 break-all">{detail}</div>
          )}
        </div>
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="min-h-[38px] px-3.5 py-1.5 text-xs font-semibold text-red-800 bg-white border border-red-300 rounded-md hover:bg-red-100 disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>{isSw ? 'Jaribu Tena' : 'Retry Connection'}</span>
        </button>
      )}
    </div>
  );
}

export function EmptyStateCard({
  locale,
  titleSw,
  titleEn,
  descriptionSw,
  descriptionEn,
}: {
  locale: Locale;
  titleSw?: string;
  titleEn?: string;
  descriptionSw?: string;
  descriptionEn?: string;
}) {
  const isSw = locale === 'sw';
  return (
    <div className="border border-dashed border-slate-200 bg-slate-50/70 rounded-lg p-8 text-center space-y-2">
      <div className="w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-400 flex items-center justify-center mx-auto">
        <Inbox className="w-5 h-5" aria-hidden="true" />
      </div>
      <div className="text-sm font-semibold text-slate-800">
        {isSw ? titleSw ?? 'Hakuna rekodi bado' : titleEn ?? 'No records yet'}
      </div>
      <p className="text-xs text-slate-500 max-w-md mx-auto">
        {isSw
          ? descriptionSw ??
            'Hakuna data iliyohifadhiwa kwenye PostgreSQL kwa sehemu hii bado.'
          : descriptionEn ??
            'No records exist in PostgreSQL for this view yet.'}
      </p>
    </div>
  );
}
