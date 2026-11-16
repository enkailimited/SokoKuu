import { useEffect, useState } from 'react';
import type { Locale } from './data/i18n';
import { DataSaverProvider } from './context/DataSaverContext';
import { HybridModeProvider } from './context/HybridModeContext';
import {
  SEED_PLATFORM_ACCOUNTS,
  type PlatformRole,
  type UserProfile,
} from './types/auth';
import { AuthPortalView } from './components/AuthPortalView';
import { BrandedAppBarWithAlerts } from './components/BrandedAppBarWithAlerts';
import { ConsumerDashboardView } from './components/ConsumerDashboardView';
import { RetailerShoppingView, type RetailerTab } from './components/RetailerShoppingView';
import { WholesalerOperationsView } from './components/WholesalerOperationsView';
import { MobileDriverReceiptCard } from './components/MobileDriverReceiptCard';
import { SuperAdminDiagnosticsView } from './components/SuperAdminDiagnosticsView';
import { ProfileEditView, SettingsView } from './components/AccountPages';
import { OfflineIndicator } from './components/OfflineIndicator';
import { isTenantGeospatialMapEnabled } from './lib/sokoManagedState';

type ActiveAccountPage = 'DASHBOARD' | 'PROFILE' | 'SETTINGS';

const SESSION_STORAGE_KEY = 'sokokuu_active_role_v1';
const ACCOUNTS_STORAGE_KEY = 'sokokuu_accounts_v1';
const LOCALE_STORAGE_KEY = 'sokokuu_locale_v1';
const RETAILER_TAB_STORAGE_KEY = 'sokokuu_retailer_tab_v1';

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

  const [accounts, setAccounts] = useState<Record<PlatformRole, UserProfile>>(() => {
    try {
      const saved = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
      if (saved) {
        return { ...SEED_PLATFORM_ACCOUNTS, ...JSON.parse(saved) };
      }
    } catch {
      // ignore storage errors
    }
    return SEED_PLATFORM_ACCOUNTS;
  });

  const [activeRole, setActiveRole] = useState<PlatformRole | null>(() => {
    try {
      const savedRole = window.localStorage.getItem(SESSION_STORAGE_KEY) as PlatformRole | null;
      if (savedRole && savedRole in SEED_PLATFORM_ACCOUNTS) {
        return savedRole;
      }
    } catch {
      // ignore storage errors
    }
    return null;
  });

  const [activePage, setActivePage] = useState<ActiveAccountPage>('DASHBOARD');
  const [retailerTab, setRetailerTabState] = useState<RetailerTab>(() => {
    try {
      const savedTab = window.localStorage.getItem(RETAILER_TAB_STORAGE_KEY);
      if (
        savedTab === 'pos_register' ||
        savedTab === 'inventory_shelf' ||
        savedTab === 'core_engine' ||
        savedTab === 'proximity_map'
      ) {
        if (savedTab === 'proximity_map' && !isTenantGeospatialMapEnabled('ret-sinza-01')) {
          return 'pos_register';
        }
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

  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [adminMobileSidebarOpen, setAdminMobileSidebarOpen] = useState<boolean>(false);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState<boolean>(false);
  const [retailerMapEnabled, setRetailerMapEnabled] = useState<boolean>(() =>
    isTenantGeospatialMapEnabled('ret-sinza-01')
  );

  useEffect(() => {
    const handleQuotaExceeded = () => setMapsQuotaExceeded(true);
    const handleGeoToggle = () => {
      const enabled = isTenantGeospatialMapEnabled('ret-sinza-01');
      setRetailerMapEnabled(enabled);
      if (!enabled && retailerTab === 'proximity_map') {
        setRetailerTab('core_engine');
      }
    };

    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    window.addEventListener('sokokuu:geospatial-toggle-updated', handleGeoToggle);
    window.addEventListener('storage', handleGeoToggle);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
      window.removeEventListener('sokokuu:geospatial-toggle-updated', handleGeoToggle);
      window.removeEventListener('storage', handleGeoToggle);
    };
  }, [retailerTab]);

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

  const handleSignIn = (role: PlatformRole) => {
    setActiveRole(role);
    setActivePage('DASHBOARD');
    setRetailerTab('pos_register');
    setMobileMenuOpen(false);
    setAdminMobileSidebarOpen(false);
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, role);
    } catch {
      // ignore storage errors
    }
  };

  const handleLogout = () => {
    setActiveRole(null);
    setActivePage('DASHBOARD');
    setMobileMenuOpen(false);
    setAdminMobileSidebarOpen(false);
    try {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  };

  const handleSaveProfile = (updated: UserProfile) => {
    setAccounts((prev) => {
      const next = { ...prev, [updated.role]: updated };
      try {
        window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  if (!activeRole) {
    return (
      <AuthPortalView
        locale={locale}
        onToggleLocale={() => setLocale((prev) => (prev === 'en' ? 'sw' : 'en'))}
        accounts={accounts}
        onSignIn={handleSignIn}
      />
    );
  }

  const activeProfile = accounts[activeRole];

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
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
      {/* ONE Single Top AppBar with integrated Notification Bell, STOMP Audio Engine, and Profile Matrix */}
      <BrandedAppBarWithAlerts
        locale={locale}
        onToggleLocale={() => setLocale((prev) => (prev === 'en' ? 'sw' : 'en'))}
        activeProfile={activeProfile}
        activePage={activePage}
        onSelectPage={setActivePage}
        retailerTab={retailerTab}
        onSelectRetailerTab={setRetailerTab}
        retailerMapEnabled={retailerMapEnabled}
        onLogout={handleLogout}
        mobileMenuOpen={mobileMenuOpen}
        onToggleMobileMenu={() => setMobileMenuOpen((prev) => !prev)}
        adminMobileSidebarOpen={adminMobileSidebarOpen}
        onToggleAdminMobileSidebar={() => setAdminMobileSidebarOpen((prev) => !prev)}
      />

      {/* Main Single-Role Dashboard Page or Account Subpage (Clean, without redundant title banners) */}
      <main
        className={
          activeProfile.role === 'SUPER_ADMIN' && activePage === 'DASHBOARD'
            ? 'flex-1 w-full flex flex-col'
            : 'flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6'
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
                onRedirectToWorkspace={() => setRetailerTab('core_engine')}
              />
            )}
            {activeProfile.role === 'WHOLESALER' && (
              <WholesalerOperationsView locale={locale} />
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
      <OfflineIndicator locale={locale} />
    </div>
  );
}
