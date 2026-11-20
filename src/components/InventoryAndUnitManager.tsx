import { useCallback, useEffect, useState } from 'react';
import {
  PlusCircle,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  DollarSign,
  Copy,
  Globe,
  X,
  Tag,
  PackagePlus,
  RotateCcw,
  Search,
  Minus,
  Plus,
  Boxes,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  formatUnitTypeLabel,
  loadPendingGlobalClones,
  markGlobalClonesSynced,
  stageOfflineGlobalClone,
  type GlobalCatalogEntry,
  type GlobalCloneSyncStatus,
} from '../lib/sokoManagedState';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}

export interface MerchantCustomUnit {
  unitId: string;
  productId?: string;
  productSku?: string;
  unitCode: string;
  unitName: string;
  baseMultiplierKg: number;
  quantaEquivalent: number;
  priceTzs: number;
  isWholesaleTier: boolean;
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
  availableQuanta: number;
  sealedBulkPackagesStock?: number;
  unitPriceTzs: number;
  cartonPriceTzs?: number;
  lowStockThresholdQuanta: number;
  unitType: string;
  lastRestockedEat: string;
}

export interface ClonedCatalogItemRecord {
  clonedProductId: string;
  retailerBusinessId: string;
  globalCatalogId: string;
  canonicalSku: string;
  fixedNameSw: string;
  fixedNameEn: string;
  imagekitCdnUrl: string;
  availableQuantaStock: number;
  lowStockThresholdQuanta: number;
  unitPriceTzs: number;
  inventoryValueTzs: number;
  lastBuyingPricePerQuantumTzs: number;
  weightedAvgBuyingCostPerQuantumTzs: number;
  buyingPriceEstablished: boolean;
  unitPricingOverrides: Array<{
    overrideId: string;
    globalProductUnitId: string;
    unitCode: string;
    displayLabelSw: string;
    displayLabelEn: string;
    quarterQuantaPerUnit: number;
    standardPriceId: string | null;
    standardPriceVersion: number;
    selectedStandardPriceTzs: number | null;
    amendedSellingPriceTzs: number | null;
    effectiveSellingPriceTzs: number;
    isOverridden: boolean;
  }>;
}

interface GlobalProductUnitDto {
  id: string;
  quarterQuantaPerUnit: number;
  displayLabelSw: string | null;
  displayLabelEn: string | null;
  isWholesaleUnit: boolean;
  systemUnit?: {
    unitCode: string;
    nameSw: string;
    nameEn: string;
    abbreviation: string;
  };
}

interface StandardPriceDto {
  id: string;
  globalProductUnitId: string;
  pricingProfileId: string;
  profileCode: string;
  profileType: 'RETAIL' | 'WHOLESALE' | 'REGIONAL' | 'PROMOTIONAL';
  version: number;
  minQty: number;
  maxQty: number | null;
  standardPriceTzs: number;
  currency: string;
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

function mapPaymentMethodToPosDto(
  method: 'CASH' | 'M-PESA' | 'TIGO-PESA'
): 'CASH' | 'M_PESA' | 'TIGO_PESA' {
  if (method === 'M-PESA') return 'M_PESA';
  if (method === 'TIGO-PESA') return 'TIGO_PESA';
  return 'CASH';
}

export function InventoryAndUnitManager({
  locale = 'en',
  activeSection = 'pos_register',
  businessId,
}: {
  locale?: Locale;
  activeSection?: 'pos_register' | 'inventory_shelf';
  businessId?: string | null;
}) {
  const isSw = locale === 'sw';

  const [resolvedBusinessId, setResolvedBusinessId] = useState<string | null>(
    isUuid(businessId) ? businessId : SokoApiClient.getActiveUser()?.businessId ?? null
  );
  const [backendOffline, setBackendOffline] = useState<boolean>(
    typeof window !== 'undefined' ? !window.navigator.onLine : false
  );
  const [loadingLive, setLoadingLive] = useState<boolean>(false);

  const [customUnits, setCustomUnits] = useState<MerchantCustomUnit[]>([]);
  const [globalCatalog, setGlobalCatalog] = useState<GlobalCatalogEntry[]>([]);
  const [clonedItems, setClonedItems] = useState<ClonedCatalogItemRecord[]>([]);
  const [shelfItems, setShelfItems] = useState<DukaInventoryItem[]>([]);
  const [receiptLedger, setReceiptLedger] = useState<PosReceiptRecord[]>([]);
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // Dynamic POS Modal State
  const [posSearch, setPosSearch] = useState<string>('');
  const [selectedItemForSale, setSelectedItemForSale] = useState<DukaInventoryItem | null>(null);
  const [promptQuantity, setPromptQuantity] = useState<number>(4);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'CASH' | 'M-PESA' | 'TIGO-PESA'>('CASH');
  const [submittingPos, setSubmittingPos] = useState<boolean>(false);

  // New Custom Unit Form State
  const [targetUnitProductId, setTargetUnitProductId] = useState<string>('');
  const [newUnitCode, setNewUnitCode] = useState('');
  const [newUnitName, setNewUnitName] = useState('');
  const [newBaseKg, setNewBaseKg] = useState<number>(18);
  const [newUnitPriceTzs, setNewUnitPriceTzs] = useState<number>(1);
  const [newUnitIsWholesale, setNewUnitIsWholesale] = useState<boolean>(false);
  const [savingUnit, setSavingUnit] = useState<boolean>(false);

  // New Shelf Product Ingestion Form State
  const [newSku, setNewSku] = useState('');
  const [newNameSw, setNewNameSw] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
  const [newUnitPriceTzsForm, setNewUnitPriceTzsForm] = useState<number>(0);
  const [newCartonPriceTzsForm, setNewCartonPriceTzsForm] = useState<number>(0);
  const [newQuantaQty, setNewQuantaQty] = useState<number>(0);
  const [newSealedQty, setNewSealedQty] = useState<number>(0);
  const [savingProduct, setSavingProduct] = useState<boolean>(false);

  // Standard / Amended Price Modal for a Cloned Global Catalog SKU
  const [pricingModalClone, setPricingModalClone] = useState<ClonedCatalogItemRecord | null>(null);
  const [pricingModalUnits, setPricingModalUnits] = useState<GlobalProductUnitDto[]>([]);
  const [pricingModalStandards, setPricingModalStandards] = useState<StandardPriceDto[]>([]);
  const [selectedGlobalUnitId, setSelectedGlobalUnitId] = useState<string>('');
  const [selectedStandardPriceId, setSelectedStandardPriceId] = useState<string>('');
  const [amendedPriceInput, setAmendedPriceInput] = useState<string>('');
  const [loadingPriceModal, setLoadingPriceModal] = useState<boolean>(false);
  const [savingPriceModal, setSavingPriceModal] = useState<boolean>(false);

  // External Purchase Receipt Modal for a Cloned Global Catalog SKU
  const [purchaseModalClone, setPurchaseModalClone] = useState<ClonedCatalogItemRecord | null>(null);
  const [purchaseModalUnits, setPurchaseModalUnits] = useState<GlobalProductUnitDto[]>([]);
  const [purchaseUnitId, setPurchaseUnitId] = useState<string>('');
  const [purchaseSupplierName, setPurchaseSupplierName] = useState<string>('');
  const [purchaseSupplierRef, setPurchaseSupplierRef] = useState<string>('');
  const [purchaseStatus, setPurchaseStatus] = useState<'GOODS_RECEIVED' | 'ORDER_CONFIRMED'>('GOODS_RECEIVED');
  const [purchaseQtyUnits, setPurchaseQtyUnits] = useState<number>(1);
  const [purchaseQuantaPerUnit, setPurchaseQuantaPerUnit] = useState<number>(4);
  const [purchaseTotalCostTzs, setPurchaseTotalCostTzs] = useState<number>(0);
  const [savingPurchaseModal, setSavingPurchaseModal] = useState<boolean>(false);

  const loadLiveWorkspaceData = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setLoadingLive(true);
    setBackendOffline(false);
    setErrorNotice(null);

    try {
      let targetBizId = isUuid(businessId)
        ? businessId
        : SokoApiClient.getActiveUser()?.businessId ?? null;

      if (!isUuid(targetBizId) && SokoApiClient.hasAccessToken()) {
        const me = await SokoApiClient.get<{ businessId?: string | null }>('/auth/me');
        targetBizId = me?.businessId ?? null;
      }
      setResolvedBusinessId(isUuid(targetBizId) ? targetBizId : null);

      const [liveCatalog, liveClones, liveProducts] = await Promise.all([
        SokoApiClient.get<
          Array<{
            id: string;
            canonicalSku: string;
            fixedNameSw: string;
            fixedNameEn: string;
            categoryCode: string;
            staticImageUrl: string;
            imagekitCdnUrl: string;
            baseQuantumUnit: string;
            clonedByStoresCount: number;
          }>
        >('/marketplace/catalog'),
        SokoApiClient.hasAccessToken()
          ? SokoApiClient.get<ClonedCatalogItemRecord[]>(
              `/merchant/catalog/clones${isUuid(targetBizId) ? `?businessId=${encodeURIComponent(targetBizId)}` : ''}`
            ).catch((err) => {
              if (err instanceof SokoHttpError && (err.status === 403 || err.status === 401)) {
                return [] as ClonedCatalogItemRecord[];
              }
              throw err;
            })
          : Promise.resolve([] as ClonedCatalogItemRecord[]),
        isUuid(targetBizId)
          ? SokoApiClient.get<
              Array<{
                productId: string;
                sellerBusinessId: string;
                sku: string;
                nameSw: string;
                nameEn: string;
                unitPriceTzs: number;
                cartonPriceTzs: number;
                availableQuarterQuanta: number;
                sealedBulkPackagesStock: number;
                imagekitCdnUrl?: string;
                globalCatalogId?: string;
                priceTiers: Array<{
                  id: string;
                  unitType: string;
                  quarterQuantaPerUnit: number;
                  priceTzs: number;
                  isWholesaleTier: boolean;
                }>;
                customUnits: Array<{
                  id: string;
                  unitCode: string;
                  unitLabel: string;
                  baseKg: number;
                  quarterQuantaPerUnit: number;
                  priceTzs: number;
                  isWholesaleTier: boolean;
                }>;
              }>
            >(`/products/active?businessId=${encodeURIComponent(targetBizId)}`)
          : Promise.resolve([]),
      ]);

      setGlobalCatalog(
        Array.isArray(liveCatalog)
          ? liveCatalog.map((c) => ({
              globalCatalogId: c.id,
              canonicalSku: c.canonicalSku,
              fixedNameSw: c.fixedNameSw,
              fixedNameEn: c.fixedNameEn,
              category: c.categoryCode,
              categoryCode: c.categoryCode,
              imagekitCdnUrl: c.imagekitCdnUrl || c.staticImageUrl,
              staticImageUrl: c.staticImageUrl,
              defaultBaseUnitSw: c.baseQuantumUnit,
              defaultBaseUnitEn: c.baseQuantumUnit,
              clonedByStoresCount: Number(c.clonedByStoresCount ?? 0),
              updatedAtEat: new Date().toISOString(),
            }))
          : []
      );

      setClonedItems(Array.isArray(liveClones) ? liveClones : []);

      const mappedShelf: DukaInventoryItem[] = Array.isArray(liveProducts)
        ? liveProducts.map((p) => ({
            itemId: p.productId,
            sku: p.sku,
            productNameSw: p.nameSw,
            productNameEn: p.nameEn,
            availableQuanta: p.availableQuarterQuanta,
            sealedBulkPackagesStock: p.sealedBulkPackagesStock,
            unitPriceTzs: p.unitPriceTzs,
            cartonPriceTzs: p.cartonPriceTzs,
            imagekitCdnUrl: p.imagekitCdnUrl,
            globalCatalogId: p.globalCatalogId,
            lowStockThresholdQuanta: 20,
            unitType: p.priceTiers?.[0]?.unitType ?? 'UNIT',
            lastRestockedEat: new Date().toLocaleDateString(),
          }))
        : [];

      setShelfItems(mappedShelf);
      if (
        mappedShelf.length > 0 &&
        (!targetUnitProductId || !mappedShelf.some((s) => s.itemId === targetUnitProductId))
      ) {
        setTargetUnitProductId(mappedShelf[0].itemId);
      }

      const aggregatedCustomUnits: MerchantCustomUnit[] = [];
      for (const p of Array.isArray(liveProducts) ? liveProducts : []) {
        for (const u of p.customUnits ?? []) {
          aggregatedCustomUnits.push({
            unitId: u.id,
            productId: p.productId,
            productSku: p.sku,
            unitCode: u.unitCode,
            unitName: u.unitLabel,
            baseMultiplierKg: u.baseKg,
            quantaEquivalent: u.quarterQuantaPerUnit,
            priceTzs: u.priceTzs,
            isWholesaleTier: u.isWholesaleTier,
            descriptionSw: `${p.sku} · ${u.baseKg} KG (${u.quarterQuantaPerUnit} Quanta) · TZS ${u.priceTzs.toLocaleString('en-US')}`,
          });
        }
      }
      setCustomUnits(aggregatedCustomUnits);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else if (err instanceof SokoHttpError) {
        setErrorNotice(err.message);
      }
    } finally {
      setLoadingLive(false);
    }
  }, [businessId, targetUnitProductId]);

  const flushPendingClones = useCallback(async () => {
    const pending = await loadPendingGlobalClones();
    if (pending.length === 0 || !SokoApiClient.hasAccessToken()) return;

    const syncedIds: string[] = [];
    for (const p of pending) {
      if (!isUuid(p.globalCatalogId)) {
        syncedIds.push(p.globalCatalogId);
        continue;
      }
      try {
        await SokoApiClient.post('/marketplace/catalog/clone-standard', {
          globalCatalogId: p.globalCatalogId,
          ...(isUuid(resolvedBusinessId) ? { retailerBusinessId: resolvedBusinessId } : {}),
        });
        syncedIds.push(p.globalCatalogId);
      } catch (err) {
        if (isSokoNetworkError(err)) {
          return;
        }
        // A reachable backend rejected the staged clone (400/403/500).
        // Keep it pending in IndexedDB so it is never silently discarded.
        setErrorNotice(
          err instanceof Error
            ? err.message
            : 'Failed to sync a staged catalog clone; it remains queued.'
        );
      }
    }

    if (syncedIds.length > 0) {
      await markGlobalClonesSynced(syncedIds);
      setToastNotice(
        isSw
          ? `Mtandao umerejea: Bidhaa ${syncedIds.length} zimesawazishwa na Hifadhidata ya SokoKuu.`
          : `Back online: ${syncedIds.length} staged catalog item(s) synced to PostgreSQL.`
      );
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    }
  }, [resolvedBusinessId, isSw]);

  useEffect(() => {
    void loadLiveWorkspaceData();
  }, [loadLiveWorkspaceData]);

  useEffect(() => {
    const handleCatalogUpdated = () => {
      void loadLiveWorkspaceData();
    };
    const handleOnline = () => {
      setBackendOffline(false);
      void flushPendingClones().then(() => loadLiveWorkspaceData());
    };
    const handleOffline = () => setBackendOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('sokokuu:catalog-updated', handleCatalogUpdated);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('sokokuu:catalog-updated', handleCatalogUpdated);
    };
  }, [flushPendingClones, loadLiveWorkspaceData]);

  const handleCreateCustomUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUnitName.trim() || !newUnitCode.trim()) return;
    setErrorNotice(null);

    const calculatedQuanta = Math.round(newBaseKg * 4);
    if (Math.abs(newBaseKg * 4 - calculatedQuanta) > 0.001) {
      setErrorNotice(
        isSw
          ? 'Uzito lazima uwe kigawe halisi cha 0.25 KG (mf. 0.25, 0.5, 1, 5, 18).'
          : 'Base KG must be an exact multiple of 0.25 (e.g. 0.25, 0.5, 1, 5, 18).'
      );
      return;
    }

    if (!isUuid(targetUnitProductId)) {
      setErrorNotice(
        isSw
          ? 'Sajili au chagua bidhaa hai dukani kabla ya kuongeza kipimo maalum.'
          : 'Select an active PostgreSQL product SKU before attaching a custom unit.'
      );
      return;
    }

    setSavingUnit(true);
    try {
      await SokoApiClient.post(`/products/${targetUnitProductId}/custom-units`, {
        unitCode: newUnitCode.trim().toUpperCase(),
        unitLabel: newUnitName.trim(),
        baseKg: Number(newBaseKg),
        priceTzs: Math.max(1, Math.round(newUnitPriceTzs)),
        isWholesaleTier: newUnitIsWholesale,
      });

      setToastNotice(
        isSw
          ? `Kipimo kipya cha "${newUnitName.trim()}" kimesajiliwa kwenye PostgreSQL (${calculatedQuanta} Quanta).`
          : `Custom unit "${newUnitName.trim()}" saved in PostgreSQL (${calculatedQuanta} Quanta).`
      );
      setNewUnitName('');
      setNewUnitCode('');
      await loadLiveWorkspaceData();
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setErrorNotice(
          isSw
            ? 'Hakuna muunganisho kwa sasa. Kipimo hakijahifadhiwa.'
            : 'Offline right now — the custom unit was not saved.'
        );
      } else {
        setErrorNotice(err instanceof Error ? err.message : 'Failed to save custom unit.');
      }
    } finally {
      setSavingUnit(false);
    }
  };

  const handleOpenPosModal = (item: DukaInventoryItem) => {
    setErrorNotice(null);
    if (item.availableQuanta <= 0 && (item.sealedBulkPackagesStock ?? 0) <= 0) {
      setToastNotice(
        isSw
          ? `Bidhaa "${item.sku}" haina hifadhi. Ongeza stoo kwanza.`
          : `Item "${item.sku}" has 0 shelf & sealed stock. Restock first.`
      );
      return;
    }
    if (item.unitPriceTzs <= 0) {
      setToastNotice(
        isSw
          ? `Bidhaa "${item.sku}" ina bei TZS 0. Weka bei kwanza.`
          : `Item "${item.sku}" has 0 TZS price. Set unit price first.`
      );
      return;
    }
    setSelectedItemForSale(item);
    setPromptQuantity(Math.min(4, Math.max(1, item.availableQuanta || 4)));
    setSelectedPaymentMethod('CASH');
  };

  const handleExecutePosSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemForSale) return;
    setErrorNotice(null);

    if (!isUuid(selectedItemForSale.itemId)) {
      setErrorNotice(
        isSw ? 'Kitambulisho cha bidhaa si halali.' : 'Selected product lacks a valid PostgreSQL UUID.'
      );
      return;
    }

    setSubmittingPos(true);
    try {
      const res = await SokoApiClient.post<{
        receiptId: string;
        productId: string;
        inventoryId: string;
        quantaSold: number;
        paymentMethod: string;
        totalTzs: number;
        remainingLooseQuanta: number;
        remainingSealedPackages: number;
        bulkPackagesBroken: number;
        timestampEat: string;
      }>('/retailer/pos/sales-receipt', {
        productId: selectedItemForSale.itemId,
        quantityRequested: promptQuantity,
        paymentMethod: mapPaymentMethodToPosDto(selectedPaymentMethod),
      });

      setShelfItems((prev) =>
        prev.map((i) =>
          i.itemId === selectedItemForSale.itemId
            ? {
                ...i,
                availableQuanta: res.remainingLooseQuanta,
                sealedBulkPackagesStock: res.remainingSealedPackages,
              }
            : i
        )
      );

      const newRecord: PosReceiptRecord = {
        receiptId: res.receiptId,
        inventoryId: res.inventoryId || res.productId,
        sku: selectedItemForSale.sku,
        quantaSold: res.quantaSold,
        paymentMethod: selectedPaymentMethod,
        totalTzs: res.totalTzs,
        timestampEat: new Date(res.timestampEat).toLocaleTimeString(),
        synced: true,
      };
      setReceiptLedger((prev) => [newRecord, ...prev]);

      const brokenMsg =
        res.bulkPackagesBroken > 0
          ? isSw
            ? ` · Kifurushi ${res.bulkPackagesBroken} kimevunjwa kiotomatiki!`
            : ` · ${res.bulkPackagesBroken} bulk package(s) auto-broken!`
          : '';
      setToastNotice(
        isSw
          ? `Stakabadhi ${res.receiptId} imerekodiwa PostgreSQL! ${selectedPaymentMethod} · Jumla: TZS ${res.totalTzs.toLocaleString('en-US')}${brokenMsg}`
          : `POS Receipt ${res.receiptId} committed! ${selectedPaymentMethod} · Total: TZS ${res.totalTzs.toLocaleString('en-US')}${brokenMsg}`
      );
      setSelectedItemForSale(null);
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setErrorNotice(
          isSw
            ? 'Mtandao umekatika: Stakabadhi ya POS haikusajiliwa.'
            : 'Offline right now — the POS receipt was not posted.'
        );
      } else {
        setErrorNotice(
          err instanceof Error ? err.message : 'POS sale rejected by backend.'
        );
      }
    } finally {
      setSubmittingPos(false);
    }
  };

  const handleCloneGlobalCatalogItem = async (entry: GlobalCatalogEntry) => {
    setErrorNotice(null);
    const alreadyCloned =
      clonedItems.some((c) => c.globalCatalogId === entry.globalCatalogId) ||
      shelfItems.some((i) => i.globalCatalogId === entry.globalCatalogId);

    if (alreadyCloned) {
      setToastNotice(
        isSw
          ? `Bidhaa "${entry.canonicalSku}" tayari imeshanakiliwa dukani.`
          : `Catalog SKU "${entry.canonicalSku}" is already cloned into your Merchant inventory.`
      );
      return;
    }

    if (!isUuid(entry.globalCatalogId)) return;

    try {
      const res = await SokoApiClient.post<{
        canonicalSku: string;
        updatedClonedByStoresCount: number;
        idempotentReplay?: boolean;
      }>('/marketplace/catalog/clone-standard', {
        globalCatalogId: entry.globalCatalogId,
        ...(isUuid(resolvedBusinessId) ? { retailerBusinessId: resolvedBusinessId } : {}),
      });
      setToastNotice(
        isSw
          ? `Imenakiliwa dukani (PostgreSQL): ${res.canonicalSku} @ 0 Stock · 0 TZS (Wafanyabiashara: ${res.updatedClonedByStoresCount}).`
          : `Cloned to PostgreSQL inventory: ${res.canonicalSku} @ 0 Stock · 0 TZS (Merchants: ${res.updatedClonedByStoresCount}).`
      );
      await loadLiveWorkspaceData();
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        await stageOfflineGlobalClone({
          cloneRecordId: entry.globalCatalogId,
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
        setToastNotice(
          isSw
            ? `Nje ya Mtandao: Ombi la kunakili ${entry.canonicalSku} limewekwa kwenye foleni ya IndexedDB kusubiri seva.`
            : `Offline: Clone request for ${entry.canonicalSku} queued in IndexedDB until NestJS reconnects.`
        );
      } else {
        setErrorNotice(
          err instanceof Error ? err.message : 'Failed to clone global catalog SKU.'
        );
      }
    }
  };

  const openPricingModal = async (clone: ClonedCatalogItemRecord) => {
    setPricingModalClone(clone);
    setLoadingPriceModal(true);
    setErrorNotice(null);
    try {
      const data = await SokoApiClient.get<{
        units: GlobalProductUnitDto[];
        standardPrices: StandardPriceDto[];
      }>(`/marketplace/catalog/${clone.globalCatalogId}/standard-prices`);
      const units = data.units ?? [];
      const prices = data.standardPrices ?? [];
      setPricingModalUnits(units);
      setPricingModalStandards(prices);

      const firstUnit = units[0]?.id ?? '';
      setSelectedGlobalUnitId(firstUnit);
      const matchingPrice = prices.find((p) => p.globalProductUnitId === firstUnit) ?? prices[0];
      setSelectedStandardPriceId(matchingPrice?.id ?? '');
      setAmendedPriceInput('');
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      setErrorNotice(err instanceof Error ? err.message : 'Failed to load standard pricing.');
      setPricingModalClone(null);
    } finally {
      setLoadingPriceModal(false);
    }
  };

  const handleSaveMerchantPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pricingModalClone || !selectedGlobalUnitId || !selectedStandardPriceId) return;
    setSavingPriceModal(true);
    setErrorNotice(null);
    try {
      const amendedVal = amendedPriceInput.trim()
        ? Math.max(1, parseInt(amendedPriceInput.trim(), 10))
        : undefined;
      await SokoApiClient.post(
        `/merchant/catalog/${pricingModalClone.clonedProductId}/select-or-amend-price`,
        {
          globalProductUnitId: selectedGlobalUnitId,
          standardPriceId: selectedStandardPriceId,
          ...(amendedVal !== undefined ? { amendedSellingPriceTzs: amendedVal } : {}),
        }
      );
      setToastNotice(
        isSw
          ? `Bei ya ${pricingModalClone.canonicalSku} imehifadhiwa kikamilifu!`
          : `Selling price for ${pricingModalClone.canonicalSku} saved to PostgreSQL!`
      );
      setPricingModalClone(null);
      await loadLiveWorkspaceData();
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      setErrorNotice(err instanceof Error ? err.message : 'Failed to save selling price.');
    } finally {
      setSavingPriceModal(false);
    }
  };

  const handleResetPriceToStandard = async () => {
    if (!pricingModalClone || !selectedGlobalUnitId) return;
    setSavingPriceModal(true);
    setErrorNotice(null);
    try {
      await SokoApiClient.post(
        `/merchant/catalog/${pricingModalClone.clonedProductId}/reset-price`,
        { globalProductUnitId: selectedGlobalUnitId }
      );
      setToastNotice(
        isSw
          ? `Bei ya ${pricingModalClone.canonicalSku} imerejeshwa kuwa Bei Kuu ya SokoKuu.`
          : `Override cleared for ${pricingModalClone.canonicalSku} — reverted to Standard Price.`
      );
      setPricingModalClone(null);
      await loadLiveWorkspaceData();
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      setErrorNotice(err instanceof Error ? err.message : 'Failed to reset price.');
    } finally {
      setSavingPriceModal(false);
    }
  };

  const openPurchaseModal = async (clone: ClonedCatalogItemRecord) => {
    setPurchaseModalClone(clone);
    setErrorNotice(null);
    setPurchaseSupplierName('');
    setPurchaseSupplierRef('');
    setPurchaseTotalCostTzs(0);
    setPurchaseQtyUnits(1);
    try {
      const units = await SokoApiClient.get<GlobalProductUnitDto[]>(
        `/admin/marketplace/catalog/${clone.globalCatalogId}/units`
      );
      setPurchaseModalUnits(units ?? []);
      if (units && units.length > 0) {
        setPurchaseUnitId(units[0].id);
        setPurchaseQuantaPerUnit(units[0].quarterQuantaPerUnit);
      } else {
        setPurchaseUnitId('');
        setPurchaseQuantaPerUnit(4);
      }
    } catch (err) {
      setPurchaseModalUnits([]);
      setPurchaseUnitId('');
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorNotice(
          err instanceof Error ? err.message : 'Failed to load product units from NestJS.'
        );
      }
    }
  };

  const handleSaveExternalPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseModalClone || !purchaseSupplierName.trim() || purchaseTotalCostTzs <= 0) return;
    setSavingPurchaseModal(true);
    setErrorNotice(null);
    try {
      const res = await SokoApiClient.post<{
        receiptStatus: string;
        receivedQuanta: number;
        availableQuantaStock: number;
        lastBuyingPricePerQuantumTzs: number;
        weightedAvgBuyingCostPerQuantumTzs: number;
      }>('/merchant/purchases/external-receipt', {
        clonedProductId: purchaseModalClone.clonedProductId,
        ...(purchaseUnitId
          ? { globalProductUnitId: purchaseUnitId }
          : { quarterQuantaPerUnit: purchaseQuantaPerUnit }),
        supplierName: purchaseSupplierName.trim(),
        ...(purchaseSupplierRef.trim() ? { supplierReference: purchaseSupplierRef.trim() } : {}),
        receiptStatus: purchaseStatus,
        quantityUnits: purchaseQtyUnits,
        agreedTotalCostTzs: purchaseTotalCostTzs,
      });

      setToastNotice(
        isSw
          ? `Manunuzi yamesajiliwa (${res.receiptStatus}): +${res.receivedQuanta}Q · Wastani wa Ununuzi: TZS ${res.weightedAvgBuyingCostPerQuantumTzs.toLocaleString('en-US')}/Q`
          : `Purchase recorded (${res.receiptStatus}): +${res.receivedQuanta}Q · Weighted Avg Cost: TZS ${res.weightedAvgBuyingCostPerQuantumTzs.toLocaleString('en-US')}/Q`
      );
      setPurchaseModalClone(null);
      await loadLiveWorkspaceData();
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      setErrorNotice(err instanceof Error ? err.message : 'Failed to record purchase receipt.');
    } finally {
      setSavingPurchaseModal(false);
    }
  };

  const handleIngestShelfItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNotice(null);
    const skuClean = newSku.trim().toUpperCase().slice(0, 8);
    if (!skuClean || !newNameSw.trim() || newUnitPriceTzsForm <= 0 || newCartonPriceTzsForm <= 0) {
      setErrorNotice(
        isSw
          ? 'Weka msimbo wa SKU, jina la bidhaa, bei ya kipimo, na bei ya katoni.'
          : 'Enter SKU code, product name, unit price (TZS), and carton price (TZS).'
      );
      return;
    }

    setSavingProduct(true);
    try {
      await SokoApiClient.post('/products', {
        smsItemCode: skuClean,
        nameSw: newNameSw.trim(),
        nameEn: newNameEn.trim() || newNameSw.trim(),
        unitPriceTzs: Math.max(1, Math.round(newUnitPriceTzsForm)),
        packPriceTzs: Math.max(1, Math.round(newUnitPriceTzsForm * 4)),
        dozenPriceTzs: Math.max(1, Math.round(newUnitPriceTzsForm * 12)),
        cartonPriceTzs: Math.max(1, Math.round(newCartonPriceTzsForm)),
        baseQuarterQuantaStock: Math.max(0, Math.round(newQuantaQty)),
        sealedBulkPackagesStock: Math.max(0, Math.round(newSealedQty)),
      });

      setToastNotice(
        isSw
          ? `Bidhaa ${skuClean} imesajiliwa moja kwa moja kwenye PostgreSQL!`
          : `Product ${skuClean} created directly in PostgreSQL!`
      );
      setNewSku('');
      setNewNameSw('');
      setNewNameEn('');
      setNewUnitPriceTzsForm(0);
      setNewCartonPriceTzsForm(0);
      setNewQuantaQty(0);
      setNewSealedQty(0);
      await loadLiveWorkspaceData();
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setErrorNotice(
          isSw
            ? 'Hakuna muunganisho kwa sasa. Bidhaa haijaundwa.'
            : 'Offline right now — the product was not created.'
        );
      } else {
        setErrorNotice(err instanceof Error ? err.message : 'Product creation failed.');
      }
    } finally {
      setSavingProduct(false);
    }
  };

  const maxPosQuanta = selectedItemForSale
    ? Math.max(
        1,
        selectedItemForSale.availableQuanta + (selectedItemForSale.sealedBulkPackagesStock ?? 0) * 100
      )
    : 100;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          onRetry={() => void loadLiveWorkspaceData()}
          retrying={loadingLive}
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
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 shadow-sm flex items-center justify-between gap-3 text-xs font-semibold text-emerald-950"
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

      {/* Database Sync Status Header */}
      {!backendOffline && (
        <div className="bg-white border border-slate-100 rounded-lg shadow-sm p-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
            <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {loadingLive
                ? isSw
                  ? 'Inapakia Hifadhidata...'
                  : 'Syncing...'
                : isSw
                  ? 'Hifadhidata'
                  : 'Inventory Connected'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void loadLiveWorkspaceData()}
            disabled={loadingLive}
            className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer disabled:opacity-50"
          >
            {isSw ? 'Onyesha Upya' : 'Refresh'}
          </button>
        </div>
      )}

      {/* VIEW 1: POS MAUZO */}
      {activeSection === 'pos_register' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-950">
                  {isSw ? 'Sanduku la Mauzo la POS' : 'POS Sales Registry'}
                </h3>
                <p className="text-xs text-slate-500">
                  {isSw
                    ? 'Bonyeza bidhaa kufungua dirisha la kuweka Quanta na njia ya malipo (CASH / M-PESA / TIGO-PESA).'
                    : 'Click any active product to execute atomic Quarter-Quanta POS deduction & bulk auto-breaking.'}
                </p>
              </div>
            </div>

            {shelfItems.length === 0 ? (
              <EmptyStateCard
                locale={locale}
                titleSw="Hakuna bidhaa dukani bado"
                titleEn="No active merchant products yet"
                descriptionSw="Sajili bidhaa mpya au nakili kutoka Katalogi Kuu kwenye kichupo cha Hifadhi & Bidhaa."
                descriptionEn="Register a new product or clone from the Global Catalog under Inventory & Shelf."
              />
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                  <input
                    type="search"
                    value={posSearch}
                    onChange={(e) => setPosSearch(e.target.value)}
                    placeholder={isSw ? 'Tafuta bidhaa au SKU...' : 'Search products by name or SKU...'}
                    aria-label={isSw ? 'Tafuta bidhaa za POS' : 'Search POS products'}
                    className="w-full min-h-[44px] pl-9 pr-3 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:border-emerald-600 focus:outline-none"
                  />
                </div>
                {(() => {
                  const query = posSearch.trim().toLowerCase();
                  const visible = query
                    ? shelfItems.filter(
                        (i) =>
                          i.sku.toLowerCase().includes(query) ||
                          i.productNameSw.toLowerCase().includes(query) ||
                          i.productNameEn.toLowerCase().includes(query)
                      )
                    : shelfItems;
                  if (visible.length === 0) {
                    return (
                      <div className="text-center text-xs text-slate-500 py-6">
                        {isSw ? 'Hakuna bidhaa inayolingana na utafutaji.' : 'No products match your search.'}
                      </div>
                    );
                  }
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {visible.map((item) => {
                        const isLow = item.availableQuanta <= item.lowStockThresholdQuanta;
                        const isOut = item.availableQuanta <= 0 && (item.sealedBulkPackagesStock ?? 0) <= 0;
                        return (
                          <button
                            key={item.itemId}
                            type="button"
                            onClick={() => handleOpenPosModal(item)}
                            className={`text-left bg-white border rounded-lg p-3 shadow-sm transition-all cursor-pointer group flex gap-3 min-h-[92px] ${
                              isOut
                                ? 'border-slate-200 opacity-60 hover:border-slate-300'
                                : 'border-slate-200 hover:border-emerald-600 hover:shadow-md'
                            }`}
                          >
                            <div className="w-16 h-16 shrink-0 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center">
                              {item.imagekitCdnUrl ? (
                                <img
                                  src={item.imagekitCdnUrl}
                                  alt={isSw ? item.productNameSw : item.productNameEn}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <Boxes className="w-7 h-7 text-slate-300" aria-hidden="true" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[11px] font-bold text-emerald-700">{item.sku}</span>
                                <span className="text-[10px] font-medium bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 whitespace-nowrap">
                                  {formatUnitTypeLabel(item.unitType, locale)}
                                </span>
                              </div>
                              <div className="text-sm font-bold text-slate-950 group-hover:text-emerald-700 transition-colors truncate">
                                {isSw ? item.productNameSw : item.productNameEn}
                              </div>
                              <div className="text-[11px] font-mono text-emerald-800 font-semibold">
                                TZS {Math.round(item.unitPriceTzs / 4).toLocaleString('en-US')}
                                <span className="text-slate-500 font-sans font-normal"> / Q</span>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-slate-600">
                                <span>
                                  <strong className="font-mono text-slate-950">{item.availableQuanta}Q</strong>
                                  {typeof item.sealedBulkPackagesStock === 'number' && (
                                    <span className="text-slate-500"> · +{item.sealedBulkPackagesStock}</span>
                                  )}
                                </span>
                                {isOut ? (
                                  <span className="text-red-700 font-semibold">{isSw ? 'Imeisha!' : 'Out!'}</span>
                                ) : isLow ? (
                                  <span className="text-amber-700 font-semibold flex items-center gap-0.5">
                                    <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                                    {isSw ? 'Chache!' : 'Low!'}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                {isSw ? 'Stakabadhi za Hivi Punde za POS' : 'Recent POS Receipts Ledger'}
                {receiptLedger.length > 0 && (
                  <span className="bg-emerald-50 text-emerald-700 font-mono px-1.5 py-0.5 rounded-full text-[10px]">
                    {receiptLedger.length}
                  </span>
                )}
              </h4>
              <button
                type="button"
                onClick={() => void loadLiveWorkspaceData()}
                disabled={loadingLive}
                title={isSw ? 'OnyeshaUpya' : 'Refresh'}
                className="text-slate-500 hover:text-emerald-700 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
            {receiptLedger.length === 0 ? (
              <EmptyStateCard
                locale={locale}
                titleSw="Hakuna stakabadhi za POS bado"
                titleEn="No POS receipts yet"
                descriptionSw="Mauzo yatakayorekodiwa kupitia POS yataorodheshwa hapa moja kwa moja."
                descriptionEn="POS sales committed to PostgreSQL in this session will appear here."
              />
            ) : (
              <div className="space-y-2">
                {receiptLedger.map((rcp) => (
                  <div
                    key={rcp.receiptId}
                    className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="font-mono font-bold text-slate-950">
                        {rcp.receiptId} · SKU: {rcp.sku}
                      </div>
                      <div className="text-slate-600">
                        {rcp.quantaSold} Quanta · <strong className="text-emerald-700">{rcp.paymentMethod}</strong> ·{' '}
                        {rcp.timestampEat}
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

      {/* VIEW 2: HIFADHI & BIDHAA */}
      {activeSection === 'inventory_shelf' && (
        <div className="space-y-5">
          {/* Global Standard Catalog Registry */}
          <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
            <div className="border-b border-slate-100 pb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                  <span>
                    {isSw
                      ? 'Katalogi Kuu ya SokoKuu'
                      : 'Global Standard Catalog Registry'}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isSw
                    ? 'Nakili bidhaa sanifu kwenda dukani kwako zikiwa na Hifadhi 0 na Bei 0 TZS.'
                    : 'Clone standardized catalog SKUs into your Merchant shelf initialized at 0 stock & 0 TZS.'}
                </p>
              </div>
            </div>

            {globalCatalog.length === 0 ? (
              <EmptyStateCard
                locale={locale}
                titleSw="Katalogi Kuu haina bidhaa bado"
                titleEn="Global catalog is empty"
                descriptionSw="Hakuna bidhaa sanifu zilizosajiliwa kwenye soko global catalog."
                descriptionEn="No standardized SKUs exist in soko global catalog yet."
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {globalCatalog.map((entry) => {
                  const isCloned =
                    clonedItems.some((c) => c.globalCatalogId === entry.globalCatalogId) ||
                    shelfItems.some((i) => i.globalCatalogId === entry.globalCatalogId);
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
                              {entry.clonedByStoresCount} {isSw ? 'wafanyabiashara' : 'merchants'}
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
                        onClick={() => void handleCloneGlobalCatalogItem(entry)}
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
                              ? 'Imeshanakiliwa'
                              : 'Cloned'
                            : isSw
                              ? 'Nakili Dukani (0 Stock · 0 TZS)'
                              : 'Clone SKU (0 Stock · 0 TZS)'}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cloned Catalog SKUs */}
          {clonedItems.length > 0 && (
            <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-950">
                  {isSw
                    ? 'Bidhaa Zilizotoka Katalogi Kuu — Bei Sanifu & Gharama ya Ununuzi'
                    : 'Cloned Global SKUs — Standard Pricing & Purchase Costing'}
                </h3>
                <p className="text-xs text-slate-500">
                  {isSw
                    ? 'Chagua bei ya SokoKuu au rekebisha bei yako ya mfanyabiashara, na ingiza risiti za manunuzi ya nje.'
                    : 'Adopt or amend Admin Standard Prices and log external supplier purchase receipts.'}
                </p>
              </div>

              <div className="space-y-3">
                {clonedItems.map((clone) => (
                  <div
                    key={clone.clonedProductId}
                    className="border border-slate-200 rounded-lg p-3.5 bg-slate-50/70 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-xs font-bold text-emerald-700">
                          {clone.canonicalSku}
                        </div>
                        <div className="text-sm font-bold text-slate-950">
                          {isSw ? clone.fixedNameSw : clone.fixedNameEn}
                        </div>
                      </div>
                      <div className="text-right font-mono text-xs">
                        <div className="font-bold text-slate-950">
                          {clone.availableQuantaStock} Quanta
                        </div>
                        <div className="text-emerald-700 font-semibold">
                          Sell: TZS {clone.unitPriceTzs.toLocaleString('en-US')}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] font-mono bg-white border border-slate-200 rounded p-2.5">
                      <div>
                        <div className="text-slate-500">Last Cost/Q</div>
                        <div className="font-bold text-slate-900">
                          TZS {clone.lastBuyingPricePerQuantumTzs.toLocaleString('en-US')}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Weighted Avg/Q</div>
                        <div className="font-bold text-slate-900">
                          TZS {clone.weightedAvgBuyingCostPerQuantumTzs.toLocaleString('en-US')}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Valuation</div>
                        <div className="font-bold text-emerald-700">
                          TZS {clone.inventoryValueTzs.toLocaleString('en-US')}
                        </div>
                      </div>
                    </div>

                    {clone.unitPricingOverrides.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {clone.unitPricingOverrides.map((ov) => (
                          <span
                            key={ov.overrideId}
                            className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                              ov.isOverridden
                                ? 'bg-amber-50 border-amber-200 text-amber-900'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            }`}
                          >
                            {ov.unitCode}: TZS {ov.effectiveSellingPriceTzs.toLocaleString('en-US')}
                            {ov.isOverridden ? ' (Amended)' : ' (Std)'}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void openPricingModal(clone)}
                        className="flex-1 min-h-[36px] px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 rounded-md text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Tag className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                        <span>{isSw ? 'Bei Sanifu / Rekebisha' : 'Standard / Amend Price'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void openPurchaseModal(clone)}
                        className="flex-1 min-h-[36px] px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <PackagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{isSw ? 'Ingiza Manunuzi (Stock-In)' : 'Record Stock-In Receipt'}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Create Active Sellable Merchant Product */}
          <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-950">
                {isSw ? 'Usajili wa Bidhaa Mpya Kwenye Rafu' : 'Create Active Merchant Product'}
              </h3>
              <p className="text-xs text-slate-500">
                {isSw
                  ? 'Ongeza bidhaa inayouzika dukani moja kwa moja.'
                  : 'Register a live sellable Merchant SKU synced directly.'}
              </p>
            </div>

            <form
              onSubmit={handleIngestShelfItem}
              className="space-y-4 bg-slate-50 p-4 rounded-lg border border-slate-200"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">SMS SKU Code (max 8)</label>
                  <input
                    type="text"
                    maxLength={8}
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                    placeholder="SGR01"
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 uppercase"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Jina (Kiswahili)' : 'Name (Swahili)'}
                  </label>
                  <input
                    type="text"
                    value={newNameSw}
                    onChange={(e) => setNewNameSw(e.target.value)}
                    placeholder={isSw ? 'Jina la bidhaa...' : 'Product name (Swahili)...'}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Jina (English)' : 'Name (English)'}
                  </label>
                  <input
                    type="text"
                    value={newNameEn}
                    onChange={(e) => setNewNameEn(e.target.value)}
                    placeholder={isSw ? 'Jina kwa Kiingereza...' : 'Product name (English)...'}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Unit TZS (1KG)</label>
                  <input
                    type="number"
                    min="1"
                    value={newUnitPriceTzsForm || ''}
                    onChange={(e) => setNewUnitPriceTzsForm(parseInt(e.target.value, 10) || 0)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Carton/Bulk TZS</label>
                  <input
                    type="number"
                    min="1"
                    value={newCartonPriceTzsForm || ''}
                    onChange={(e) => setNewCartonPriceTzsForm(parseInt(e.target.value, 10) || 0)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Loose Quanta</label>
                  <input
                    type="number"
                    min="0"
                    value={newQuantaQty}
                    onChange={(e) => setNewQuantaQty(parseInt(e.target.value, 10) || 0)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Sealed Sacks/Ctn</label>
                  <input
                    type="number"
                    min="0"
                    value={newSealedQty}
                    onChange={(e) => setNewSealedQty(parseInt(e.target.value, 10) || 0)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingProduct}
                className="w-full min-h-[42px] px-4 py-2 bg-slate-950 hover:bg-slate-900 disabled:opacity-60 text-white font-semibold text-xs rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                {savingProduct
                  ? isSw
                    ? 'Inahifadhi...'
                    : 'Saving...'
                  : isSw
                    ? 'Sajili Bidhaa Kwenye Rafu'
                    : 'Create Product in PostgreSQL'}
              </button>
            </form>

            {/* Current Merchant Shelf Overview */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {isSw ? 'Hifadhi ya Sasa ya Mfanyabiashara' : 'Current Merchant Shelf Ledger'}
              </h4>
              {shelfItems.length === 0 ? (
                <EmptyStateCard
                  locale={locale}
                  titleSw="Hakuna bidhaa kwenye rafu bado"
                  titleEn="No shelf products yet"
                  descriptionSw="Ongeza bidhaa mpya hapo juu ili kuona leja ya rafu."
                  descriptionEn="Register a product above to populate the Merchant shelf ledger."
                />
              ) : (
                <div className="space-y-2">
                  {shelfItems.map((item) => (
                    <div
                      key={item.itemId}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-mono font-bold text-slate-950 truncate">
                          <span>{item.sku}</span>
                        </div>
                        <div className="text-slate-600 truncate">
                          {isSw ? item.productNameSw : item.productNameEn}
                        </div>
                      </div>
                      <div className="text-right font-mono shrink-0">
                        <div className="font-bold text-slate-950">
                          {item.availableQuanta}Q{' '}
                          {typeof item.sealedBulkPackagesStock === 'number'
                            ? `(+${item.sealedBulkPackagesStock} sealed)`
                            : ''}
                        </div>
                        <div className="text-[11px] text-emerald-700">
                          TZS {item.unitPriceTzs.toLocaleString('en-US')} / unit
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Merchant Custom Units Configurator */}
          <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-950">
                {isSw ? 'Vipimo Maalum vya Mfanyabiashara (Merchant Custom Units)' : 'Merchant Custom Units Configurator'}
              </h3>
              <p className="text-xs text-slate-500">
                {isSw
                  ? 'Sanidi vipimo vya kienyeji (Debe, Sado, Dumu) kwa bidhaa husika vikibadilishwa kuwa Quarter Quanta (KG × 4).'
                  : 'Attach bespoke local units (Debe, Sado, Dumu) to a specific product mapped to integer Quarter-Quanta (KG × 4).'}
              </p>
            </div>

            <form
              onSubmit={handleCreateCustomUnit}
              className="space-y-4 bg-slate-50 p-4 rounded-lg border border-slate-200"
            >
              {shelfItems.some((s) => isUuid(s.itemId)) && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Bidhaa Husika (Product SKU)' : 'Target Product SKU'}
                  </label>
                  <select
                    value={targetUnitProductId}
                    onChange={(e) => setTargetUnitProductId(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                  >
                    {shelfItems
                      .filter((s) => isUuid(s.itemId))
                      .map((s) => (
                        <option key={s.itemId} value={s.itemId}>
                          {s.sku} — {isSw ? s.productNameSw : s.productNameEn}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Msimbo (Mf. DEBE, SADO)' : 'Unit Code (e.g. DEBE, SADO)'}
                  </label>
                  <input
                    type="text"
                    value={newUnitCode}
                    onChange={(e) => setNewUnitCode(e.target.value)}
                    placeholder="DEBE"
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 uppercase"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Jina la Kipimo (Mf. Debe 18KG)' : 'Unit Label (e.g. Debe 18KG)'}
                  </label>
                  <input
                    type="text"
                    value={newUnitName}
                    onChange={(e) => setNewUnitName(e.target.value)}
                    placeholder={isSw ? 'Debe la Mafuta (18 KG)' : 'Debe Special (18 KG)'}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Uzito wa Kilo (0.25×)' : 'Base Weight in KG (0.25 step)'}
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0.25"
                    value={newBaseKg}
                    onChange={(e) => setNewBaseKg(parseFloat(e.target.value) || 0.25)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Bei ya Kipimo (TZS)' : 'Unit Selling Price (TZS)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newUnitPriceTzs}
                    onChange={(e) => setNewUnitPriceTzs(parseInt(e.target.value, 10) || 1)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={newUnitIsWholesale}
                  onChange={(e) => setNewUnitIsWholesale(e.target.checked)}
                  className="rounded border-slate-300 accent-emerald-600"
                />
                <span>
                  {isSw ? 'Hiki ni Kipimo cha Jumla (Wholesale Tier)' : 'Mark as Wholesale Tier (Channel Harmony)'}
                </span>
              </label>

              <div className="text-[11px] text-emerald-800 font-mono bg-emerald-50 p-2.5 rounded border border-emerald-100">
                {isSw ? 'Ubadilishaji:' : 'Conversion:'} {newBaseKg} KG × 4 ={' '}
                <strong>{Math.round(newBaseKg * 4)} Quarter Quanta</strong>
              </div>

              <button
                type="submit"
                disabled={savingUnit || !isUuid(targetUnitProductId)}
                className="w-full min-h-[42px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-xs rounded-lg shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <PlusCircle className="w-4 h-4" aria-hidden="true" />
                <span>
                  {savingUnit
                    ? isSw
                      ? 'Inahifadhi...'
                      : 'Saving...'
                    : isSw
                      ? 'Hifadhi Kipimo Kipya'
                      : 'Save Custom Unit'}
                </span>
              </button>
            </form>

            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {isSw ? 'Vipimo Vinavyotumika Sasa' : 'Active Merchant Custom Units'}
              </h4>
              {customUnits.length === 0 ? (
                <EmptyStateCard
                  locale={locale}
                  titleSw="Hakuna vipimo maalum bado"
                  titleEn="No custom units yet"
                  descriptionSw="Ongeza kipimo maalum hapo juu (mf. Debe au Sado) kwa bidhaa yako."
                  descriptionEn="Save a custom unit above to attach local measures to your products."
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {customUnits.map((u) => (
                    <div
                      key={u.unitId}
                      className="bg-white border border-slate-200 rounded-lg p-3 space-y-1 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-950">{u.unitName}</span>
                        <span className="font-mono text-xs text-emerald-700 font-semibold">
                          {u.quantaEquivalent}Q
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600">{u.descriptionSw}</p>
                      <div className="text-[10px] font-mono text-slate-400">
                        {u.productSku ? `${u.productSku} · ` : ''}Base: {u.baseMultiplierKg} KG · TZS{' '}
                        {u.priceTzs.toLocaleString('en-US')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DYNAMIC POS QUANTITY PROMPT MODAL OVERLAY */}
      {selectedItemForSale && (
        <div className="sk-dialog-overlay backdrop-blur-sm">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto sk-safe-bottom overscroll-contain">
            {/* Product header */}
            <div className="flex items-start gap-3 border-b border-slate-100 p-5">
              <div className="w-16 h-16 shrink-0 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center">
                {selectedItemForSale.imagekitCdnUrl ? (
                  <img
                    src={selectedItemForSale.imagekitCdnUrl}
                    alt={isSw ? selectedItemForSale.productNameSw : selectedItemForSale.productNameEn}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Boxes className="w-8 h-8 text-slate-300" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs font-bold text-emerald-700">{selectedItemForSale.sku}</div>
                <h3 className="text-base font-bold text-slate-950 mt-0.5 leading-tight">
                  {isSw ? selectedItemForSale.productNameSw : selectedItemForSale.productNameEn}
                </h3>
                <div className="text-[11px] text-slate-500 mt-1">
                  {formatUnitTypeLabel(selectedItemForSale.unitType, locale)} · 1 Quanta = 250g/mL
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedItemForSale(null)}
                aria-label={isSw ? 'Funga' : 'Close'}
                className="text-slate-400 hover:text-slate-900 p-2 -m-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleExecutePosSale} className="p-5 space-y-4">
              {/* Stock preview + low-stock warning */}
              <div
                className={`rounded-xl p-3 border flex items-center justify-between text-xs ${
                  selectedItemForSale.availableQuanta <= selectedItemForSale.lowStockThresholdQuanta
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <Boxes className="w-4 h-4" aria-hidden="true" />
                  {isSw ? 'Hifadhi iliyopo:' : 'Stock available:'}{' '}
                  <strong className="font-mono">{selectedItemForSale.availableQuanta}Q</strong>
                  {typeof selectedItemForSale.sealedBulkPackagesStock === 'number' && (
                    <span className="font-mono opacity-80">
                      (+{selectedItemForSale.sealedBulkPackagesStock}{' '}
                      {isSw ? 'mifuko' : 'sealed'})
                    </span>
                  )}
                </span>
                {selectedItemForSale.availableQuanta <= selectedItemForSale.lowStockThresholdQuanta && (
                  <span className="flex items-center gap-1 font-bold whitespace-nowrap">
                    <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                    {isSw ? 'Hifadhi chache!' : 'Low stock!'}
                  </span>
                )}
              </div>

              {/* Quantity control */}
              <div className="space-y-2.5 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <label htmlFor="pos-quanta-input" className="block text-xs font-semibold text-slate-700">
                  {isSw ? 'Idadi ya Quanta ya Kuuza:' : 'Quanta to sell:'}
                </label>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    aria-label={isSw ? 'Punguza' : 'Decrease'}
                    onClick={() => setPromptQuantity((q) => Math.max(1, q - 1))}
                    className="w-12 h-12 shrink-0 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer flex items-center justify-center transition-colors"
                  >
                    <Minus className="w-5 h-5" aria-hidden="true" />
                  </button>
                  <input
                    id="pos-quanta-input"
                    type="number"
                    min={1}
                    max={maxPosQuanta}
                    value={promptQuantity}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      const next = Number.isFinite(parsed) ? Math.trunc(parsed) : 1;
                      setPromptQuantity(Math.min(maxPosQuanta, Math.max(1, next)));
                    }}
                    className="w-24 h-12 text-center font-mono text-xl font-bold text-emerald-700 bg-white border-2 border-emerald-200 rounded-xl focus:border-emerald-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label={isSw ? 'Ongeza' : 'Increase'}
                    onClick={() => setPromptQuantity((q) => Math.min(maxPosQuanta, q + 1))}
                    className="w-12 h-12 shrink-0 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer flex items-center justify-center transition-colors"
                  >
                    <Plus className="w-5 h-5" aria-hidden="true" />
                  </button>
                  <span className="font-mono text-emerald-700 font-bold">Q</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max={maxPosQuanta}
                  value={promptQuantity}
                  aria-label={isSw ? 'Idadi ya Quanta' : 'Quanta amount'}
                  onChange={(e) => setPromptQuantity(parseInt(e.target.value, 10) || 1)}
                  className="w-full h-2 accent-emerald-600 cursor-pointer"
                />
                {/* Quick quanta chips */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {[1, 2, 4, 8].filter((q) => q <= maxPosQuanta).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setPromptQuantity(q)}
                      className={`min-w-[44px] min-h-[34px] px-2 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                        promptQuantity === q
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-emerald-50 hover:border-emerald-400'
                      }`}
                    >
                      {q}Q
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPromptQuantity(maxPosQuanta)}
                    className={`min-h-[34px] px-2.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                      promptQuantity === maxPosQuanta
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-emerald-50 hover:border-emerald-400'
                    }`}
                  >
                    {isSw ? 'Zote' : 'Max'} ({maxPosQuanta}Q)
                  </button>
                </div>
              </div>

              {/* Payment method — CASH first and default */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  {isSw ? 'Njia ya Malipo:' : 'Payment method:'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['CASH', 'M-PESA', 'TIGO-PESA'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setSelectedPaymentMethod(method)}
                      className={`min-h-[52px] px-2 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        selectedPaymentMethod === method
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-sm ring-1 ring-emerald-600'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price breakdown */}
              <div className="bg-emerald-50/70 border border-emerald-100 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-700">
                  <span>{isSw ? 'Bei kwa Quanta:' : 'Price per quantum:'}</span>
                  <span className="font-mono font-semibold text-slate-900">
                    TZS {Math.round(selectedItemForSale.unitPriceTzs / 4).toLocaleString('en-US')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-700">
                  <span>{isSw ? 'Idadi:' : 'Quantity:'}</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {promptQuantity} Q
                  </span>
                </div>
                <div className="border-t border-emerald-200 pt-2 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">
                    {isSw ? 'Jumla ya Mauzo:' : 'POS Total:'}
                  </span>
                  <span className="font-mono font-bold text-emerald-800 text-lg">
                    TZS{' '}
                    {Math.round(
                      (promptQuantity * selectedItemForSale.unitPriceTzs) / 4
                    ).toLocaleString('en-US')}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setSelectedItemForSale(null)}
                  className="flex-1 min-h-[48px] px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-sm rounded-xl cursor-pointer transition-colors"
                >
                  {isSw ? 'Ghairi' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submittingPos}
                  className="flex-[2] min-h-[48px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-sm rounded-xl shadow-sm cursor-pointer transition-colors flex items-center justify-center gap-2"
                >
                  <DollarSign className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {submittingPos
                      ? isSw
                        ? 'Inakata...'
                        : 'Processing...'
                      : isSw
                        ? 'Thibitisha Mauzo'
                        : 'Confirm Sale'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STANDARD / AMENDED PRICE MODAL FOR CLONED GLOBAL SKU */}
      {pricingModalClone && (
        <div className="sk-dialog-overlay backdrop-blur-xs">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4 max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto sk-safe-bottom overscroll-contain">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="font-mono text-xs font-bold text-emerald-700">
                  {pricingModalClone.canonicalSku}
                </div>
                <h3 className="text-base font-bold text-slate-950">
                  {isSw ? 'Chagua Bei Kuu / Rekebisha Bei' : 'Standard & Amended Selling Price'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPricingModalClone(null)}
                className="text-slate-400 hover:text-slate-900 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingPriceModal ? (
              <p className="text-xs text-slate-500 py-4 text-center">Loading standard prices...</p>
            ) : pricingModalUnits.length === 0 || pricingModalStandards.length === 0 ? (
              <p className="text-xs text-slate-600 py-4">
                {isSw
                  ? 'Hakuna bei kuu zilizochapishwa na Super Admin kwa bidhaa hii bado.'
                  : 'No Super Admin standard prices published for this SKU yet.'}
              </p>
            ) : (
              <form onSubmit={handleSaveMerchantPrice} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Kipimo cha Bidhaa' : 'Product Unit'}
                  </label>
                  <select
                    value={selectedGlobalUnitId}
                    onChange={(e) => {
                      const nextUnitId = e.target.value;
                      setSelectedGlobalUnitId(nextUnitId);
                      const firstMatch = pricingModalStandards.find(
                        (p) => p.globalProductUnitId === nextUnitId
                      );
                      if (firstMatch) setSelectedStandardPriceId(firstMatch.id);
                    }}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                  >
                    {pricingModalUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayLabelSw || u.systemUnit?.nameSw} ({u.quarterQuantaPerUnit}Q)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Bei Kuu ya SokoKuu (Standard Tier)' : 'Published Standard Price'}
                  </label>
                  <select
                    value={selectedStandardPriceId}
                    onChange={(e) => setSelectedStandardPriceId(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                  >
                    {pricingModalStandards
                      .filter((p) => p.globalProductUnitId === selectedGlobalUnitId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          [{p.profileType} v{p.version}] Min {p.minQty} — TZS{' '}
                          {p.standardPriceTzs.toLocaleString('en-US')}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw
                      ? 'Marekebisho ya Bei Yako ya Mfanyabiashara (Hiari - acha wazi kutumia Bei Kuu)'
                      : 'Custom Selling Price Amendment (optional — leave blank to adopt Standard Price)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={amendedPriceInput}
                    onChange={(e) => setAmendedPriceInput(e.target.value)}
                    placeholder={isSw ? 'Weka bei (TZS)...' : 'Enter price (TZS)...'}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                  />
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    disabled={savingPriceModal}
                    onClick={() => void handleResetPriceToStandard()}
                    className="px-3 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{isSw ? 'Rejesha Bei Kuu' : 'Reset Override'}</span>
                  </button>
                  <button
                    type="submit"
                    disabled={savingPriceModal}
                    className="flex-1 min-h-[40px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    {savingPriceModal
                      ? isSw
                        ? 'Inahifadhi...'
                        : 'Saving...'
                      : isSw
                        ? 'Hifadhi Bei'
                        : 'Save Price'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* EXTERNAL PURCHASE RECEIPT MODAL */}
      {purchaseModalClone && (
        <div className="sk-dialog-overlay backdrop-blur-xs">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4 max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto sk-safe-bottom overscroll-contain">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="font-mono text-xs font-bold text-emerald-700">
                  {purchaseModalClone.canonicalSku}
                </div>
                <h3 className="text-base font-bold text-slate-950">
                  {isSw ? 'Risiti ya Manunuzi ya Nje (Stock-In)' : 'External Purchase Receipt'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPurchaseModalClone(null)}
                className="text-slate-400 hover:text-slate-900 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveExternalPurchase} className="space-y-3.5">
              {purchaseModalUnits.length > 0 ? (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Kipimo cha Manunuzi' : 'Purchase Unit'}
                  </label>
                  <select
                    value={purchaseUnitId}
                    onChange={(e) => {
                      setPurchaseUnitId(e.target.value);
                      const found = purchaseModalUnits.find((u) => u.id === e.target.value);
                      if (found) setPurchaseQuantaPerUnit(found.quarterQuantaPerUnit);
                    }}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                  >
                    {purchaseModalUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayLabelSw || u.systemUnit?.nameSw} ({u.quarterQuantaPerUnit}Q)
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Quanta kwa Kifungashio' : 'Quarter-Quanta per Unit'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={purchaseQuantaPerUnit}
                    onChange={(e) => setPurchaseQuantaPerUnit(parseInt(e.target.value, 10) || 4)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Msambazaji (Supplier)' : 'Supplier Name'}
                  </label>
                  <input
                    type="text"
                    value={purchaseSupplierName}
                    onChange={(e) => setPurchaseSupplierName(e.target.value)}
                    placeholder={isSw ? 'Jina la msambazaji...' : 'Supplier name...'}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Hali ya Risiti' : 'Receipt Status'}
                  </label>
                  <select
                    value={purchaseStatus}
                    onChange={(e) =>
                      setPurchaseStatus(e.target.value as 'GOODS_RECEIVED' | 'ORDER_CONFIRMED')
                    }
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                  >
                    <option value="GOODS_RECEIVED">GOODS_RECEIVED (+Stock)</option>
                    <option value="ORDER_CONFIRMED">ORDER_CONFIRMED (Pre-Arrival)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Rejea ya Ankara / Risiti' : 'Supplier Reference'}
                </label>
                <input
                  type="text"
                  value={purchaseSupplierRef}
                  onChange={(e) => setPurchaseSupplierRef(e.target.value)}
                  placeholder="INV-..."
                  className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Idadi (Units)' : 'Quantity Units'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={purchaseQtyUnits}
                    onChange={(e) => setPurchaseQtyUnits(parseInt(e.target.value, 10) || 1)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Jumla ya Gharama (TZS)' : 'Agreed Total Cost (TZS)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={purchaseTotalCostTzs || ''}
                    onChange={(e) => setPurchaseTotalCostTzs(parseInt(e.target.value, 10) || 0)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                    required
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPurchaseModalClone(null)}
                  className="flex-1 min-h-[40px] px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  {isSw ? 'Ghairi' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingPurchaseModal}
                  className="flex-1 min-h-[40px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  {savingPurchaseModal
                    ? isSw
                      ? 'Inahifadhi...'
                      : 'Recording...'
                    : isSw
                      ? 'Hifadhi Risiti'
                      : 'Commit Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
