import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import type { Locale } from '../data/i18n';

export function OfflineIndicator({ locale = 'sw' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg border border-amber-500"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>
        {isSw
          ? 'Hali ya Nje ya Mtandao.'
          : 'Offline Mode.'}
      </span>
    </div>
  );
}
