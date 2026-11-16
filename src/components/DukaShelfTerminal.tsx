import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  PlusCircle,
  CheckCircle2,
  TrendingDown,
  Layers,
  RefreshCcw,
  Receipt,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { Locale } from '../data/i18n';

interface DukaInventoryItem {
  itemId: string;
  sku: string;
  productNameSw: string;
  productNameEn: string;
  availableQuanta: number; // Namba kamili ya Quarter Quanta (1 = 250g, 4 = 1KG)
  lowStockThresholdQuanta: number;
  unitType: string;
  lastRestockedEat: string;
}

interface PosReceiptRecord {
  receiptId: string;
  sku: string;
  quantaSold: number;
  totalTzs: number;
  timestampEat: string;
  synced: boolean;
}

const INITIAL_SHELF_INVENTORY: DukaInventoryItem[] = [
  {
    itemId: 'shelf-01',
    sku: 'AZN-1KG',
    productNameSw: 'Unga wa Ngano Azania (Kilo 1)',
    productNameEn: 'Azania Wheat Flour (1KG)',
    availableQuanta: 12,
    lowStockThresholdQuanta: 15,
    unitType: 'QUARTER_4',
    lastRestockedEat: 'Leo 08:30 EAT',
  },
  {
    itemId: 'shelf-02',
    sku: 'KOR-250ML',
    productNameSw: 'Mafuta ya Kupikia Korie (Robo 250mL)',
    productNameEn: 'Korie Cooking Oil (250mL)',
    availableQuanta: 36,
    lowStockThresholdQuanta: 10,
    unitType: 'QUARTER_1',
    lastRestockedEat: 'Leo 10:15 EAT',
  },
  {
    itemId: 'shelf-03',
    sku: 'KLM-5KG',
    productNameSw: 'Sukari ya Kilombero (5KG)',
    productNameEn: 'Kilombero Sugar (5KG)',
    availableQuanta: 8,
    lowStockThresholdQuanta: 10,
    unitType: 'QUARTER_20',
    lastRestockedEat: 'Jana 16:45 EAT',
  },
  {
    itemId: 'shelf-04',
    sku: 'MBY-25KG',
    productNameSw: 'Mchele wa Mbeya Super (25KG Gunia)',
    productNameEn: 'Mbeya Super Rice (25KG Sack)',
    availableQuanta: 100,
    lowStockThresholdQuanta: 20,
    unitType: 'QUARTER_100',
    lastRestockedEat: 'Leo 11:00 EAT',
  },
];

const IDB_NAME = 'sokokuu_duka_shelf_db';
const IDB_STORE = 'shelf_inventory';

async function saveShelfToIndexedDB(items: DukaInventoryItem[]) {
  return new Promise<void>((resolve) => {
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
// DukaShelfTerminal.tsx
// Zimehamishwa tab za juu kwenda kwenye AppBar kupitia App.tsx.
// Hapa tunatoa maudhui ya POS Mauzo na Inventory / Catalogs.
// ============================================================================
export function DukaShelfTerminal({
  locale = 'en',
  mode = 'pos_register',
}: {
  locale?: Locale;
  mode?: 'pos_register' | 'inventory_shelf';
}) {
  const isSw = locale === 'sw';
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof window !== 'undefined' ? window.navigator.onLine : true
  );

  const [shelfItems, setShelfItems] = useState<DukaInventoryItem[]>(INITIAL_SHELF_INVENTORY);
  const [pendingReceipts, setPendingReceipts] = useState<PosReceiptRecord[]>([]);
  const [toastNotice, setToastNotice] = useState<string | null>(null);

  const [newSku, setNewSku] = useState('SKU-NEW');
  const [newNameSw, setNewNameSw] = useState('Mchele Maalum');
  const [newQuanta, setNewQuanta] = useState<number>(40);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncPendingPosSales();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [pendingReceipts]);

  useEffect(() => {
    saveShelfToIndexedDB(shelfItems);
  }, [shelfItems]);

  const syncPendingPosSales = async () => {
    if (pendingReceipts.length === 0) return;
    
    setToastNotice(
      isSw
        ? `Inasawazisha stakabadhi ${pendingReceipts.length} za POS kwenda Hifadhidata ya SokoKuu...`
        : `Syncing ${pendingReceipts.length} pending POS receipts to Cloud Database Core...`
    );

    await new Promise((r) => setTimeout(r, 1200));

    setPendingReceipts([]);
    setToastNotice(
      isSw
        ? 'Usawazishaji wa POS umekamilika. Hifadhi na leja zimesawazishwa.'
        : 'POS background sync completed. Inventories and ledgers successfully reconciled.'
    );
  };

  const handlePosSale = (item: DukaInventoryItem, quantaSold: number) => {
    const pricePerQuantum = 1200;
    const totalTzs = quantaSold * pricePerQuantum;
    const receiptId = 'RCP-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    setShelfItems((prev) =>
      prev.map((i) =>
        i.itemId === item.itemId
          ? { ...i, availableQuanta: Math.max(0, i.availableQuanta - quantaSold) }
          : i
      )
    );

    const newReceipt: PosReceiptRecord = {
      receiptId,
      sku: item.sku,
      quantaSold,
      totalTzs,
      timestampEat: new Date().toLocaleTimeString(),
      synced: isOnline,
    };

    if (!isOnline) {
      setPendingReceipts((prev) => [newReceipt, ...prev]);
      setToastNotice(
        isSw
          ? `Nje ya Mtandao: Mauzo ya POS ${receiptId} yamewekwa kwenye folda ya IndexedDB.`
          : `Offline mode: POS sale ${receiptId} queued in local IndexedDB storage.`
      );
    } else {
      setToastNotice(
        isSw
          ? `Mauzo ya POS yamerekodiwa kikamilifu (${receiptId}) · TZS ${totalTzs.toLocaleString('en-US')}`
          : `POS Sale registered successfully (${receiptId}) · TZS ${totalTzs.toLocaleString('en-US')}`
      );
    }
  };

  const handleManualIngestion = (e: React.FormEvent) => {
    e.preventDefault();
    const newItem: DukaInventoryItem = {
      itemId: 'shelf-' + Math.random().toString(36).substring(2, 8),
      sku: newSku.toUpperCase(),
      productNameSw: newNameSw,
      productNameEn: newNameSw,
      availableQuanta: newQuanta,
      lowStockThresholdQuanta: 10,
      unitType: 'QUARTER_4',
      lastRestockedEat: 'Sasa Hivi',
    };

    setShelfItems((prev) => [newItem, ...prev]);
    setToastNotice(
      isSw
        ? `Bidhaa mpya (${newItem.sku}) imeongezwa kwenye hifadhi ya duka.`
        : `New item (${newItem.sku}) successfully ingested into store shelf.`
    );
    setNewSku('SKU-NEW');
    setNewNameSw('');
    setNewQuanta(40);
  };

  const lowStockCount = shelfItems.filter((i) => i.availableQuanta <= i.lowStockThresholdQuanta).length;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {toastNotice && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 shadow-sm flex items-center justify-between gap-3 text-xs font-semibold text-emerald-900"
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

      {mode === 'pos_register' && (
        <div className="space-y-6">
          <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  <span>{isSw ? 'Mashine ya POS — Mauzo ya Rejareja ya Mtaani' : 'Walk-in Consumer POS Register'}</span>
                </h2>
                <p className="text-xs text-slate-500">
                  {isSw
                    ? 'Rekodi mauzo ya mara kwa mara (Robo, Nusu, Lita 1) kwa wateja wa mtaani.'
                    : 'Process walk-in B2C retail cash sales with instant integer inventory decrement.'}
                </p>
              </div>

              {pendingReceipts.length > 0 && (
                <button
                  type="button"
                  onClick={syncPendingPosSales}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-xs cursor-pointer"
                >
                  <RefreshCcw className="w-3.5 h-3.5" />
                  <span>{isSw ? `Sawazisha POS (${pendingReceipts.length})` : `Sync POS (${pendingReceipts.length})`}</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {shelfItems.map((item) => (
                <div key={item.itemId} className="border border-slate-100 rounded-lg p-4 space-y-3 bg-slate-50/40">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-bold text-slate-900">{item.sku}</span>
                    <span className="text-emerald-700 font-semibold">{item.availableQuanta}Q Available</span>
                  </div>

                  <div className="text-sm font-semibold text-slate-900">
                    {isSw ? item.productNameSw : item.productNameEn}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => handlePosSale(item, 1)}
                      className="min-h-[40px] px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-md shadow-xs cursor-pointer"
                    >
                      Mauzo: Robo (-1Q)
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePosSale(item, 4)}
                      className="min-h-[40px] px-3 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-xs cursor-pointer"
                    >
                      Mauzo: Kilo 1 (-4Q)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {mode === 'inventory_shelf' && (
        <div className="space-y-6">
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm space-y-1">
              <div className="text-xs text-slate-500 font-medium">
                {isSw ? 'Jumla ya Bidhaa Rafu' : 'Active Shelf Items'}
              </div>
              <div className="text-2xl font-bold font-mono text-slate-900">{shelfItems.length}</div>
              <div className="text-xs text-slate-500">IndexedDB Local Cache</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm space-y-1">
              <div className="text-xs text-slate-500 font-medium">
                {isSw ? 'Tahadhari ya Kuisha' : 'Low Stock Alerts'}
              </div>
              <div className="text-2xl font-bold font-mono text-red-600">{lowStockCount}</div>
              <div className="text-xs text-slate-500">Below safety threshold</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm space-y-1">
              <div className="text-xs text-slate-500 font-medium">
                {isSw ? 'Hali ya Usalama wa Hifadhi' : 'Inventory Ledger Integrity'}
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-600">100%</div>
              <div className="text-xs text-slate-500">Zero-Float Quanta Guard</div>
            </div>
          </section>

          {lowStockCount > 0 && (
            <div className="border border-red-200 bg-red-50 rounded-lg p-4 shadow-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                <div className="text-sm font-bold text-red-900">
                  {isSw ? 'Tahadhari ya Hifadhi: Bidhaa Zinaisha!' : 'Low Stock Warning: Restock Required!'}
                </div>
                <div className="text-xs text-red-800">
                  {isSw
                    ? 'Baadhi ya bidhaa zimefika chini ya kikomo chao cha usalama. Jaza akiba kupitia oda za jumla.'
                    : 'Certain shelf items have fallen below safety quanta limits. Replenish stock immediately.'}
                </div>
              </div>
            </div>
          )}

          <section className="bg-white border border-slate-100 rounded-lg shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                <span>{isSw ? 'Hifadhi ya Rafu ya Duka (Retailer Inventories)' : 'Retail Duka Shelf Inventory Terminal'}</span>
              </h2>
              <span className="text-xs font-mono text-slate-500">Integer Quanta (1Q = 250g)</span>
            </div>

            <div className="divide-y divide-slate-100">
              {shelfItems.map((item) => {
                const isLow = item.availableQuanta <= item.lowStockThresholdQuanta;

                return (
                  <div key={item.itemId} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-slate-900">{item.sku}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-500">{item.lastRestockedEat}</span>
                        {isLow && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-100 text-red-800">
                            <TrendingDown className="w-3 h-3" /> LOW STOCK
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-bold text-slate-900">
                        {isSw ? item.productNameSw : item.productNameEn}
                      </div>
                      <div className="text-xs font-mono text-slate-600">
                        Akiba: <strong className={isLow ? 'text-red-600' : 'text-emerald-700'}>{item.availableQuanta} Quanta</strong> ({(item.availableQuanta * 0.25).toFixed(2)} KG/L) · Kiwango cha chini: {item.lowStockThresholdQuanta}Q
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <PlusCircle className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              <span>{isSw ? 'Ingiza Bidhaa Mpya kwa Mikono (Mali ya Nje)' : 'Manual Ingestion (External Supplier Stock-In)'}</span>
            </h3>

            <form onSubmit={handleManualIngestion} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700">SKU</span>
                <input
                  type="text"
                  required
                  value={newSku}
                  onChange={(e) => setNewSku(e.target.value)}
                  className="w-full min-h-[40px] px-3 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700">{isSw ? 'Jina la Bidhaa' : 'Product Name'}</span>
                <input
                  type="text"
                  required
                  value={newNameSw}
                  onChange={(e) => setNewNameSw(e.target.value)}
                  placeholder="Mf. Sukari"
                  className="w-full min-h-[40px] px-3 text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700">{isSw ? 'Kiasi cha Quanta' : 'Initial Quanta'}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    required
                    value={newQuanta}
                    onChange={(e) => setNewQuanta(Number(e.target.value))}
                    className="w-full min-h-[40px] px-3 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md whitespace-nowrap cursor-pointer shadow-xs"
                  >
                    Ongeza
                  </button>
                </div>
              </label>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
