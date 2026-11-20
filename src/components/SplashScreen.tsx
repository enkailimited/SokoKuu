import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../data/i18n';
import { SokoKuuAppIcon } from './BrandLogo';

interface SplashScreenProps {
  locale: Locale;
  isReady?: boolean;
  onFinish: () => void;
}

const MIN_SPLASH_MS = 3950;
const REDUCED_SPLASH_MS = 450;
const EXIT_DURATION_MS = 420;
const MAX_WAIT_MS = 5000;

export function SplashScreen({ locale, isReady = true, onFinish }: SplashScreenProps) {
  const [minElapsed, setMinElapsed] = useState(false);
  const [maxElapsed, setMaxElapsed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const notifiedDoneRef = useRef(false);

  const isSw = locale === 'sw';

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
      prefersReduced ? REDUCED_SPLASH_MS : MIN_SPLASH_MS
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

  const handleSkip = () => {
    if (!exiting) {
      setExiting(true);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={isSw ? 'Inafungua SokoKuu TZ' : 'Loading SokoKuu TZ'}
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white px-6 transition-all duration-[420ms] ease-out ${
        exiting
          ? 'opacity-0 scale-[1.015] pointer-events-none'
          : 'opacity-100 scale-100'
      }`}
    >
      {/* Subtle daylight ambient wash behind the centered app icon */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(2,188,55,0.08)_0%,rgba(0,84,166,0.03)_34%,transparent_68%)]"
      />

      {/* Centered authentic App Icon only (no text wordmark or tagline): stroke draw -> fill reveal */}
      <div className="sk-splash-icon-frame relative z-10 flex items-center justify-center p-4">
        <SokoKuuAppIcon sizeClass="w-36 h-36 sm:w-44 sm:h-44" animated />
      </div>

      {/* Subtle accessible skip control */}
      <button
        type="button"
        onClick={handleSkip}
        className="sk-splash-skip absolute bottom-8 min-h-[44px] px-5 py-2 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded-lg"
      >
        {isSw ? 'Endelea' : 'Continue'}
      </button>
    </div>
  );
}

export default SplashScreen;
