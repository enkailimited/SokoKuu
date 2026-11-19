import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { checkBackendHealth } from '../services/sokoApiClient';

export function DashboardOnlineBadge() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const result = await checkBackendHealth();
      if (active) setOnline(result.online);
    };
    void check();
    const timer = window.setInterval(() => void check(), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const statusLabel =
    online === true
      ? 'SokoKuu backend online'
      : online === false
        ? 'SokoKuu backend offline'
        : 'Checking SokoKuu backend';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={statusLabel}
      title={statusLabel}
      className={`fixed bottom-5 left-5 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border bg-white/95 shadow-lg backdrop-blur-sm ${
        online === false
          ? 'border-amber-300 text-amber-600'
          : online === true
            ? 'border-emerald-300 text-emerald-600'
            : 'border-slate-300 text-slate-400'
      }`}
    >
      {online === false ? (
        <WifiOff className="h-5 w-5" aria-hidden="true" />
      ) : (
        <Wifi className="h-5 w-5" aria-hidden="true" />
      )}
    </div>
  );
}
