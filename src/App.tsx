import { useCallback, useEffect, useState } from 'react';
import type { Locale } from './data/i18n';
import { DataSaverProvider } from './context/DataSaverContext';
import { HybridModeProvider } from './context/HybridModeContext';
import {
  ROLE_LABELS,
  mapTierToAccountMode,
  type PlatformRole,
  type UserProfile,
} from './types/auth';
import { AuthPortalView } from './components/AuthPortalView';
import { PublicLandingView } from './components/PublicLandingView';
import { BrandedAppBarWithAlerts } from './components/BrandedAppBarWithAlerts';
import { ConsumerDashboardView } from './components/ConsumerDashboardView';
import { RetailerShoppingView, type RetailerTab } from './components/RetailerShoppingView';
import { SokoniCoreEngine } from './components/SokoniCoreEngine';
import { WholesalerOperationsView } from './components/WholesalerOperationsView';
import {
  SupplierDashboardView,
  type SupplierTab,
} from './components/SupplierDashboardView';
import { DashboardOnlineBadge } from './components/DashboardOnlineBadge';
import { MobileDriverReceiptCard } from './components/MobileDriverReceiptCard';
import { SuperAdminDiagnosticsView } from './components/SuperAdminDiagnosticsView';
import { ProfileEditView, SettingsView } from './components/AccountPages';
import { BackendOfflineBanner } from './components/DatabaseStateBanner';
import { OfflineIndicator } from './components/OfflineIndicator';
import { SokoApiClient, isSokoNetworkError } from './services/sokoApiClient';

type ActiveAccountPage = 'DASHBOARD' | 'PROFILE' | 'SETTINGS';

const ACTIVE_USER_STORAGE_KEY = 'sokokuu_active_user_v1';
const LOCALE_STORAGE_KEY = 'sokokuu_locale_v1';
const RETAILER_TAB_STORAGE_KEY = 'sokokuu_retailer_tab_v1';
const WHOLESALER_TAB_STORAGE_KEY = 'sokokuu_wholesaler_tab_v1';
const SUPPLIER_TAB_STORAGE_KEY = 'sokokuu_supplier_tab_v1';

export type WholesalerTab = 'operations' | 'sokoni';

export default function App() {
  return (
    <DataSaverProvider>
      <HybridModeProvider>
        <SinglePlatformShell />
      </HybridModeProvider>
    </DataSaverProvider>
  );
}

function SinglePlatformShell() {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved === 'en' || saved === 'sw') {
        return saved;
      }
    } catch {
      // ignore storage errors
    }
    return 'sw';
  });

  const setLocale = (nextOrUpdater: Locale | ((prev: Locale) => Locale)) => {
    setLocaleState((prev) => {
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(() => {
    if (!SokoApiClient.hasAccessToken()) return null;
    try {
      const raw = window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as UserProfile;
      }
    } catch {
      // ignore storage errors
    }
    return null;
  });

  const [activePage, setActivePage] = useState<ActiveAccountPage>('DASHBOARD');
  const [showAuthPortal, setShowAuthPortal] = useState(false);
  const [retailerTab, setRetailerTabState] = useState<RetailerTab>(() => {
    try {
      const savedTab = window.localStorage.getItem(RETAILER_TAB_STORAGE_KEY);
      if (
        savedTab === 'pos_register' ||
        savedTab === 'inventory_shelf' ||
        savedTab === 'core_engine' ||
        savedTab === 'proximity_map'
      ) {
        return savedTab;
      }
    } catch {
      // ignore storage errors
    }
    return 'pos_register';
  });

  const setRetailerTab = (tab: RetailerTab) => {
    setRetailerTabState(tab);
    try {
      window.localStorage.setItem(RETAILER_TAB_STORAGE_KEY, tab);
    } catch {
      // ignore storage errors
    }
  };

  const [wholesalerTab, setWholesalerTabState] = useState<WholesalerTab>(() => {
    try {
      const savedTab = window.localStorage.getItem(WHOLESALER_TAB_STORAGE_KEY);
      if (savedTab === 'operations' || savedTab === 'sokoni') {
        return savedTab;
      }
    } catch {
      // ignore storage errors
    }
    return 'operations';
  });

  const setWholesalerTab = (tab: WholesalerTab) => {
    setWholesalerTabState(tab);
    try {
      window.localStorage.setItem(WHOLESALER_TAB_STORAGE_KEY, tab);
    } catch {
      // ignore storage errors
    }
  };

  const [supplierTab, setSupplierTabState] = useState<SupplierTab>(() => {
    try {
      const savedTab = window.localStorage.getItem(SUPPLIER_TAB_STORAGE_KEY);
      if (
        savedTab === 'warehouse' ||
        savedTab === 'publish' ||
        savedTab === 'orders' ||
        savedTab === 'reports'
      ) {
        return savedTab;
      }
    } catch {
      // ignore storage errors
    }
    return 'warehouse';
  });

  const setSupplierTab = (tab: SupplierTab) => {
    setSupplierTabState(tab);
    try {
      window.localStorage.setItem(SUPPLIER_TAB_STORAGE_KEY, tab);
    } catch {
      // ignore storage errors
    }
  };

  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [adminMobileSidebarOpen, setAdminMobileSidebarOpen] = useState<boolean>(false);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState<boolean>(false);
  const [retailerMapEnabled, setRetailerMapEnabled] = useState<boolean>(false);
  const [sessionBackendOffline, setSessionBackendOffline] = useState<boolean>(false);
  const [hydratingSession, setHydratingSession] = useState<boolean>(false);
  const [focusedOrder, setFocusedOrder] = useState<{
    orderRef: string | null;
    orderId: string | null;
  } | null>(null);

  const persistActiveProfile = (profile: UserProfile | null) => {
    setActiveProfile(profile);
    try {
      if (profile) {
        window.localStorage.setItem(ACTIVE_USER_STORAGE_KEY, JSON.stringify(profile));
      } else {
        window.localStorage.removeItem(ACTIVE_USER_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  };

  const hydrateSessionFromApi = useCallback(async () => {
    if (!SokoApiClient.hasAccessToken()) {
      persistActiveProfile(null);
      return;
    }

    setHydratingSession(true);
    try {
      const me = await SokoApiClient.get<{
        user?: {
          id: string;
          phoneE164: string;
          fullName: string;
          role: PlatformRole;
        };
        businessProfile?: {
          id: string;
          smsShortCode: string;
          businessName: string;
          tier: string;
          ward: string;
          district: string;
          streetAddress: string;
          geospatialMapEnabled: boolean;
          isPlatformManaged: boolean;
          logoCdnUrl?: string | null;
        } | null;
        tenantContext?: {
          businessId?: string | null;
          tier?: string | null;
        } | null;
      }>('/auth/me');

      setSessionBackendOffline(false);

      if (!me?.user?.role) {
        SokoApiClient.clearTokens();
        persistActiveProfile(null);
        return;
      }

      const role = me.user.role;
      const bp = me.businessProfile;
      const tier = bp?.tier ?? me.tenantContext?.tier ?? null;
      const geoEnabled = Boolean(bp?.geospatialMapEnabled);

      setRetailerMapEnabled(geoEnabled);
      if (role === 'RETAILER' && !geoEnabled && retailerTab === 'proximity_map') {
        setRetailerTab('core_engine');
      }

      setActiveProfile((prev) => {
        const next: UserProfile = {
          userId: me.user!.id,
          businessId: bp?.id ?? me.tenantContext?.businessId ?? null,
          smsShortCode: bp?.smsShortCode ?? null,
          tier,
          geospatialMapEnabled: geoEnabled,
          isPlatformManaged: Boolean(bp?.isPlatformManaged),
          fullName: me.user!.fullName,
          phone: me.user!.phoneE164,
          email: prev?.email ?? '',
          businessLabel:
            bp?.businessName ??
            (locale === 'sw' ? ROLE_LABELS[role].sw : ROLE_LABELS[role].en),
          ward: bp?.ward ?? prev?.ward ?? '',
          streetAddress: bp?.streetAddress ?? prev?.streetAddress ?? '',
          shopImageUrl: bp?.logoCdnUrl ?? prev?.shopImageUrl ?? null,
          role,
          mode: mapTierToAccountMode(role, tier),
          smsAlertsEnabled: prev?.smsAlertsEnabled ?? true,
          offlineSmsFallbackEnabled: prev?.offlineSmsFallbackEnabled ?? true,
        };
        try {
          window.localStorage.setItem(ACTIVE_USER_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setSessionBackendOffline(true);
      } else {
        // Unauthorized / expired refresh session -> force clean login
        SokoApiClient.clearTokens();
        persistActiveProfile(null);
      }
    } finally {
      setHydratingSession(false);
    }
  }, [locale, retailerTab]);

  useEffect(() => {
    void hydrateSessionFromApi();
  }, [hydrateSessionFromApi]);

  useEffect(() => {
    const handleQuotaExceeded = () => setMapsQuotaExceeded(true);
    const syncGeoPermission = async () => {
      if (activeProfile?.role !== 'RETAILER' || !SokoApiClient.hasAccessToken()) {
        return;
      }
      try {
        await SokoApiClient.get(
          '/geospatial/stores-map-matrix?originLat=-6.809&originLng=39.255&maxDistanceMeters=1000'
        );
        setRetailerMapEnabled(true);
      } catch (err) {
        if (!isSokoNetworkError(err)) {
          setRetailerMapEnabled(false);
          if (retailerTab === 'proximity_map') {
            setRetailerTab('core_engine');
          }
        }
      }
    };

    void syncGeoPermission();

    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    window.addEventListener('sokokuu:geospatial-toggle-updated', syncGeoPermission);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
      window.removeEventListener('sokokuu:geospatial-toggle-updated', syncGeoPermission);
    };
  }, [activeProfile?.role, retailerTab]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleSignIn = (profile: UserProfile) => {
    persistActiveProfile(profile);
    setRetailerMapEnabled(Boolean(profile.geospatialMapEnabled));
    setSessionBackendOffline(false);
    setActivePage('DASHBOARD');
    setRetailerTab('pos_register');
    setSupplierTab('warehouse');
    setMobileMenuOpen(false);
    setAdminMobileSidebarOpen(false);
  };

  const handleLogout = async () => {
    try {
      await SokoApiClient.post('/auth/logout');
    } catch {
      // ignore offline errors
    }
    SokoApiClient.clearTokens();
    persistActiveProfile(null);
    setActivePage('DASHBOARD');
    setMobileMenuOpen(false);
    setAdminMobileSidebarOpen(false);
  };

  const handleSaveProfile = (updated: UserProfile) => {
    persistActiveProfile(updated);
  };

  const handleOpenDeepLink = useCallback((deepLink: string) => {
    const queryIndex = deepLink.indexOf('?');
    const path = queryIndex >= 0 ? deepLink.slice(0, queryIndex) : deepLink;
    const params =
      queryIndex >= 0 ? new URLSearchParams(deepLink.slice(queryIndex + 1)) : new URLSearchParams();

    setActivePage('DASHBOARD');

    if (path.includes('/dashboard/supplier')) {
      const supplierTabParam = params.get('tab');
      setSupplierTabState(
        supplierTabParam === 'warehouse' ||
          supplierTabParam === 'publish' ||
          supplierTabParam === 'orders' ||
          supplierTabParam === 'reports'
          ? supplierTabParam
          : 'orders'
      );
    } else if (path.includes('/dashboard/wholesaler')) {
      setWholesalerTabState('operations');
    } else if (path.includes('/dashboard/retailer')) {
      setRetailerTabState('core_engine');
    }

    // A notification that points at a specific order must land the operator on
    // that order row so they can receive, dispatch or resolve it immediately.
    const orderRef = params.get('orderRef');
    const orderId = params.get('orderId');
    setFocusedOrder({ orderRef, orderId });
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; deepLink?: string } | undefined;
      if (data?.type === 'SOKOKUU_NOTIFICATION_OPEN' && typeof data.deepLink === 'string') {
        handleOpenDeepLink(data.deepLink);
      }
    };
    navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage);
    };
  }, [handleOpenDeepLink]);

  if (!activeProfile) {
    if (!showAuthPortal) {
      return (
        <PublicLandingView
          locale={locale}
          onToggleLocale={() => setLocale((prev) => (prev === 'en' ? 'sw' : 'en'))}
          onEnter={() => setShowAuthPortal(true)}
        />
      );
    }
    return (
      <AuthPortalView
        locale={locale}
        onToggleLocale={() => setLocale((prev) => (prev === 'en' ? 'sw' : 'en'))}
        onSignIn={handleSignIn}
      />
    );
  }

  return (
    <div className="min-h-dvh bg-white text-slate-900 flex flex-col overflow-x-hidden sk-safe-x">
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <BrandedAppBarWithAlerts
        locale={locale}
        onToggleLocale={() => setLocale((prev) => (prev === 'en' ? 'sw' : 'en'))}
        activeProfile={activeProfile}
        activePage={activePage}
        onSelectPage={setActivePage}
        retailerTab={retailerTab}
        onSelectRetailerTab={setRetailerTab}
        wholesalerTab={wholesalerTab}
        onSelectWholesalerTab={setWholesalerTab}
        supplierTab={supplierTab}
        onSelectSupplierTab={setSupplierTab}
        retailerMapEnabled={retailerMapEnabled}
        onLogout={handleLogout}
        mobileMenuOpen={mobileMenuOpen}
        onToggleMobileMenu={() => setMobileMenuOpen((prev) => !prev)}
        adminMobileSidebarOpen={adminMobileSidebarOpen}
        onToggleAdminMobileSidebar={() => setAdminMobileSidebarOpen((prev) => !prev)}
        onOpenDeepLink={handleOpenDeepLink}
      />

      {sessionBackendOffline && (
        <div className="px-4 sm:px-6 pt-4 max-w-6xl w-full mx-auto">
          <BackendOfflineBanner
            locale={locale}
            onRetry={() => void hydrateSessionFromApi()}
            retrying={hydratingSession}
          />
        </div>
      )}

      <main
        className={
          activeProfile.role === 'SUPER_ADMIN' && activePage === 'DASHBOARD'
            ? 'flex-1 w-full flex flex-col min-w-0'
            : 'flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6 min-w-0 sk-safe-bottom'
        }
      >
        {activePage === 'DASHBOARD' && (
          <>
            {activeProfile.role === 'CONSUMER' && (
              <ConsumerDashboardView locale={locale} consumerWard={activeProfile.ward} />
            )}
            {activeProfile.role === 'RETAILER' && (
              <RetailerShoppingView
                locale={locale}
                activeTab={retailerTab}
                userRole="RETAILER"
                userTier={activeProfile.tier}
                businessId={activeProfile.businessId}
                onRedirectToWorkspace={() => setRetailerTab('core_engine')}
              />
            )}
            {activeProfile.role === 'WHOLESALER' &&
              (wholesalerTab === 'sokoni' ? (
                <SokoniCoreEngine
                  locale={locale}
                  userRole="WHOLESALER"
                  userTier={activeProfile.tier}
                  businessId={activeProfile.businessId}
                />
              ) : (
                <WholesalerOperationsView
                  locale={locale}
                  businessId={activeProfile.businessId}
                  focusOrder={focusedOrder}
                />
              ))}
            {activeProfile.role === 'SUPPLIER' && (
              <SupplierDashboardView
                locale={locale}
                activeTab={supplierTab}
                onTabChange={setSupplierTab}
                businessId={activeProfile.businessId}
                sellerPhone={activeProfile.phone}
                focusOrder={focusedOrder}
              />
            )}
            {activeProfile.role === 'DRIVER' && (
              <MobileDriverReceiptCard locale={locale} />
            )}
            {activeProfile.role === 'SUPER_ADMIN' && (
              <SuperAdminDiagnosticsView
                locale={locale}
                authority={activeProfile.role}
                mobileSidebarOpen={adminMobileSidebarOpen}
                onMobileSidebarOpenChange={setAdminMobileSidebarOpen}
                focusOrder={focusedOrder}
              />
            )}
          </>
        )}

        {activePage === 'PROFILE' && (
          <ProfileEditView
            locale={locale}
            profile={activeProfile}
            onSaveProfile={handleSaveProfile}
            onBackToDashboard={() => setActivePage('DASHBOARD')}
            onLogout={handleLogout}
          />
        )}

        {activePage === 'SETTINGS' && (
          <SettingsView
            locale={locale}
            onSetLocale={setLocale}
            profile={activeProfile}
            onSaveProfile={handleSaveProfile}
            onBackToDashboard={() => setActivePage('DASHBOARD')}
          />
        )}
      </main>
      {activePage === 'DASHBOARD' && <DashboardOnlineBadge />}
      <OfflineIndicator locale={locale} />
    </div>
  );
}
