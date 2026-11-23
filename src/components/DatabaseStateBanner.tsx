import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import type { Locale } from '../data/i18n';

/**
 * SokoKuu is an offline-first PWA. Backend availability is communicated by the
 * compact API status badge, so no intrusive "backend offline" banner is shown.
 * Call sites are kept intact so retry handlers and offline caches still work.
 */
export function BackendOfflineBanner(_props: {
  locale: Locale;
  onRetry?: () => void;
  retrying?: boolean;
  detail?: string | null;
}) {
  return null;
}

export function EmptyStateCard({
  locale,
  titleSw,
  titleEn,
  descriptionSw,
  descriptionEn,
  action,
}: {
  locale: Locale;
  titleSw?: string;
  titleEn?: string;
  descriptionSw?: string;
  descriptionEn?: string;
  action?: ReactNode;
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
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
