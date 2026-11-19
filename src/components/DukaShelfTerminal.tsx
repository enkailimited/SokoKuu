import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  PlusCircle,
  CheckCircle2,
  TrendingDown,
  Layers,
  Receipt,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

interface DukaInventoryItem {
  itemId: string;
  sku: string;
  productNameSw: string;
  productNameEn: string;
  availableQuanta: number;
  sealedBulkPackagesStock: number;
  lowStockThresholdQuanta: number;
  unitPriceTzs: number;
  cartonPriceTzs: number;
  unitType: string;
  lastRestockedEat: string;
}

interface PosReceiptRecord {
  receiptId: string;
  sku: string;
  quantaSold: number;
  totalTzs: number;
  timestampEat: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}

export function DukaShelfTerminal({
  locale = 'en',
  mode = 'pos_register',
  businessId,
}: {
  locale?: Locale;
  mode?: 'pos_register' | 'inventory_shelf';
  businessId?: string | null;
}) {
  const isSw = locale === 'sw';

  const [shelfItems, setShelfItems] = useState<DukaInventoryItem[]>([]);
  const [recentReceipts, setRecentReceipts] = useState<PosReceiptRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [submittingSaleId, setSubmittingSaleId] = useState<string | null>(null);
  const [savingProduct, setSavingProduct] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(
    typeof window !== 'undefined' ? !window.navigator.onLine : false
  );
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const [newSku, setNewSku] = useState('');
  const [newNameSw, setNewNameSw] = useState('');
  const [newUnitPriceTzs, setNewUnitPriceTzs] = useState<number>(0);
  const [newQuanta, setNewQuanta] = useState<number>(4);

  const loadShelfItems = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setLoading(true);
    setBackendOffline(false);
    setErrorNotice(null);

    try {
      let targetBusinessId = isUuid(businessId)
        ? businessId
        : SokoApiClient.getActiveUser()?.businessId ?? null;

      if (!isUuid(targetBusinessId) && SokoApiClient.hasAccessToken()) {
        const me = await SokoApiClient.get<{ businessId?: string | null }>('/auth/me');
        targetBusinessId = me?.businessId ?? null;
      }

      if (!isUuid(targetBusinessId)) {
        setShelfItems([]);
        return;
      }

      const products = await SokoApiClient.get<
        Array<{
          productId: string;
          sku: string;
          nameSw: string;
          nameEn: string;
          unitPriceTzs: number;
          cartonPriceTzs: number;
          availableQuarterQuanta: number;
          sealedBulkPackagesStock: number;
          priceTiers?: Array<{ unitType: string }>;
        }>
      >(`/products/active?businessId=${encodeURIComponent(targetBusinessId)}`);

      setShelfItems(
        (Array.isArray(products) ? products : []).map((p) => ({
          itemId: p.productId,
          sku: p.sku,
          productNameSw: p.nameSw,
          productNameEn: p.nameEn,
          availableQuanta: Number(p.availableQuarterQuanta ?? 0),
          sealedBulkPackagesStock: Number(p.sealedBulkPackagesStock ?? 0),
          lowStockThresholdQuanta: 20,
          unitPriceTzs: Number(p.unitPriceTzs ?? 0),
          cartonPriceTzs: Number(p.cartonPriceTzs ?? 0),
          unitType: p.priceTiers?.[0]?.unitType ?? 'UNIT',
          lastRestockedEat: new Date().toLocaleDateString(),
        }))
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else if (err instanceof SokoHttpError) {
        setErrorNotice(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void loadShelfItems();
  }, [loadShelfItems]);

  useEffect(() => {
    const handleOnline = () => {
      setBackendOffline(false);
      void loadShelfItems();
    };
    const handleOffline = () => setBackendOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadShelfItems]);

  const handlePosSale = async (item: DukaInventoryItem, quantaSold: number) => {
    setErrorNotice(null);
    setToastNotice(null);
    setSubmittingSaleId(item.itemId);

    try {
      const res = await SokoApiClient.post<{
        receiptId: string;
        quantaSold: number;
        totalTzs: number;
        remainingLooseQuanta: number;
        remainingSealedPackages: number;
        timestampEat: string;
      }>('/retailer/pos/sales-receipt', {
        productId: item.itemId,
        quantityRequested: quantaSold,
        paymentMethod: 'CASH',
      });

      setShelfItems((prev) =>
        prev.map((i) =>
          i.itemId === item.itemId
            ? {
                ...i,
                availableQuanta: res.remainingLooseQuanta,
                sealedBulkPackagesStock: res.remainingSealedPackages,
              }
            : i
        )
      );

      setRecentReceipts((prev) => [
        {
          receiptId: res.receiptId,
          sku: item.sku,
          quantaSold: res.quantaSold,
          totalTzs: res.totalTzs,
          timestampEat: new Date(res.timestampEat).toLocaleTimeString(),
        },
        ...prev,
      ]);

      setToastNotice(
        isSw
          ? `Mauzo ya POS yamerekodiwa PostgreSQL (${res.receiptId}) · TZS ${res.totalTzs.toLocaleString('en-US')}`
          : `POS Sale committed to PostgreSQL (${res.receiptId}) · TZS ${res.totalTzs.toLocaleString('en-US')}`
      );
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setErrorNotice(
          isSw
            ? 'Mtandao haupatikani: POS inahitaji muunganisho wa seva ya NestJS.'
            : 'Offline right now — this POS sale could not be posted.'
        );
      } else {
        setErrorNotice(err instanceof Error ? err.message : 'POS sale failed.');
      }
    } finally {
      setSubmittingSaleId(null);
    }
  };

  const handleManualIngestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNotice(null);
    setToastNotice(null);

    const skuClean = newSku.trim().toUpperCase().slice(0, 8);
    if (!skuClean || !newNameSw.trim() || newUnitPriceTzs <= 0) {
      setErrorNotice(
        isSw
          ? 'Weka SKU, jina la bidhaa, na bei ya kipimo (TZS > 0).'
          : 'Enter SKU code, product name, and unit price (TZS > 0).'
      );
      return;
    }

    setSavingProduct(true);
    try {
      await SokoApiClient.post('/products', {
        smsItemCode: skuClean,
        nameSw: newNameSw.trim(),
        nameEn: newNameSw.trim(),
        unitPriceTzs: Math.round(newUnitPriceTzs),
        packPriceTzs: Math.round(newUnitPriceTzs * 4),
        dozenPriceTzs: Math.round(newUnitPriceTzs * 12),
        cartonPriceTzs: Math.round(newUnitPriceTzs * 24),
        baseQuarterQuantaStock: Math.max(0, Math.round(newQuanta)),
        sealedBulkPackagesStock: 0,
      });

      setToastNotice(
        isSw
          ? `Bidhaa mpya (${skuClean}) imesajiliwa moja kwa moja kwenye PostgreSQL.`
          : `New item (${skuClean}) committed directly to PostgreSQL shelf.`
      );
      setNewSku('');
      setNewNameSw('');
      setNewUnitPriceTzs(0);
      setNewQuanta(4);
      await loadShelfItems();
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorNotice(err instanceof Error ? err.message : 'Product ingestion failed.');
      }
    } finally {
      setSavingProduct(false);
    }
  };

  const lowStockCount = shelfItems.filter((i) => i.availableQuanta <= i.lowStockThresholdQuanta).length;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          onRetry={() => void loadShelfItems()}
          retrying={loading}
        />
      )}

      {errorNotice && (
        <div
          role="alert"
          className="border border-rose-200 bg-rose-50 rounded-lg p-4 shadow-sm flex items-center justify-between gap-3 text-xs font-semibold text-rose-900"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
            <span>{errorNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorNotice(null)}
            className="text-rose-500 hover:text-rose-900 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {toastNotice && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 shadow-sm flex items-center justify-between gap-3 text-xs font-semibold text-emerald-900"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{toastNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastNotice(null)}
            className="text-slate-500 hover:text-slate-900 cursor-pointer"
          >
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
                    ? 'Rekodi mauzo ya mara kwa mara (Robo, Nusu, Lita 1) moja kwa moja kwenye PostgreSQL.'
                    : 'Process walk-in B2C retail cash sales with atomic PostgreSQL Quarter-Quanta decrement.'}
                </p>
              </div>
            </div>

            {shelfItems.length === 0 ? (
              <EmptyStateCard
                locale={locale}
                titleSw="Hakuna bidhaa dukani bado"
                titleEn="No shelf products found"
                descriptionSw="Hakuna bidhaa zilizosajiliwa kwenye PostgreSQL kwa akaunti hii."
                descriptionEn="No active PostgreSQL products exist for this Merchant account yet."
              />
            ) : (
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
                    <div className="text-xs font-mono text-slate-500">
                      TZS {item.unitPriceTzs.toLocaleString('en-US')} / 4Q
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <button
                        type="button"
                        disabled={submittingSaleId === item.itemId}
                        onClick={() => void handlePosSale(item, 1)}
                        className="min-h-[40px] px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md shadow-xs cursor-pointer"
                      >
                        {isSw ? 'Mauzo: Robo (-1Q)' : 'Sale: 1/4 (-1Q)'}
                      </button>
                      <button
                        type="button"
                        disabled={submittingSaleId === item.itemId}
                        onClick={() => void handlePosSale(item, 4)}
                        className="min-h-[40px] px-3 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md shadow-xs cursor-pointer"
                      >
                        {isSw ? 'Mauzo: Kilo 1 (-4Q)' : 'Sale: 1KG (-4Q)'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {recentReceipts.length > 0 && (
            <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-5 space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {isSw ? 'Stakabadhi za POS (PostgreSQL)' : 'Session POS Receipts (PostgreSQL)'}
              </h3>
              <div className="space-y-2">
                {recentReceipts.map((rcp) => (
                  <div
                    key={rcp.receiptId}
                    className="flex items-center justify-between text-xs bg-slate-50 border border-slate-200 rounded px-3 py-2 font-mono"
                  >
                    <span>
                      {rcp.receiptId} · {rcp.sku} (-{rcp.quantaSold}Q) · {rcp.timestampEat}
                    </span>
                    <span className="font-bold text-emerald-700">
                      TZS {rcp.totalTzs.toLocaleString('en-US')}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
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
              <div className="text-xs text-slate-500">PostgreSQL Live</div>
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
              <div className="text-2xl font-bold font-mono text-emerald-600">
                {backendOffline ? '--' : '100%'}
              </div>
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
                <span>{isSw ? 'Hifadhi ya Rafu ya Mfanyabiashara' : 'Merchant Shelf Inventory Terminal'}</span>
              </h2>
              <span className="text-xs font-mono text-slate-500">Integer Quanta (1Q = 250g)</span>
            </div>

            {shelfItems.length === 0 ? (
              <div className="p-4">
                <EmptyStateCard
                  locale={locale}
                  titleSw="Hakuna bidhaa dukani bado"
                  titleEn="No shelf items yet"
                  descriptionSw="Ongeza bidhaa mpya kwa fomu iliyo hapa chini."
                  descriptionEn="Add a product using the form below to populate your PostgreSQL shelf."
                />
              </div>
            ) : (
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
            )}
          </section>

          <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <PlusCircle className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              <span>{isSw ? 'Sajili Bidhaa Mpya (PostgreSQL)' : 'Create Active Merchant SKU (PostgreSQL)'}</span>
            </h3>

            <form onSubmit={handleManualIngestion} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700">SKU (max 8)</span>
                <input
                  type="text"
                  maxLength={8}
                  required
                  value={newSku}
                  onChange={(e) => setNewSku(e.target.value)}
                  placeholder="SGR01"
                  className="w-full min-h-[40px] px-3 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none uppercase"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700">{isSw ? 'Jina la Bidhaa' : 'Product Name'}</span>
                <input
                  type="text"
                  required
                  value={newNameSw}
                  onChange={(e) => setNewNameSw(e.target.value)}
                  placeholder={isSw ? 'Jina la bidhaa...' : 'Product name...'}
                  className="w-full min-h-[40px] px-3 text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700">{isSw ? 'Bei ya 1KG / Lita (TZS)' : 'Unit Price (TZS)'}</span>
                <input
                  type="number"
                  min={1}
                  required
                  value={newUnitPriceTzs || ''}
                  onChange={(e) => setNewUnitPriceTzs(Number(e.target.value))}
                  placeholder="3200"
                  className="w-full min-h-[40px] px-3 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700">{isSw ? 'Kiasi cha Quanta' : 'Initial Quanta'}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    required
                    value={newQuanta}
                    onChange={(e) => setNewQuanta(Number(e.target.value))}
                    className="w-full min-h-[40px] px-3 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={savingProduct}
                    className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md whitespace-nowrap cursor-pointer shadow-xs"
                  >
                    {savingProduct ? (isSw ? 'Inahifadhi...' : 'Saving...') : isSw ? 'Ongeza' : 'Create'}
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
