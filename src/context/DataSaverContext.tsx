import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface DataSaverContextValue {
  isLowDataModeActive: boolean;
  setLowDataMode: (enabled: boolean) => void;
  toggleLowDataMode: () => void;
  estimatedSavedKb: number;
  recordSavedBytes: (kb: number) => void;
}

const DataSaverContext = createContext<DataSaverContextValue | undefined>(undefined);

const STORAGE_KEY = 'sokokuu_low_data_mode';

export function DataSaverProvider({ children }: { children: ReactNode }) {
  const [isLowDataModeActive, setIsLowDataModeActive] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved === 'true';
    const navConn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    return Boolean(navConn?.saveData);
  });

  const [estimatedSavedKb, setEstimatedSavedKb] = useState<number>(0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, String(isLowDataModeActive));
    }
  }, [isLowDataModeActive]);

  const setLowDataMode = (enabled: boolean) => setIsLowDataModeActive(enabled);
  const toggleLowDataMode = () => setIsLowDataModeActive((prev) => !prev);
  const recordSavedBytes = (kb: number) => setEstimatedSavedKb((prev) => prev + kb);

  return (
    <DataSaverContext.Provider
      value={{
        isLowDataModeActive,
        setLowDataMode,
        toggleLowDataMode,
        estimatedSavedKb,
        recordSavedBytes,
      }}
    >
      {children}
    </DataSaverContext.Provider>
  );
}

export function useDataSaver(): DataSaverContextValue {
  const ctx = useContext(DataSaverContext);
  if (!ctx) {
    throw new Error('useDataSaver must be used inside DataSaverProvider');
  }
  return ctx;
}
