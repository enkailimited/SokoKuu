import { useState, useEffect } from 'react';
import {
  PlusCircle,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  DollarSign,
  Copy,
  Globe,
  X
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  formatUnitTypeLabel,
  incrementCatalogCloneCounter,
  loadGlobalCatalogEntries,
  loadPendingGlobalClones,
  markGlobalClonesSynced,
  stageOfflineGlobalClone,
  type GlobalCatalogEntry,
  type GlobalCloneSyncStatus,
} from '../lib/sokoManagedState';
import { SokoApiClient } from '../services/sokoApiClient';

// ============================================================================
// Types & Interfaces for Merchant Custom Units & Dynamic POS Terminal
// ============================================================================
export interface MerchantCustomUnit {
  unitId: string;
  unitName: string; // e.g. "Debe", "Sado", "Dumu", "Gunia"
  baseMultiplierKg: number; // e.g. 18 KG for a Debe
  quantaEquivalent: number; // baseMultiplierKg * 4 (Quarter Quanta integer)
  descriptionSw: string;
}

export interface DukaInventoryItem {
  itemId: string;
  sku: string;
  globalCatalogId?: string;
  imagekitCdnUrl?: string;
  syncStatus?: GlobalCloneSyncStatus;
  productNameSw: string;
  productNameEn: string;
  availableQuanta: number; // Integer Quarter Quanta (1 = 250g, 4 = 1KG)
  unitPriceTzs: number; // Price per Quantum (0 when freshly cloned from Global Catalog)
  lowStockThresholdQuanta: number;
  unitType: string;
  lastRestockedEat: string;
}

export interface PosReceiptRecord {
  receiptId: string;
  inventoryId: string;
  sku: string;
  quantaSold: number;
  paymentMethod: 'CASH' | 'M-PESA' | 'TIGO-PESA';
  totalTzs: number;
  timestampEat: string;
  synced: boolean;
}

const DEFAULT_CUSTOM_UNITS: MerchantCustomUnit[] = [
  {
    unitId: 'unit-debe',
    unitName: 'Debe (20L / 18KG)',
    baseMultiplierKg: 18,
    quantaEquivalent: 72,
    descriptionSw: 'Kipimo cha jadi cha Debe ya mafuta au unga (Lita 20 / Kilo 18).'
  },
  {
    unitId: 'unit-sado',
    unitName: 'Sado (5KG)',
    baseMultiplierKg: 5,
    quantaEquivalent: 20,
    descriptionSw: 'Kipimo cha kati cha Sado kwa maharagwe au mchele.'
  },
  {
    unitId: 'unit-dumu',
    unitName: 'Dumu Kubwa (10L)',
    baseMultiplierKg: 10,
    quantaEquivalent: 40,
    descriptionSw: 'Dumu la plastiki la ujazo wa lita 10 za mafuta ya kupikia.'
  },
  {
    unitId: 'unit-quanta',
    unitName: 'Robo Quanta (250g/250mL)',
    baseMultiplierKg: 0.25,
    quantaEquivalent: 1,
    descriptionSw: 'Kipimo kikuu cha msingi (1 Quanta = robo kilo/lita).'
  }
];

const INITIAL_SHELF_ITEMS: DukaInventoryItem[] = [
  {
    itemId: 'item-001',
    sku: 'KOR-OIL-20L',
    productNameSw: 'Mafuta ya Kupikia Korie (Debe 18KG)',
    productNameEn: 'Korie Cooking Oil (18KG Debe)',
    availableQuanta: 216, // 3 Debes (3 * 72)
    unitPriceTzs: 1250,
    lowStockThresholdQuanta: 40,
    unitType: 'DEBE',
    lastRestockedEat: 'Leo 08:30 EAT'
  },
  {
    itemId: 'item-002',
    sku: 'AZN-WHEAT-5KG',
    productNameSw: 'Unga wa Ngano Azania (Sado 5KG)',
    productNameEn: 'Azania Wheat Flour (5KG Sado)',
    availableQuanta: 120, // 6 Sados (6 * 20)
    unitPriceTzs: 1250,
    lowStockThresholdQuanta: 30,
    unitType: 'SADO',
    lastRestockedEat: 'Leo 10:15 EAT'
  },
  {
    itemId: 'item-003',
    sku: 'MBY-RICE-25KG',
    productNameSw: 'Mchele wa Mbeya (Gunia 25KG)',
    productNameEn: 'Mbeya Super Rice (25KG Sack)',
    availableQuanta: 400, // 4 Sacks
    unitPriceTzs: 1250,
    lowStockThresholdQuanta: 80,
    unitType: 'GUNIA',
    lastRestockedEat: 'Jana 16:45 EAT'
  }
];

const IDB_NAME = 'sokokuu_inventory_units_db';
const IDB_STORE = 'shelf_store';

async function persistToIndexedDB(items: DukaInventoryItem[]) {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve();
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'itemId' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      items.forEach((item) => store.put(item));
      tx.oncomplete = () => resolve();
    };
    req.onerror = () => resolve();
  });
}

// ============================================================================
// InventoryAndUnitManager.tsx
// Imeunganishwa moja kwa moja na AppBar (POS Mauzo / Hifadhi & Bidhaa).
// Hakuna tab za marudio za Vipimo Maalum au Hifadhi & Rafu ndani ya POS Mauzo.
// ============================================================================
export function InventoryAndUnitManager({
  locale = 'en',
  activeSection = 'pos_register',
}: {
  locale?: Locale;
  activeSection?: 'pos_register' | 'inventory_shelf';
}) {
  const isSw = locale === 'sw';

  const [isOnline, setIsOnline] = useState<boolean>(
    typeof window !== 'undefined' ? window.navigator.onLine : true
  );

  const [customUnits, setCustomUnits] = useState<MerchantCustomUnit[]>(DEFAULT_CUSTOM_UNITS);
  const [globalCatalog, setGlobalCatalog] = useState<GlobalCatalogEntry[]>(() =>
    loadGlobalCatalogEntries()
  );
  const [shelfItems, setShelfItems] = useState<DukaInventoryItem[]>(INITIAL_SHELF_ITEMS);
  const [receiptLedger, setReceiptLedger] = useState<PosReceiptRecord[]>([]);
  const [toastNotice, setToastNotice] = useState<string | null>(null);

  // Dynamic POS Quantity Prompt Modal State
  const [selectedItemForSale, setSelectedItemForSale] = useState<DukaInventoryItem | null>(null);
  const [promptQuantity, setPromptQuantity] = useState<number>(4); // Default 1 KG (4 quanta)
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'CASH' | 'M-PESA' | 'TIGO-PESA'>('CASH');

  // New Custom Unit Form State
  const [newUnitName, setNewUnitName] = useState('');
  const [newBaseKg, setNewBaseKg] = useState<number>(10);

  // New Manual Shelf Ingestion State
  const [newSku, setNewSku] = useState('SKU-NEW');
  const [newNameSw, setNewNameSw] = useState('Sukari ya Kupimia');
  const [newQuantaQty, setNewQuantaQty] = useState<number>(40);

  const flushPendingClones = async () => {
    const pending = await loadPendingGlobalClones();
    if (pending.length === 0) return;

    const idsToSync = pending.map((p) => p.globalCatalogId);
    await markGlobalClonesSynced(idsToSync);

    let updatedCatalog = globalCatalog;
    for (const id of idsToSync) {
      updatedCatalog = incrementCatalogCloneCounter(id);
    }
    setGlobalCatalog(updatedCatalog);

    setShelfItems((prev) =>
      prev.map((item) =>
        item.globalCatalogId && idsToSync.includes(item.globalCatalogId)
          ? { ...item, syncStatus: 'SYNCED' }
          : item
      )
    );

    setToastNotice(
      isSw
        ? `Mtandao umerejea: Bidhaa ${pending.length} zilizokuwa zinasubiri zimesawazishwa na Hifadhidata ya SokoKuu.`
        : `Back online: ${pending.length} staged catalog item(s) synced to Cloud Database Core.`
    );
  };

  useEffect(() => {
    const refreshCatalog = () => setGlobalCatalog(loadGlobalCatalogEntries());
    const handleOnline = () => {
      setIsOnline(true);
      void flushPendingClones();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('sokokuu:catalog-updated', refreshCatalog);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('sokokuu:catalog-updated', refreshCatalog);
    };
  }, [isSw]);

  useEffect(() => {
    persistToIndexedDB(shelfItems);
  }, [shelfItems]);

  const handleCreateCustomUnit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUnitName.trim()) return;

    const calculatedQuanta = Math.round(newBaseKg * 4); // Math.multiplyExact equivalent scale
    const newUnit: MerchantCustomUnit = {
      unitId: 'unit-' + Math.random().toString(36).substring(2, 8),
      unitName: newUnitName.trim(),
      baseMultiplierKg: newBaseKg,
      quantaEquivalent: calculatedQuanta,
      descriptionSw: `Kipimo maalum kilichosanifiwa na duka (${newBaseKg} KG / ${calculatedQuanta} Quanta).`
    };

    setCustomUnits((prev) => [...prev, newUnit]);
    setToastNotice(
      isSw
        ? `Kipimo kipya cha "${newUnit.unitName}" kimesajiliwa kikamilifu (${calculatedQuanta} Quanta).`
        : `Custom unit "${newUnit.unitName}" successfully registered (${calculatedQuanta} Quanta).`
    );
    setNewUnitName('');
    setNewBaseKg(10);
  };

  const handleOpenPosModal = (item: DukaInventoryItem) => {
    if (item.availableQuanta <= 0 || item.unitPriceTzs <= 0) {
      setToastNotice(
        isSw
          ? `Bidhaa "${item.sku}" ina hifadhi 0 au bei TZS 0. Weka stoo na bei kwenye kichupo cha Hifadhi kabla ya kuuza.`
          : `Item "${item.sku}" has 0 stock or 0 TZS price. Restock and set unit price in Inventory first.`
      );
      return;
    }
    setSelectedItemForSale(item);
    setPromptQuantity(Math.min(4, item.availableQuanta));
    setSelectedPaymentMethod('CASH');
  };

  const handleExecutePosSale = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemForSale) return;

    if (promptQuantity > selectedItemForSale.availableQuanta) {
      setToastNotice(
        isSw
          ? `Kosa la Uhifadhi: Idadi inayoombwa (${promptQuantity} Quanta) inazidi kiwango kilichopo rafu (${selectedItemForSale.availableQuanta} Quanta).`
          : `Stock Error: Requested quantity (${promptQuantity} Quanta) exceeds available shelf stock (${selectedItemForSale.availableQuanta} Quanta).`
      );
      return;
    }

    const pricePerQuantum = selectedItemForSale.unitPriceTzs || 1250;
    const totalTzs = promptQuantity * pricePerQuantum;
    const receiptId = 'RCP-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Atomic state update with overflow-checked boundaries
    setShelfItems((prev) =>
      prev.map((i) =>
        i.itemId === selectedItemForSale.itemId
          ? { ...i, availableQuanta: Math.max(0, i.availableQuanta - promptQuantity) }
          : i
      )
    );

    const newRecord: PosReceiptRecord = {
      receiptId,
      inventoryId: selectedItemForSale.itemId,
      sku: selectedItemForSale.sku,
      quantaSold: promptQuantity,
      paymentMethod: selectedPaymentMethod,
      totalTzs,
      timestampEat: new Date().toLocaleTimeString(),
      synced: isOnline
    };

    if (isOnline) {
      void SokoApiClient.post('/retailer/pos/sales-receipt', {
        receiptId,
        inventoryId: selectedItemForSale.itemId,
        sku: selectedItemForSale.sku,
        quantaSold: promptQuantity,
        paymentMethod: selectedPaymentMethod,
        totalTzs,
      }).catch(() => {
        // Continue with local IndexedDB persistence
      });
    }

    setReceiptLedger((prev) => [newRecord, ...prev]);
    setToastNotice(
      isSw
        ? `Stakabadhi ya Mauzo ${receiptId} imekamilika! Njia: ${selectedPaymentMethod} · Jumla: TZS ${totalTzs.toLocaleString('en-US')}`
        : `POS Receipt ${receiptId} generated! Method: ${selectedPaymentMethod} · Total: TZS ${totalTzs.toLocaleString('en-US')}`
    );

    setSelectedItemForSale(null);
  };

  // Kunakili bidhaa kutoka soko kuu la kawaida (soko_global_catalog) kwenda duka la ndani
  // ikiwa na idadi ya 0 na bei ya TZS 0. Kama hakuna mtandao, inahifadhiwa IndexedDB
  // ikiwa na bendera ya PENDING_GLOBAL_CLONE_SYNC.
  const handleCloneGlobalCatalogItem = async (entry: GlobalCatalogEntry) => {
    const alreadyCloned = shelfItems.some(
      (i) => i.globalCatalogId === entry.globalCatalogId || i.sku === entry.canonicalSku
    );
    if (alreadyCloned) {
      setToastNotice(
        isSw
          ? `Bidhaa "${entry.canonicalSku}" tayari ipo kwenye wasifu wako wa duka.`
          : `Catalog SKU "${entry.canonicalSku}" is already cloned into your shop workspace.`
      );
      return;
    }

    const syncStatus: GlobalCloneSyncStatus = isOnline ? 'SYNCED' : 'PENDING_GLOBAL_CLONE_SYNC';
    const itemId = 'item-' + Math.random().toString(36).substring(2, 8);

    const clonedItem: DukaInventoryItem = {
      itemId,
      globalCatalogId: entry.globalCatalogId,
      imagekitCdnUrl: entry.imagekitCdnUrl, // Direct ImageKit CDN pointer (no local binary duplicate)
      syncStatus,
      sku: entry.canonicalSku,
      productNameSw: entry.fixedNameSw,
      productNameEn: entry.fixedNameEn,
      availableQuanta: 0, // Initialized with strictly 0 stock
      unitPriceTzs: 0,    // Initialized with strictly 0 currency config
      lowStockThresholdQuanta: 10,
      unitType: 'QUANTA_ZERO',
      lastRestockedEat: isSw ? 'Imenakiliwa (0 Stock · 0 TZS)' : 'Cloned (0 Stock · 0 TZS)'
    };

    if (!isOnline) {
      await stageOfflineGlobalClone({
        cloneRecordId: itemId,
        globalCatalogId: entry.globalCatalogId,
        canonicalSku: entry.canonicalSku,
        fixedNameSw: entry.fixedNameSw,
        fixedNameEn: entry.fixedNameEn,
        imagekitCdnUrl: entry.imagekitCdnUrl,
        initializedStockQuanta: 0,
        initializedPriceTzs: 0,
        syncStatus: 'PENDING_GLOBAL_CLONE_SYNC',
        stagedAtIso: new Date().toISOString(),
      });
    } else {
      try {
        await SokoApiClient.post('/marketplace/catalog/clone-standard', {
          globalCatalogId: entry.globalCatalogId,
        });
      } catch {
        // Fallback to local catalog increment
      }
      setGlobalCatalog(incrementCatalogCloneCounter(entry.globalCatalogId));
    }

    setShelfItems((prev) => [clonedItem, ...prev]);
    setToastNotice(
      !isOnline
        ? isSw
          ? `Nje ya Mtandao: ${entry.canonicalSku} imehifadhiwa ndani ikisubiri mtandao (0 Stock · 0 TZS).`
          : `Offline: ${entry.canonicalSku} staged locally for sync (0 Stock · 0 TZS).`
        : isSw
          ? `Imenakiliwa kutoka Katalogi Kuu: ${entry.canonicalSku} (ImageKit pointer +1 duka).`
          : `Cloned ${entry.canonicalSku} at 0 stock & 0 TZS (ImageKit CDN pointer copied · adoption +1).`
    );
  };

  const handleIngestShelfItem = (e: React.FormEvent) => {
    e.preventDefault();
    const item: DukaInventoryItem = {
      itemId: 'item-' + Math.random().toString(36).substring(2, 8),
      sku: newSku.toUpperCase(),
      productNameSw: newNameSw,
      productNameEn: newNameSw,
      availableQuanta: newQuantaQty,
      unitPriceTzs: 1250,
      lowStockThresholdQuanta: 15,
      unitType: 'CUSTOM',
      lastRestockedEat: isSw ? 'Sasa Hivi' : 'Just Now'
    };

    setShelfItems((prev) => [item, ...prev]);
    setToastNotice(
      isSw
        ? `Bidhaa mpya ${item.sku} imewekwa kwenye rafu za duka.`
        : `New item ${item.sku} successfully ingested onto shop shelf.`
    );
    setNewSku('SKU-NEW');
    setNewNameSw('');
    setNewQuantaQty(40);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Toast Notice */}
      {toastNotice && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 shadow-sm flex items-center justify-between gap-3 text-xs font-semibold text-emerald-950"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{toastNotice}</span>
          </div>
          <button type="button" onClick={() => setToastNotice(null)} className="text-slate-500 hover:text-slate-900">
            ✕
          </button>
        </div>
      )}

      {/* Network State Header with Offline Test Toggle */}
      <div className="bg-white border border-slate-100 rounded-lg shadow-sm p-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {isOnline ? (
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
              <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSw ? 'Mtandao Upo · Hifadhidata ya SokoKuu Iko Tayari' : 'Online · Live System Sync Engine Active'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100">
              <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSw ? 'Nje ya Mtandao · IndexedDB CoD Backup Hai' : 'Offline · IndexedDB CoD Backup Active'}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            const nextOnline = !isOnline;
            setIsOnline(nextOnline);
            if (nextOnline) {
              void flushPendingClones();
            }
          }}
          className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer"
        >
          {isOnline
            ? isSw
              ? 'Jaribu Offline'
              : 'Simulate Offline'
            : isSw
              ? 'Rejesha Mtandao & Sync'
              : 'Restore Online & Sync'}
        </button>
      </div>

      {/* VIEW 1: POS MAUZO (Directly from Top AppBar — zero inner sub-tabs) */}
      {activeSection === 'pos_register' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-950">
                  {isSw ? 'Sanduku la Mauzo la POS (Dynamic Registry)' : 'POS Sales Registry (Dynamic Prompt)'}
                </h3>
                <p className="text-xs text-slate-500">
                  {isSw
                    ? 'Bonyeza bidhaa yoyote kufungua dirisha la kuweka idadi na njia ya malipo (CASH / M-PESA / TIGO-PESA).'
                    : 'Click any product to open the dynamic quantity prompt dialog and select payment channel.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {shelfItems.map((item) => {
                const isLow = item.availableQuanta <= item.lowStockThresholdQuanta;
                return (
                  <button
                    key={item.itemId}
                    type="button"
                    onClick={() => handleOpenPosModal(item)}
                    className="text-left bg-white border border-slate-200 hover:border-emerald-600 rounded-lg p-4 shadow-sm transition-all cursor-pointer space-y-2 group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-mono text-xs font-bold text-emerald-700">{item.sku}</div>
                      <span className="text-[11px] font-medium bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                        {formatUnitTypeLabel(item.unitType, locale)}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-slate-950 group-hover:text-emerald-700 transition-colors">
                      {isSw ? item.productNameSw : item.productNameEn}
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-600 pt-1 border-t border-slate-100">
                      <span>
                        {isSw ? 'Iliyopo:' : 'Available:'}{' '}
                        <strong className="font-mono text-slate-950">{item.availableQuanta} Quanta</strong>
                      </span>
                      {isLow && (
                        <span className="text-amber-700 font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                          {isSw ? 'Imebaki Chache!' : 'Low Stock!'}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Recent POS Sales Receipt Ledger */}
          <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {isSw ? 'Stakabadhi za Hivi Punde za POS (Leja ya Duka)' : 'Recent POS Receipts Ledger'}
            </h4>
            {receiptLedger.length === 0 ? (
              <p className="text-xs text-slate-500 py-3 text-center">
                {isSw ? 'Hakuna mauzo yaliyorekodiwa leo bado.' : 'No POS sales recorded today yet.'}
              </p>
            ) : (
              <div className="space-y-2">
                {receiptLedger.map((rcp) => (
                  <div key={rcp.receiptId} className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between text-xs">
                    <div className="space-y-0.5">
                      <div className="font-mono font-bold text-slate-950">{rcp.receiptId} · SKU: {rcp.sku}</div>
                      <div className="text-slate-600">
                        {rcp.quantaSold} Quanta · {isSw ? 'Njia:' : 'Method:'}{' '}
                        <strong className="text-emerald-700">{rcp.paymentMethod}</strong> · {rcp.timestampEat}
                      </div>
                    </div>
                    <div className="text-right font-mono font-bold text-emerald-700">
                      TZS {rcp.totalTzs.toLocaleString('en-US')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: HIFADHI & BIDHAA (Global Catalog, Shelf Ingestion, & Custom Units) */}
      {activeSection === 'inventory_shelf' && (
        <div className="space-y-5">
          {/* Standardized Global Catalog Registry (soko_global_catalog) */}
          <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
            <div className="border-b border-slate-100 pb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                  <span>
                    {isSw
                      ? 'Katalogi Kuu ya SokoKuu (soko_global_catalog)'
                      : 'Global Standard Catalog Registry (soko_global_catalog)'}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isSw
                    ? 'Nakili bidhaa sanifu zenye picha rasmi kwenda kwenye duka lako zikiwa na Hifadhi 0 na Bei 0 TZS.'
                    : 'Clone standardized items with fixed titles & static imagery directly into your local shop initialized at 0 stock & 0 TZS.'}
                </p>
              </div>
              <span className="text-[11px] font-mono text-emerald-700 shrink-0">
                POST /catalog/clone-standard
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {globalCatalog.map((entry) => {
                const isCloned = shelfItems.some(
                  (i) => i.globalCatalogId === entry.globalCatalogId || i.sku === entry.canonicalSku
                );
                return (
                  <div
                    key={entry.globalCatalogId}
                    className="border border-slate-200 rounded-lg p-3.5 bg-white flex flex-col justify-between gap-3"
                  >
                    <div className="flex items-start gap-3">
                      <img
                        src={entry.imagekitCdnUrl || entry.staticImageUrl}
                        alt={isSw ? entry.fixedNameSw : entry.fixedNameEn}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          const target = e.currentTarget;
                          if (entry.staticImageUrl && target.src !== entry.staticImageUrl) {
                            target.src = entry.staticImageUrl;
                          }
                        }}
                        className="w-12 h-12 rounded-md object-cover border border-slate-100 shrink-0 bg-slate-50"
                      />
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                          <span className="font-bold text-emerald-700 truncate">
                            {entry.canonicalSku}
                          </span>
                          <span className="text-slate-500 tabular-nums shrink-0">
                            {entry.clonedByStoresCount}{' '}
                            {isSw ? 'maduka' : 'stores'}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-slate-950 leading-snug">
                          {isSw ? entry.fixedNameSw : entry.fixedNameEn}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {entry.category} · {isSw ? entry.defaultBaseUnitSw : entry.defaultBaseUnitEn}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isCloned}
                      onClick={() => handleCloneGlobalCatalogItem(entry)}
                      className={`w-full min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                        isCloned
                          ? 'bg-slate-100 text-slate-500 cursor-default'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                      }`}
                    >
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>
                        {isCloned
                          ? isSw
                            ? 'Imeshanakiliwa Dukani'
                            : 'Cloned in Shop'
                          : isSw
                            ? 'Nakili Dukani (0 Stock · 0 TZS)'
                            : 'Clone to Shop (0 Stock · 0 TZS)'}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-950">
                {isSw ? 'Usajili wa Bidhaa Mpya Kwenye Rafu (Mali ya Nje)' : 'New Shelf Ingestion & Stock-In'}
              </h3>
              <p className="text-xs text-slate-500">
                {isSw ? 'Ongeza bidhaa moja kwa moja kwenye hesabu za duka na kuziunganisha na PostgreSQL.' : 'Ingest new stock directly into duka shelves synced with PostgreSQL.'}
              </p>
            </div>

            <form onSubmit={handleIngestShelfItem} className="space-y-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">SKU Code</label>
                  <input
                    type="text"
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Jina la Bidhaa' : 'Product Name'}
                  </label>
                  <input
                    type="text"
                    value={newNameSw}
                    onChange={(e) => setNewNameSw(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Idadi ya Quanta (Hifadhi ya Msingi)' : 'Quanta Quantity (Base Stock)'}
                </label>
                <input
                  type="number"
                  min="4"
                  value={newQuantaQty}
                  onChange={(e) => setNewQuantaQty(parseInt(e.target.value) || 4)}
                  className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full min-h-[42px] px-4 py-2 bg-slate-950 hover:bg-slate-900 text-white font-semibold text-xs rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                {isSw ? 'Weka Bidhaa Hii Kwenye Rafu' : 'Ingest Item onto Shelf'}
              </button>
            </form>

            {/* Current Shop Shelf Overview (including cloned 0-stock / 0-TZS rows) */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {isSw ? 'Hifadhi ya Sasa Dukani' : 'Current Shop Shelf Ledger'}
              </h4>
              <div className="space-y-2">
                {shelfItems.map((item) => (
                  <div
                    key={item.itemId}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-mono font-bold text-slate-950 truncate">
                        <span>{item.sku}</span>
                        {item.syncStatus === 'PENDING_GLOBAL_CLONE_SYNC' && (
                          <span className="text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-200 px-1.5 py-0.5 rounded">
                            {isSw ? 'Inasubiri Usawazishaji' : 'Pending Sync'}
                          </span>
                        )}
                      </div>
                      <div className="text-slate-600 truncate">
                        {isSw ? item.productNameSw : item.productNameEn}
                      </div>
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <div className="font-bold text-slate-950">{item.availableQuanta} Quanta</div>
                      <div className="text-[11px] text-emerald-700">
                        TZS {item.unitPriceTzs.toLocaleString('en-US')} / Q
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Merchant Custom Units Configurator (Strictly under Inventory & Catalogs) */}
          <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-950">
                {isSw ? 'Vipimo Maalum vya Duka (Merchant Custom Units)' : 'Merchant Custom Units Configurator'}
              </h3>
              <p className="text-xs text-slate-500">
                {isSw
                  ? 'Sanidi vipimo vya kienyeji (kama Debe, Sado, Dumu) vinavyobadilishwa kuwa Quanta kamili (KG * 4).'
                  : 'Configure bespoke local units (Debe, Sado, Dumu) mapped to integer Quanta scale (KG * 4).'}
              </p>
            </div>

            <form onSubmit={handleCreateCustomUnit} className="space-y-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Jina la Kipimo (Mf. Debe, Sado)' : 'Unit Name (e.g. Debe, Sado)'}
                  </label>
                  <input
                    type="text"
                    value={newUnitName}
                    onChange={(e) => setNewUnitName(e.target.value)}
                    placeholder={isSw ? 'Mf. Debe la Pamba' : 'e.g. Debe Special'}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Uzito wa Kilo (Base KG)' : 'Base Weight in KG'}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.25"
                    value={newBaseKg}
                    onChange={(e) => setNewBaseKg(parseFloat(e.target.value) || 1)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    required
                  />
                </div>
              </div>

              <div className="text-[11px] text-emerald-800 font-mono bg-emerald-50 p-2.5 rounded border border-emerald-100">
                {isSw ? 'Ubadilishaji wa Hisabati:' : 'Conversion Formula:'} {newBaseKg} KG × 4 ={' '}
                <strong>{Math.round(newBaseKg * 4)} Quarter Quanta</strong>
              </div>

              <button
                type="submit"
                className="w-full min-h-[42px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <PlusCircle className="w-4 h-4" aria-hidden="true" />
                <span>{isSw ? 'Hifadhi Kipimo Kipya (Hifadhidata ya SokoKuu)' : 'Save Custom Unit to Cloud Database Core'}</span>
              </button>
            </form>

            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {isSw ? 'Vipimo Vinavyotumika Sasa' : 'Active Merchant Units'}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {customUnits.map((u) => (
                  <div key={u.unitId} className="bg-white border border-slate-200 rounded-lg p-3 space-y-1 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-950">{u.unitName}</span>
                      <span className="font-mono text-xs text-emerald-700 font-semibold">{u.quantaEquivalent} Quanta</span>
                    </div>
                    <p className="text-[11px] text-slate-600">{u.descriptionSw}</p>
                    <div className="text-[10px] font-mono text-slate-400">Base: {u.baseMultiplierKg} KG</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DYNAMIC POS QUANTITY PROMPT MODAL OVERLAY */}
      {selectedItemForSale && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="font-mono text-xs font-bold text-emerald-700">{selectedItemForSale.sku}</div>
                <h3 className="text-base font-bold text-slate-950 mt-0.5">
                  {isSw ? selectedItemForSale.productNameSw : selectedItemForSale.productNameEn}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedItemForSale(null)}
                className="text-slate-400 hover:text-slate-900 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleExecutePosSale} className="space-y-4">
              <div className="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>{isSw ? 'Weka Idadi ya Quanta (Inayouzwa):' : 'Declared Quanta Volume:'}</span>
                  <strong className="font-mono text-emerald-700 text-sm">{promptQuantity} Quanta</strong>
                </div>
                <input
                  type="range"
                  min="1"
                  max={selectedItemForSale.availableQuanta}
                  value={promptQuantity}
                  onChange={(e) => setPromptQuantity(parseInt(e.target.value) || 1)}
                  className="w-full accent-emerald-600 cursor-pointer"
                />
                <div className="flex justify-between text-[11px] font-mono text-slate-500">
                  <span>1 Quanta (250g)</span>
                  <span>
                    {isSw ? 'Upeo:' : 'Max:'} {selectedItemForSale.availableQuanta} Quanta
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Njia ya Malipo (Payment Method):' : 'Payment Channel:'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['CASH', 'M-PESA', 'TIGO-PESA'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setSelectedPaymentMethod(method)}
                      className={`min-h-[40px] px-2 py-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        selectedPaymentMethod === method
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3.5 flex items-center justify-between text-xs">
                <span className="text-slate-700 font-medium">{isSw ? 'Jumla ya Mauzo:' : 'Total Payable Amount:'}</span>
                <span className="font-mono font-bold text-emerald-800 text-sm">
                  TZS {(promptQuantity * (selectedItemForSale.unitPriceTzs || 1250)).toLocaleString('en-US')}
                </span>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedItemForSale(null)}
                  className="flex-1 min-h-[44px] px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-xl cursor-pointer transition-colors"
                >
                  {isSw ? 'Ghairi (Cancel)' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="flex-1 min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl shadow-sm cursor-pointer transition-colors flex items-center justify-center gap-2"
                >
                  <DollarSign className="w-4 h-4" aria-hidden="true" />
                  <span>{isSw ? 'Thibitisha & Kata Mauzo' : 'Confirm & Deduct Stock'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
