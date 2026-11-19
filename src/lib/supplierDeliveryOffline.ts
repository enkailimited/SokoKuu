/**
 * Offline-safe cache for the supplier B2B delivery policy.
 *
 * The PWA must keep showing the last known Free Delivery status while offline
 * and must never discard a toggle made without connectivity. The queued
 * payload is replayed to NestJS as soon as the browser reports `online`.
 * Nothing here is used as a fallback while the backend is reachable — a
 * successful GET always overwrites the cached snapshot.
 */

export interface SupplierDeliveryPayload {
  isFreeDeliveryEnabled: boolean;
  freeDeliveryMinOrderTzs: string;
  standardDeliveryFeeTzs: string;
  deliveryCoverageRegions: string[];
}

export interface SupplierDeliveryOfflineRecord {
  businessScope: string;
  // `allowAdminReceive` is cached read-only for the consent badge. It is never
  // part of a queued PATCH payload — that endpoint is managed in Settings only.
  lastKnown: SupplierDeliveryPayload & {
    policy?: string;
    allowAdminReceive?: boolean;
  };
  pending?: SupplierDeliveryPayload & { queuedAt: string };
}

const DB_NAME = 'sokokuu_supplier_delivery_offline';
const STORE_NAME = 'delivery_policy_state';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'businessScope' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function readSupplierDeliveryOffline(
  businessScope: string
): Promise<SupplierDeliveryOfflineRecord | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(businessScope);
      request.onsuccess = () => resolve((request.result as SupplierDeliveryOfflineRecord) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function writeSupplierDeliveryOffline(
  record: SupplierDeliveryOfflineRecord
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function stageSupplierDeliveryChange(
  businessScope: string,
  lastKnown: SupplierDeliveryOfflineRecord['lastKnown'],
  pending: SupplierDeliveryPayload
): Promise<void> {
  await writeSupplierDeliveryOffline({
    businessScope,
    lastKnown,
    pending: { ...pending, queuedAt: new Date().toISOString() },
  });
}

export async function clearSupplierDeliveryPending(businessScope: string): Promise<void> {
  const existing = await readSupplierDeliveryOffline(businessScope);
  if (!existing?.pending) return;
  const { pending: _pending, ...rest } = existing;
  await writeSupplierDeliveryOffline(rest);
}
