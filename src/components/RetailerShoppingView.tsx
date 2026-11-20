import type { Locale } from '../data/i18n';
import { SokoniCoreEngine } from './SokoniCoreEngine';
import { InventoryAndUnitManager } from './InventoryAndUnitManager';
import { FullPageMarketplaceMap } from './FullPageMarketplaceMap';

export type RetailerTab = 'pos_register' | 'inventory_shelf' | 'core_engine' | 'proximity_map';

export function RetailerShoppingView({
  locale = 'en',
  activeTab = 'pos_register',
  userRole = 'RETAILER',
  userTier = null,
  businessId,
  onRedirectToWorkspace,
  onOpenSokoni,
  sokoniInitialCatalogId = null,
  onClearSokoniCatalogFilter,
}: {
  locale?: Locale;
  activeTab?: RetailerTab;
  userRole?: 'RETAILER' | 'CONSUMER';
  userTier?: string | null;
  businessId?: string | null;
  onRedirectToWorkspace?: () => void;
  onOpenSokoni?: (globalCatalogId?: string | null) => void;
  sokoniInitialCatalogId?: string | null;
  onClearSokoniCatalogFilter?: () => void;
}) {
  const containerClass =
    activeTab === 'inventory_shelf'
      ? 'max-w-5xl mx-auto space-y-5'
      : activeTab === 'proximity_map'
        ? 'max-w-4xl mx-auto space-y-5'
        : 'max-w-2xl mx-auto space-y-5';

  return (
    <div className={containerClass}>
      {activeTab === 'pos_register' && (
        <InventoryAndUnitManager
          locale={locale}
          activeSection="pos_register"
          businessId={businessId}
          userRole={userRole}
          userTier={userTier}
          onOpenSokoni={onOpenSokoni}
        />
      )}
      {activeTab === 'inventory_shelf' && (
        <InventoryAndUnitManager
          locale={locale}
          activeSection="inventory_shelf"
          businessId={businessId}
          userRole={userRole}
          userTier={userTier}
          onOpenSokoni={onOpenSokoni}
        />
      )}
      {activeTab === 'core_engine' && (
        <SokoniCoreEngine
          locale={locale}
          userRole={userRole}
          userTier={userTier}
          initialGlobalCatalogId={sokoniInitialCatalogId}
          onClearInitialCatalogFilter={onClearSokoniCatalogFilter}
        />
      )}
      {activeTab === 'proximity_map' && (
        <FullPageMarketplaceMap
          locale={locale}
          authority="RETAILER"
          tenantBusinessId={businessId ?? null}
          onRedirectToWorkspace={onRedirectToWorkspace}
          onSelectMerchantStorefront={onRedirectToWorkspace}
        />
      )}
    </div>
  );
}
