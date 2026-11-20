import {
  formatFractionLabel,
  formatPackagingUnit,
  type UnitCategory,
} from '../utils/formatProductUnit';

export interface GlobalCatalogEntry {
  globalCatalogId: string;
  canonicalSku: string;
  fixedNameSw: string;
  fixedNameEn: string;
  category: string;
  categoryCode: string;
  imagekitCdnUrl: string;
  staticImageUrl: string;
  defaultBaseUnitSw: string;
  defaultBaseUnitEn: string;
  baseQuantumUnit?: string;
  isActive?: boolean;
  clonedByStoresCount: number;
  updatedAtEat: string;
}

export interface CatalogCategoryRecord {
  categoryId: string;
  categoryCode: string;
  nameSw: string;
  nameEn: string;
  imagekitFolderPath: string;
  createdAtEat: string;
}

export type TanzaniaRegion =
  | 'Dar es Salaam'
  | 'Arusha'
  | 'Mwanza'
  | 'Dodoma'
  | 'Mbeya';

export interface RegionViewportConfig {
  key: 'ALL' | TanzaniaRegion;
  labelSw: string;
  labelEn: string;
  center: { lat: number; lng: number };
  zoom: number;
}

export const TANZANIA_REGIONS: RegionViewportConfig[] = [
  {
    key: 'ALL',
    labelSw: 'Mikoa Yote (Tanzania)',
    labelEn: 'All Regions (Tanzania)',
    center: { lat: -6.369, lng: 34.8888 },
    zoom: 6,
  },
  {
    key: 'Dar es Salaam',
    labelSw: 'Dar es Salaam',
    labelEn: 'Dar es Salaam',
    center: { lat: -6.809, lng: 39.255 },
    zoom: 13,
  },
  {
    key: 'Arusha',
    labelSw: 'Arusha',
    labelEn: 'Arusha',
    center: { lat: -3.3869, lng: 36.683 },
    zoom: 13,
  },
  {
    key: 'Mwanza',
    labelSw: 'Mwanza',
    labelEn: 'Mwanza',
    center: { lat: -2.5164, lng: 32.9175 },
    zoom: 13,
  },
  {
    key: 'Dodoma',
    labelSw: 'Dodoma',
    labelEn: 'Dodoma',
    center: { lat: -6.163, lng: 35.7516 },
    zoom: 13,
  },
  {
    key: 'Mbeya',
    labelSw: 'Mbeya',
    labelEn: 'Mbeya',
    center: { lat: -8.9094, lng: 33.4608 },
    zoom: 13,
  },
];

export function extractRegionFromWard(ward: string): TanzaniaRegion {
  const lower = ward.toLowerCase();
  if (lower.includes('arusha')) return 'Arusha';
  if (lower.includes('mwanza')) return 'Mwanza';
  if (lower.includes('dodoma')) return 'Dodoma';
  if (lower.includes('mbeya')) return 'Mbeya';
  return 'Dar es Salaam';
}

export interface ManagedWholesaleProfile {
  businessId: string;
  businessName: string;
  roleTier?: 'Wholesaler' | 'Retailer';
  region?: TanzaniaRegion;
  ward: string;
  latitude?: number;
  longitude?: number;
  isPlatformManaged: boolean;
  isConverted?: boolean;
  isVerified?: boolean;
  ownerName?: string;
  ownerPhoneE164?: string;
  sourceLeadId?: string;
  geoTenantId?: string;
  updatedAtEat: string;
}

export type DispatchRoutingCode =
  | 'ROUTED_PLATFORM_MANAGED_HELPDESK'
  | 'ROUTED_DIRECT_MERCHANT_DB';

export type DispatchTargetPipeline =
  | 'SUPER_ADMIN_HELPDESK_PIPELINE'
  | 'WHOLESALER_VENDOR_TERMINAL';

export type AdminManagedOrderStatus = 'PENDING' | 'RECEIVED' | 'IN_TRANSIT' | 'DISPATCHED';

export interface OrderDispatchAuditTrace {
  traceId: string;
  orderRef8: string;
  sellerBusinessId: string;
  sellerBusinessName: string;
  sellerOwnerName?: string;
  sellerPhoneE164?: string;
  buyerName?: string;
  buyerPhoneE164?: string;
  driverName?: string | null;
  driverPhoneE164?: string | null;
  isPlatformManagedAtSubmit: boolean;
  routingCode: DispatchRoutingCode;
  targetPipeline: DispatchTargetPipeline;
  isolationLevel: 'REPEATABLE_READ';
  totalCashDueTzs: number;
  itemsSummary: string;
  recordedAtEat: string;
  adminStatus?: AdminManagedOrderStatus;
  adminHandledAtEat?: string;
  orderStatus?: string;
}

export type GlobalCloneSyncStatus = 'SYNCED' | 'PENDING_GLOBAL_CLONE_SYNC';

export interface OfflineGlobalCloneRecord {
  cloneRecordId: string;
  globalCatalogId: string;
  canonicalSku: string;
  fixedNameSw: string;
  fixedNameEn: string;
  imagekitCdnUrl: string;
  initializedStockQuanta: 0;
  initializedPriceTzs: 0;
  syncStatus: GlobalCloneSyncStatus;
  stagedAtIso: string;
}

export const ADMIN_ALERT_CHANNEL_NAME = 'sokokuu_admin_managed_alerts';

const CLONE_IDB_NAME = 'sokokuu_global_clone_sync_db';
const CLONE_IDB_STORE = 'pending_global_clones';

export function broadcastManagedOrderAlert(trace: OrderDispatchAuditTrace) {
  if (trace.routingCode !== 'ROUTED_PLATFORM_MANAGED_HELPDESK') return;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<OrderDispatchAuditTrace>('sokokuu:managed-order-alert', {
        detail: trace,
      })
    );
    if ('BroadcastChannel' in window) {
      try {
        const channel = new BroadcastChannel(ADMIN_ALERT_CHANNEL_NAME);
        channel.postMessage(trace);
        channel.close();
      } catch {
        // ignore BroadcastChannel errors
      }
    }
  }
}

// ============================================================================
// Offline IndexedDB Staging for Real User-Queued Global Catalog Clones
// ============================================================================
function openCloneDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    const req = window.indexedDB.open(CLONE_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CLONE_IDB_STORE)) {
        db.createObjectStore(CLONE_IDB_STORE, { keyPath: 'globalCatalogId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function stageOfflineGlobalClone(
  record: OfflineGlobalCloneRecord
): Promise<void> {
  const db = await openCloneDatabase();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(CLONE_IDB_STORE, 'readwrite');
    tx.objectStore(CLONE_IDB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function loadPendingGlobalClones(): Promise<OfflineGlobalCloneRecord[]> {
  const db = await openCloneDatabase();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(CLONE_IDB_STORE, 'readonly');
    const req = tx.objectStore(CLONE_IDB_STORE).getAll();
    req.onsuccess = () => {
      const all = (req.result as OfflineGlobalCloneRecord[]) ?? [];
      resolve(all.filter((r) => r.syncStatus === 'PENDING_GLOBAL_CLONE_SYNC'));
    };
    req.onerror = () => resolve([]);
  });
}

export async function markGlobalClonesSynced(globalCatalogIds: string[]): Promise<void> {
  const db = await openCloneDatabase();
  if (!db || globalCatalogIds.length === 0) return;
  return new Promise((resolve) => {
    const tx = db.transaction(CLONE_IDB_STORE, 'readwrite');
    const store = tx.objectStore(CLONE_IDB_STORE);
    for (const id of globalCatalogIds) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const rec = getReq.result as OfflineGlobalCloneRecord | undefined;
        if (rec) {
          store.put({ ...rec, syncStatus: 'SYNCED' });
        }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// ============================================================================
// Human-Readable UI Formatters (Never expose raw DB_UNDERSCORE_CODES in UI)
// ============================================================================
export function formatCodeWithoutUnderscores(raw: string): string {
  return raw
    .trim()
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function formatRoutingLabel(
  code: DispatchRoutingCode,
  locale: 'sw' | 'en' = 'sw'
): string {
  if (code === 'ROUTED_PLATFORM_MANAGED_HELPDESK') {
    return locale === 'sw'
      ? 'Msaada wa Jukwaa (Helpdesk)'
      : 'Platform Helpdesk Dispatch';
  }
  return locale === 'sw'
    ? 'Moja kwa Moja kwa Muuzaji'
    : 'Direct Merchant Terminal';
}

export function formatPipelineLabel(
  pipeline: DispatchTargetPipeline,
  locale: 'sw' | 'en' = 'sw'
): string {
  if (pipeline === 'SUPER_ADMIN_HELPDESK_PIPELINE') {
    return locale === 'sw' ? 'Dawati la Simu (Super Admin)' : 'Super Admin Call Desk';
  }
  return locale === 'sw' ? 'Mfumo wa Muuzaji' : 'Vendor Terminal';
}

export function formatAlertPacketLabel(
  packetType: string,
  locale: 'sw' | 'en' = 'sw'
): string {
  switch (packetType) {
    case 'ROUTED_PLATFORM_MANAGED_HELPDESK':
      return locale === 'sw' ? 'Msaada wa Jukwaa (Helpdesk)' : 'Platform Managed Helpdesk';
    case 'ROUTED_DIRECT_MERCHANT_DB':
      return locale === 'sw' ? 'Moja kwa Moja kwa Muuzaji' : 'Direct Merchant Order';
    case 'NEW_B2B_ORDER_REQUEST':
      return locale === 'sw' ? 'Oda Mpya ya B2B' : 'New B2B Order Request';
    case 'STANDARD_UPDATE':
      return locale === 'sw' ? 'Taarifa ya Mfumo' : 'Standard Update';
    default:
      return formatCodeWithoutUnderscores(packetType);
  }
}

export function formatExceptionFlagLabel(
  flag: string,
  locale: 'sw' | 'en' = 'sw'
): string {
  switch (flag) {
    case 'PENDING_SMS_SYNC':
      return locale === 'sw' ? 'Inasubiri SMS' : 'Pending SMS Sync';
    case 'DISPUTED':
      return locale === 'sw' ? 'Mzozo' : 'Disputed';
    case 'RESOLVED':
      return locale === 'sw' ? 'Imetatuliwa' : 'Resolved';
    default:
      return formatCodeWithoutUnderscores(flag);
  }
}

export function formatOrderStatusLabel(
  status: string,
  locale: 'sw' | 'en' = 'sw'
): string {
  switch (status) {
    case 'PLACED':
      return locale === 'sw' ? 'Imewekwa' : 'Placed';
    case 'DISPATCHED':
      return locale === 'sw' ? 'Imetumwa' : 'Dispatched';
    case 'IN_TRANSIT':
      return locale === 'sw' ? 'Njiani' : 'In Transit';
    case 'DELIVERED':
      return locale === 'sw' ? 'Imefika' : 'Delivered';
    case 'DISPUTED':
      return locale === 'sw' ? 'Ina Mzozo' : 'Disputed';
    case 'CANCELLED':
      return locale === 'sw' ? 'Imeghairiwa' : 'Cancelled';
    case 'SETTLED':
      return locale === 'sw' ? 'Imefungwa' : 'Settled';
    case 'ON_ROUTE':
      return locale === 'sw' ? 'Yupo Njiani' : 'On Route';
    case 'RETURNING_WITH_CASH':
      return locale === 'sw' ? 'Anarudi na Taslimu' : 'Returning With Cash';
    case 'CLEARED':
      return locale === 'sw' ? 'Amekamilisha' : 'Cleared';
    case 'QUEUED_OFFLINE':
      return locale === 'sw' ? 'Foleni Nje ya Mtandao' : 'Queued Offline';
    case 'SYNCING':
      return locale === 'sw' ? 'Inasawazisha' : 'Syncing';
    case 'SYNCED':
      return locale === 'sw' ? 'Imesawazishwa' : 'Synced';
    case 'SENT_VIA_SMS':
      return locale === 'sw' ? 'Imetumwa kwa SMS' : 'Sent via SMS';
    case 'WAITING':
      return locale === 'sw' ? 'Inasubiri' : 'Waiting';
    case 'BUYER_CONFIRMED':
      return locale === 'sw' ? 'Mnunuzi Amethibitisha' : 'Buyer Confirmed';
    case 'DRIVER_CONFIRMED':
      return locale === 'sw' ? 'Dereva Amethibitisha' : 'Driver Confirmed';
    case 'SUCCESSFUL':
      return locale === 'sw' ? 'Imekamilika' : 'Successful';
    default:
      return formatCodeWithoutUnderscores(status);
  }
}

/**
 * Category-aware unit label. Pass the product's category whenever available so
 * liquids render mL/L and solids render g/KG — never a combined "KG/L".
 */
export function formatUnitTypeLabel(
  unitType: string,
  locale: 'sw' | 'en' = 'sw',
  category: UnitCategory = 'WEIGHT',
): string {
  switch (unitType) {
    case 'QUANTA_ZERO':
      return locale === 'sw' ? 'Kipimo cha Quanta' : 'Quanta Unit';
    case 'QUARTER_KILO_LITRE':
      return formatFractionLabel('QUARTER', category, locale);
    case 'HALF_KILO_LITRE':
      return formatFractionLabel('HALF', category, locale);
    case 'THREE_QUARTER_KILO':
      return formatFractionLabel('THREE_QUARTER', category, locale);
    case 'SINGLE_KILO_LITRE':
      return formatFractionLabel('SINGLE', category, locale);
    case 'SACK_50KG':
      return formatPackagingUnit({
        labelSw: 'Gunia',
        labelEn: 'Sack',
        locale,
        packageKg: 50,
      });
    case 'SACK_25KG':
      return formatPackagingUnit({
        labelSw: 'Gunia',
        labelEn: 'Sack',
        locale,
        packageKg: 25,
      });
    case 'CARTON':
      return formatPackagingUnit({
        labelSw: 'Katoni',
        labelEn: 'Carton',
        locale,
      });
    case 'CRATE':
      return formatPackagingUnit({
        labelSw: 'Kreti',
        labelEn: 'Crate',
        locale,
      });
    case 'DOZEN':
      return locale === 'sw' ? 'Dazeni' : 'Dozen';
    case 'PACK':
      return locale === 'sw' ? 'Pakiti' : 'Pack';
    case 'UNIT':
      return locale === 'sw' ? 'Kipimo Kimoja' : 'Single Unit';
    default:
      return formatCodeWithoutUnderscores(unitType);
  }
}

export function formatBusinessTierLabel(
  tier: string,
  locale: 'sw' | 'en' = 'sw'
): string {
  switch (tier) {
    case 'WHOLESALE':
      return locale === 'sw' ? 'Duka la Jumla' : 'Wholesale Hub';
    case 'HYBRID_STORE':
      return locale === 'sw' ? 'Duka Mseto' : 'Hybrid Store';
    case 'RETAIL_DUKA':
      return locale === 'sw' ? 'Duka la Rejareja' : 'Retail Duka';
    case 'END_CONSUMER':
      return locale === 'sw' ? 'Mlaji wa Mwisho' : 'End Consumer';
    case 'FLEET_RIDER':
      return locale === 'sw' ? 'Dereva Msafirishaji' : 'Fleet Rider';
    case 'PLATFORM_ADMIN':
      return locale === 'sw' ? 'Msimamizi wa Jukwaa' : 'Platform Admin';
    default:
      return formatCodeWithoutUnderscores(tier);
  }
}

export interface TenantGeospatialPermission {
  tenantBusinessId: string;
  businessName: string;
  roleTier: 'Wholesaler' | 'Retailer';
  ward: string;
  geospatialMapEnabled: boolean;
  updatedAtEat: string;
}

export interface SokoStoreGeoNode {
  businessId: string;
  smsShortCode: string;
  businessName: string;
  tierLabel: 'Wholesale Hub' | 'Retail Merchant' | 'Retail Duka';
  region: TanzaniaRegion;
  ward: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  activeSkusCount: number;
  logoUrl: string;
  isPlatformManaged: boolean;
  isConverted: boolean;
  isVerified: boolean;
}
