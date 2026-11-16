import { useCallback, useEffect, useState } from 'react';
import {
  formatTzsAmount,
  SOKOKUU_TRANSLATIONS,
  type SokoKuuLocale,
  type SokoKuuPhraseDictionary,
} from '../data/sokokuuTranslations';

const LOCALE_STORAGE_KEY = 'sokokuu_offline_locale';

export function useSokoKuuI18n(profileFallbackLocale: SokoKuuLocale = 'sw') {
  const [locale, setLocaleState] = useState<SokoKuuLocale>(() => {
    if (typeof window === 'undefined') return profileFallbackLocale;
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === 'en' || stored === 'sw' ? stored : profileFallbackLocale;
  });

  useEffect(() => {
    const onStorageSync = (e: StorageEvent) => {
      if (e.key === LOCALE_STORAGE_KEY && (e.newValue === 'en' || e.newValue === 'sw')) {
        setLocaleState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorageSync);
    return () => window.removeEventListener('storage', onStorageSync);
  }, []);

  const setLocale = useCallback((nextLocale: SokoKuuLocale) => {
    setLocaleState(nextLocale);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    }
  }, []);

  const t = useCallback(
    (key: keyof SokoKuuPhraseDictionary) => SOKOKUU_TRANSLATIONS[locale][key],
    [locale]
  );

  const formatCurrency = useCallback(
    (amountTzs: number) => formatTzsAmount(amountTzs, locale),
    [locale]
  );

  return {
    locale,
    setLocale,
    toggleLocale: () => setLocale(locale === 'sw' ? 'en' : 'sw'),
    t,
    formatCurrency,
  };
}
