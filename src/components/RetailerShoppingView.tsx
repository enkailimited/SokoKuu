import type { Locale } from '../data/i18n';
import { SokoniCoreEngine } from './SokoniCoreEngine';
import { InventoryAndUnitManager } from './InventoryAndUnitManager';
import { FullPageMarketplaceMap } from './FullPageMarketplaceMap';

export type RetailerTab = 'pos_register' | 'inventory_shelf' | 'core_engine' | 'proximity_map';

export function RetailerShoppingView({
  locale = 'en',
  activeTab = 'pos_register',
  businessId,
  onRedirectToWorkspace,
}: {
  locale?: Locale;
  activeTab?: RetailerTab;
  userRole?: 'RETAILER' | 'CONSUMER';
  businessId?: string | null;
  onRedirectToWorkspace?: () => void;
}) {
  return (
    <div className={activeTab === 'proximity_map' ? 'max-w-4xl mx-auto space-y-5' : 'max-w-2xl mx-auto space-y-5'}>
      {activeTab === 'pos_register' && (
        <InventoryAndUnitManager
          locale={locale}
          activeSection="pos_register"
          businessId={businessId}
        />
      )}
      {activeTab === 'inventory_shelf' && (
        <InventoryAndUnitManager
          locale={locale}
          activeSection="inventory_shelf"
          businessId={businessId}
        />
      )}
      {activeTab === 'core_engine' && <SokoniCoreEngine locale={locale} />}
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
