export type OfflineQueueSyncStatus =
  | 'QUEUED_OFFLINE'
  | 'SYNCING'
  | 'SYNCED'
  | 'SENT_VIA_SMS';

export type DemoSyncStatus = OfflineQueueSyncStatus;

export interface OfflineQueuedOrder {
  idempotencyKey: string;
  sellerBusinessId: string;
  sellerHub: string;
  compactSmsBody: string;
  totalTzs: number;
  /** Preserved so queued supplier restocks replay with correct channel pricing. */
  orderChannel?: 'RETAIL_MARKETPLACE' | 'SUPPLIER_TO_WHOLESALER';
  deliveryFeeTzs?: number;
  items?: Array<{
    productId: string;
    unitType: string;
    quantity: number;
    supplierListingId?: string;
  }>;
  clientCreatedAt: string;
  syncStatus: OfflineQueueSyncStatus;
  retryCount: number;
  serverNote?: string;
}

export type DemoQueuedOrder = OfflineQueuedOrder;

const DB_NAME = 'sokokuu_tz_offline_outbox';
const STORE_NAME = 'pending_cod_orders';
const DB_VERSION = 1;

function openOutboxDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'idempotencyKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listQueuedOrders(): Promise<OfflineQueuedOrder[]> {
  if (typeof window === 'undefined' || !window.indexedDB) return [];
  const db = await openOutboxDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result as OfflineQueuedOrder[]) || [];
      items.sort((a, b) => b.clientCreatedAt.localeCompare(a.clientCreatedAt));
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putQueuedOrder(order: OfflineQueuedOrder): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  const db = await openOutboxDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(order);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearSyncedOrders(): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  const all = await listQueuedOrders();
  const db = await openOutboxDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    all.forEach((item) => {
      if (item.syncStatus === 'SYNCED' || item.syncStatus === 'SENT_VIA_SMS') {
        store.delete(item.idempotencyKey);
      }
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
