import azaniaFlourImg from '../assets/images/azania_wheat_flour_1794734183041.jpg';
import korieOilImg from '../assets/images/korie_cooking_oil_1794734183539.jpg';
import kilomberoSugarImg from '../assets/images/kilombero_brown_sugar_1794734184028.jpg';
import mbeyaRiceImg from '../assets/images/mbeya_super_rice_1794734184118.jpg';

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

export type AdminManagedOrderStatus = 'PENDING' | 'RECEIVED' | 'DISPATCHED';

export interface OrderDispatchAuditTrace {
  traceId: string;
  orderRef8: string;
  sellerBusinessId: string;
  sellerBusinessName: string;
  isPlatformManagedAtSubmit: boolean;
  routingCode: DispatchRoutingCode;
  targetPipeline: DispatchTargetPipeline;
  isolationLevel: 'REPEATABLE_READ';
  totalCashDueTzs: number;
  itemsSummary: string;
  recordedAtEat: string;
  adminStatus?: AdminManagedOrderStatus;
  adminHandledAtEat?: string;
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

export const INITIAL_CATALOG_CATEGORIES: CatalogCategoryRecord[] = [
  {
    categoryId: 'cat-01',
    categoryCode: 'NAFAKA_UNGA',
    nameSw: 'Nafaka & Unga',
    nameEn: 'Grains & Flours',
    imagekitFolderPath: '/sokokuutz/catalog/grains-flours',
    createdAtEat: 'Leo 06:30 EAT',
  },
  {
    categoryId: 'cat-02',
    categoryCode: 'MAFUTA_KUPIKIA',
    nameSw: 'Mafuta ya Kupikia',
    nameEn: 'Cooking Oils',
    imagekitFolderPath: '/sokokuutz/catalog/cooking-oils',
    createdAtEat: 'Leo 06:35 EAT',
  },
  {
    categoryId: 'cat-03',
    categoryCode: 'SUKARI_VINYWAJI',
    nameSw: 'Sukari & Vinywaji',
    nameEn: 'Sugar & Beverages',
    imagekitFolderPath: '/sokokuutz/catalog/sugar-beverages',
    createdAtEat: 'Leo 06:40 EAT',
  },
];

export const GLOBAL_CATALOG_SEED: GlobalCatalogEntry[] = [
  {
    globalCatalogId: 'gc-0001-azania',
    canonicalSku: 'GC-AZN-WHEAT',
    fixedNameSw: 'Unga wa Ngano Safi wa Azania (Standard)',
    fixedNameEn: 'Azania Refined Wheat Flour (Standard)',
    category: 'Nafaka & Unga',
    categoryCode: 'NAFAKA_UNGA',
    imagekitCdnUrl:
      'https://ik.imagekit.io/sokokuutz/tr:w-320,h-320,fo-auto,f-webp,q-80/catalog/grains-flours/azania_wheat_flour.webp',
    staticImageUrl: azaniaFlourImg,
    defaultBaseUnitSw: 'Quanta (Robo 250g)',
    defaultBaseUnitEn: 'Quanta (250g Base)',
    clonedByStoresCount: 142,
    updatedAtEat: 'Leo 08:10 EAT',
  },
  {
    globalCatalogId: 'gc-0002-korie',
    canonicalSku: 'GC-KOR-OIL',
    fixedNameSw: 'Mafuta ya Kupikia ya Korie (Standard)',
    fixedNameEn: 'Korie Cooking Oil (Standard)',
    category: 'Mafuta ya Kupikia',
    categoryCode: 'MAFUTA_KUPIKIA',
    imagekitCdnUrl:
      'https://ik.imagekit.io/sokokuutz/tr:w-320,h-320,fo-auto,f-webp,q-80/catalog/cooking-oils/korie_cooking_oil.webp',
    staticImageUrl: korieOilImg,
    defaultBaseUnitSw: 'Quanta (Robo 250mL)',
    defaultBaseUnitEn: 'Quanta (250mL Base)',
    clonedByStoresCount: 189,
    updatedAtEat: 'Leo 08:45 EAT',
  },
  {
    globalCatalogId: 'gc-0003-kilombero',
    canonicalSku: 'GC-KLM-SUGAR',
    fixedNameSw: 'Sukari ya Kahawia ya Kilombero (Standard)',
    fixedNameEn: 'Kilombero Brown Cane Sugar (Standard)',
    category: 'Sukari & Vinywaji',
    categoryCode: 'SUKARI_VINYWAJI',
    imagekitCdnUrl:
      'https://ik.imagekit.io/sokokuutz/tr:w-320,h-320,fo-auto,f-webp,q-80/catalog/sugar-beverages/kilombero_brown_sugar.webp',
    staticImageUrl: kilomberoSugarImg,
    defaultBaseUnitSw: 'Quanta (Robo 250g)',
    defaultBaseUnitEn: 'Quanta (250g Base)',
    clonedByStoresCount: 97,
    updatedAtEat: 'Leo 09:12 EAT',
  },
  {
    globalCatalogId: 'gc-0004-mbeya',
    canonicalSku: 'GC-MBY-RICE',
    fixedNameSw: 'Mchele Mzuri wa Mbeya Grade A (Standard)',
    fixedNameEn: 'Mbeya Grade A Aromatic Rice (Standard)',
    category: 'Nafaka & Unga',
    categoryCode: 'NAFAKA_UNGA',
    imagekitCdnUrl:
      'https://ik.imagekit.io/sokokuutz/tr:w-320,h-320,fo-auto,f-webp,q-80/catalog/grains-flours/mbeya_super_rice.webp',
    staticImageUrl: mbeyaRiceImg,
    defaultBaseUnitSw: 'Quanta (Robo 250g)',
    defaultBaseUnitEn: 'Quanta (250g Base)',
    clonedByStoresCount: 164,
    updatedAtEat: 'Leo 09:30 EAT',
  },
];

export const INITIAL_MANAGED_WHOLESALERS: ManagedWholesaleProfile[] = [
  {
    businessId: '11111111-aaaa-4111-8111-000000000001',
    businessName: 'Mo Wholesale Hub',
    roleTier: 'Wholesaler',
    region: 'Dar es Salaam',
    ward: 'Kariakoo, Dar es Salaam',
    latitude: -6.81954,
    longitude: 39.27642,
    isPlatformManaged: true,
    isConverted: true,
    isVerified: true,
    geoTenantId: 'ws-mo-01',
    updatedAtEat: 'Leo 07:00 EAT',
  },
  {
    businessId: '22222222-bbbb-4222-8222-000000000002',
    businessName: 'Bakhresa Group',
    roleTier: 'Wholesaler',
    region: 'Dar es Salaam',
    ward: 'Ilala, Dar es Salaam',
    latitude: -6.82711,
    longitude: 39.24891,
    isPlatformManaged: false,
    isConverted: true,
    isVerified: true,
    geoTenantId: 'ws-bakhresa-02',
    updatedAtEat: 'Leo 07:15 EAT',
  },
  {
    businessId: '33333333-cccc-4333-8333-000000000003',
    businessName: 'Kilombero Wholesalers',
    roleTier: 'Wholesaler',
    region: 'Dar es Salaam',
    ward: 'Mchikichini, Dar es Salaam',
    latitude: -6.81428,
    longitude: 39.26985,
    isPlatformManaged: true,
    isConverted: true,
    isVerified: true,
    geoTenantId: 'ws-kilombero-03',
    updatedAtEat: 'Leo 08:00 EAT',
  },
  {
    businessId: 'ret-sinza-01',
    businessName: 'Sinza Corner Duka',
    roleTier: 'Retailer',
    region: 'Dar es Salaam',
    ward: 'Sinza Mori, Dar es Salaam',
    latitude: -6.78421,
    longitude: 39.22419,
    isPlatformManaged: false,
    isConverted: true,
    isVerified: true,
    geoTenantId: 'ret-sinza-01',
    updatedAtEat: 'Leo 08:20 EAT',
  },
  {
    businessId: 'ld-88102-shop',
    businessName: 'Msimbazi Mega Depot',
    roleTier: 'Wholesaler',
    region: 'Dar es Salaam',
    ward: 'Kariakoo, Dar es Salaam',
    latitude: -6.8211,
    longitude: 39.2749,
    isPlatformManaged: true,
    isConverted: true,
    isVerified: true,
    ownerName: 'Hassan Mbwambo',
    ownerPhoneE164: '+255754889310',
    sourceLeadId: 'LD-88102',
    geoTenantId: 'ld-88102-shop',
    updatedAtEat: 'Leo 09:15 EAT',
  },
  {
    businessId: 'ws-arusha-01',
    businessName: 'Arusha Central Wholesale',
    roleTier: 'Wholesaler',
    region: 'Arusha',
    ward: 'Soko Kuu, Arusha',
    latitude: -3.3712,
    longitude: 36.6824,
    isPlatformManaged: true,
    isConverted: true,
    isVerified: true,
    geoTenantId: 'ws-arusha-01',
    updatedAtEat: 'Leo 09:30 EAT',
  },
  {
    businessId: 'ws-mwanza-01',
    businessName: 'Nyamagana Lakeview Depot',
    roleTier: 'Wholesaler',
    region: 'Mwanza',
    ward: 'Nyamagana, Mwanza',
    latitude: -2.5169,
    longitude: 32.9058,
    isPlatformManaged: false,
    isConverted: true,
    isVerified: true,
    geoTenantId: 'ws-mwanza-01',
    updatedAtEat: 'Leo 09:45 EAT',
  },
  {
    businessId: 'ret-dodoma-01',
    businessName: 'Dodoma Jamhuri Cash & Carry',
    roleTier: 'Retailer',
    region: 'Dodoma',
    ward: 'Majengo, Dodoma',
    latitude: -6.1731,
    longitude: 35.7478,
    isPlatformManaged: true,
    isConverted: true,
    isVerified: true,
    geoTenantId: 'ret-dodoma-01',
    updatedAtEat: 'Leo 10:05 EAT',
  },
  {
    businessId: 'ws-mbeya-01',
    businessName: 'Mbeya Uyole Supply Hub',
    roleTier: 'Wholesaler',
    region: 'Mbeya',
    ward: 'Uyole, Mbeya',
    latitude: -8.9195,
    longitude: 33.5162,
    isPlatformManaged: false,
    isConverted: true,
    isVerified: true,
    geoTenantId: 'ws-mbeya-01',
    updatedAtEat: 'Leo 10:20 EAT',
  },
];

const INITIAL_AUDIT_TRACES: OrderDispatchAuditTrace[] = [
  {
    traceId: 'TRC-9F2A10C4',
    orderRef8: 'SK88410A',
    sellerBusinessId: '11111111-aaaa-4111-8111-000000000001',
    sellerBusinessName: 'Mo Wholesale Hub',
    isPlatformManagedAtSubmit: true,
    routingCode: 'ROUTED_PLATFORM_MANAGED_HELPDESK',
    targetPipeline: 'SUPER_ADMIN_HELPDESK_PIPELINE',
    isolationLevel: 'REPEATABLE_READ',
    totalCashDueTzs: 48500,
    itemsSummary: 'Unga wa Ngano Azania (16 Quanta) + Mafuta ya Korie (12 Quanta)',
    recordedAtEat: 'Leo 09:42 EAT',
    adminStatus: 'PENDING',
  },
  {
    traceId: 'TRC-4B18D9E2',
    orderRef8: 'SK73092B',
    sellerBusinessId: '22222222-bbbb-4222-8222-000000000002',
    sellerBusinessName: 'Bakhresa Group',
    isPlatformManagedAtSubmit: false,
    routingCode: 'ROUTED_DIRECT_MERCHANT_DB',
    targetPipeline: 'WHOLESALER_VENDOR_TERMINAL',
    isolationLevel: 'REPEATABLE_READ',
    totalCashDueTzs: 96000,
    itemsSummary: 'Unga wa Ngano Azania 25KG (2 Mifuko)',
    recordedAtEat: 'Leo 10:18 EAT',
    adminStatus: 'DISPATCHED',
  },
];

const STORAGE_PROFILES_KEY = 'sokokuu_managed_wholesalers_v1';
const STORAGE_TRACES_KEY = 'sokokuu_dispatch_audit_traces_v1';
export const ADMIN_ALERT_CHANNEL_NAME = 'sokokuu_admin_managed_alerts';

const CLONE_IDB_NAME = 'sokokuu_global_clone_sync_db';
const CLONE_IDB_STORE = 'pending_global_clones';

export function loadManagedWholesalers(): ManagedWholesaleProfile[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_PROFILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ManagedWholesaleProfile[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const existingIds = new Set(parsed.map((p) => p.businessId));
        const missingSeeds = INITIAL_MANAGED_WHOLESALERS.filter(
          (seed) => !existingIds.has(seed.businessId)
        );
        const enriched = [...parsed, ...missingSeeds].map((item) => {
          const seed = INITIAL_MANAGED_WHOLESALERS.find((s) => s.businessId === item.businessId);
          return {
            ...seed,
            ...item,
            region: item.region ?? seed?.region ?? extractRegionFromWard(item.ward),
            isConverted: item.isConverted ?? true,
            isVerified: item.isVerified ?? true,
            latitude: item.latitude ?? seed?.latitude ?? -6.809,
            longitude: item.longitude ?? seed?.longitude ?? 39.255,
            geoTenantId: item.geoTenantId ?? seed?.geoTenantId ?? item.businessId,
          };
        });
        return enriched;
      }
    }
  } catch {
    // ignore storage errors
  }
  return INITIAL_MANAGED_WHOLESALERS;
}

export function saveManagedWholesalers(profiles: ManagedWholesaleProfile[]) {
  try {
    window.localStorage.setItem(STORAGE_PROFILES_KEY, JSON.stringify(profiles));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sokokuu:shops-updated'));
    }
  } catch {
    // ignore storage errors
  }
}

export function toggleManagedWholesalerFlag(businessId: string): ManagedWholesaleProfile[] {
  const current = loadManagedWholesalers();
  const next = current.map((w) =>
    w.businessId === businessId
      ? {
          ...w,
          isPlatformManaged: !w.isPlatformManaged,
          updatedAtEat: new Date().toLocaleTimeString(),
        }
      : w
  );
  saveManagedWholesalers(next);
  return next;
}

export function loadDispatchAuditTraces(): OrderDispatchAuditTrace[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_TRACES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as OrderDispatchAuditTrace[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return INITIAL_AUDIT_TRACES;
}

export function updateAdminManagedOrderStatus(
  traceId: string,
  adminStatus: AdminManagedOrderStatus
): OrderDispatchAuditTrace[] {
  const existing = loadDispatchAuditTraces();
  const next = existing.map((t) =>
    t.traceId === traceId
      ? {
          ...t,
          adminStatus,
          adminHandledAtEat: new Date().toLocaleTimeString(),
        }
      : t
  );
  try {
    window.localStorage.setItem(STORAGE_TRACES_KEY, JSON.stringify(next));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sokokuu:orders-updated'));
    }
  } catch {
    // ignore storage errors
  }
  return next;
}

export function appendIncomingManagedOrder(trace: OrderDispatchAuditTrace): OrderDispatchAuditTrace[] {
  const existing = loadDispatchAuditTraces();
  if (existing.some((t) => t.traceId === trace.traceId)) return existing;
  const updated = [{ ...trace, adminStatus: trace.adminStatus ?? 'PENDING' }, ...existing].slice(
    0,
    50
  );
  try {
    window.localStorage.setItem(STORAGE_TRACES_KEY, JSON.stringify(updated));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sokokuu:orders-updated'));
    }
  } catch {
    // ignore storage errors
  }
  return updated;
}

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

export function recordOrderDispatchAuditTrace(params: {
  orderRef8: string;
  sellerBusinessId: string;
  sellerBusinessName: string;
  totalCashDueTzs: number;
  itemsSummary: string;
}): OrderDispatchAuditTrace {
  const profiles = loadManagedWholesalers();
  const profile = profiles.find((p) => p.businessId === params.sellerBusinessId);
  const isManaged = profile ? profile.isPlatformManaged : true;

  const trace: OrderDispatchAuditTrace = {
    traceId: 'TRC-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
    orderRef8: params.orderRef8,
    sellerBusinessId: params.sellerBusinessId,
    sellerBusinessName: params.sellerBusinessName,
    isPlatformManagedAtSubmit: isManaged,
    routingCode: isManaged
      ? 'ROUTED_PLATFORM_MANAGED_HELPDESK'
      : 'ROUTED_DIRECT_MERCHANT_DB',
    targetPipeline: isManaged
      ? 'SUPER_ADMIN_HELPDESK_PIPELINE'
      : 'WHOLESALER_VENDOR_TERMINAL',
    isolationLevel: 'REPEATABLE_READ',
    totalCashDueTzs: params.totalCashDueTzs,
    itemsSummary: params.itemsSummary,
    recordedAtEat: new Date().toLocaleTimeString(),
    adminStatus: isManaged ? 'PENDING' : 'DISPATCHED',
  };

  const existing = loadDispatchAuditTraces();
  const updated = [trace, ...existing].slice(0, 50);
  try {
    window.localStorage.setItem(STORAGE_TRACES_KEY, JSON.stringify(updated));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sokokuu:orders-updated'));
    }
  } catch {
    // ignore storage errors
  }

  // Trigger real-time Admin STOMP / Broadcast alarm if platform-managed
  broadcastManagedOrderAlert(trace);

  return trace;
}

// ============================================================================
// Offline IndexedDB Staging for Global Catalog Cloning (PENDING_GLOBAL_CLONE_SYNC)
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
// Global Catalog Registry (ImageKit CDN + Atomic cloned_by_stores_count)
// ============================================================================
const STORAGE_GLOBAL_CATALOG_KEY = 'sokokuu_global_catalog_v2';
const STORAGE_CATEGORIES_KEY = 'sokokuu_catalog_categories_v1';

export function loadCatalogCategories(): CatalogCategoryRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_CATEGORIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CatalogCategoryRecord[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return INITIAL_CATALOG_CATEGORIES;
}

export function addCatalogCategory(category: CatalogCategoryRecord): CatalogCategoryRecord[] {
  const existing = loadCatalogCategories();
  const next = [category, ...existing.filter((c) => c.categoryCode !== category.categoryCode)];
  try {
    window.localStorage.setItem(STORAGE_CATEGORIES_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

export function loadGlobalCatalogEntries(): GlobalCatalogEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_GLOBAL_CATALOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GlobalCatalogEntry[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // ignore storage errors
  }
  return GLOBAL_CATALOG_SEED;
}

export function saveGlobalCatalogEntries(entries: GlobalCatalogEntry[]) {
  try {
    window.localStorage.setItem(STORAGE_GLOBAL_CATALOG_KEY, JSON.stringify(entries));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    }
  } catch {
    // ignore storage errors
  }
}

export function addGlobalCatalogEntry(entry: GlobalCatalogEntry): GlobalCatalogEntry[] {
  const current = loadGlobalCatalogEntries();
  const next = [entry, ...current];
  saveGlobalCatalogEntries(next);
  return next;
}

export function incrementCatalogCloneCounter(globalCatalogId: string): GlobalCatalogEntry[] {
  const current = loadGlobalCatalogEntries();
  const next = current.map((item) =>
    item.globalCatalogId === globalCatalogId
      ? {
          ...item,
          clonedByStoresCount: item.clonedByStoresCount + 1,
          updatedAtEat: new Date().toLocaleTimeString(),
        }
      : item
  );
  saveGlobalCatalogEntries(next);
  return next;
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
    case 'DISPATCHED':
      return locale === 'sw' ? 'Imetumwa' : 'Dispatched';
    case 'IN_TRANSIT':
      return locale === 'sw' ? 'Njiani' : 'In Transit';
    case 'DELIVERED':
      return locale === 'sw' ? 'Imefika' : 'Delivered';
    case 'DISPUTED':
      return locale === 'sw' ? 'Ina Mzozo' : 'Disputed';
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

export function formatUnitTypeLabel(
  unitType: string,
  locale: 'sw' | 'en' = 'sw'
): string {
  switch (unitType) {
    case 'QUANTA_ZERO':
      return locale === 'sw' ? 'Kipimo cha Quanta' : 'Quanta Unit';
    case 'QUARTER_KILO_LITRE':
      return locale === 'sw' ? 'Robo (1/4 KG/L)' : 'Quarter (1/4 KG/L)';
    case 'HALF_KILO_LITRE':
      return locale === 'sw' ? 'Nusu (1/2 KG/L)' : 'Half (1/2 KG/L)';
    case 'THREE_QUARTER_KILO':
      return locale === 'sw' ? 'Tatu-Robo (3/4 KG)' : 'Three-Quarter (3/4 KG)';
    case 'SINGLE_KILO_LITRE':
      return locale === 'sw' ? 'Kilo / Lita 1' : '1 KG / Litre';
    case 'SACK_50KG':
      return locale === 'sw' ? 'Gunia 50 KG' : '50 KG Sack';
    case 'SACK_25KG':
      return locale === 'sw' ? 'Gunia 25 KG' : '25 KG Sack';
    case 'CARTON':
      return locale === 'sw' ? 'Katoni' : 'Carton';
    case 'DOZEN':
      return locale === 'sw' ? 'Dazeni' : 'Dozen';
    default:
      return formatCodeWithoutUnderscores(unitType);
  }
}

export function formatBusinessTierLabel(
  tier: string,
  locale: 'sw' | 'en' = 'sw'
): string {
  switch (tier) {
    case 'WHOLESALE_HUB':
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

// ============================================================================
// Multi-Tenant Geospatial Map Feature Flags (Default: FALSE for non-admins)
// ============================================================================
export interface TenantGeospatialPermission {
  tenantBusinessId: string;
  businessName: string;
  roleTier: 'Wholesaler' | 'Retailer';
  ward: string;
  geospatialMapEnabled: boolean; // Default: false
  updatedAtEat: string;
}

export interface SokoStoreGeoNode {
  businessId: string;
  smsShortCode: string;
  businessName: string;
  tierLabel: 'Wholesale Hub' | 'Retail Duka';
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

const STORAGE_GEO_PERMS_KEY = 'sokokuu_tenant_geospatial_perms_v1';

export const INITIAL_TENANT_GEO_PERMISSIONS: TenantGeospatialPermission[] = [
  {
    tenantBusinessId: 'ws-mo-01',
    businessName: 'Mo Wholesale Hub',
    roleTier: 'Wholesaler',
    ward: 'Kariakoo, Dar es Salaam',
    geospatialMapEnabled: false,
    updatedAtEat: 'Default (Locked)',
  },
  {
    tenantBusinessId: 'ret-sinza-01',
    businessName: 'Sinza Corner Duka',
    roleTier: 'Retailer',
    ward: 'Sinza Mori, Dar es Salaam',
    geospatialMapEnabled: false,
    updatedAtEat: 'Default (Locked)',
  },
  {
    tenantBusinessId: 'ws-bakhresa-02',
    businessName: 'Bakhresa Group',
    roleTier: 'Wholesaler',
    ward: 'Ilala, Dar es Salaam',
    geospatialMapEnabled: false,
    updatedAtEat: 'Default (Locked)',
  },
  {
    tenantBusinessId: 'ws-kilombero-03',
    businessName: 'Kilombero Wholesalers',
    roleTier: 'Wholesaler',
    ward: 'Mchikichini, Dar es Salaam',
    geospatialMapEnabled: false,
    updatedAtEat: 'Default (Locked)',
  },
  {
    tenantBusinessId: 'ld-88102-shop',
    businessName: 'Msimbazi Mega Depot',
    roleTier: 'Wholesaler',
    ward: 'Kariakoo, Dar es Salaam',
    geospatialMapEnabled: false,
    updatedAtEat: 'Default (Locked)',
  },
  {
    tenantBusinessId: 'ws-arusha-01',
    businessName: 'Arusha Central Wholesale',
    roleTier: 'Wholesaler',
    ward: 'Soko Kuu, Arusha',
    geospatialMapEnabled: false,
    updatedAtEat: 'Default (Locked)',
  },
  {
    tenantBusinessId: 'ws-mwanza-01',
    businessName: 'Nyamagana Lakeview Depot',
    roleTier: 'Wholesaler',
    ward: 'Nyamagana, Mwanza',
    geospatialMapEnabled: false,
    updatedAtEat: 'Default (Locked)',
  },
  {
    tenantBusinessId: 'ret-dodoma-01',
    businessName: 'Dodoma Jamhuri Cash & Carry',
    roleTier: 'Retailer',
    ward: 'Majengo, Dodoma',
    geospatialMapEnabled: false,
    updatedAtEat: 'Default (Locked)',
  },
  {
    tenantBusinessId: 'ws-mbeya-01',
    businessName: 'Mbeya Uyole Supply Hub',
    roleTier: 'Wholesaler',
    ward: 'Uyole, Mbeya',
    geospatialMapEnabled: false,
    updatedAtEat: 'Default (Locked)',
  },
];

const SHOP_LOGO_CYCLE = [azaniaFlourImg, korieOilImg, kilomberoSugarImg, mbeyaRiceImg];

export function loadVerifiedStoreGeoNodes(): SokoStoreGeoNode[] {
  const shops = loadManagedWholesalers().filter(
    (s) => (s.isConverted ?? true) && (s.isVerified ?? true)
  );
  return shops.map((shop, index) => ({
    businessId: shop.geoTenantId ?? shop.businessId,
    smsShortCode: `SK${101 + index}`,
    businessName: shop.businessName,
    tierLabel: (shop.roleTier ?? 'Wholesaler') === 'Wholesaler' ? 'Wholesale Hub' : 'Retail Duka',
    region: shop.region ?? extractRegionFromWard(shop.ward),
    ward: shop.ward,
    latitude: shop.latitude ?? -6.809,
    longitude: shop.longitude ?? 39.255,
    distanceMeters: 150 + index * 140,
    activeSkusCount: 24 + ((index * 9) % 40),
    logoUrl: SHOP_LOGO_CYCLE[index % SHOP_LOGO_CYCLE.length],
    isPlatformManaged: shop.isPlatformManaged,
    isConverted: true,
    isVerified: true,
  }));
}

export const SOKO_STORE_GEO_NODES: SokoStoreGeoNode[] = loadVerifiedStoreGeoNodes();

export function registerConvertedVerifiedShop(params: {
  sourceLeadId: string;
  shopName: string;
  ownerName: string;
  ownerPhoneE164: string;
  ward: string;
  businessTier: 'Wholesaler' | 'Retailer';
  latitude: number;
  longitude: number;
}): ManagedWholesaleProfile[] {
  const shops = loadManagedWholesalers();
  const normalizedId = `conv-${params.sourceLeadId.toLowerCase()}`;
  const region = extractRegionFromWard(params.ward);

  const existing = shops.find(
    (s) => s.sourceLeadId === params.sourceLeadId || s.businessId === normalizedId
  );

  let nextShops: ManagedWholesaleProfile[];
  if (existing) {
    nextShops = shops.map((s) =>
      s.businessId === existing.businessId
        ? { ...s, isConverted: true, isVerified: true, updatedAtEat: new Date().toLocaleTimeString() }
        : s
    );
  } else {
    const newShop: ManagedWholesaleProfile = {
      businessId: normalizedId,
      businessName: params.shopName,
      roleTier: params.businessTier,
      region,
      ward: params.ward,
      latitude: params.latitude,
      longitude: params.longitude,
      isPlatformManaged: false,
      isConverted: true,
      isVerified: true,
      ownerName: params.ownerName,
      ownerPhoneE164: params.ownerPhoneE164,
      sourceLeadId: params.sourceLeadId,
      geoTenantId: normalizedId,
      updatedAtEat: new Date().toLocaleTimeString(),
    };
    nextShops = [newShop, ...shops];
  }

  saveManagedWholesalers(nextShops);

  // Also provision default FALSE geospatial map permission for the newly verified shop
  const perms = loadTenantGeospatialPermissions();
  if (!perms.some((p) => p.tenantBusinessId === normalizedId)) {
    const nextPerms: TenantGeospatialPermission[] = [
      {
        tenantBusinessId: normalizedId,
        businessName: params.shopName,
        roleTier: params.businessTier,
        ward: params.ward,
        geospatialMapEnabled: false,
        updatedAtEat: 'Default (Locked)',
      },
      ...perms,
    ];
    try {
      window.localStorage.setItem(STORAGE_GEO_PERMS_KEY, JSON.stringify(nextPerms));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sokokuu:geospatial-toggle-updated'));
      }
    } catch {
      // ignore storage write error
    }
  }

  return nextShops;
}

export function loadTenantGeospatialPermissions(): TenantGeospatialPermission[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_GEO_PERMS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TenantGeospatialPermission[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const existingIds = new Set(parsed.map((p) => p.tenantBusinessId));
        const missing = INITIAL_TENANT_GEO_PERMISSIONS.filter(
          (seed) => !existingIds.has(seed.tenantBusinessId)
        );
        return [...parsed, ...missing];
      }
    }
  } catch {
    // ignore storage read error
  }
  return INITIAL_TENANT_GEO_PERMISSIONS;
}

export function toggleTenantGeospatialPermission(
  tenantBusinessId: string
): TenantGeospatialPermission[] {
  const current = loadTenantGeospatialPermissions();
  const next = current.map((item) =>
    item.tenantBusinessId === tenantBusinessId
      ? {
          ...item,
          geospatialMapEnabled: !item.geospatialMapEnabled,
          updatedAtEat: new Date().toLocaleTimeString(),
        }
      : item
  );
  try {
    window.localStorage.setItem(STORAGE_GEO_PERMS_KEY, JSON.stringify(next));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sokokuu:geospatial-toggle-updated'));
    }
  } catch {
    // ignore storage write error
  }
  return next;
}

export function isTenantGeospatialMapEnabled(tenantBusinessId: string): boolean {
  const perms = loadTenantGeospatialPermissions();
  return Boolean(
    perms.find((p) => p.tenantBusinessId === tenantBusinessId)?.geospatialMapEnabled
  );
}



