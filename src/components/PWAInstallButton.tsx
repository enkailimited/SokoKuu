import { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import type { Locale } from '../data/i18n';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton({ locale = 'sw' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 sm:px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
      >
        <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="sm:hidden">{isSw ? 'Sakinisha' : 'Install'}</span>
        <span className="hidden sm:inline">{isSw ? 'Sakinisha App' : 'Install App'}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Smartphone className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
          <span className="sm:hidden">{isSw ? 'iOS' : 'iOS'}</span>
          <span className="hidden sm:inline">{isSw ? 'Weka Kwenye iPhone' : 'Install on iOS'}</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-sm rounded-xl bg-white border border-slate-200 p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">
                  {isSw ? 'Sakinisha SokoKuu Kwenye iOS' : 'Install SokoKuu on iPhone / iPad'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded text-slate-400 hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {isSw ? (
                  <>
                    1. Gusa kitufe cha <strong>Share</strong> kwenye Safari.<br />
                    2. Chagua <strong>Add to Home Screen</strong> kutumia POS hata bila intaneti.
                  </>
                ) : (
                  <>
                    1. Tap the <strong>Share</strong> button in the Safari toolbar.<br />
                    2. Select <strong>Add to Home Screen</strong> for full offline POS access.
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
              >
                {isSw ? 'Funga' : 'Close'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
