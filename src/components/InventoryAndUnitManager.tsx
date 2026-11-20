import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  DollarSign,
  Eye,
  Globe,
  Minus,
  PackagePlus,
  Pencil,
  Plus,
  PlusCircle,
  RotateCcw,
  Search,
  ShoppingBag,
  Store,
  Tag,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wifi,
  X,
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
  categoryFromSystemUnitCode,
  formatContextAwareStock,
  formatQuantaMeasurement,
  formatQuantumDefinition,
  isWholesaleOnly,
  type UnitCategory,
} from '../utils/formatProductUnit';
import { resolveBackendImageUrl } from '../lib/sokoProductImage';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';
import { ConfirmDestructiveDialog } from './ConfirmDestructiveDialog';
import { ImageKitUpload } from './ImageKitUpload';

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
  unitCategory?: UnitCategory;
  lastRestockedEat: string;
}

export interface ClonedCatalogItemRecord {
  clonedProductId: string;
  retailerBusinessId: string;
  globalCatalogId: string;
  canonicalSku: string;
  categoryCode?: string;
  baseQuantumUnit?: string;
  unitCategory?: UnitCategory;
  fixedNameSw: string;
  fixedNameEn: string;
  imagekitCdnUrl: string;
  availableQuantaStock: number;
  lowStockThresholdQuanta: number;
  unitPriceTzs: number;
  sellingPriceTzs?: number;
  inventoryValueTzs: number;
  lastBuyingPricePerQuantumTzs: number;
  weightedAvgBuyingCostPerQuantumTzs: number;
  buyingPriceEstablished: boolean;
  isPublishedToMarket?: boolean;
  isActiveForSale?: boolean;
  unitPricingOverrides: Array<{
    overrideId: string;
    globalProductUnitId: string;
    unitCode: string;
    category?: UnitCategory;
    abbreviation?: string;
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

interface CatalogAvailableUnitDto {
  id: string;
  unitCode: string;
  category?: UnitCategory;
  abbreviation?: string;
  displayLabelSw: string;
  displayLabelEn: string;
  quarterQuantaPerUnit: number;
  isWholesaleUnit: boolean;
}

interface EnrichedGlobalCatalogEntry extends GlobalCatalogEntry {
  unitCategory: UnitCategory;
  availableUnits: CatalogAvailableUnitDto[];
  standardRetailPriceTzs: number | null;
  standardRetailUnitLabelSw: string | null;
  standardWholesalePriceTzs: number | null;
  standardWholesaleUnitLabelSw: string | null;
}

interface GlobalProductUnitDto {
  id: string;
  quarterQuantaPerUnit: number;
  displayLabelSw: string | null;
  displayLabelEn: string | null;
  isWholesaleUnit: boolean;
  systemUnit?: {
    unitCode: string;
    category?: UnitCategory;
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

type InventoryHubTab = 'stock' | 'stock_in' | 'catalog' | 'publish';
type StockFilter = 'ALL' | 'LIVE' | 'LOW_STOCK' | 'NEEDS_STOCK';
type StockSourceType = 'EXISTING_STORE_STOCK' | 'EXTERNAL_SUPPLIER';

function mapPaymentMethodToPosDto(
  method: 'CASH' | 'M-PESA' | 'TIGO-PESA',
): 'CASH' | 'M_PESA' | 'TIGO_PESA' {
  if (method === 'M-PESA') return 'M_PESA';
  if (method === 'TIGO-PESA') return 'TIGO_PESA';
  return 'CASH';
}

function resolveUnitCategoryForClone(
  clone: ClonedCatalogItemRecord,
  catalogEntry?: EnrichedGlobalCatalogEntry,
): UnitCategory {
  if (clone.unitCategory) return clone.unitCategory;
  if (catalogEntry?.unitCategory) return catalogEntry.unitCategory;
  const ovCat = clone.unitPricingOverrides.find((o) => o.category === 'VOLUME' || o.category === 'WEIGHT')?.category;
  if (ovCat) return ovCat;
  const hint = `${clone.baseQuantumUnit ?? ''} ${clone.categoryCode ?? ''} ${clone.fixedNameSw} ${clone.fixedNameEn}`.toUpperCase();
  if (/OIL|MAFUTA|JUICE|JUISI|SODA|WATER|MAJI|MILK|MAZIWA|LITRE|ML|VINYWAJI|DRINK/.test(hint)) {
    return 'VOLUME';
  }
  return 'WEIGHT';
}

function getCloneFinancialView(
  clone: ClonedCatalogItemRecord,
  wholesaleMode: boolean,
  unitCategory: UnitCategory,
  locale: Locale,
  catalogEntry?: EnrichedGlobalCatalogEntry,
) {
  const isSw = locale === 'sw';
  const overrides = clone.unitPricingOverrides ?? [];
  const base4Override = overrides.find((o) => o.quarterQuantaPerUnit === 4);
  const pkgOverride =
    overrides.find((o) => o.quarterQuantaPerUnit >= 24) ??
    overrides.find((o) => o.unitCode.includes('CARTON') || o.unitCode.includes('GUNIA') || o.unitCode.includes('SACK') || o.unitCode.includes('DEBE'));
  const retailOverride = base4Override ?? overrides.find((o) => o.quarterQuantaPerUnit < 24) ?? overrides[0];

  const primaryOverride = wholesaleMode ? pkgOverride ?? retailOverride : retailOverride ?? pkgOverride;

  const catalogPkgUnit = catalogEntry?.availableUnits.find((u) => u.isWholesaleUnit || u.quarterQuantaPerUnit >= 24);
  const displayQuantaPerUnit =
    primaryOverride?.quarterQuantaPerUnit ??
    (wholesaleMode && catalogPkgUnit ? catalogPkgUnit.quarterQuantaPerUnit : 4);

  const unitLabel = primaryOverride
    ? isSw
      ? primaryOverride.displayLabelSw
      : primaryOverride.displayLabelEn
    : wholesaleMode && catalogPkgUnit
      ? isSw
        ? catalogPkgUnit.displayLabelSw
        : catalogPkgUnit.displayLabelEn
      : unitCategory === 'VOLUME'
        ? '1 L'
        : '1 KG';

  const effectiveSellingPriceTzs = primaryOverride
    ? primaryOverride.effectiveSellingPriceTzs
    : Number(clone.sellingPriceTzs ?? clone.unitPriceTzs ?? 0);

  const buyingCostPerUnitTzs =
    clone.weightedAvgBuyingCostPerQuantumTzs > 0
      ? Math.round(clone.weightedAvgBuyingCostPerQuantumTzs * displayQuantaPerUnit)
      : 0;

  const marginTzs =
    buyingCostPerUnitTzs > 0 && effectiveSellingPriceTzs > 0
      ? effectiveSellingPriceTzs - buyingCostPerUnitTzs
      : null;

  const pkgDisplayUnit = pkgOverride
    ? {
        labelSw: pkgOverride.displayLabelSw,
        labelEn: pkgOverride.displayLabelEn,
        quanta: pkgOverride.quarterQuantaPerUnit,
      }
    : catalogPkgUnit
      ? {
          labelSw: catalogPkgUnit.displayLabelSw,
          labelEn: catalogPkgUnit.displayLabelEn,
          quanta: catalogPkgUnit.quarterQuantaPerUnit,
        }
      : undefined;

  const stockLabel = formatContextAwareStock({
    quanta: clone.availableQuantaStock,
    category: unitCategory,
    locale: isSw ? 'sw' : 'en',
    wholesaleMode,
    packageUnitLabelSw: pkgDisplayUnit?.labelSw,
    packageUnitLabelEn: pkgDisplayUnit?.labelEn,
    quantaPerPackage: pkgDisplayUnit?.quanta,
  });

  const hasStock = clone.availableQuantaStock > 0;
  const hasPrice =
    effectiveSellingPriceTzs > 0 ||
    overrides.some((o) => o.effectiveSellingPriceTzs > 0);
  const isPublished = Boolean(clone.isPublishedToMarket);
  const isAmended = Boolean(primaryOverride?.isOverridden);
  const isStandard = Boolean(primaryOverride && !primaryOverride.isOverridden);

  return {
    unitLabel,
    displayQuantaPerUnit,
    effectiveSellingPriceTzs,
    buyingCostPerUnitTzs,
    marginTzs,
    stockLabel,
    hasStock,
    hasPrice,
    isPublished,
    isAmended,
    isStandard,
    pkgOverride,
  };
}

export function InventoryAndUnitManager({
  locale = 'en',
  activeSection = 'pos_register',
  businessId,
  userRole = 'RETAILER',
  userTier = null,
  onOpenSokoni,
}: {
  locale?: Locale;
  activeSection?: 'pos_register' | 'inventory_shelf';
  businessId?: string | null;
  userRole?: 'RETAILER' | 'WHOLESALER' | 'CONSUMER';
  userTier?: string | null;
  onOpenSokoni?: (globalCatalogId?: string | null) => void;
}) {
  const isSw = locale === 'sw';
  const wholesaleMode = isWholesaleOnly(userRole, userTier);

  const [resolvedBusinessId, setResolvedBusinessId] = useState<string | null>(
    isUuid(businessId) ? businessId : SokoApiClient.getActiveUser()?.businessId ?? null,
  );
  const [backendOffline, setBackendOffline] = useState<boolean>(
    typeof window !== 'undefined' ? !window.navigator.onLine : false,
  );
  const [loadingLive, setLoadingLive] = useState<boolean>(false);

  // 4-Tab Hub Navigation & Filters
  const [activeHubTab, setActiveHubTab] = useState<InventoryHubTab>('stock');
  const [stockSearchQuery, setStockSearchQuery] = useState<string>('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('ALL');
  const [catalogSearchQuery, setCatalogSearchQuery] = useState<string>('');
  const [showLegacyShelfTools, setShowLegacyShelfTools] = useState<boolean>(false);

  const [customUnits, setCustomUnits] = useState<MerchantCustomUnit[]>([]);
  const [globalCatalog, setGlobalCatalog] = useState<EnrichedGlobalCatalogEntry[]>([]);
  const [clonedItems, setClonedItems] = useState<ClonedCatalogItemRecord[]>([]);
  const [shelfItems, setShelfItems] = useState<DukaInventoryItem[]>([]);
  const [receiptLedger, setReceiptLedger] = useState<PosReceiptRecord[]>([]);
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const [toastAction, setToastAction] = useState<{ label: string; onClick: () => void } | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [togglingPublishId, setTogglingPublishId] = useState<string | null>(null);
  const [bulkPublishing, setBulkPublishing] = useState<boolean>(false);
  const [previewPublishClone, setPreviewPublishClone] = useState<ClonedCatalogItemRecord | null>(null);

  // Clone self-service (edit / delete)
  const [editClone, setEditClone] = useState<ClonedCatalogItemRecord | null>(null);
  const [editCloneStock, setEditCloneStock] = useState<string>('0');
  const [editCloneLowStock, setEditCloneLowStock] = useState<string>('20');
  const [editCloneImageUrl, setEditCloneImageUrl] = useState<string>('');
  const [savingCloneEdit, setSavingCloneEdit] = useState<boolean>(false);
  const [deleteCloneTarget, setDeleteCloneTarget] = useState<ClonedCatalogItemRecord | null>(null);
  const [deletingClone, setDeletingClone] = useState<boolean>(false);

  // Merchant-owned product / custom-unit delete
  const [deleteProductTarget, setDeleteProductTarget] = useState<{ id: string; label: string } | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<boolean>(false);
  const [deleteUnitTarget, setDeleteUnitTarget] = useState<{ productId: string; unitId: string; label: string } | null>(null);
  const [deletingUnit, setDeletingUnit] = useState<boolean>(false);

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

  // Standard / Amended Price Drawer/Modal for a Cloned Global Catalog SKU
  const [pricingModalClone, setPricingModalClone] = useState<ClonedCatalogItemRecord | null>(null);
  const [pricingModalUnits, setPricingModalUnits] = useState<GlobalProductUnitDto[]>([]);
  const [pricingModalStandards, setPricingModalStandards] = useState<StandardPriceDto[]>([]);
  const [selectedGlobalUnitId, setSelectedGlobalUnitId] = useState<string>('');
  const [selectedStandardPriceId, setSelectedStandardPriceId] = useState<string>('');
  const [amendedPriceInput, setAmendedPriceInput] = useState<string>('');
  const [loadingPriceModal, setLoadingPriceModal] = useState<boolean>(false);
  const [savingPriceModal, setSavingPriceModal] = useState<boolean>(false);

  // Tab 2 Inline Stock-In (Manual Purchase / Existing Store Stock vs Sokoni)
  const [stockInCloneId, setStockInCloneId] = useState<string>('');
  const [stockInSource, setStockInSource] = useState<StockSourceType>('EXISTING_STORE_STOCK');
  const [stockInUnits, setStockInUnits] = useState<GlobalProductUnitDto[]>([]);
  const [loadingStockInUnits, setLoadingStockInUnits] = useState<boolean>(false);
  const [stockInUnitId, setStockInUnitId] = useState<string>('');
  const [stockInQuantaPerUnit, setStockInQuantaPerUnit] = useState<number>(4);
  const [stockInQtyUnits, setStockInQtyUnits] = useState<number>(1);
  const [stockInBuyingPricePerUnit, setStockInBuyingPricePerUnit] = useState<number>(0);
  const [stockInSupplierName, setStockInSupplierName] = useState<string>('');
  const [stockInReceiptRef, setStockInReceiptRef] = useState<string>('');
  const [savingStockIn, setSavingStockIn] = useState<boolean>(false);

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
            unitCategory?: UnitCategory;
            availableUnits?: CatalogAvailableUnitDto[];
            standardRetailPriceTzs?: number | null;
            standardRetailUnitLabelSw?: string | null;
            standardWholesalePriceTzs?: number | null;
            standardWholesaleUnitLabelSw?: string | null;
          }>
        >('/marketplace/catalog'),
        SokoApiClient.hasAccessToken()
          ? SokoApiClient.get<ClonedCatalogItemRecord[]>(
              `/merchant/catalog/clones${isUuid(targetBizId) ? `?businessId=${encodeURIComponent(targetBizId)}` : ''}`,
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
                unitCategory?: UnitCategory;
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
              imagekitCdnUrl: resolveBackendImageUrl(c.imagekitCdnUrl, c.staticImageUrl),
              staticImageUrl: c.staticImageUrl,
              defaultBaseUnitSw: c.baseQuantumUnit,
              defaultBaseUnitEn: c.baseQuantumUnit,
              baseQuantumUnit: c.baseQuantumUnit,
              clonedByStoresCount: Number(c.clonedByStoresCount ?? 0),
              updatedAtEat: new Date().toISOString(),
              unitCategory: c.unitCategory ?? 'WEIGHT',
              availableUnits: c.availableUnits ?? [],
              standardRetailPriceTzs: c.standardRetailPriceTzs ?? null,
              standardRetailUnitLabelSw: c.standardRetailUnitLabelSw ?? null,
              standardWholesalePriceTzs: c.standardWholesalePriceTzs ?? null,
              standardWholesaleUnitLabelSw: c.standardWholesaleUnitLabelSw ?? null,
            }))
          : [],
      );

      const safeClones = Array.isArray(liveClones) ? liveClones : [];
      setClonedItems(safeClones);
      if (
        safeClones.length > 0 &&
        (!stockInCloneId || !safeClones.some((c) => c.clonedProductId === stockInCloneId))
      ) {
        setStockInCloneId(safeClones[0].clonedProductId);
      }

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
            imagekitCdnUrl: resolveBackendImageUrl(p.imagekitCdnUrl),
            globalCatalogId: p.globalCatalogId,
            lowStockThresholdQuanta: 20,
            unitType: p.priceTiers?.[0]?.unitType ?? 'UNIT',
            unitCategory: p.unitCategory,
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
  }, [businessId, stockInCloneId, targetUnitProductId]);

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
        setErrorNotice(
          err instanceof Error
            ? err.message
            : 'Failed to sync a staged catalog clone; it remains queued.',
        );
      }
    }

    if (syncedIds.length > 0) {
      await markGlobalClonesSynced(syncedIds);
      setToastNotice(
        isSw
          ? `Mtandao umerejea: Bidhaa ${syncedIds.length} zimesawazishwa na Hifadhidata ya SokoKuu.`
          : `Back online: ${syncedIds.length} staged catalog item(s) synced to PostgreSQL.`,
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

  const catalogById = useMemo(
    () => new Map(globalCatalog.map((item) => [item.globalCatalogId, item])),
    [globalCatalog],
  );

  // Selected clone for Tab 2 Stock-In & fetch its valid units dynamically
  const selectedStockInClone = useMemo(
    () => clonedItems.find((c) => c.clonedProductId === stockInCloneId) ?? null,
    [clonedItems, stockInCloneId],
  );

  useEffect(() => {
    if (!selectedStockInClone || activeSection !== 'inventory_shelf') {
      setStockInUnits([]);
      return;
    }

    let cancelled = false;
    const loadUnitsForSelected = async () => {
      setLoadingStockInUnits(true);
      try {
        const res = await SokoApiClient.get<{
          units?: GlobalProductUnitDto[];
        }>(`/marketplace/catalog/${selectedStockInClone.globalCatalogId}/standard-prices`);
        if (cancelled) return;
        const units = res.units ?? [];
        setStockInUnits(units);
        if (units.length > 0) {
          const preferred =
            (wholesaleMode ? units.find((u) => u.isWholesaleUnit) : units.find((u) => u.quarterQuantaPerUnit === 4)) ??
            units[0];
          setStockInUnitId(preferred.id);
          setStockInQuantaPerUnit(preferred.quarterQuantaPerUnit);
        } else {
          setStockInUnitId('');
          setStockInQuantaPerUnit(4);
        }
      } catch {
        if (cancelled) return;
        const fallbackUnits = catalogById.get(selectedStockInClone.globalCatalogId)?.availableUnits ?? [];
        const mapped: GlobalProductUnitDto[] = fallbackUnits.map((u) => ({
          id: u.id,
          quarterQuantaPerUnit: u.quarterQuantaPerUnit,
          displayLabelSw: u.displayLabelSw,
          displayLabelEn: u.displayLabelEn,
          isWholesaleUnit: u.isWholesaleUnit,
          systemUnit: {
            unitCode: u.unitCode,
            category: u.category,
            nameSw: u.displayLabelSw,
            nameEn: u.displayLabelEn,
            abbreviation: u.abbreviation ?? '',
          },
        }));
        setStockInUnits(mapped);
        if (mapped.length > 0) {
          setStockInUnitId(mapped[0].id);
          setStockInQuantaPerUnit(mapped[0].quarterQuantaPerUnit);
        } else {
          setStockInUnitId('');
          setStockInQuantaPerUnit(4);
        }
      } finally {
        if (!cancelled) setLoadingStockInUnits(false);
      }
    };

    void loadUnitsForSelected();
    return () => {
      cancelled = true;
    };
  }, [selectedStockInClone, activeSection, wholesaleMode, catalogById]);

  const jumpToStockInForClone = (clonedProductId: string) => {
    setErrorNotice(null);
    setToastAction(null);
    setStockInCloneId(clonedProductId);
    setStockInQtyUnits(1);
    setStockInBuyingPricePerUnit(0);
    setStockInReceiptRef('');
    setActiveHubTab('stock_in');
  };

  // KPI metrics for Tab 1
  const kpiMetrics = useMemo(() => {
    const totalActiveSkus = clonedItems.length;
    const totalInventoryValueCostTzs = clonedItems.reduce(
      (sum, item) =>
        sum +
        Math.round(
          Math.max(0, item.availableQuantaStock) *
            Math.max(0, item.weightedAvgBuyingCostPerQuantumTzs),
        ),
      0,
    );
    const lowStockCount = clonedItems.filter(
      (item) =>
        item.availableQuantaStock <= item.lowStockThresholdQuanta,
    ).length;
    const liveOnMarketCount = clonedItems.filter((item) => Boolean(item.isPublishedToMarket)).length;
    return {
      totalActiveSkus,
      totalInventoryValueCostTzs,
      lowStockCount,
      liveOnMarketCount,
    };
  }, [clonedItems]);

  const filteredStockClones = useMemo(() => {
    const q = stockSearchQuery.trim().toLowerCase();
    return clonedItems.filter((clone) => {
      if (stockFilter === 'LIVE' && !clone.isPublishedToMarket) return false;
      if (
        stockFilter === 'LOW_STOCK' &&
        !(clone.availableQuantaStock > 0 && clone.availableQuantaStock <= clone.lowStockThresholdQuanta)
      ) {
        return false;
      }
      if (stockFilter === 'NEEDS_STOCK' && clone.availableQuantaStock > 0) return false;

      if (!q) return true;
      return (
        clone.fixedNameSw.toLowerCase().includes(q) ||
        clone.fixedNameEn.toLowerCase().includes(q) ||
        clone.canonicalSku.toLowerCase().includes(q) ||
        (clone.categoryCode ?? '').toLowerCase().includes(q)
      );
    });
  }, [clonedItems, stockSearchQuery, stockFilter]);

  const filteredGlobalCatalog = useMemo(() => {
    const q = catalogSearchQuery.trim().toLowerCase();
    if (!q) return globalCatalog;
    return globalCatalog.filter(
      (entry) =>
        entry.fixedNameSw.toLowerCase().includes(q) ||
        entry.fixedNameEn.toLowerCase().includes(q) ||
        entry.canonicalSku.toLowerCase().includes(q) ||
        entry.categoryCode.toLowerCase().includes(q),
    );
  }, [globalCatalog, catalogSearchQuery]);

  // Live Calculation Preview for Tab 2 Stock-In
  const stockInPreview = useMemo(() => {
    const safeQty = Math.max(1, Math.round(stockInQtyUnits || 1));
    const safeQpu = Math.max(1, Math.round(stockInQuantaPerUnit || 4));
    const safeUnitCost = Math.max(0, Math.round(stockInBuyingPricePerUnit || 0));
    const addedQuanta = safeQty * safeQpu;
    const totalCostTzs = safeQty * safeUnitCost;

    const existingQuanta = Math.max(0, selectedStockInClone?.availableQuantaStock ?? 0);
    const existingWacPerQ = Math.max(0, selectedStockInClone?.weightedAvgBuyingCostPerQuantumTzs ?? 0);
    const newTotalQuanta = existingQuanta + addedQuanta;
    const projectedWacPerQ =
      newTotalQuanta > 0 && totalCostTzs > 0
        ? Math.round((existingQuanta * existingWacPerQ + totalCostTzs) / newTotalQuanta)
        : existingWacPerQ;
    const projectedWacPerSelectedUnit = projectedWacPerQ * safeQpu;

    const unitCat = selectedStockInClone
      ? resolveUnitCategoryForClone(
          selectedStockInClone,
          catalogById.get(selectedStockInClone.globalCatalogId),
        )
      : 'WEIGHT';

    return {
      addedQuanta,
      addedMeasureLabel: formatQuantaMeasurement(addedQuanta, unitCat, isSw ? 'sw' : 'en'),
      totalCostTzs,
      newTotalQuanta,
      projectedWacPerQ,
      projectedWacPerSelectedUnit,
      unitCat,
    };
  }, [
    stockInQtyUnits,
    stockInQuantaPerUnit,
    stockInBuyingPricePerUnit,
    selectedStockInClone,
    catalogById,
    isSw,
  ]);

  // Actions
  const handleToggleMarketPublish = async (
    clone: ClonedCatalogItemRecord,
    nextPublish: boolean,
  ) => {
    setErrorNotice(null);
    setToastAction(null);

    const catEntry = catalogById.get(clone.globalCatalogId);
    const unitCat = resolveUnitCategoryForClone(clone, catEntry);
    const fin = getCloneFinancialView(clone, wholesaleMode, unitCat, locale, catEntry);

    if (nextPublish && !fin.hasStock) {
      setErrorNotice(
        isSw
          ? `Bidhaa "${clone.fixedNameSw}" haina stock (0). Ingiza mzigo kwanza kabla ya kupeleka Sokoni.`
          : `Product "${clone.fixedNameEn}" has 0 stock. Record stock-in first before publishing to Sokoni.`,
      );
      setToastAction({
        label: isSw ? '+ Ingiza Stock Sasa' : '+ Add Stock Now',
        onClick: () => jumpToStockInForClone(clone.clonedProductId),
      });
      return;
    }

    if (nextPublish && !fin.hasPrice) {
      setErrorNotice(
        isSw
          ? `Bidhaa "${clone.fixedNameSw}" haina bei ya kuuzia (> 0 TZS). Weka bei kwanza.`
          : `Product "${clone.fixedNameEn}" needs a selling price (> 0 TZS) before publishing to Sokoni.`,
      );
      setToastAction({
        label: isSw ? 'Weka Bei Sasa' : 'Set Price Now',
        onClick: () => void openPricingModal(clone),
      });
      return;
    }

    setTogglingPublishId(clone.clonedProductId);
    try {
      const updated = await SokoApiClient.patch<{
        clonedProductId: string;
        isPublishedToMarket: boolean;
        isActiveForSale: boolean;
      }>(`/merchant/catalog/${clone.clonedProductId}/publish-status`, {
        isPublishedToMarket: nextPublish,
        isActiveForSale: nextPublish,
      });

      setClonedItems((prev) =>
        prev.map((c) =>
          c.clonedProductId === clone.clonedProductId
            ? {
                ...c,
                isPublishedToMarket: updated.isPublishedToMarket,
                isActiveForSale: updated.isActiveForSale,
              }
            : c,
        ),
      );
      setToastNotice(
        updated.isPublishedToMarket
          ? isSw
            ? `"${clone.fixedNameSw}" imepelekwa Sokoni na inaonekana kwa wanunuzi.`
            : `"${clone.fixedNameEn}" is now live on Sokoni Marketplace.`
          : isSw
            ? `"${clone.fixedNameSw}" imeondolewa Sokoni kwa muda.`
            : `"${clone.fixedNameEn}" unpublished from Sokoni Marketplace.`,
      );
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorNotice(
          err instanceof SokoHttpError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to update market visibility.',
        );
      }
    } finally {
      setTogglingPublishId(null);
    }
  };

  const handleBulkPublishReady = async (publish: boolean) => {
    setErrorNotice(null);
    const targetIds = clonedItems
      .filter((clone) => {
        if (!publish) return Boolean(clone.isPublishedToMarket);
        const catEntry = catalogById.get(clone.globalCatalogId);
        const unitCat = resolveUnitCategoryForClone(clone, catEntry);
        const fin = getCloneFinancialView(clone, wholesaleMode, unitCat, locale, catEntry);
        return fin.hasStock && fin.hasPrice && !fin.isPublished;
      })
      .map((c) => c.clonedProductId);

    if (targetIds.length === 0) {
      setToastNotice(
        publish
          ? isSw
            ? 'Hakuna bidhaa mpya iliyo tayari (Stock > 0 & Bei > 0) kupelekwa Sokoni.'
            : 'No unpublished ready items (Stock > 0 & Price > 0) found.'
          : isSw
            ? 'Hakuna bidhaa zilizopo Sokoni kwa sasa.'
            : 'No live items on Sokoni right now.',
      );
      return;
    }

    setBulkPublishing(true);
    try {
      await SokoApiClient.patch('/merchant/catalog/publish-status/bulk', {
        clonedProductIds: targetIds,
        isPublishedToMarket: publish,
      });
      setToastNotice(
        publish
          ? isSw
            ? `Bidhaa ${targetIds.length} zimepelekwa Sokoni kwa mpigo!`
            : `${targetIds.length} ready product(s) published live to Sokoni!`
          : isSw
            ? `Bidhaa ${targetIds.length} zimeondolewa Sokoni.`
            : `${targetIds.length} product(s) unpublished from Sokoni.`,
      );
      await loadLiveWorkspaceData();
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      setErrorNotice(
        err instanceof SokoHttpError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Bulk publish update failed.',
      );
    } finally {
      setBulkPublishing(false);
    }
  };

  const handleSubmitStockIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNotice(null);
    if (!selectedStockInClone) {
      setErrorNotice(isSw ? 'Chagua bidhaa kwanza.' : 'Please select a cloned product.');
      return;
    }
    if (stockInSource === 'EXTERNAL_SUPPLIER' && !stockInSupplierName.trim()) {
      setErrorNotice(
        isSw
          ? 'Weka jina la msambazaji kwa manunuzi ya nje.'
          : 'Enter supplier name for external supplier purchases.',
      );
      return;
    }
    if (stockInBuyingPricePerUnit <= 0) {
      setErrorNotice(
        isSw
          ? 'Weka bei halisi ya kununulia kwa kipimo (> 0 TZS) ili kukokotoa WAC.'
          : 'Enter actual buying price per unit (> 0 TZS) for accurate WAC costing.',
      );
      return;
    }

    setSavingStockIn(true);
    try {
      const res = await SokoApiClient.post<{
        receiptStatus: string;
        receivedQuanta: number;
        availableQuantaStock: number;
        lastBuyingPricePerQuantumTzs: number;
        weightedAvgBuyingCostPerQuantumTzs: number;
      }>('/merchant/purchases/external-receipt', {
        clonedProductId: selectedStockInClone.clonedProductId,
        ...(stockInUnitId
          ? { globalProductUnitId: stockInUnitId }
          : { quarterQuantaPerUnit: Math.max(1, stockInQuantaPerUnit) }),
        stockSource: stockInSource,
        ...(stockInSupplierName.trim() ? { supplierName: stockInSupplierName.trim() } : {}),
        ...(stockInReceiptRef.trim() ? { supplierReference: stockInReceiptRef.trim() } : {}),
        receiptStatus: 'GOODS_RECEIVED',
        quantityUnits: Math.max(1, Math.round(stockInQtyUnits)),
        agreedTotalCostTzs: stockInPreview.totalCostTzs,
      });

      setToastNotice(
        isSw
          ? `Mzigo umeingizwa (+${res.receivedQuanta}Q)! Wastani wa Ununuzi (WAC): TZS ${res.weightedAvgBuyingCostPerQuantumTzs.toLocaleString('en-US')}/Q`
          : `Stock-In committed (+${res.receivedQuanta}Q)! Updated WAC: TZS ${res.weightedAvgBuyingCostPerQuantumTzs.toLocaleString('en-US')}/Q`,
      );
      setStockInBuyingPricePerUnit(0);
      setStockInQtyUnits(1);
      setStockInSupplierName('');
      setStockInReceiptRef('');
      await loadLiveWorkspaceData();
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      setErrorNotice(
        err instanceof SokoHttpError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to record stock-in receipt.',
      );
    } finally {
      setSavingStockIn(false);
    }
  };

  const handleCloneGlobalCatalogItem = async (entry: EnrichedGlobalCatalogEntry) => {
    setErrorNotice(null);
    const existingClone = clonedItems.find((c) => c.globalCatalogId === entry.globalCatalogId);
    if (existingClone) {
      jumpToStockInForClone(existingClone.clonedProductId);
      return;
    }

    if (!isUuid(entry.globalCatalogId)) return;

    try {
      const res = await SokoApiClient.post<{
        localInventoryId: string;
        canonicalSku: string;
        updatedClonedByStoresCount: number;
      }>('/marketplace/catalog/clone-standard', {
        globalCatalogId: entry.globalCatalogId,
        ...(isUuid(resolvedBusinessId) ? { retailerBusinessId: resolvedBusinessId } : {}),
      });
      setToastNotice(
        isSw
          ? `Imenakiliwa dukani: ${res.canonicalSku} @ 0 Stock · 0 TZS. Sasa ingiza mzigo au chagua bei.`
          : `Cloned ${res.canonicalSku} @ 0 Stock · 0 TZS. Add stock or select selling price next.`,
      );
      setToastAction({
        label: isSw ? '+ Ingiza Stock' : '+ Stock-In Now',
        onClick: () => jumpToStockInForClone(res.localInventoryId),
      });
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
            ? `Nje ya Mtandao: Ombi la kunakili ${entry.canonicalSku} limewekwa kwenye foleni ya IndexedDB.`
            : `Offline: Clone request for ${entry.canonicalSku} queued in IndexedDB.`,
        );
      } else {
        setErrorNotice(err instanceof Error ? err.message : 'Failed to clone global catalog SKU.');
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

      const preferredUnit =
        (wholesaleMode ? units.find((u) => u.isWholesaleUnit) : units.find((u) => u.quarterQuantaPerUnit === 4)) ??
        units[0];
      const firstUnitId = preferredUnit?.id ?? '';
      setSelectedGlobalUnitId(firstUnitId);

      const unitPrices = prices.filter((p) => p.globalProductUnitId === firstUnitId);
      const matchingPrice =
        (wholesaleMode
          ? unitPrices.find((p) => p.profileType === 'WHOLESALE')
          : unitPrices.find((p) => p.profileType === 'RETAIL')) ??
        unitPrices[0] ??
        prices[0];
      setSelectedStandardPriceId(matchingPrice?.id ?? '');

      const existingOv = clone.unitPricingOverrides.find((o) => o.globalProductUnitId === firstUnitId);
      setAmendedPriceInput(
        existingOv?.isOverridden && existingOv.amendedSellingPriceTzs
          ? String(existingOv.amendedSellingPriceTzs)
          : '',
      );
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
        },
      );
      setToastNotice(
        isSw
          ? `Bei ya "${pricingModalClone.fixedNameSw}" imehifadhiwa kikamilifu!`
          : `Selling price for "${pricingModalClone.fixedNameEn}" saved to PostgreSQL!`,
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
        { globalProductUnitId: selectedGlobalUnitId },
      );
      setToastNotice(
        isSw
          ? `Bei ya "${pricingModalClone.fixedNameSw}" imerejeshwa kuwa Bei Kuu ya SokoKuu.`
          : `Override cleared for "${pricingModalClone.fixedNameEn}" — reverted to Standard Price.`,
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

  // POS & Direct Product Handlers (preserved)
  const handleCreateCustomUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUnitName.trim() || !newUnitCode.trim()) return;
    setErrorNotice(null);

    const calculatedQuanta = Math.round(newBaseKg * 4);
    if (Math.abs(newBaseKg * 4 - calculatedQuanta) > 0.001) {
      setErrorNotice(
        isSw
          ? 'Uzito lazima uwe kigawe halisi cha 0.25 KG (mf. 0.25, 0.5, 1, 5, 18).'
          : 'Base KG must be an exact multiple of 0.25 (e.g. 0.25, 0.5, 1, 5, 18).',
      );
      return;
    }

    if (!isUuid(targetUnitProductId)) {
      setErrorNotice(
        isSw
          ? 'Chagua bidhaa hai dukani kabla ya kuongeza kipimo maalum.'
          : 'Select an active PostgreSQL product SKU before attaching a custom unit.',
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
          ? `Kipimo kipya cha "${newUnitName.trim()}" kimesajiliwa (${calculatedQuanta} Quanta).`
          : `Custom unit "${newUnitName.trim()}" saved in PostgreSQL (${calculatedQuanta} Quanta).`,
      );
      setNewUnitName('');
      setNewUnitCode('');
      await loadLiveWorkspaceData();
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
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
          : `Item "${item.sku}" has 0 shelf & sealed stock. Restock first.`,
      );
      return;
    }
    if (item.unitPriceTzs <= 0) {
      setToastNotice(
        isSw
          ? `Bidhaa "${item.sku}" ina bei TZS 0. Weka bei kwanza.`
          : `Item "${item.sku}" has 0 TZS price. Set unit price first.`,
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
        isSw ? 'Kitambulisho cha bidhaa si halali.' : 'Selected product lacks a valid PostgreSQL UUID.',
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
            : i,
        ),
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
          : `POS Receipt ${res.receiptId} committed! ${selectedPaymentMethod} · Total: TZS ${res.totalTzs.toLocaleString('en-US')}${brokenMsg}`,
      );
      setSelectedItemForSale(null);
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorNotice(err instanceof Error ? err.message : 'POS sale rejected by backend.');
      }
    } finally {
      setSubmittingPos(false);
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
          : 'Enter SKU code, product name, unit price (TZS), and carton price (TZS).',
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
          : `Product ${skuClean} created directly in PostgreSQL!`,
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
      } else {
        setErrorNotice(err instanceof Error ? err.message : 'Product creation failed.');
      }
    } finally {
      setSavingProduct(false);
    }
  };

  const openEditClone = (clone: ClonedCatalogItemRecord) => {
    setErrorNotice(null);
    setEditClone(clone);
    setEditCloneStock(String(clone.availableQuantaStock ?? 0));
    setEditCloneLowStock(String(clone.lowStockThresholdQuanta ?? 0));
    setEditCloneImageUrl(clone.imagekitCdnUrl ?? '');
  };

  const handleSaveCloneEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editClone) return;
    setSavingCloneEdit(true);
    setErrorNotice(null);
    setToastAction(null);
    try {
      const updated = await SokoApiClient.patch<ClonedCatalogItemRecord>(
        `/merchant/catalog/${editClone.clonedProductId}`,
        {
          availableQuantaStock: Math.max(0, Math.trunc(Number(editCloneStock) || 0)),
          lowStockThresholdQuanta: Math.max(0, Math.trunc(Number(editCloneLowStock) || 0)),
          ...(editCloneImageUrl.trim() ? { imagekitCdnUrl: editCloneImageUrl.trim() } : {}),
        },
      );
      setClonedItems((prev) =>
        prev.map((c) =>
          c.clonedProductId === editClone.clonedProductId ? { ...c, ...updated } : c,
        ),
      );
      setToastNotice(
        isSw
          ? `Bidhaa "${editClone.fixedNameSw}" imesasishwa.`
          : `Cloned item "${editClone.fixedNameEn}" updated.`,
      );
      setEditClone(null);
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorNotice(
          err instanceof SokoHttpError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to update the cloned item.',
        );
      }
    } finally {
      setSavingCloneEdit(false);
    }
  };

  const handleConfirmDeleteClone = async () => {
    if (!deleteCloneTarget) return;
    const target = deleteCloneTarget;
    setDeletingClone(true);
    setErrorNotice(null);
    try {
      await SokoApiClient.delete(`/merchant/catalog/${target.clonedProductId}`);
      setClonedItems((prev) =>
        prev.filter((c) => c.clonedProductId !== target.clonedProductId),
      );
      setToastNotice(
        isSw
          ? `Bidhaa "${target.fixedNameSw}" imeondolewa.`
          : `Cloned item "${target.fixedNameEn}" removed.`,
      );
      setToastAction(null);
      setDeleteCloneTarget(null);
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorNotice(
          err instanceof SokoHttpError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to delete the cloned item.',
        );
      }
    } finally {
      setDeletingClone(false);
    }
  };

  const handleConfirmDeleteProduct = async () => {
    if (!deleteProductTarget) return;
    setDeletingProduct(true);
    setErrorNotice(null);
    setToastAction(null);
    try {
      await SokoApiClient.delete(`/products/${deleteProductTarget.id}`);
      setShelfItems((prev) => prev.filter((s) => s.itemId !== deleteProductTarget.id));
      setToastNotice(
        isSw
          ? `Bidhaa "${deleteProductTarget.label}" imefutwa.`
          : `Product "${deleteProductTarget.label}" deleted.`,
      );
      setDeleteProductTarget(null);
      await loadLiveWorkspaceData();
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      else setErrorNotice(err instanceof Error ? err.message : 'Failed to delete product.');
    } finally {
      setDeletingProduct(false);
    }
  };

  const handleConfirmDeleteCustomUnit = async () => {
    if (!deleteUnitTarget) return;
    setDeletingUnit(true);
    setErrorNotice(null);
    setToastAction(null);
    try {
      await SokoApiClient.delete(
        `/products/${deleteUnitTarget.productId}/custom-units/${deleteUnitTarget.unitId}`,
      );
      setCustomUnits((prev) => prev.filter((u) => u.unitId !== deleteUnitTarget.unitId));
      setToastNotice(
        isSw
          ? `Kipimo maalum "${deleteUnitTarget.label}" kimefutwa.`
          : `Custom unit "${deleteUnitTarget.label}" deleted.`,
      );
      setDeleteUnitTarget(null);
      await loadLiveWorkspaceData();
      window.dispatchEvent(new CustomEvent('sokokuu:catalog-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      else setErrorNotice(err instanceof Error ? err.message : 'Failed to delete custom unit.');
    } finally {
      setDeletingUnit(false);
    }
  };

  const maxPosQuanta = selectedItemForSale
    ? Math.max(
        1,
        selectedItemForSale.availableQuanta + (selectedItemForSale.sealedBulkPackagesStock ?? 0) * 100,
      )
    : 100;

  const containerMaxClass =
    activeSection === 'inventory_shelf' ? 'max-w-5xl mx-auto space-y-5' : 'max-w-2xl mx-auto space-y-6';

  return (
    <div className={containerMaxClass}>
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
          className="border border-rose-200 bg-rose-50 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-rose-900"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
            <span>{errorNotice}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {toastAction && (
              <button
                type="button"
                onClick={() => {
                  const action = toastAction;
                  setErrorNotice(null);
                  setToastAction(null);
                  action.onClick();
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold cursor-pointer"
              >
                {toastAction.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setErrorNotice(null);
                setToastAction(null);
              }}
              className="text-rose-500 hover:text-rose-900 p-1 cursor-pointer"
              aria-label={isSw ? 'Funga' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {toastNotice && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-emerald-950"
        >
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span className="truncate">{toastNotice}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {toastAction && (
              <button
                type="button"
                onClick={() => {
                  const action = toastAction;
                  setToastNotice(null);
                  setToastAction(null);
                  action.onClick();
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
              >
                <span>{toastAction.label}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setToastNotice(null);
                setToastAction(null);
              }}
              className="text-slate-500 hover:text-slate-900 p-1 cursor-pointer"
              aria-label={isSw ? 'Funga' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* VIEW 1: POS MAUZO */}
      {activeSection === 'pos_register' && (
        <div className="space-y-5">
          {!backendOffline && (
            <div className="bg-white border border-slate-100 rounded-xl shadow-xs px-4 py-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {loadingLive
                    ? isSw
                      ? 'Inapakia Hifadhidata...'
                      : 'Syncing...'
                    : isSw
                      ? 'POS Tayari · Imeunganishwa na PostgreSQL'
                      : 'POS Live · PostgreSQL Connected'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void loadLiveWorkspaceData()}
                disabled={loadingLive}
                className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer disabled:opacity-50"
              >
                {isSw ? 'Onyesha Upya' : 'Refresh'}
              </button>
            </div>
          )}

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
                descriptionSw="Nakili bidhaa kutoka Katalogi Kuu, ingiza stock na uipeleke Sokoni ili iwe tayari kuuzwa."
                descriptionEn="Clone products from Global Catalog, record stock-in, and publish them live."
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
                          i.productNameEn.toLowerCase().includes(query),
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
                        const itemCategory = item.unitCategory ?? categoryFromSystemUnitCode(item.unitType);
                        return (
                          <button
                            key={item.itemId}
                            type="button"
                            onClick={() => handleOpenPosModal(item)}
                            className={`text-left bg-white border rounded-lg p-3 shadow-xs transition-all cursor-pointer group flex gap-3 min-h-[92px] ${
                              isOut
                                ? 'border-slate-200 opacity-60 hover:border-slate-300'
                                : 'border-slate-200 hover:border-emerald-600 hover:shadow-md'
                            }`}
                          >
                            <div className="w-16 h-16 shrink-0 rounded-lg bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center">
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
                                  {formatUnitTypeLabel(item.unitType, locale, itemCategory)}
                                </span>
                              </div>
                              <div className="text-sm font-bold text-slate-950 group-hover:text-emerald-700 transition-colors truncate">
                                {isSw ? item.productNameSw : item.productNameEn}
                              </div>
                              <div className="text-[11px] font-mono text-emerald-800 font-semibold tabular-nums">
                                TZS {Math.round(item.unitPriceTzs / 4).toLocaleString('en-US')}
                                <span className="text-slate-500 font-sans font-normal"> / Q</span>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-slate-600">
                                <span className="font-mono text-slate-900 font-semibold tabular-nums">
                                  {formatQuantaMeasurement(item.availableQuanta, itemCategory, isSw ? 'sw' : 'en')}
                                  {typeof item.sealedBulkPackagesStock === 'number' &&
                                    item.sealedBulkPackagesStock > 0 &&
                                    ` · +${item.sealedBulkPackagesStock}`}
                                </span>
                                {isOut ? (
                                  <span className="text-rose-700 font-semibold">{isSw ? 'Imeisha!' : 'Out!'}</span>
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
                  <span className="bg-emerald-50 text-emerald-700 font-mono px-1.5 py-0.5 rounded text-[10px]">
                    {receiptLedger.length}
                  </span>
                )}
              </h4>
              <button
                type="button"
                onClick={() => void loadLiveWorkspaceData()}
                disabled={loadingLive}
                title={isSw ? 'Onyesha Upya' : 'Refresh'}
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
                    <div className="text-right font-mono font-bold text-emerald-700 tabular-nums">
                      TZS {rcp.totalTzs.toLocaleString('en-US')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: 4-TAB MERCHANT INVENTORY & MARKET HUB */}
      {activeSection === 'inventory_shelf' && (
        <div className="space-y-5">
          {/* Header & 4-Tab Bar */}
          <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-950 flex items-center gap-2">
                  <Store className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />
                  <span>
                    {isSw
                      ? 'Usimamizi wa Stock, Manunuzi & Soko'
                      : 'Merchant Inventory, Stock-In & Market Hub'}
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {wholesaleMode
                    ? isSw
                      ? 'Mwonekano wa Duka la Jumla — bei za Katoni/Gunia na uhasibu wa WAC moja kwa moja PostgreSQL.'
                      : 'Wholesale Hub View — Carton & package pricing with live PostgreSQL WAC accounting.'
                    : isSw
                      ? 'Fuatilia stock, ingiza mzigo wa dukani au agiza Sokoni, weka bei, kisha peleka Sokoni.'
                      : 'Track shelf stock, record manual or Sokoni restocks, set selling prices, and publish live.'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadLiveWorkspaceData()}
                  disabled={loadingLive}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${loadingLive ? 'animate-spin' : ''}`} aria-hidden="true" />
                  <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
                </button>
              </div>
            </div>

            {/* 4 Clean Tabs */}
            <nav
              aria-label={isSw ? 'Sehemu za Stock na Soko' : 'Inventory and Market Tabs'}
              className="grid grid-cols-2 lg:grid-cols-4 gap-2 pt-1 border-t border-slate-100"
            >
              {(
                [
                  {
                    id: 'stock' as const,
                    labelSw: 'Stock Yangu',
                    labelEn: 'My Stock List',
                    count: kpiMetrics.totalActiveSkus,
                  },
                  {
                    id: 'stock_in' as const,
                    labelSw: 'Ongeza Mzigo',
                    labelEn: 'Stock-In',
                    count: null,
                  },
                  {
                    id: 'catalog' as const,
                    labelSw: 'Katalogi Kuu',
                    labelEn: 'Clone Products',
                    count: globalCatalog.length,
                  },
                  {
                    id: 'publish' as const,
                    labelSw: 'Peleka Sokoni',
                    labelEn: 'Market Publishing',
                    count: kpiMetrics.liveOnMarketCount,
                  },
                ] as const
              ).map((tab) => {
                const active = activeHubTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveHubTab(tab.id)}
                    className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                      active
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-slate-50/70 text-slate-700 border-slate-200 hover:bg-white hover:border-slate-300'
                    }`}
                  >
                    <span className="truncate">{isSw ? tab.labelSw : tab.labelEn}</span>
                    {tab.count !== null && (
                      <span
                        className={`font-mono text-[11px] px-1.5 py-0.5 rounded tabular-nums ${
                          active
                            ? 'bg-emerald-700 text-white'
                            : 'bg-white border border-slate-200 text-slate-600'
                        }`}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* ============================================================== */}
          {/* TAB 1: STOCK YANGU (MY STOCK LIST)                             */}
          {/* ============================================================== */}
          {activeHubTab === 'stock' && (
            <div className="space-y-4">
              {/* Top 4-Card KPI Summary Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-white border border-slate-100 rounded-xl shadow-xs p-4 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-500">
                    {isSw ? 'Bidhaa Zilizopo' : 'Total Active SKUs'}
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-950">
                    {kpiMetrics.totalActiveSkus}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {isSw ? 'Kutoka Katalogi Kuu' : 'Cloned shelf items'}
                  </div>
                </div>

                <div className="bg-white border border-slate-100 rounded-xl shadow-xs p-4 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-500">
                    {isSw ? 'Thamani ya Stock (Gharama)' : 'Inventory Value at Cost'}
                  </div>
                  <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-700 truncate">
                    TZS {kpiMetrics.totalInventoryValueCostTzs.toLocaleString('en-US')}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {isSw ? 'Quanta × Wastani WAC' : 'Stock × Weighted Avg Cost'}
                  </div>
                </div>

                <div className="bg-white border border-slate-100 rounded-xl shadow-xs p-4 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-500">
                    {isSw ? 'Stock Imepungua' : 'Low / Zero Stock Alerts'}
                  </div>
                  <div
                    className={`text-2xl font-bold font-mono tabular-nums ${
                      kpiMetrics.lowStockCount > 0 ? 'text-amber-600' : 'text-slate-900'
                    }`}
                  >
                    {kpiMetrics.lowStockCount}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {isSw ? 'Zinahitaji kuongezwa mzigo' : 'Below safety threshold'}
                  </div>
                </div>

                <div className="bg-white border border-slate-100 rounded-xl shadow-xs p-4 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-500">
                    {isSw ? 'Zilizopo Sokoni' : 'Live on Sokoni Market'}
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600">
                    {kpiMetrics.liveOnMarketCount}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {isSw ? 'Zinaonekana kwa wanunuzi' : 'Visible to market buyers'}
                  </div>
                </div>
              </div>

              {/* Search & Status Filters */}
              <div className="bg-white border border-slate-100 rounded-xl shadow-xs p-4 space-y-3">
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <input
                      type="search"
                      value={stockSearchQuery}
                      onChange={(e) => setStockSearchQuery(e.target.value)}
                      placeholder={
                        isSw
                          ? 'Tafuta bidhaa dukani kwa jina au SKU...'
                          : 'Search inventory by name or SKU...'
                      }
                      className="w-full min-h-[42px] pl-9 pr-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-600 focus:outline-none text-xs text-slate-900"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { id: 'ALL' as const, labelSw: 'Zote', labelEn: 'All' },
                        { id: 'LIVE' as const, labelSw: 'Zipo Sokoni', labelEn: 'Live' },
                        { id: 'LOW_STOCK' as const, labelSw: 'Stock Imepungua', labelEn: 'Low Stock' },
                        { id: 'NEEDS_STOCK' as const, labelSw: 'Bila Stock (0Q)', labelEn: 'Needs Stock (0Q)' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setStockFilter(f.id)}
                        className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          stockFilter === f.id
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {isSw ? f.labelSw : f.labelEn}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Clean Product Stock Rows */}
              {clonedItems.length === 0 ? (
                <div className="bg-white border border-slate-100 rounded-xl shadow-xs p-6 text-center space-y-3">
                  <EmptyStateCard
                    locale={locale}
                    titleSw="Bado hujanakili bidhaa kutoka Katalogi Kuu"
                    titleEn="No cloned inventory items yet"
                    descriptionSw="Fungua kichupo cha Katalogi Kuu kuchagua bidhaa unazouza, kisha ingiza mzigo na bei."
                    descriptionEn="Open the Clone Products tab to pick canonical SKUs for your store, then add stock and pricing."
                  />
                  <button
                    type="button"
                    onClick={() => setActiveHubTab('catalog')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Globe className="w-4 h-4" aria-hidden="true" />
                    <span>{isSw ? 'Nenda Katalogi Kuu' : 'Browse Global Catalog'}</span>
                  </button>
                </div>
              ) : filteredStockClones.length === 0 ? (
                <div className="bg-white border border-slate-100 rounded-xl shadow-xs p-8 text-center text-xs text-slate-500">
                  {isSw
                    ? 'Hakuna bidhaa inayolingana na vichujio ulivyochagua.'
                    : 'No inventory items match the selected filter.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredStockClones.map((clone) => {
                    const catEntry = catalogById.get(clone.globalCatalogId);
                    const unitCat = resolveUnitCategoryForClone(clone, catEntry);
                    const fin = getCloneFinancialView(clone, wholesaleMode, unitCat, locale, catEntry);
                    const isLowStock =
                      clone.availableQuantaStock > 0 &&
                      clone.availableQuantaStock <= clone.lowStockThresholdQuanta;
                    const isPublishingRow = togglingPublishId === clone.clonedProductId;

                    return (
                      <article
                        key={clone.clonedProductId}
                        className="bg-white border border-slate-100 rounded-xl shadow-xs p-4 sm:p-5 space-y-4 hover:border-slate-200 transition-colors"
                      >
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          {/* Left: Thumbnail + Product Info + Context-Aware Stock */}
                          <div className="flex items-start gap-3.5 min-w-0">
                            <div className="w-16 h-16 shrink-0 rounded-xl bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center">
                              {clone.imagekitCdnUrl ? (
                                <img
                                  src={clone.imagekitCdnUrl}
                                  alt={isSw ? clone.fixedNameSw : clone.fixedNameEn}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Boxes className="w-7 h-7 text-slate-300" aria-hidden="true" />
                              )}
                            </div>

                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                <span className="font-mono font-bold text-emerald-700">
                                  {clone.canonicalSku}
                                </span>
                                {clone.categoryCode && (
                                  <>
                                    <span className="text-slate-300">·</span>
                                    <span className="text-slate-500 font-medium">{clone.categoryCode}</span>
                                  </>
                                )}
                                <span className="text-slate-300">·</span>
                                <span className="text-slate-500 font-medium">
                                  {unitCat === 'VOLUME'
                                    ? isSw
                                      ? 'Kimiminika (mL / L)'
                                      : 'Liquid (mL / L)'
                                    : isSw
                                      ? 'Uzito (g / KG)'
                                      : 'Weight (g / KG)'}
                                </span>
                              </div>

                              <h3 className="text-sm sm:text-base font-bold text-slate-950 truncate">
                                {isSw ? clone.fixedNameSw : clone.fixedNameEn}
                              </h3>

                              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                                <span
                                  className={`inline-flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-md border tabular-nums ${
                                    !fin.hasStock
                                      ? 'bg-slate-100 border-slate-200 text-slate-600'
                                      : isLowStock
                                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                                        : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                  }`}
                                >
                                  <Boxes className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                  <span>{fin.stockLabel}</span>
                                </span>

                                {isLowStock && (
                                  <span className="text-[11px] font-semibold text-amber-700 flex items-center gap-1">
                                    <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                                    {isSw ? 'Stock Imepungua' : 'Low Stock'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Right: Publish Toggle + Edit/Delete */}
                          <div className="flex items-center justify-between md:justify-end gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                            <div className="flex items-center gap-2.5">
                              <span className="text-xs font-semibold text-slate-700">
                                {fin.isPublished
                                  ? isSw
                                    ? 'Ipo Sokoni'
                                    : 'Live on Sokoni'
                                  : isSw
                                    ? 'Peleka Sokoni'
                                    : 'Publish Live'}
                              </span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={fin.isPublished}
                                aria-label={
                                  isSw
                                    ? `Peleka ${clone.fixedNameSw} Sokoni`
                                    : `Toggle Sokoni listing for ${clone.fixedNameEn}`
                                }
                                disabled={isPublishingRow}
                                onClick={() => void handleToggleMarketPublish(clone, !fin.isPublished)}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                                  fin.isPublished ? 'bg-emerald-600' : 'bg-slate-200'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition duration-200 ${
                                    fin.isPublished ? 'translate-x-5' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditClone(clone)}
                                title={isSw ? 'Hariri picha / tahadhari' : 'Edit threshold / image'}
                                className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteCloneTarget(clone)}
                                title={isSw ? 'Ondoa bidhaa' : 'Remove item'}
                                className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Middle: Financial Metrics Side-by-Side (Buying Cost vs Selling Price vs Est. Margin) */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50/70 border border-slate-100 rounded-lg p-3.5">
                          <div className="space-y-0.5">
                            <div className="text-[11px] font-medium text-slate-500">
                              {isSw
                                ? `Bei ya Kununulia (WAC · ${fin.unitLabel})`
                                : `Buying Cost (WAC · ${fin.unitLabel})`}
                            </div>
                            {fin.buyingCostPerUnitTzs > 0 ? (
                              <div className="text-sm font-bold font-mono tabular-nums text-slate-900">
                                TZS {fin.buyingCostPerUnitTzs.toLocaleString('en-US')}
                              </div>
                            ) : (
                              <div className="inline-flex items-center text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded">
                                {isSw ? 'Haijawekwa / Not Purchased' : 'Not Yet Purchased'}
                              </div>
                            )}
                          </div>

                          <div className="space-y-0.5">
                            <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
                              <span>
                                {wholesaleMode
                                  ? isSw
                                    ? `Bei ya Katoni/Kifungashio (${fin.unitLabel})`
                                    : `Carton/Pkg Price (${fin.unitLabel})`
                                  : isSw
                                    ? `Bei ya Kuuzia (${fin.unitLabel})`
                                    : `Selling Price (${fin.unitLabel})`}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {fin.effectiveSellingPriceTzs > 0 ? (
                                <span className="text-sm font-bold font-mono tabular-nums text-emerald-700">
                                  TZS {fin.effectiveSellingPriceTzs.toLocaleString('en-US')}
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                                  {isSw ? 'Haijawekwa (0 TZS)' : 'Not Set (0 TZS)'}
                                </span>
                              )}
                              {fin.isAmended && (
                                <span className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                  {isSw ? 'Imerekebishwa' : 'Amended'}
                                </span>
                              )}
                              {fin.isStandard && (
                                <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                                  {isSw ? 'Bei Kuu' : 'Standard'}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="space-y-0.5">
                            <div className="text-[11px] font-medium text-slate-500">
                              {isSw ? 'Faida Kadirio (Est. Margin)' : 'Est. Margin'}
                            </div>
                            {fin.marginTzs === null ? (
                              <div className="text-xs font-mono text-slate-400">
                                — ({isSw ? 'Weka bei & stock' : 'Needs cost & price'})
                              </div>
                            ) : fin.marginTzs >= 0 ? (
                              <div className="inline-flex items-center gap-1 text-sm font-bold font-mono tabular-nums text-emerald-700">
                                <TrendingUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                <span>+TZS {fin.marginTzs.toLocaleString('en-US')}</span>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1 text-xs font-bold font-mono tabular-nums text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">
                                <TrendingDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                <span>
                                  -TZS {Math.abs(fin.marginTzs).toLocaleString('en-US')} (
                                  {isSw ? 'Chini ya Gharama' : 'Below Cost'})
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Bottom Quick Action Buttons */}
                        <div className="flex flex-wrap items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => jumpToStockInForClone(clone.clonedProductId)}
                            className="flex-1 sm:flex-none min-h-[38px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            <PackagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{isSw ? '+ Ongeza Stock' : '+ Stock-In'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => void openPricingModal(clone)}
                            className="flex-1 sm:flex-none min-h-[38px] px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Tag className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                            <span>{isSw ? 'Bei (Chagua / Rekebisha)' : 'Price (Select / Amend)'}</span>
                          </button>

                          {clone.unitPricingOverrides.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-slate-600 ml-auto">
                              {clone.unitPricingOverrides.slice(0, 3).map((ov) => (
                                <span
                                  key={ov.overrideId}
                                  className="px-2 py-0.5 rounded bg-slate-50 border border-slate-200 tabular-nums"
                                >
                                  {isSw ? ov.displayLabelSw : ov.displayLabelEn}: TZS{' '}
                                  {ov.effectiveSellingPriceTzs.toLocaleString('en-US')}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {/* Collapsible Secondary Tools: Direct Product Registration & Custom Local Units */}
              <div className="bg-white border border-slate-100 rounded-xl shadow-xs overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowLegacyShelfTools((prev) => !prev)}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <span>
                    {isSw
                      ? 'Zana za Ziada: Sajili SKU Binafsi & Vipimo Maalum (Debe / Sado)'
                      : 'Additional Tools: Direct Store SKUs & Custom Local Units (Debe / Sado)'}
                  </span>
                  {showLegacyShelfTools ? (
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </button>

                {showLegacyShelfTools && (
                  <div className="p-5 pt-2 border-t border-slate-100 space-y-6">
                    {/* Direct Product Registration */}
                    <form
                      onSubmit={handleIngestShelfItem}
                      className="space-y-4 bg-slate-50 p-4 rounded-lg border border-slate-200"
                    >
                      <div className="text-xs font-bold text-slate-900">
                        {isSw ? 'Sajili Bidhaa ya Ziada Moja kwa Moja' : 'Create Direct Merchant Product'}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-700">SKU (max 8)</label>
                          <input
                            type="text"
                            maxLength={8}
                            value={newSku}
                            onChange={(e) => setNewSku(e.target.value)}
                            placeholder="SGR01"
                            className="w-full min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 uppercase"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-700">
                            {isSw ? 'Jina (Kiswahili)' : 'Name (Swahili)'}
                          </label>
                          <input
                            type="text"
                            value={newNameSw}
                            onChange={(e) => setNewNameSw(e.target.value)}
                            placeholder={isSw ? 'Jina la bidhaa...' : 'Product name...'}
                            className="w-full min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-700">
                            {isSw ? 'Jina (English)' : 'Name (English)'}
                          </label>
                          <input
                            type="text"
                            value={newNameEn}
                            onChange={(e) => setNewNameEn(e.target.value)}
                            placeholder={isSw ? 'Jina kwa Kiingereza...' : 'English name...'}
                            className="w-full min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-700">Unit TZS (4Q)</label>
                          <input
                            type="number"
                            min="1"
                            value={newUnitPriceTzsForm || ''}
                            onChange={(e) => setNewUnitPriceTzsForm(parseInt(e.target.value, 10) || 0)}
                            className="w-full min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-700">Carton/Bulk TZS</label>
                          <input
                            type="number"
                            min="1"
                            value={newCartonPriceTzsForm || ''}
                            onChange={(e) => setNewCartonPriceTzsForm(parseInt(e.target.value, 10) || 0)}
                            className="w-full min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-700">Loose Quanta</label>
                          <input
                            type="number"
                            min="0"
                            value={newQuantaQty}
                            onChange={(e) => setNewQuantaQty(parseInt(e.target.value, 10) || 0)}
                            className="w-full min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-700">Sealed Sacks/Ctn</label>
                          <input
                            type="number"
                            min="0"
                            value={newSealedQty}
                            onChange={(e) => setNewSealedQty(parseInt(e.target.value, 10) || 0)}
                            className="w-full min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                            required
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={savingProduct}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-semibold text-xs rounded-lg cursor-pointer"
                      >
                        {savingProduct
                          ? isSw
                            ? 'Inahifadhi...'
                            : 'Saving...'
                          : isSw
                            ? 'Sajili Bidhaa ya Ziada'
                            : 'Save Direct Product'}
                      </button>
                    </form>

                    {/* Active Shelf Items Delete List */}
                    {shelfItems.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                          {isSw ? 'Bidhaa Zilizopo Kwenye POS (Active Products)' : 'Active POS Products'}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {shelfItems.map((item) => (
                            <div
                              key={item.itemId}
                              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-mono font-bold text-slate-900 truncate">{item.sku}</div>
                                <div className="text-slate-600 truncate">
                                  {isSw ? item.productNameSw : item.productNameEn}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteProductTarget({
                                    id: item.itemId,
                                    label: isSw ? item.productNameSw : item.productNameEn,
                                  })
                                }
                                className="w-7 h-7 inline-flex items-center justify-center rounded border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 cursor-pointer shrink-0"
                                aria-label={isSw ? 'Futa bidhaa' : 'Delete product'}
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Custom Local Units Configurator */}
                    <form
                      onSubmit={handleCreateCustomUnit}
                      className="space-y-4 bg-slate-50 p-4 rounded-lg border border-slate-200"
                    >
                      <div className="text-xs font-bold text-slate-900">
                        {isSw ? 'Vipimo Maalum (Debe, Sado, Dumu)' : 'Custom Local Units Configurator'}
                      </div>
                      {shelfItems.some((s) => isUuid(s.itemId)) && (
                        <select
                          value={targetUnitProductId}
                          onChange={(e) => setTargetUnitProductId(e.target.value)}
                          className="w-full min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
                        >
                          {shelfItems
                            .filter((s) => isUuid(s.itemId))
                            .map((s) => (
                              <option key={s.itemId} value={s.itemId}>
                                {s.sku} — {isSw ? s.productNameSw : s.productNameEn}
                              </option>
                            ))}
                        </select>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          type="text"
                          value={newUnitCode}
                          onChange={(e) => setNewUnitCode(e.target.value)}
                          placeholder="DEBE"
                          className="min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs uppercase"
                          required
                        />
                        <input
                          type="text"
                          value={newUnitName}
                          onChange={(e) => setNewUnitName(e.target.value)}
                          placeholder={isSw ? 'Debe la 18 KG' : 'Debe 18 KG'}
                          className="min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs"
                          required
                        />
                        <input
                          type="number"
                          step="0.25"
                          min="0.25"
                          value={newBaseKg}
                          onChange={(e) => setNewBaseKg(parseFloat(e.target.value) || 0.25)}
                          className="min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs"
                          required
                        />
                        <input
                          type="number"
                          min="1"
                          value={newUnitPriceTzs}
                          onChange={(e) => setNewUnitPriceTzs(parseInt(e.target.value, 10) || 1)}
                          className="min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-xs"
                          required
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newUnitIsWholesale}
                          onChange={(e) => setNewUnitIsWholesale(e.target.checked)}
                          className="rounded border-slate-300 accent-emerald-600"
                        />
                        <span>{isSw ? 'Kipimo cha Jumla (Wholesale Tier)' : 'Wholesale Tier'}</span>
                      </label>
                      <button
                        type="submit"
                        disabled={savingUnit || !isUuid(targetUnitProductId)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{isSw ? 'Hifadhi Kipimo' : 'Save Custom Unit'}</span>
                      </button>
                    </form>

                    {customUnits.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {customUnits.map((u) => (
                          <div
                            key={u.unitId}
                            className="bg-white border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900">{u.unitName}</div>
                              <div className="text-[11px] text-slate-500 truncate">{u.descriptionSw}</div>
                            </div>
                            {u.productId && (
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteUnitTarget({
                                    productId: u.productId as string,
                                    unitId: u.unitId,
                                    label: u.unitName,
                                  })
                                }
                                className="w-7 h-7 inline-flex items-center justify-center rounded border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 cursor-pointer shrink-0"
                                aria-label={isSw ? 'Futa kipimo maalum' : 'Delete custom unit'}
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: ONGEZA MZIGO (DUAL-PATH STOCK-IN)                       */}
          {/* ============================================================== */}
          {activeHubTab === 'stock_in' && (
            <div className="space-y-4">
              {clonedItems.length === 0 ? (
                <div className="bg-white border border-slate-100 rounded-xl shadow-xs p-6 text-center space-y-3">
                  <EmptyStateCard
                    locale={locale}
                    titleSw="Nakili bidhaa kwanza kabla ya kuingiza mzigo"
                    titleEn="Clone a product before recording stock-in"
                    descriptionSw="Chagua bidhaa kutoka Katalogi Kuu ili uweze kuingiza mzigo wa dukani au kuagiza Sokoni."
                    descriptionEn="Clone at least one Global Catalog item first, then stock-in manually or via Sokoni."
                  />
                  <button
                    type="button"
                    onClick={() => setActiveHubTab('catalog')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Globe className="w-4 h-4" aria-hidden="true" />
                    <span>{isSw ? 'Fungua Katalogi Kuu' : 'Open Global Catalog'}</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
                  {/* Card A: Manual Purchase / Existing Store Stock */}
                  <section className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
                    <div className="border-b border-slate-100 pb-3 flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                        <PackagePlus className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-950">
                          {isSw
                            ? 'Ingiza Mzigo wa Dukani / Manunuzi ya Nje'
                            : 'Manual Purchase / Existing Store Stock'}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {isSw
                            ? 'Rekodi mzigo uliopo dukani au uliyonunua nje ya SokoKuu ili stock na WAC zihifadhiwe.'
                            : 'Log existing shelf stock or external supplier purchases directly into PostgreSQL.'}
                        </p>
                      </div>
                    </div>

                    <form onSubmit={handleSubmitStockIn} className="space-y-4">
                      {/* 1. Select Cloned Product */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-700">
                          {isSw ? '1. Chagua Bidhaa (Select Cloned Product)' : '1. Select Cloned Product'}
                        </label>
                        <select
                          value={stockInCloneId}
                          onChange={(e) => setStockInCloneId(e.target.value)}
                          className="w-full min-h-[42px] px-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-600 focus:outline-none text-xs font-medium text-slate-900"
                        >
                          {clonedItems.map((c) => (
                            <option key={c.clonedProductId} value={c.clonedProductId}>
                              {c.canonicalSku} — {isSw ? c.fixedNameSw : c.fixedNameEn} ({c.availableQuantaStock}Q)
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* 2. Stock Source */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-700">
                          {isSw ? '2. Aina ya Uingizaji (Stock Source)' : '2. Stock Source'}
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setStockInSource('EXISTING_STORE_STOCK')}
                            className={`text-left px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                              stockInSource === 'EXISTING_STORE_STOCK'
                                ? 'bg-emerald-50 border-emerald-600 text-emerald-950 ring-1 ring-emerald-600'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <div>{isSw ? 'Mzigo Uliokuwepo Dukani' : 'Existing Store Stock'}</div>
                            <div className="text-[10px] font-normal text-slate-500 mt-0.5">
                              {isSw ? 'Hisa ya awali dukani' : 'Opening / current shelf stock'}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setStockInSource('EXTERNAL_SUPPLIER')}
                            className={`text-left px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                              stockInSource === 'EXTERNAL_SUPPLIER'
                                ? 'bg-emerald-50 border-emerald-600 text-emerald-950 ring-1 ring-emerald-600'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <div>{isSw ? 'Manunuzi ya Nje' : 'External Supplier Purchase'}</div>
                            <div className="text-[10px] font-normal text-slate-500 mt-0.5">
                              {isSw ? 'Kutoka kwa msambazaji wa nje' : 'From outside wholesaler/supplier'}
                            </div>
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                          <input
                            type="text"
                            value={stockInSupplierName}
                            onChange={(e) => setStockInSupplierName(e.target.value)}
                            placeholder={
                              stockInSource === 'EXTERNAL_SUPPLIER'
                                ? isSw
                                  ? 'Jina la Msambazaji (lazima)...'
                                  : 'Supplier Name (required)...'
                                : isSw
                                  ? 'Maelezo / Chanzo (hiari)...'
                                  : 'Source note (optional)...'
                            }
                            required={stockInSource === 'EXTERNAL_SUPPLIER'}
                            className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs text-slate-900"
                          />
                          <input
                            type="text"
                            value={stockInReceiptRef}
                            onChange={(e) => setStockInReceiptRef(e.target.value)}
                            placeholder={isSw ? 'Namba ya Risiti (INV-...) hiari' : 'Receipt Ref (INV-...) optional'}
                            className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-900"
                          />
                        </div>
                      </div>

                      {/* 3. Select Product Unit */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-700">
                          {isSw ? '3. Chagua Kipimo (Product Unit)' : '3. Select Product Unit'}
                        </label>
                        {loadingStockInUnits ? (
                          <div className="text-xs text-slate-500 py-2">
                            {isSw ? 'Inapakia vipimo vya bidhaa...' : 'Loading valid product units...'}
                          </div>
                        ) : stockInUnits.length > 0 ? (
                          <select
                            value={stockInUnitId}
                            onChange={(e) => {
                              setStockInUnitId(e.target.value);
                              const found = stockInUnits.find((u) => u.id === e.target.value);
                              if (found) setStockInQuantaPerUnit(found.quarterQuantaPerUnit);
                            }}
                            className="w-full min-h-[42px] px-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-600 focus:outline-none text-xs font-medium text-slate-900"
                          >
                            {stockInUnits.map((u) => {
                              const label = isSw
                                ? u.displayLabelSw || u.systemUnit?.nameSw
                                : u.displayLabelEn || u.systemUnit?.nameEn;
                              return (
                                <option key={u.id} value={u.id}>
                                  {label} · {u.quarterQuantaPerUnit}Q (
                                  {formatQuantaMeasurement(
                                    u.quarterQuantaPerUnit,
                                    u.systemUnit?.category ?? stockInPreview.unitCat,
                                    isSw ? 'sw' : 'en',
                                  )}
                                  )
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              value={stockInQuantaPerUnit}
                              onChange={(e) => setStockInQuantaPerUnit(parseInt(e.target.value, 10) || 4)}
                              className="w-28 min-h-[40px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-mono"
                            />
                            <span className="text-xs text-slate-500">
                              {isSw ? 'Quanta kwa kipimo kimoja' : 'Quarter-Quanta per unit'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 4. Quantity Received & Buying Price per Unit */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">
                            {isSw ? '4a. Idadi (Quantity)' : '4a. Quantity Received'}
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={stockInQtyUnits}
                            onChange={(e) => setStockInQtyUnits(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            className="w-full min-h-[42px] px-3 rounded-lg border border-slate-200 bg-white text-sm font-mono font-bold text-slate-900"
                            required
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">
                            {isSw
                              ? '4b. Bei ya Kununulia kwa Kipimo (TZS)'
                              : '4b. Buying Price per Unit (TZS)'}
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={stockInBuyingPricePerUnit || ''}
                            onChange={(e) =>
                              setStockInBuyingPricePerUnit(Math.max(0, parseInt(e.target.value, 10) || 0))
                            }
                            placeholder="e.g. 28000"
                            className="w-full min-h-[42px] px-3 rounded-lg border border-slate-200 bg-white text-sm font-mono font-bold text-slate-900"
                            required
                          />
                        </div>
                      </div>

                      {/* 5. Live Calculation Preview Box */}
                      <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4 space-y-2 text-xs">
                        <div className="font-bold text-emerald-950">
                          {isSw ? 'Hakiki ya Mahesabu (Live Preview)' : 'Live Cost & Quanta Preview'}
                        </div>
                        <div className="flex items-center justify-between text-slate-700">
                          <span>{isSw ? 'Stock Inayoongezwa:' : 'Stock Added:'}</span>
                          <span className="font-mono font-bold text-slate-950 tabular-nums">
                            +{stockInPreview.addedQuanta}Q ({stockInPreview.addedMeasureLabel})
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-700">
                          <span>{isSw ? 'Jumla ya Gharama ya Ununuzi:' : 'Total Purchase Cost:'}</span>
                          <span className="font-mono font-bold text-slate-950 tabular-nums">
                            TZS {stockInPreview.totalCostTzs.toLocaleString('en-US')}
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-emerald-200 text-emerald-900">
                          <span>{isSw ? 'Wastani Mpya wa Gharama (WAC):' : 'Updated Weighted Avg Cost (WAC):'}</span>
                          <span className="font-mono font-bold tabular-nums">
                            TZS {stockInPreview.projectedWacPerQ.toLocaleString('en-US')}/Q · TZS{' '}
                            {stockInPreview.projectedWacPerSelectedUnit.toLocaleString('en-US')}/unit
                          </span>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={savingStockIn || stockInBuyingPricePerUnit <= 0}
                        className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-xs transition-colors"
                      >
                        {savingStockIn
                          ? isSw
                            ? 'Inahifadhi Stock...'
                            : 'Saving Stock-In...'
                          : isSw
                            ? 'Hifadhi Stock (Save Stock-In)'
                            : 'Save Stock-In'}
                      </button>
                    </form>
                  </section>

                  {/* Card B: Order via Sokoni Marketplace */}
                  <section className="bg-white border border-slate-100 rounded-xl shadow-sm p-5 space-y-4">
                    <div className="border-b border-slate-100 pb-3 flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                        <ShoppingBag className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-950">
                          {isSw ? 'Agiza Kupitia SokoKuu' : 'Restock via Sokoni Marketplace'}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {isSw
                            ? 'Agiza kutoka kwa wauzaji wa jumla au viwanda vilivyounganishwa na mfumo.'
                            : 'Source from verified Wholesalers & Suppliers on Sokoni Marketplace.'}
                        </p>
                      </div>
                    </div>

                    {selectedStockInClone && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center gap-3.5">
                        <div className="w-14 h-14 rounded-lg bg-white border border-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                          {selectedStockInClone.imagekitCdnUrl ? (
                            <img
                              src={selectedStockInClone.imagekitCdnUrl}
                              alt={isSw ? selectedStockInClone.fixedNameSw : selectedStockInClone.fixedNameEn}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Boxes className="w-6 h-6 text-slate-300" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="font-mono text-[11px] font-bold text-emerald-700">
                            {selectedStockInClone.canonicalSku}
                          </div>
                          <div className="text-sm font-bold text-slate-950 truncate">
                            {isSw ? selectedStockInClone.fixedNameSw : selectedStockInClone.fixedNameEn}
                          </div>
                          <div className="text-xs text-slate-600 font-mono">
                            {isSw ? 'Stock ya Sasa:' : 'Current Stock:'}{' '}
                            {formatQuantaMeasurement(
                              selectedStockInClone.availableQuantaStock,
                              stockInPreview.unitCat,
                              isSw ? 'sw' : 'en',
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2.5 text-xs text-slate-600 bg-slate-50/70 border border-slate-100 rounded-xl p-4">
                      <div className="font-bold text-slate-900">
                        {isSw ? 'Faida ya Kuagiza Kupitia SokoKuu:' : 'How Sokoni Auto-Hydration Works:'}
                      </div>
                      <ul className="space-y-1.5 list-disc pl-4">
                        <li>
                          {isSw
                            ? 'Mfumo utakupeleka moja kwa moja kwa wauzaji wenye bidhaa hii.'
                            : 'Opens Sokoni Marketplace pre-filtered to suppliers carrying this SKU.'}
                        </li>
                        <li>
                          {isSw
                            ? 'Ukishathibitisha kupokea mzigo kwa Dual-PIN / QR mlangoni, stock na WAC hujazwa kiotomatiki.'
                            : 'Confirming delivery via Dual-PIN / QR automatically hydrates stock and updates Weighted Avg Cost.'}
                        </li>
                      </ul>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenSokoni?.(selectedStockInClone?.globalCatalogId ?? null)}
                      className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-colors"
                    >
                      <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                      <span>
                        {isSw ? 'Nenda Sokoni Kuagiza Bidhaa Hii' : 'Order This Product on Sokoni'}
                      </span>
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </section>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: KATALOGI KUU (CLONE / REUSE PRODUCTS)                   */}
          {/* ============================================================== */}
          {activeHubTab === 'catalog' && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-100 rounded-xl shadow-xs p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-950">
                    {isSw
                      ? 'Katalogi Kuu ya SokoKuu — Nakili Bidhaa Dukani'
                      : 'Global Standard Catalog — Clone & Reuse SKUs'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isSw
                      ? 'Kila bidhaa mpya huanzia 0 Stock & 0 TZS kuzuia makadirio yasiyo halisi.'
                      : 'Every newly cloned item initializes at 0 Stock & 0 TZS until stocked and priced.'}
                  </p>
                </div>

                <div className="relative sm:w-72">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                  <input
                    type="search"
                    value={catalogSearchQuery}
                    onChange={(e) => setCatalogSearchQuery(e.target.value)}
                    placeholder={isSw ? 'Tafuta kwenye katalogi...' : 'Search global catalog...'}
                    className="w-full min-h-[40px] pl-9 pr-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-600 focus:outline-none text-xs"
                  />
                </div>
              </div>

              {filteredGlobalCatalog.length === 0 ? (
                <EmptyStateCard
                  locale={locale}
                  titleSw="Katalogi Kuu haina bidhaa inayolingana"
                  titleEn="No matching global catalog items"
                  descriptionSw="Hakikisha bidhaa zimeongezwa na Super Admin au badilisha maneno ya utafutaji."
                  descriptionEn="Try clearing search or check back when Super Admin publishes more canonical SKUs."
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredGlobalCatalog.map((entry) => {
                    const clonedMatch = clonedItems.find(
                      (c) => c.globalCatalogId === entry.globalCatalogId,
                    );
                    const isCloned = Boolean(clonedMatch);

                    return (
                      <article
                        key={entry.globalCatalogId}
                        className="bg-white border border-slate-100 rounded-xl shadow-xs p-4 flex flex-col justify-between gap-3.5 hover:border-slate-200 transition-colors"
                      >
                        <div className="space-y-3">
                          <div className="h-32 w-full rounded-lg bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center p-2">
                            {entry.imagekitCdnUrl || entry.staticImageUrl ? (
                              <img
                                src={entry.imagekitCdnUrl || entry.staticImageUrl}
                                alt={isSw ? entry.fixedNameSw : entry.fixedNameEn}
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <Globe className="w-8 h-8 text-slate-300" />
                            )}
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                              <span className="font-bold text-emerald-700 truncate">
                                {entry.canonicalSku}
                              </span>
                              <span className="text-slate-500">
                                {entry.categoryCode} · {entry.clonedByStoresCount} {isSw ? 'maduka' : 'stores'}
                              </span>
                            </div>

                            <h4 className="text-sm font-bold text-slate-950 leading-snug">
                              {isSw ? entry.fixedNameSw : entry.fixedNameEn}
                            </h4>

                            {/* Available Units */}
                            {entry.availableUnits.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {entry.availableUnits.slice(0, 4).map((u) => (
                                  <span
                                    key={u.id}
                                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-600"
                                  >
                                    {isSw ? u.displayLabelSw : u.displayLabelEn}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Standard Price Preview (prominent Wholesale Carton/Pkg for Wholesale Hubs) */}
                          {(entry.standardWholesalePriceTzs || entry.standardRetailPriceTzs) && (
                            <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 space-y-1 text-[11px]">
                              {wholesaleMode && entry.standardWholesalePriceTzs && (
                                <div className="flex items-center justify-between font-semibold text-emerald-800">
                                  <span>
                                    {isSw ? 'Bei Kuu Jumla' : 'Std Wholesale'}
                                    {entry.standardWholesaleUnitLabelSw
                                      ? ` (${entry.standardWholesaleUnitLabelSw})`
                                      : ''}
                                  </span>
                                  <span className="font-mono tabular-nums">
                                    TZS {entry.standardWholesalePriceTzs.toLocaleString('en-US')}
                                  </span>
                                </div>
                              )}
                              {entry.standardRetailPriceTzs && (
                                <div className="flex items-center justify-between text-slate-700">
                                  <span>
                                    {isSw ? 'Bei Kuu Rejareja' : 'Std Retail'}
                                    {entry.standardRetailUnitLabelSw
                                      ? ` (${entry.standardRetailUnitLabelSw})`
                                      : ''}
                                  </span>
                                  <span className="font-mono font-bold tabular-nums">
                                    TZS {entry.standardRetailPriceTzs.toLocaleString('en-US')}
                                  </span>
                                </div>
                              )}
                              {!wholesaleMode && entry.standardWholesalePriceTzs && (
                                <div className="flex items-center justify-between text-slate-500">
                                  <span>
                                    {isSw ? 'Bei Kuu Jumla' : 'Std Wholesale'}
                                    {entry.standardWholesaleUnitLabelSw
                                      ? ` (${entry.standardWholesaleUnitLabelSw})`
                                      : ''}
                                  </span>
                                  <span className="font-mono tabular-nums">
                                    TZS {entry.standardWholesalePriceTzs.toLocaleString('en-US')}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleCloneGlobalCatalogItem(entry)}
                          className={`w-full min-h-[40px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                            isCloned
                              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                          }`}
                        >
                          {isCloned ? (
                            <>
                              <Check className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{isSw ? '✓ Ipo Dukani — Ongeza Stock' : '✓ In Store — Add Stock'}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{isSw ? '+ Clone Dukani' : '+ Clone to Store'}</span>
                            </>
                          )}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: PELEKA SOKONI (MARKET PUBLISHING & READINESS)           */}
          {/* ============================================================== */}
          {activeHubTab === 'publish' && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-100 rounded-xl shadow-xs p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-950">
                    {isSw
                      ? 'Uthibitisho wa Kupeleka Bidhaa Sokoni (Storefront Readiness)'
                      : 'Market Publishing & Storefront Readiness'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isSw
                      ? 'Bidhaa huonekana kwa wanunuzi wa SokoKuu baada ya kukamilisha hatua zote 3: Clone ✓ → Stock (>0) ✓ → Bei (>0 TZS) ✓.'
                      : 'Products go live on Sokoni Marketplace once all 3 steps pass: Cloned ✓ → Stocked (>0) ✓ → Priced (>0 TZS) ✓.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={bulkPublishing || clonedItems.length === 0}
                    onClick={() => void handleBulkPublishReady(true)}
                    className="min-h-[38px] px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-xs"
                  >
                    {bulkPublishing
                      ? isSw
                        ? 'Inachapisha...'
                        : 'Publishing...'
                      : isSw
                        ? 'Peleka Zote Zilizo Tayari'
                        : 'Publish All Ready'}
                  </button>
                  <button
                    type="button"
                    disabled={bulkPublishing || kpiMetrics.liveOnMarketCount === 0}
                    onClick={() => void handleBulkPublishReady(false)}
                    className="min-h-[38px] px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    {isSw ? 'Ondoa Zote Sokoni' : 'Unpublish All'}
                  </button>
                </div>
              </div>

              {clonedItems.length === 0 ? (
                <EmptyStateCard
                  locale={locale}
                  titleSw="Hakuna bidhaa zilizotayarishwa bado"
                  titleEn="No products ready for publishing"
                  descriptionSw="Anza kwa kunakili bidhaa kwenye kichupo cha Katalogi Kuu."
                  descriptionEn="Start by cloning products in the Clone Products tab."
                />
              ) : (
                <div className="space-y-3">
                  {clonedItems.map((clone) => {
                    const catEntry = catalogById.get(clone.globalCatalogId);
                    const unitCat = resolveUnitCategoryForClone(clone, catEntry);
                    const fin = getCloneFinancialView(clone, wholesaleMode, unitCat, locale, catEntry);
                    const isReady = fin.hasStock && fin.hasPrice;
                    const busy = togglingPublishId === clone.clonedProductId;

                    return (
                      <article
                        key={clone.clonedProductId}
                        className="bg-white border border-slate-100 rounded-xl shadow-xs p-4 sm:p-5 space-y-3"
                      >
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                          <div className="flex items-start gap-3.5 min-w-0">
                            <div className="w-14 h-14 shrink-0 rounded-lg bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center">
                              {clone.imagekitCdnUrl ? (
                                <img
                                  src={clone.imagekitCdnUrl}
                                  alt={isSw ? clone.fixedNameSw : clone.fixedNameEn}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Boxes className="w-6 h-6 text-slate-300" />
                              )}
                            </div>
                            <div className="min-w-0 space-y-1">
                              <div className="font-mono text-[11px] font-bold text-emerald-700">
                                {clone.canonicalSku}
                              </div>
                              <h4 className="text-sm font-bold text-slate-950 truncate">
                                {isSw ? clone.fixedNameSw : clone.fixedNameEn}
                              </h4>

                              {/* 3-Step Readiness Checklist */}
                              <div className="flex flex-wrap items-center gap-2 text-[11px] pt-0.5">
                                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                                  1. {isSw ? 'Imenakiliwa ✓' : 'Cloned ✓'}
                                </span>

                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!fin.hasStock) jumpToStockInForClone(clone.clonedProductId);
                                  }}
                                  className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded border ${
                                    fin.hasStock
                                      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                                      : 'text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-100 cursor-pointer'
                                  }`}
                                >
                                  2. {isSw ? 'Stock (>0)' : 'Stocked (>0)'} {fin.hasStock ? '✓' : '✗ +'}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!fin.hasPrice) void openPricingModal(clone);
                                  }}
                                  className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded border ${
                                    fin.hasPrice
                                      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                                      : 'text-amber-800 bg-amber-50 border-amber-200 hover:bg-amber-100 cursor-pointer'
                                  }`}
                                >
                                  3. {isSw ? 'Bei (>0 TZS)' : 'Priced (>0)'} {fin.hasPrice ? '✓' : '✗ +'}
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewPublishClone((prev) =>
                                  prev?.clonedProductId === clone.clonedProductId ? null : clone,
                                )
                              }
                              className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{isSw ? 'Hakiki Muonekano' : 'Buyer Preview'}</span>
                            </button>

                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleToggleMarketPublish(clone, !fin.isPublished)}
                              className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50 ${
                                fin.isPublished
                                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                                  : isReady
                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                                    : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                              }`}
                            >
                              {busy
                                ? isSw
                                  ? 'Inasasisha...'
                                  : 'Updating...'
                                : fin.isPublished
                                  ? isSw
                                    ? 'Ondoa Sokoni'
                                    : 'Unpublish'
                                  : isSw
                                    ? 'Peleka Sokoni'
                                    : 'Publish Live'}
                            </button>
                          </div>
                        </div>

                        {/* Expandable Live Buyer Storefront Preview */}
                        {previewPublishClone?.clonedProductId === clone.clonedProductId && (
                          <div className="border-t border-slate-100 pt-3">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                              {isSw
                                ? 'Mwonekano kwa Wanunuzi wa SokoKuu Marketplace'
                                : 'Live Buyer Listing Preview on Sokoni Marketplace'}
                            </div>
                            <div className="max-w-sm bg-white border border-slate-200 rounded-lg p-3.5 shadow-xs space-y-2">
                              <div className="flex items-center gap-3">
                                <img
                                  src={clone.imagekitCdnUrl}
                                  alt={isSw ? clone.fixedNameSw : clone.fixedNameEn}
                                  className="w-14 h-14 rounded-md object-contain bg-slate-50 border border-slate-100 p-1"
                                />
                                <div className="min-w-0">
                                  <div className="text-[11px] font-mono text-slate-500">
                                    {clone.canonicalSku} · {fin.unitLabel}
                                  </div>
                                  <div className="text-sm font-bold text-slate-900 truncate">
                                    {isSw ? clone.fixedNameSw : clone.fixedNameEn}
                                  </div>
                                  <div className="text-xs font-mono font-bold text-emerald-700 tabular-nums">
                                    TZS {fin.effectiveSellingPriceTzs.toLocaleString('en-US')}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {isSw ? 'Zilizopo:' : 'Available:'} {fin.stockLabel}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* DYNAMIC POS QUANTITY PROMPT MODAL OVERLAY                      */}
      {/* ============================================================== */}
      {selectedItemForSale && (
        <div className="sk-dialog-overlay backdrop-blur-sm">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto sk-safe-bottom overscroll-contain">
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
                  {formatUnitTypeLabel(
                    selectedItemForSale.unitType,
                    locale,
                    selectedItemForSale.unitCategory ?? categoryFromSystemUnitCode(selectedItemForSale.unitType),
                  )}{' '}
                  ·{' '}
                  {formatQuantumDefinition(
                    selectedItemForSale.unitCategory ?? categoryFromSystemUnitCode(selectedItemForSale.unitType),
                    locale,
                  )}
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
                  <strong className="font-mono">
                    {formatQuantaMeasurement(
                      selectedItemForSale.availableQuanta,
                      selectedItemForSale.unitCategory ?? categoryFromSystemUnitCode(selectedItemForSale.unitType),
                      isSw ? 'sw' : 'en',
                    )}
                  </strong>
                  {typeof selectedItemForSale.sealedBulkPackagesStock === 'number' &&
                    selectedItemForSale.sealedBulkPackagesStock > 0 && (
                      <span className="font-mono opacity-80">
                        (+{selectedItemForSale.sealedBulkPackagesStock}{' '}
                        {isSw ? 'mifuko' : 'sealed'})
                      </span>
                    )}
                </span>
              </div>

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
                <div className="flex flex-wrap items-center gap-1.5">
                  {[1, 2, 4, 8]
                    .filter((q) => q <= maxPosQuanta)
                    .map((q) => (
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
                </div>
              </div>

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
                      className={`min-h-[50px] px-2 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        selectedPaymentMethod === method
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-xs ring-1 ring-emerald-600'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-emerald-50/70 border border-emerald-100 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-700">
                  <span>{isSw ? 'Bei kwa Quanta:' : 'Price per quantum:'}</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    TZS {Math.round(selectedItemForSale.unitPriceTzs / 4).toLocaleString('en-US')}
                  </span>
                </div>
                <div className="border-t border-emerald-200 pt-2 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">
                    {isSw ? 'Jumla ya Mauzo:' : 'POS Total:'}
                  </span>
                  <span className="font-mono font-bold text-emerald-800 text-lg tabular-nums">
                    TZS {Math.round((promptQuantity * selectedItemForSale.unitPriceTzs) / 4).toLocaleString('en-US')}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setSelectedItemForSale(null)}
                  className="flex-1 min-h-[46px] px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-sm rounded-xl cursor-pointer transition-colors"
                >
                  {isSw ? 'Ghairi' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submittingPos}
                  className="flex-[2] min-h-[46px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-sm rounded-xl shadow-xs cursor-pointer transition-colors flex items-center justify-center gap-2"
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

      {/* STANDARD PRICING TEMPLATE & TENANT-ISOLATED AMENDMENT DRAWER/MODAL */}
      {pricingModalClone && (
        <div
          className="sk-dialog-overlay backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPricingModalClone(null);
          }}
        >
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4 max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto sk-safe-bottom overscroll-contain">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="font-mono text-xs font-bold text-emerald-700">
                  {pricingModalClone.canonicalSku}
                </div>
                <h3 className="text-base font-bold text-slate-950">
                  {isSw ? 'Bei Kuu & Marekebisho ya Mfanyabiashara' : 'Standard & Amended Selling Price'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isSw ? pricingModalClone.fixedNameSw : pricingModalClone.fixedNameEn}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPricingModalClone(null)}
                className="text-slate-400 hover:text-slate-900 p-1 cursor-pointer"
                aria-label={isSw ? 'Funga' : 'Close'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingPriceModal ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                {isSw ? 'Inapakia bei kuu za SokoKuu...' : 'Loading standard pricing templates...'}
              </p>
            ) : pricingModalUnits.length === 0 || pricingModalStandards.length === 0 ? (
              <div className="space-y-3 py-4 text-xs text-slate-600">
                <p>
                  {isSw
                    ? 'Hakuna bei kuu zilizochapishwa na Super Admin kwa bidhaa hii bado.'
                    : 'No Super Admin standard prices published for this SKU yet.'}
                </p>
              </div>
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
                      const unitStandards = pricingModalStandards.filter(
                        (p) => p.globalProductUnitId === nextUnitId,
                      );
                      const firstMatch =
                        (wholesaleMode
                          ? unitStandards.find((p) => p.profileType === 'WHOLESALE')
                          : unitStandards.find((p) => p.profileType === 'RETAIL')) ??
                        unitStandards[0];
                      if (firstMatch) setSelectedStandardPriceId(firstMatch.id);
                      const ov = pricingModalClone.unitPricingOverrides.find(
                        (o) => o.globalProductUnitId === nextUnitId,
                      );
                      setAmendedPriceInput(
                        ov?.isOverridden && ov.amendedSellingPriceTzs
                          ? String(ov.amendedSellingPriceTzs)
                          : '',
                      );
                    }}
                    className="w-full min-h-[42px] px-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-600 focus:outline-none text-xs text-slate-900"
                  >
                    {pricingModalUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {(isSw ? u.displayLabelSw : u.displayLabelEn) ||
                          (isSw ? u.systemUnit?.nameSw : u.systemUnit?.nameEn)}{' '}
                        ({u.quarterQuantaPerUnit}Q)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Kiolezo cha Bei Kuu (Standard Price)' : 'Published Standard Price'}
                  </label>
                  <select
                    value={selectedStandardPriceId}
                    onChange={(e) => setSelectedStandardPriceId(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-600 focus:outline-none text-xs text-slate-900"
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
                      ? 'Marekebisho ya Bei Yako (Hiari — acha wazi kutumia Bei Kuu)'
                      : 'Custom Selling Price Amendment (optional — leave blank for Standard Price)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={amendedPriceInput}
                    onChange={(e) => setAmendedPriceInput(e.target.value)}
                    placeholder={isSw ? 'Weka bei ya kuuzia (TZS)...' : 'Enter selling price (TZS)...'}
                    className="w-full min-h-[42px] px-3 rounded-lg border border-slate-200 bg-white text-sm font-mono font-bold text-slate-900"
                  />
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    disabled={savingPriceModal}
                    onClick={() => void handleResetPriceToStandard()}
                    className="px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{isSw ? 'Rejesha Bei Kuu' : 'Reset Override'}</span>
                  </button>
                  <button
                    type="submit"
                    disabled={savingPriceModal}
                    className="flex-1 min-h-[42px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-xs"
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

      {/* EDIT CLONE MODAL */}
      {editClone && (
        <div
          className="sk-dialog-overlay backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditClone(null);
          }}
        >
          <div className="sk-dialog-panel">
            <div className="shrink-0 px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {isSw ? 'Hariri Mipangilio ya Bidhaa' : 'Edit Merchant Item Settings'}
                </h3>
                <div className="text-[11px] font-mono text-slate-500">{editClone.canonicalSku}</div>
              </div>
              <button
                type="button"
                onClick={() => setEditClone(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                aria-label={isSw ? 'Funga' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCloneEdit} className="sk-dialog-body p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Hisa Inayopatikana (Quanta)' : 'Available Stock (Quanta)'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={editCloneStock}
                    onChange={(e) => setEditCloneStock(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-900"
                    required
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Kiwango cha Tahadhari (Quanta)' : 'Low Stock Alert Threshold (Quanta)'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={editCloneLowStock}
                    onChange={(e) => setEditCloneLowStock(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-900"
                    required
                  />
                </label>
              </div>

              <ImageKitUpload
                locale={locale}
                label={isSw ? 'Picha ya Bidhaa (ImageKit)' : 'Item Image (ImageKit)'}
                folder="/merchants/catalog"
                value={editCloneImageUrl}
                onChange={setEditCloneImageUrl}
              />

              <div className="shrink-0 sk-safe-bottom flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditClone(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {isSw ? 'Ghairi' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingCloneEdit}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {savingCloneEdit
                      ? isSw
                        ? 'Inahifadhi...'
                        : 'Saving...'
                      : isSw
                        ? 'Hifadhi Mabadiliko'
                        : 'Save Changes'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteCloneTarget && (
        <ConfirmDestructiveDialog
          locale={locale}
          titleSw="Ondoa Bidhaa Dukani"
          titleEn="Remove Cloned Item"
          descriptionSw={`Bidhaa "${deleteCloneTarget.fixedNameSw}" itaondolewa kwenye orodha yako.`}
          descriptionEn={`"${deleteCloneTarget.fixedNameEn}" will be removed from your shelf list.`}
          isBusy={deletingClone}
          onConfirm={() => void handleConfirmDeleteClone()}
          onCancel={() => setDeleteCloneTarget(null)}
        />
      )}

      {deleteProductTarget && (
        <ConfirmDestructiveDialog
          locale={locale}
          titleSw="Futa Bidhaa"
          titleEn="Delete Product"
          descriptionSw={`Bidhaa "${deleteProductTarget.label}" itafutwa kutoka kwenye rekodi za POS.`}
          descriptionEn={`Product "${deleteProductTarget.label}" will be removed from active POS records.`}
          isBusy={deletingProduct}
          onConfirm={() => void handleConfirmDeleteProduct()}
          onCancel={() => setDeleteProductTarget(null)}
        />
      )}

      {deleteUnitTarget && (
        <ConfirmDestructiveDialog
          locale={locale}
          titleSw="Futa Kipimo Maalum"
          titleEn="Delete Custom Unit"
          descriptionSw={`Kipimo maalum "${deleteUnitTarget.label}" kitafutwa.`}
          descriptionEn={`Custom unit "${deleteUnitTarget.label}" will be deleted.`}
          isBusy={deletingUnit}
          onConfirm={() => void handleConfirmDeleteCustomUnit()}
          onCancel={() => setDeleteUnitTarget(null)}
        />
      )}
    </div>
  );
}
