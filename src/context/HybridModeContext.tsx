import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ActiveViewChannel = 'WHOLESALE' | 'RETAIL';

interface HybridModeContextValue {
  /**
   * Hali ya sasa ya duka mseto (HYBRID_STORE):
   * - 'WHOLESALE': Niko kama Jumla (inaonyesha magunia 50KG/25KG na katoni kwa maduka ya rejareja)
   * - 'RETAIL': Niko kama Rejareja (inaonyesha vipimo vidogo vya Robo 1/4, Nusu 1/2, Tatu-Robo 3/4)
   */
  activeViewChannel: ActiveViewChannel;
  setViewChannel: (channel: ActiveViewChannel) => void;
  toggleViewChannel: () => void;
}

const HybridModeContext = createContext<HybridModeContextValue | undefined>(undefined);
const STORAGE_KEY = 'sokokuu_hybrid_view_channel';

export function HybridModeProvider({ children }: { children: ReactNode }) {
  const [activeViewChannel, setActiveViewChannel] = useState<ActiveViewChannel>(() => {
    if (typeof window === 'undefined') return 'WHOLESALE';
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'RETAIL' || saved === 'WHOLESALE' ? saved : 'WHOLESALE';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, activeViewChannel);
    }
  }, [activeViewChannel]);

  const setViewChannel = (channel: ActiveViewChannel) => setActiveViewChannel(channel);
  const toggleViewChannel = () =>
    setActiveViewChannel((prev) => (prev === 'WHOLESALE' ? 'RETAIL' : 'WHOLESALE'));

  return (
    <HybridModeContext.Provider
      value={{
        activeViewChannel,
        setViewChannel,
        toggleViewChannel,
      }}
    >
      {children}
    </HybridModeContext.Provider>
  );
}

export function useHybridMode(): HybridModeContextValue {
  const ctx = useContext(HybridModeContext);
  if (!ctx) {
    throw new Error('useHybridMode must be used inside HybridModeProvider');
  }
  return ctx;
}
