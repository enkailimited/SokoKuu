import { useCallback, useEffect, useState } from 'react';
import { Calculator, LayoutDashboard, Settings } from 'lucide-react';
import { t, type Locale } from './i18n';
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
import {
  BrandedAppBarWithAlerts,
  type MerchantNavView,
} from './components/BrandedAppBarWithAlerts';
import { ConsumerDashboardView } from './components/ConsumerDashboardView';
import { type RetailerTab } from './components/RetailerShoppingView';
import { SokoniCoreEngine } from './components/SokoniCoreEngine';
import { WholesalerOperationsView } from './components/WholesalerOperationsView';
import { MerchantWarehouseView } from './components/MerchantWarehouseView';
import {
  SupplierDashboardView,
  type SupplierTab,
} from './components/SupplierDashboardView';
import { MerchantDashboardView } from './components/MerchantDashboardView';
import { InventoryAndUnitManager } from './components/InventoryAndUnitManager';
import { HybridAnalyticsDashboard } from './components/HybridAnalyticsDashboard';
import { FullPageMarketplaceMap } from './components/FullPageMarketplaceMap';
import { DashboardOnlineBadge } from './components/DashboardOnlineBadge';
import { MobileDriverReceiptCard } from './components/MobileDriverReceiptCard';
import { SuperAdminDiagnosticsView } from './components/SuperAdminDiagnosticsView';
import { ProfileEditView, SettingsView } from './components/AccountPages';
import { BackendOfflineBanner } from './components/DatabaseStateBanner';
import { OfflineIndicator } from './components/OfflineIndicator';
import { SokoSplashScreen } from './components/SokoSplashScreen';
import { SokoApiClient, isSokoNetworkError } from './services/sokoApiClient';

type ActiveAccountPage = 'DASHBOARD' | 'PROFILE' | 'SETTINGS';

const ACTIVE_USER_STORAGE_KEY = 'sokokuu_active_user_v1';
const MERCHANT_VIEW_STORAGE_KEY = 'sokokuu_merchant_view_v1';
const SUPPLIER_TAB_STORAGE_KEY = 'sokokuu_supplier_tab_v1';

export type WholesalerTab = 'operations' | 'ghala' | 'sokoni';

const ROLE_THEME_CLASSES: Record<PlatformRole, string> = {
  CONSUMER: 'bg-white text-slate-900',
  RETAILER: 'bg-emerald-50/20 text-slate-900',
  WHOLESALER: 'bg-sky-50/25 text-slate-900',
  SUPPLIER: 'bg-slate-50/60 text-slate-900',
  DRIVER: 'bg-amber-50/25 text-slate-900',
  SUPER_ADMIN: 'bg-slate-50/80 text-slate-900',
};

function normalizeLocale(val?: string | null): Locale {
  return val === 'en' ? 'en' : 'sw';
}

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

  // Locale ALWAYS starts at Kiswahili ('sw') and is hydrated from the user's
  // server-side profile (/auth/me preferredLanguage) — never from localStorage.
  const [locale, setLocaleState] = useState<Locale>('sw');

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const [activePage, setActivePage] = useState<ActiveAccountPage>('DASHBOARD');
  const [showAuthPortal, setShowAuthPortal] = useState(false);

  const [merchantView, setMerchantViewState] = useState<MerchantNavView>(() => {
    try {
      const saved = window.localStorage.getItem(MERCHANT_VIEW_STORAGE_KEY);
      if (
        saved === 'dashboard' ||
        saved === 'sokoni' ||
        saved === 'pos' ||
        saved === 'orders' ||
        saved === 'inventory' ||
        saved === 'warehouse' ||
        saved === 'reports' ||
        saved === 'map'
      ) {
        return saved;
      }
    } catch {
      // ignore storage errors
    }
    return 'dashboard';
  });

  const setMerchantView = (view: MerchantNavView) => {
    setMerchantViewState(view);
    try {
      window.localStorage.setItem(MERCHANT_VIEW_STORAGE_KEY, view);
    } catch {
      // ignore storage errors
    }
  };

  const [retailerTab, setRetailerTab] = useState<RetailerTab>('pos_register');
  const [wholesalerTab, setWholesalerTab] = useState<WholesalerTab>('operations');

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
  const [hydratingSession, setHydratingSession] = useState<boolean>(() =>
    SokoApiClient.hasAccessToken(),
  );
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [focusedOrder, setFocusedOrder] = useState<{
    orderRef: string | null;
    orderId: string | null;
  } | null>(null);
  const [sokoniInitialCatalogId, setSokoniInitialCatalogId] = useState<string | null>(null);

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

  const applyLocale = useCallback(
    (nextOrUpdater: Locale | ((prev: Locale) => Locale)) => {
      setLocaleState((prev) => {
        const next =
          typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;

        if (SokoApiClient.hasAccessToken()) {
          void SokoApiClient.patch<{ preferredLanguage: Locale }>('/auth/preferences', {
            preferredLanguage: next,
          }).catch(() => undefined);

          setActiveProfile((curr) => {
            if (!curr) return curr;
            const updated: UserProfile = {
              ...curr,
              preferredLanguage: next,
              preferredLocale: next,
            };
            try {
              window.localStorage.setItem(
                ACTIVE_USER_STORAGE_KEY,
                JSON.stringify(updated),
              );
            } catch {
              // ignore storage errors
            }
            return updated;
          });
        }

        return next;
      });
    },
    [],
  );

  const hydrateSessionFromApi = useCallback(async () => {
    if (!SokoApiClient.hasAccessToken()) {
      persistActiveProfile(null);
      setHydratingSession(false);
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
          preferredLocale?: string;
          preferredLanguage?: string;
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
        setLocaleState('sw');
        return;
      }

      const role = me.user.role;
      const bp = me.businessProfile;
      const tier = bp?.tier ?? me.tenantContext?.tier ?? null;
      const geoEnabled = Boolean(bp?.geospatialMapEnabled);
      const userLang = normalizeLocale(
        me.user.preferredLanguage ?? me.user.preferredLocale,
      );

      setLocaleState(userLang);
      setRetailerMapEnabled(geoEnabled);
      if (role === 'RETAILER' && !geoEnabled && merchantView === 'map') {
        setMerchantView('dashboard');
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
            (userLang === 'sw' ? ROLE_LABELS[role].sw : ROLE_LABELS[role].en),
          ward: bp?.ward ?? prev?.ward ?? '',
          district: bp?.district ?? prev?.district ?? '',
          streetAddress: bp?.streetAddress ?? prev?.streetAddress ?? '',
          shopImageUrl: bp?.logoCdnUrl ?? prev?.shopImageUrl ?? null,
          role,
          mode: mapTierToAccountMode(role, tier),
          preferredLocale: userLang,
          preferredLanguage: userLang,
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
        SokoApiClient.clearTokens();
        persistActiveProfile(null);
        setLocaleState('sw');
      }
    } finally {
      setHydratingSession(false);
    }
  }, [merchantView]);

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
          '/geospatial/stores-map-matrix?originLat=-6.809&originLng=39.255&maxDistanceMeters=1000',
        );
        setRetailerMapEnabled(true);
      } catch (err) {
        if (!isSokoNetworkError(err)) {
          setRetailerMapEnabled(false);
          if (merchantView === 'map') {
            setMerchantView('dashboard');
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
  }, [activeProfile?.role, merchantView]);

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
    const userLang = normalizeLocale(
      profile.preferredLanguage ?? profile.preferredLocale,
    );
    setLocaleState(userLang);
    persistActiveProfile({
      ...profile,
      preferredLanguage: userLang,
      preferredLocale: userLang,
    });
    setRetailerMapEnabled(Boolean(profile.geospatialMapEnabled));
    setSessionBackendOffline(false);
    setActivePage('DASHBOARD');
    setMerchantView('dashboard');
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
    setLocaleState('sw');
    setActivePage('DASHBOARD');
    setMerchantView('dashboard');
    setMobileMenuOpen(false);
    setAdminMobileSidebarOpen(false);
  };

  const handleSaveProfile = (updated: UserProfile) => {
    persistActiveProfile(updated);
    if (updated.preferredLanguage || updated.preferredLocale) {
      setLocaleState(
        normalizeLocale(updated.preferredLanguage ?? updated.preferredLocale),
      );
    }
  };

  const handleOpenDeepLink = useCallback((deepLink: string) => {
    const queryIndex = deepLink.indexOf('?');
    const path = queryIndex >= 0 ? deepLink.slice(0, queryIndex) : deepLink;
    const params =
      queryIndex >= 0
        ? new URLSearchParams(deepLink.slice(queryIndex + 1))
        : new URLSearchParams();

    setActivePage('DASHBOARD');

    if (path.includes('/dashboard/supplier')) {
      const supplierTabParam = params.get('tab');
      if (supplierTabParam === 'reports') {
        setMerchantView('reports');
        setSupplierTabState('reports');
      } else if (supplierTabParam === 'publish') {
        setMerchantView('pos');
        setSupplierTabState('publish');
      } else if (supplierTabParam === 'warehouse') {
        setMerchantView('warehouse');
        setSupplierTabState('warehouse');
      } else {
        setMerchantView('orders');
        setSupplierTabState('orders');
      }
    } else if (path.includes('/dashboard/wholesaler')) {
      setMerchantView('orders');
      setWholesalerTab('operations');
    } else if (path.includes('/dashboard/retailer')) {
      setMerchantView('orders');
      setRetailerTab('core_engine');
    }

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

  const splashOverlay = showSplash ? (
    <SokoSplashScreen
      locale={locale}
      isReady={!hydratingSession}
      onFinish={() => setShowSplash(false)}
    />
  ) : null;

  if (!activeProfile) {
    if (!showAuthPortal) {
      return (
        <>
          {splashOverlay}
          <div key="stage-landing" className="sk-theme-transition sk-dashboard-crossfade">
            <PublicLandingView
              locale={locale}
              onToggleLocale={() => applyLocale((prev) => (prev === 'en' ? 'sw' : 'en'))}
              onEnter={() => setShowAuthPortal(true)}
            />
          </div>
        </>
      );
    }
    return (
      <>
        {splashOverlay}
        <div key="stage-auth" className="sk-theme-transition sk-dashboard-crossfade">
          <AuthPortalView
            locale={locale}
            onToggleLocale={() => applyLocale((prev) => (prev === 'en' ? 'sw' : 'en'))}
            onSignIn={handleSignIn}
          />
        </div>
      </>
    );
  }

  const isMerchantRole =
    activeProfile.role === 'RETAILER' ||
    activeProfile.role === 'WHOLESALER' ||
    activeProfile.role === 'SUPPLIER';
  const activeDashboardTab =
    activePage !== 'DASHBOARD'
      ? activePage
      : isMerchantRole
        ? `${activeProfile.role}:${merchantView}`
        : activeProfile.role;
  const dashboardTransitionKey = `${activeProfile.role}:${activePage}:${activeDashboardTab}`;
  const isFullBleedAdmin = activeProfile.role === 'SUPER_ADMIN' && activePage === 'DASHBOARD';

  return (
    <div
      key={`stage-shell-${activeProfile.role}`}
      data-role-theme={activeProfile.role}
      className={`min-h-dvh flex flex-col sk-safe-x sk-theme-transition sk-dashboard-crossfade ${ROLE_THEME_CLASSES[activeProfile.role]}`}
    >
      {splashOverlay}
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
        activeProfile={activeProfile}
        activePage={activePage}
        onSelectPage={setActivePage}
        merchantView={merchantView}
        onSelectMerchantView={setMerchantView}
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
          isFullBleedAdmin
            ? 'flex-1 w-full flex flex-col min-w-0'
            : `flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto min-w-0 ${
                isMerchantRole
                  ? 'pb-[calc(6rem+env(safe-area-inset-bottom,0px))]'
                  : 'sk-safe-bottom'
              }`
        }
      >
        <div
          key={dashboardTransitionKey}
          className={
            isFullBleedAdmin
              ? 'flex-1 flex flex-col min-w-0 sk-dashboard-crossfade'
              : 'min-w-0 space-y-6 sk-dashboard-crossfade'
          }
        >
          {activePage === 'DASHBOARD' && (
            <>
              {activeProfile.role === 'CONSUMER' && (
                <ConsumerDashboardView locale={locale} consumerWard={activeProfile.ward} />
              )}

              {/* UNIFIED MERCHANT 3-SCREEN WORKSPACE (RETAILER, WHOLESALER, SUPPLIER) */}
              {isMerchantRole && (
                <>
                  {merchantView === 'dashboard' && (
                    <MerchantDashboardView
                      locale={locale}
                      profile={activeProfile}
                      onOpenSokoni={() => setMerchantView('sokoni')}
                      onOpenOrders={() => setMerchantView('orders')}
                      onOpenInventory={() => setMerchantView('inventory')}
                      onOpenWarehouse={() => setMerchantView('warehouse')}
                      onOpenReports={() => setMerchantView('reports')}
                      onOpenPos={() => setMerchantView('pos')}
                      onSelectOrder={(orderId, orderRef) => {
                        setFocusedOrder({ orderId, orderRef });
                        setMerchantView('orders');
                      }}
                    />
                  )}

                  {merchantView === 'sokoni' && (
                    <SokoniCoreEngine
                      locale={locale}
                      userRole={
                        activeProfile.role as 'RETAILER' | 'WHOLESALER' | 'SUPPLIER'
                      }
                      userTier={activeProfile.tier}
                      businessId={activeProfile.businessId}
                      initialView="BUY"
                      initialGlobalCatalogId={sokoniInitialCatalogId}
                      onClearInitialCatalogFilter={() => setSokoniInitialCatalogId(null)}
                      onBackToDashboard={() => setMerchantView('dashboard')}
                    />
                  )}

                  {merchantView === 'pos' &&
                    (activeProfile.role === 'SUPPLIER' ? (
                      <SupplierDashboardView
                        locale={locale}
                        activeTab="publish"
                        onTabChange={setSupplierTab}
                        businessId={activeProfile.businessId}
                        sellerPhone={activeProfile.phone}
                        focusOrder={focusedOrder}
                      />
                    ) : (
                      <InventoryAndUnitManager
                        locale={locale}
                        activeSection="pos_register"
                        businessId={activeProfile.businessId}
                        userRole={activeProfile.role === 'WHOLESALER' ? 'WHOLESALER' : 'RETAILER'}
                        userTier={activeProfile.tier}
                        onOpenSokoni={(catalogId) => {
                          setSokoniInitialCatalogId(catalogId ?? null);
                          setMerchantView('sokoni');
                        }}
                      />
                    ))}

                  {merchantView === 'orders' &&
                    (activeProfile.role === 'RETAILER' ? (
                      <SokoniCoreEngine
                        locale={locale}
                        userRole="RETAILER"
                        userTier={activeProfile.tier}
                        businessId={activeProfile.businessId}
                        initialView="ORDERS"
                        onBackToDashboard={() => setMerchantView('dashboard')}
                      />
                    ) : activeProfile.role === 'WHOLESALER' ? (
                      <WholesalerOperationsView
                        locale={locale}
                        businessId={activeProfile.businessId}
                        focusOrder={focusedOrder}
                        initialTab="riders"
                      />
                    ) : (
                      <SupplierDashboardView
                        locale={locale}
                        activeTab="orders"
                        onTabChange={setSupplierTab}
                        businessId={activeProfile.businessId}
                        sellerPhone={activeProfile.phone}
                        focusOrder={focusedOrder}
                      />
                    ))}

                  {merchantView === 'inventory' &&
                    (activeProfile.role === 'SUPPLIER' ? (
                      <SupplierDashboardView
                        locale={locale}
                        activeTab="warehouse"
                        onTabChange={setSupplierTab}
                        businessId={activeProfile.businessId}
                        sellerPhone={activeProfile.phone}
                        focusOrder={focusedOrder}
                      />
                    ) : (
                      <InventoryAndUnitManager
                        locale={locale}
                        activeSection="inventory_shelf"
                        businessId={activeProfile.businessId}
                        userRole={activeProfile.role === 'WHOLESALER' ? 'WHOLESALER' : 'RETAILER'}
                        userTier={activeProfile.tier}
                        onOpenSokoni={(catalogId) => {
                          setSokoniInitialCatalogId(catalogId ?? null);
                          setMerchantView('sokoni');
                        }}
                      />
                    ))}

                  {merchantView === 'warehouse' &&
                    (activeProfile.role === 'SUPPLIER' ? (
                      <SupplierDashboardView
                        locale={locale}
                        activeTab="warehouse"
                        onTabChange={setSupplierTab}
                        businessId={activeProfile.businessId}
                        sellerPhone={activeProfile.phone}
                        focusOrder={focusedOrder}
                      />
                    ) : (
                      <MerchantWarehouseView locale={locale} />
                    ))}

                  {merchantView === 'reports' &&
                    (activeProfile.role === 'RETAILER' ? (
                      <HybridAnalyticsDashboard
                        locale={locale}
                        businessId={activeProfile.businessId}
                      />
                    ) : activeProfile.role === 'WHOLESALER' ? (
                      <WholesalerOperationsView
                        locale={locale}
                        businessId={activeProfile.businessId}
                        focusOrder={focusedOrder}
                        initialTab="analytics"
                      />
                    ) : (
                      <SupplierDashboardView
                        locale={locale}
                        activeTab="reports"
                        onTabChange={setSupplierTab}
                        businessId={activeProfile.businessId}
                        sellerPhone={activeProfile.phone}
                        focusOrder={focusedOrder}
                      />
                    ))}

                  {merchantView === 'map' && activeProfile.role === 'RETAILER' && (
                    <FullPageMarketplaceMap
                      locale={locale}
                      authority="RETAILER"
                      tenantBusinessId={activeProfile.businessId ?? null}
                      onRedirectToWorkspace={() => setMerchantView('sokoni')}
                      onSelectMerchantStorefront={() => setMerchantView('sokoni')}
                    />
                  )}
                </>
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
              onSetLocale={applyLocale}
              profile={activeProfile}
              onSaveProfile={handleSaveProfile}
              onBackToDashboard={() => setActivePage('DASHBOARD')}
            />
          )}
        </div>
      </main>

      {/* Fixed Bottom Navigation Bar (Wireframe 1 & 2: Dashboard | POS | Settings) */}
      {isMerchantRole && (
        <nav
          aria-label={locale === 'sw' ? 'Urambazaji wa Chini' : 'Bottom navigation'}
          className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 sk-safe-bottom"
        >
          <div className="max-w-lg mx-auto grid grid-cols-3 h-16">
            <button
              type="button"
              onClick={() => {
                setActivePage('DASHBOARD');
                setMerchantView('dashboard');
              }}
              aria-current={
                activePage === 'DASHBOARD' && merchantView !== 'pos' ? 'page' : undefined
              }
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors cursor-pointer ${
                activePage === 'DASHBOARD' && merchantView !== 'pos'
                  ? 'text-[#15AC49]'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <LayoutDashboard className="w-5 h-5" aria-hidden="true" />
              <span>{t(locale, 'nav.dashboard')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActivePage('DASHBOARD');
                setMerchantView('pos');
              }}
              aria-current={
                activePage === 'DASHBOARD' && merchantView === 'pos' ? 'page' : undefined
              }
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors cursor-pointer ${
                activePage === 'DASHBOARD' && merchantView === 'pos'
                  ? 'text-[#15AC49]'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Calculator className="w-5 h-5" aria-hidden="true" />
              <span>{t(locale, 'nav.pos')}</span>
            </button>

            <button
              type="button"
              onClick={() => setActivePage('SETTINGS')}
              aria-current={activePage === 'SETTINGS' ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors cursor-pointer ${
                activePage === 'SETTINGS'
                  ? 'text-[#15AC49]'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Settings className="w-5 h-5" aria-hidden="true" />
              <span>{t(locale, 'nav.settings')}</span>
            </button>
          </div>
        </nav>
      )}

      {activePage === 'DASHBOARD' && !isMerchantRole && <DashboardOnlineBadge />}
      <OfflineIndicator locale={locale} />
    </div>
  );
}
