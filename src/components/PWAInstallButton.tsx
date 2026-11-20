import { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import type { Locale } from '../data/i18n';
import { usePWAInstall } from '../hooks/usePWAInstall';

type InstallGuide = 'chrome' | 'ios' | 'inapp' | 'generic';

function detectInstallGuide(isIOS: boolean): InstallGuide {
  if (typeof window === 'undefined') return 'generic';
  const ua = window.navigator.userAgent.toLowerCase();
  const isInApp = /whatsapp|facebook|fbav|fb_iab|instagram|telegram|messenger|twitter|line\//.test(ua);
  if (isInApp) return 'inapp';
  const isAppleMobile =
    isIOS ||
    /iphone|ipad|ipod/.test(ua) ||
    (/macintosh/.test(ua) &&
      ((window.navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints ?? 0) > 1);
  if (isAppleMobile) return 'ios';
  if (/chrome\/|crios/.test(ua) && !/edg|opr|opera|samsungbrowser|vivaldi/.test(ua)) return 'chrome';
  return 'generic';
}

function GuideBody({ guide, isSw }: { guide: InstallGuide; isSw: boolean }) {
  if (guide === 'ios') {
    return isSw ? (
      <>
        1. Fungua site kwenye <strong>Safari</strong> (si Chrome wala browser ya WhatsApp/Facebook).<br />
        2. Gusa kitufe cha <strong>Share</strong> (□↑).<br />
        3. Chagua <strong>Add to Home Screen</strong> → <strong>Add</strong>.
      </>
    ) : (
      <>
        1. Open this site in <strong>Safari</strong> (not Chrome or an in-app browser).<br />
        2. Tap the <strong>Share</strong> button (□↑).<br />
        3. Select <strong>Add to Home Screen</strong> → <strong>Add</strong>.
      </>
    );
  }

  if (guide === 'inapp') {
    return isSw ? (
      <>
        Uko kwenye browser ya ndani (WhatsApp, Facebook, Instagram, n.k.) ambayo haiwezi kusakinisha app.<br />
        1. Gusa <strong>⋮</strong> → <strong>Open in browser</strong> / <strong>Open in Chrome</strong>.<br />
        2. Kwenye Chrome gusa <strong>⋮</strong> → <strong>Install app</strong>.<br />
        3. Kwenye iPhone tuma site kwenye Safari kisha Share → <strong>Add to Home Screen</strong>.
      </>
    ) : (
      <>
        You are using an in-app browser (WhatsApp, Facebook, Instagram, etc.) which cannot install apps.<br />
        1. Tap <strong>⋮</strong> → <strong>Open in browser</strong> / <strong>Open in Chrome</strong>.<br />
        2. In Chrome tap <strong>⋮</strong> → <strong>Install app</strong>.<br />
        3. On iPhone, open in Safari then Share → <strong>Add to Home Screen</strong>.
      </>
    );
  }

  if (guide === 'chrome') {
    return isSw ? (
      <>
        Chrome hakutoa prompt otomatiki kwenye kifaa hiki bado, hivyo tumia menyu yake:<br />
        1. Gusa <strong>⋮</strong> kwenye Chrome (si incognito).<br />
        2. Chagua <strong>Install app</strong> / <strong>Add to Home screen</strong>.<br />
        Kwenye Chrome mpya: <strong>⋮ → Cast, save and share → Install page as app</strong>.<br />
        3. Thibitisha kwa <strong>Install</strong>.<br />
        Kama bado huoni, tembelea SokoKuu mara chache kisha urudi, au ihakikishe uko kwenye Chrome halisi si WhatsApp/Facebook.
      </>
    ) : (
      <>
        Chrome hasn't offered its automatic prompt on this device yet, so use its menu:<br />
        1. Tap <strong>⋮</strong> in Chrome (not incognito).<br />
        2. Select <strong>Install app</strong> / <strong>Add to Home screen</strong>.<br />
        On newer Chrome: <strong>⋮ → Cast, save and share → Install page as app</strong>.<br />
        3. Confirm with <strong>Install</strong>.<br />
        If still missing, visit SokoKuu a few times and come back, or make sure you are in real Chrome, not WhatsApp/Facebook.
      </>
    );
  }

  return isSw ? (
    <>
      Tumia <strong>Chrome</strong> (Android) au <strong>Safari</strong> (iPhone/iPad).<br />
      Chrome: menu <strong>⋮</strong> → <strong>Install app</strong>.<br />
      Safari: Share → <strong>Add to Home Screen</strong>.
    </>
  ) : (
    <>
      Use <strong>Chrome</strong> (Android) or <strong>Safari</strong> (iPhone/iPad).<br />
      Chrome: <strong>⋮</strong> menu → <strong>Install app</strong>.<br />
      Safari: Share → <strong>Add to Home Screen</strong>.
    </>
  );
}

export function PWAInstallButton({ locale = 'sw' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const guide = detectInstallGuide(isIOS);

  if (isInstalled) {
    return null;
  }

  const handleClick = () => {
    if (isInstallable) {
      void install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={isSw ? 'Sakinisha SokoKuu' : 'Install SokoKuu'}
        aria-label={isSw ? 'Sakinisha SokoKuu' : 'Install SokoKuu'}
        className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 sm:px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
      >
        <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="sm:hidden">{isSw ? 'Sakinisha' : 'Install'}</span>
        <span className="hidden sm:inline">{isSw ? 'Sakinisha App' : 'Install App'}</span>
      </button>

      {showGuide && (
        <div
          className="animate-fade-in sk-dialog-overlay"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-t-2xl sm:rounded-xl bg-white border border-slate-200 p-5 shadow-xl space-y-3 max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto sk-safe-bottom overscroll-contain">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Smartphone className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                {isSw ? 'Jinsi ya Kusakinisha SokoKuu' : 'How to Install SokoKuu'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label={isSw ? 'Funga' : 'Close'}
                className="p-1 rounded text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              <GuideBody guide={guide} isSw={isSw} />
            </p>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
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
