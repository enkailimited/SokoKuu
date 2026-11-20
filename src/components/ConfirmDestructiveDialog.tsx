import { useEffect, type ReactNode } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import type { Locale } from '../data/i18n';

/**
 * Shared destructive-action confirmation sheet.
 * Uses the standard SokoKuu dialog shell (bottom sheet on phones, centered
 * card on larger screens) and a red confirm button for irreversible actions.
 */
export function ConfirmDestructiveDialog({
  locale = 'sw',
  titleSw,
  titleEn,
  descriptionSw,
  descriptionEn,
  confirmLabelSw,
  confirmLabelEn,
  isBusy = false,
  children,
  onConfirm,
  onCancel,
}: {
  locale?: Locale;
  titleSw: string;
  titleEn: string;
  descriptionSw: string;
  descriptionEn: string;
  confirmLabelSw?: string;
  confirmLabelEn?: string;
  isBusy?: boolean;
  children?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const isSw = locale === 'sw';

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  return (
    <div
      className="sk-dialog-overlay backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="sk-dialog-panel"
        role="alertdialog"
        aria-modal="true"
        aria-label={isSw ? titleSw : titleEn}
      >
        <div className="shrink-0 px-5 py-3.5 border-b border-slate-100 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-600" aria-hidden="true" />
          </div>
          <h3 className="text-sm font-bold text-slate-900">{isSw ? titleSw : titleEn}</h3>
        </div>

        <div className="sk-dialog-body p-5 space-y-3">
          <p className="text-xs leading-relaxed text-slate-700">
            {isSw ? descriptionSw : descriptionEn}
          </p>
          {children}
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-slate-100 bg-white flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            {isSw ? 'Ghairi' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isBusy}
            className="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            {isBusy && <LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            <span>
              {isBusy
                ? isSw
                  ? 'Inatekelezwa...'
                  : 'Working...'
                : isSw
                  ? confirmLabelSw ?? 'Futa'
                  : confirmLabelEn ?? 'Delete'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
