import { useEffect, useRef, useState } from 'react';
import { t, type Locale } from '../i18n';
import { SokoKuuAppIcon } from './BrandLogo';

interface SokoSplashScreenProps {
  locale: Locale;
  isReady?: boolean;
  onFinish: () => void;
}

const MIN_SPLASH_MS = 650;
const REDUCED_SPLASH_MS = 200;
const EXIT_DURATION_MS = 320;
const MAX_WAIT_MS = 5000;

export function SokoSplashScreen({
  locale,
  isReady = true,
  onFinish,
}: SokoSplashScreenProps) {
  const [minElapsed, setMinElapsed] = useState(false);
  const [maxElapsed, setMaxElapsed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const notifiedDoneRef = useRef(false);

  if (typeof window !== 'undefined' && !exiting && !notifiedDoneRef.current) {
    window.__sokoKuuSplashActive = true;
  }

  const notifySplashDone = () => {
    if (notifiedDoneRef.current || typeof window === 'undefined') return;
    notifiedDoneRef.current = true;
    window.__sokoKuuSplashActive = false;
    window.dispatchEvent(new Event('sokokuu:splash-done'));
  };

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const minTimer = window.setTimeout(
      () => setMinElapsed(true),
      prefersReduced ? REDUCED_SPLASH_MS : MIN_SPLASH_MS,
    );
    const maxTimer = window.setTimeout(() => setMaxElapsed(true), MAX_WAIT_MS);

    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(maxTimer);
      if (typeof window !== 'undefined') {
        window.__sokoKuuSplashActive = false;
      }
    };
  }, []);

  useEffect(() => {
    if (exiting) return;
    if ((minElapsed && isReady) || maxElapsed) {
      setExiting(true);
    }
  }, [exiting, minElapsed, isReady, maxElapsed]);

  useEffect(() => {
    if (!exiting) return;
    notifySplashDone();
    const exitTimer = window.setTimeout(onFinish, EXIT_DURATION_MS);
    return () => window.clearTimeout(exitTimer);
  }, [exiting, onFinish]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exiting) {
        setExiting(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exiting]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t(locale, 'splash.loading')}
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white px-6 transition-all duration-300 ease-out ${
        exiting ? 'opacity-0 scale-[1.015] pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(21,172,73,0.07)_0%,rgba(0,84,166,0.04)_38%,transparent_72%)]"
      />

      <div className="relative z-10 flex flex-col items-center text-center gap-4">
        <div className="p-3 rounded-3xl bg-white border border-slate-100 shadow-sm">
          <SokoKuuAppIcon sizeClass="w-24 h-24 sm:w-28 sm:h-28" animated />
        </div>

        <div className="space-y-1">
          <div className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-none select-none">
            <span className="text-[#0054A6]">Soko</span>
            <span className="text-[#15AC49]">Kuu</span>
          </div>
          <p className="text-xs sm:text-sm font-semibold tracking-wide text-[#0054A6]">
            {t(locale, 'splash.tagline')}
          </p>
        </div>

        <div className="mt-3 w-44 h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
          <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-[#0054A6] to-[#15AC49] animate-[sk-splash-bar_1.1s_ease-in-out_infinite]" />
        </div>

        <p className="text-[11px] font-medium text-slate-500">{t(locale, 'splash.loading')}</p>
      </div>

      <button
        type="button"
        onClick={() => !exiting && setExiting(true)}
        className="absolute bottom-8 min-h-[44px] px-5 py-2 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15AC49] rounded-lg"
      >
        {t(locale, 'splash.continueBtn')}
      </button>
    </div>
  );
}

export default SokoSplashScreen;
