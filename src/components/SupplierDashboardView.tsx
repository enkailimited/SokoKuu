import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  Factory,
  KeyRound,
  LoaderCircle,
  PackagePlus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Store,
  Truck,
  Warehouse,
  X,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { formatCodeWithoutUnderscores } from '../lib/sokoManagedState';
import { useFocusOrderScroll, type FocusOrderTarget } from '../lib/sokoFocusOrder';
import {
  clearSupplierDeliveryPending,
  readSupplierDeliveryOffline,
  stageSupplierDeliveryChange,
  writeSupplierDeliveryOffline,
  type SupplierDeliveryOfflineRecord,
  type SupplierDeliveryPayload,
} from '../lib/supplierDeliveryOffline';
import { ImageKitUpload } from './ImageKitUpload';

export type SupplierTab = 'warehouse' | 'publish' | 'orders' | 'reports';

export const SUPPLIER_TAB_LABELS: Record<SupplierTab, string> = {
  warehouse: 'Ghala & Stock',
  publish: 'Peleka Sokoni',
  orders: 'Oda & Usafirishaji',
  reports: 'Ripoti',
};

type DeliveryPolicyCode =
  | 'FREE_DELIVERY_ABOVE_MINIMUM'
  | 'FREE_DELIVERY_ALL_ORDERS'
  | 'STANDARD_DELIVERY_FEE';

const DELIVERY_POLICY_LABELS: Record<DeliveryPolicyCode, { sw: string; en: string }> = {
  FREE_DELIVERY_ABOVE_MINIMUM: {
    sw: 'Usafirishaji bure zaidi ya kiwango cha chini',
    en: 'Free delivery above minimum',
  },
  FREE_DELIVERY_ALL_ORDERS: {
    sw: 'Usafirishaji bure kwa oda zote',
    en: 'Free delivery on all orders',
  },
  STANDARD_DELIVERY_FEE: {
    sw: 'Ada ya kawaida ya usafirishaji',
    en: 'Standard delivery fee',
  },
};

/** Backend returns a machine code; show a readable label, never raw underscores. */
function formatDeliveryPolicy(policy: string | undefined, isSw: boolean): string {
  if (!policy) return '—';
  const label = DELIVERY_POLICY_LABELS[policy as DeliveryPolicyCode];
  if (label) return isSw ? label.sw : label.en;
  return policy
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (char) => char.toUpperCase());
}

type StockMovementType = 'FACTORY_PRODUCTION' | 'WAREHOUSE_STOCK_IN' | 'STOCK_ADJUSTMENT';

interface InventoryUnitConversion {
  globalProductUnitId: string;
  systemUnitId: string;
  unitCode: string;
  nameSw: string;
  nameEn: string;
  abbreviation: string;
  quarterQuantaPerUnit: number;
  isWholesaleUnit: boolean;
  displayLabelSw: string | null;
  displayLabelEn: string | null;
}

interface InventoryItem {
  productId: string;
  smsItemCode: string;
  nameSw: string;
  nameEn: string;
  globalCatalogId: string | null;
  canonicalSku: string | null;
  imagekitCdnUrl?: string;
  availableQuantaStock: number;
  sealedBulkPackagesStock: number;
  sealedParentUnitType: string;
  quantaPerSealedPackage: number;
  lowStockThresholdQuanta: number;
  unitConversions: InventoryUnitConversion[];
}

interface InventoryResponse {
  supplierBusinessId: string;
  totalWarehouseQuanta: number;
  items: InventoryItem[];
}

interface MarketSupplierListing {
  listingId: string;
  supplierBusinessId: string;
  supplierName: string;
  productId: string | null;
  globalCatalogId: string;
  canonicalSku: string;
  nameSw: string;
  nameEn: string;
  imagekitCdnUrl: string;
  systemUnitId: string;
  systemUnitCode: string;
  systemUnitLabelSw: string;
  quarterQuantaPerUnit: number;
  supplierBulkPriceTzs: string;
  minOrderQuantity: number;
  availableQuantaStock: number;
  maxOrderQuantity: number;
  isFreeDeliveryEnabled: boolean;
  freeDeliveryMinOrderTzs: string;
  standardDeliveryFeeTzs: string;
  deliveryCoverageRegions: string[];
  isAvailable: boolean;
}

interface DeliverySettings {
  isFreeDeliveryEnabled: boolean;
  freeDeliveryMinOrderTzs: string;
  standardDeliveryFeeTzs: string;
  deliveryCoverageRegions: string[];
  policy?: string;
  allowAdminReceive?: boolean;
}

interface GlobalCatalogBrowseItem {
  id: string;
  canonicalSku: string;
  fixedNameSw: string;
  fixedNameEn: string;
  categoryCode: string;
  imagekitCdnUrl: string;
  staticImageUrl: string;
  baseQuantumUnit: string;
  clonedByStoresCount: number;
}

interface StandardCatalogCloneResult {
  productId: string;
  localInventoryId: string;
  globalCatalogId: string;
  imagekitCdnUrl: string;
  initializedStockQuanta: number;
  initializedPriceTzs: number;
  idempotentReplay: boolean;
  supplierBusinessId: string;
}

interface SupplierPurchaseReceiptResult {
  receiptId: string;
  productId: string;
  receivedQuanta: number;
  agreedTotalCostTzs: string;
  receiptStatus: 'GOODS_RECEIVED' | 'ORDER_CONFIRMED';
  availableQuantaStock?: number;
}

function toDeliveryCache(res: DeliverySettings): SupplierDeliveryOfflineRecord['lastKnown'] {
  return {
    isFreeDeliveryEnabled: Boolean(res.isFreeDeliveryEnabled),
    freeDeliveryMinOrderTzs: res.freeDeliveryMinOrderTzs,
    standardDeliveryFeeTzs: res.standardDeliveryFeeTzs,
    deliveryCoverageRegions: res.deliveryCoverageRegions ?? [],
    policy: res.policy,
    allowAdminReceive:
      typeof res.allowAdminReceive === 'boolean' ? res.allowAdminReceive : undefined,
  };
}

interface SupplierOrder {
  orderId: string;
  orderRef: string;
  status: 'PLACED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED' | 'DISPUTED';
  orderChannel: string;
  placedAtEat: string;
  dispatchedAtEat: string | null;
  buyer: { id: string; fullName: string; phoneE164: string };
  driver: { id: string; fullName: string; phoneE164: string } | null;
  sellerBusinessId: string;
  expectedTotalTzs: string;
  deliveryFeeTzs: string;
  isFreeDeliveryApplied: boolean;
  dualPinStatus: {
    verificationStatus: string;
    isBuyerConfirmed: boolean;
    isDriverConfirmed: boolean;
    isQrTokenConsumed: boolean;
  } | null;
  items: Array<{
    productId: string;
    nameSw: string;
    nameEn: string;
    quantity: number;
    quarterQuanta: number;
    lineTotalTzs: string;
  }>;
}

interface AvailableDriver {
  driverUserId: string;
  driverName: string;
  phoneE164: string;
}

interface SupplierReport {
  supplierBusinessId: string;
  supplierName: string;
  totalB2bRevenueTzs: string;
  totalOrdersFulfilled: number;
  pendingDispatchCount: number;
  freeDeliveryOrdersSponsored: number;
  topProducts: Array<{
    productId: string;
    nameSw: string;
    nameEn: string;
    quantity: number;
    quanta: number;
    revenueTzs: string;
  }>;
  warehouseValuationTzs: string;
}

function formatTzs(value: string | number | null | undefined): string {
  try {
    return BigInt(value ?? 0).toLocaleString('en-US');
  } catch {
    return Number(value ?? 0).toLocaleString('en-US');
  }
}

function describeError(err: unknown, isSw: boolean, fallback: string): string {
  if (err instanceof SokoHttpError) {
    return `HTTP ${err.status}: ${err.message}`;
  }
  if (isSokoNetworkError(err)) {
    return isSw
      ? 'HTTP GATEWAY: Hakuna muunganisho na SokoKuu API.'
      : 'HTTP GATEWAY: SokoKuu API is unreachable.';
  }
  return err instanceof Error ? err.message : fallback;
}

export function SupplierDashboardView({
  locale,
  activeTab,
  onTabChange,
  businessId,
  sellerPhone,
  focusOrder,
}: {
  locale: Locale;
  activeTab: SupplierTab;
  onTabChange: (tab: SupplierTab) => void;
  businessId?: string | null;
  sellerPhone?: string | null;
  focusOrder?: FocusOrderTarget | null;
}) {
  const isSw = locale === 'sw';
  useFocusOrderScroll(focusOrder, activeTab === 'orders');
  const deliveryScope = useMemo(
    () => businessId ?? 'supplier-delivery-default',
    [businessId]
  );

  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [deliverySettings, setDeliverySettings] = useState<DeliverySettings | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(true);
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [deliveryPendingSync, setDeliveryPendingSync] = useState(false);
  const [listings, setListings] = useState<MarketSupplierListing[]>([]);
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [drivers, setDrivers] = useState<AvailableDriver[]>([]);
  const [report, setReport] = useState<SupplierReport | null>(null);

  const [loading, setLoading] = useState(false);
  const [backendOffline, setBackendOffline] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [stockForm, setStockForm] = useState({
    productId: '',
    quantityQuanta: '',
    movementType: 'WAREHOUSE_STOCK_IN' as StockMovementType,
    note: '',
    referenceId: '',
  });
  const [deliveryForm, setDeliveryForm] = useState({
    isFreeDeliveryEnabled: true,
    freeDeliveryMinOrderTzs: '0',
    standardDeliveryFeeTzs: '0',
    deliveryCoverageRegions: '',
  });
  const [publishForm, setPublishForm] = useState({
    globalCatalogId: '',
    systemUnitId: '',
    supplierBulkPriceTzs: '',
    minOrderQuantity: '1',
    imagekitCdnUrl: '',
    isPublishedToMarket: true,
  });
  const [selectedDriverByOrder, setSelectedDriverByOrder] = useState<Record<string, string>>({});
  const [dispatchingOrderId, setDispatchingOrderId] = useState<string | null>(null);
  const [dispatchNotice, setDispatchNotice] = useState<{
    orderRef: string;
    buyerPin: string;
    driverPin: string;
    totalTzs: string;
  } | null>(null);

  // Reuse of the immutable standard catalog (same pattern as Admin / Retailer).
  const [standardCatalog, setStandardCatalog] = useState<GlobalCatalogBrowseItem[]>([]);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [cloningCatalogId, setCloningCatalogId] = useState<string | null>(null);

  // Supplier-specific manual purchase receipt / costed stock hydration.
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({
    productId: '',
    globalProductUnitId: '',
    quarterQuantaPerUnit: '',
    supplierName: '',
    supplierReference: '',
    receiptStatus: 'GOODS_RECEIVED' as 'GOODS_RECEIVED' | 'ORDER_CONFIRMED',
    quantityUnits: '',
    agreedTotalCostTzs: '',
    note: '',
  });

  const handleError = useCallback(
    (err: unknown, fallback: string) => {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      setApiError(describeError(err, isSw, fallback));
    },
    [isSw]
  );

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    setBackendOffline(false);
    try {
      const res = await SokoApiClient.get<InventoryResponse>('/supplier/inventory');
      setInventory(res);
      setStockForm((prev) => ({
        ...prev,
        productId:
          prev.productId && res.items.some((item) => item.productId === prev.productId)
            ? prev.productId
            : (res.items[0]?.productId ?? ''),
      }));
      setPublishForm((prev) => {
        const item = res.items.find((entry) => entry.globalCatalogId === prev.globalCatalogId);
        const firstItem = res.items.find((entry) => entry.globalCatalogId);
        const chosenItem = item ?? firstItem;
        return {
          ...prev,
          globalCatalogId: chosenItem?.globalCatalogId ?? '',
          systemUnitId:
            chosenItem?.unitConversions.find(
              (unit) => unit.systemUnitId === prev.systemUnitId
            )?.systemUnitId ??
            chosenItem?.unitConversions[0]?.systemUnitId ??
            '',
        };
      });
    } catch (err) {
      handleError(
        err,
        isSw ? 'Imeshindikana kupakia ghala la supplier.' : 'Failed to load supplier warehouse.'
      );
    } finally {
      setLoading(false);
    }
  }, [handleError, isSw]);

  const applyDeliverySettings = useCallback((res: DeliverySettings) => {
    setDeliverySettings(res);
    setDeliveryForm({
      isFreeDeliveryEnabled: Boolean(res.isFreeDeliveryEnabled),
      freeDeliveryMinOrderTzs: res.freeDeliveryMinOrderTzs,
      standardDeliveryFeeTzs: res.standardDeliveryFeeTzs,
      deliveryCoverageRegions: (res.deliveryCoverageRegions ?? []).join(', '),
    });
  }, []);

  /**
   * Replay a Save Policy action that was staged while the PWA was offline.
   * The queued payload is kept untouched when the backend is still unreachable.
   */
  const flushPendingDelivery = useCallback(async () => {
    const cached = await readSupplierDeliveryOffline(deliveryScope);
    if (!cached?.pending) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;

    setDeliverySaving(true);
    try {
      const res = await SokoApiClient.patch<DeliverySettings>('/supplier/delivery-settings', {
        isFreeDeliveryEnabled: cached.pending.isFreeDeliveryEnabled,
        freeDeliveryMinOrderTzs: cached.pending.freeDeliveryMinOrderTzs,
        standardDeliveryFeeTzs: cached.pending.standardDeliveryFeeTzs,
        deliveryCoverageRegions: cached.pending.deliveryCoverageRegions,
      });
      applyDeliverySettings(res);
      await writeSupplierDeliveryOffline({
        businessScope: deliveryScope,
        lastKnown: toDeliveryCache(res),
      });
      setDeliveryPendingSync(false);
      setNotice(
        isSw
          ? 'Mtandao umerejea: sera ya usafiri imesawazishwa na PostgreSQL.'
          : 'Back online: delivery policy synced to PostgreSQL.'
      );
      return true;
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        return false;
      }
      await clearSupplierDeliveryPending(deliveryScope);
      setDeliveryPendingSync(false);
      handleError(
        err,
        isSw
          ? 'Imeshindikana kusawazisha sera ya usafiri iliyokuwa foleni.'
          : 'Failed to sync the queued delivery policy.'
      );
      return false;
    } finally {
      setDeliverySaving(false);
    }
  }, [applyDeliverySettings, deliveryScope, handleError, isSw]);

  const loadDeliverySettings = useCallback(async () => {
    // Never flash a guessed ENABLED/DISABLED value: show "Checking status..."
    // until the server (or the offline cache) answers.
    setDeliveryLoading(true);
    setApiError(null);
    const cached = await readSupplierDeliveryOffline(deliveryScope);

    const applyCached = (): boolean => {
      if (!cached) return false;
      const pending = cached.pending;
      applyDeliverySettings({
        ...cached.lastKnown,
        isFreeDeliveryEnabled: pending?.isFreeDeliveryEnabled ?? cached.lastKnown.isFreeDeliveryEnabled,
        freeDeliveryMinOrderTzs:
          pending?.freeDeliveryMinOrderTzs ?? cached.lastKnown.freeDeliveryMinOrderTzs,
        standardDeliveryFeeTzs:
          pending?.standardDeliveryFeeTzs ?? cached.lastKnown.standardDeliveryFeeTzs,
        deliveryCoverageRegions:
          pending?.deliveryCoverageRegions ?? cached.lastKnown.deliveryCoverageRegions,
      });
      setDeliveryPendingSync(Boolean(pending));
      return true;
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setBackendOffline(true);
      if (applyCached()) {
        setNotice(
          isSw
            ? 'Nje ya mtandao: unaona hali iliyohifadhiwa kwenye kifaa chako.'
            : 'Offline: showing the delivery status cached on this device.'
        );
      } else {
        setDeliveryPendingSync(false);
      }
      setDeliveryLoading(false);
      return;
    }

    try {
      const res = await SokoApiClient.get<DeliverySettings>('/supplier/delivery-settings');
      applyDeliverySettings(res);
      setDeliveryPendingSync(false);
      await writeSupplierDeliveryOffline({
        businessScope: deliveryScope,
        lastKnown: toDeliveryCache(res),
      });
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        if (!applyCached()) {
          setApiError(describeError(
            err,
            isSw,
            'Imeshindikana kupakia sera ya usafiri ya supplier.'
          ));
        }
      } else {
        handleError(
          err,
          isSw
            ? 'Imeshindikana kupakia sera ya usafiri ya supplier.'
            : 'Failed to load supplier delivery policy.'
        );
      }
    } finally {
      setDeliveryLoading(false);
    }
  }, [applyDeliverySettings, deliveryScope, handleError, isSw]);

  const loadListings = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    setBackendOffline(false);
    try {
      const res = await SokoApiClient.get<{ items: MarketSupplierListing[] }>(
        '/marketplace/suppliers/catalog'
      );
      setListings(
        businessId
          ? (res.items ?? []).filter((item) => item.supplierBusinessId === businessId)
          : (res.items ?? [])
      );
    } catch (err) {
      handleError(
        err,
        isSw
          ? 'Imeshindikana kupakia orodha ya soko la supplier.'
          : 'Failed to load supplier marketplace listings.'
      );
    } finally {
      setLoading(false);
    }
  }, [businessId, handleError, isSw]);

  const loadStandardCatalog = useCallback(async () => {
    setApiError(null);
    try {
      const rows = await SokoApiClient.get<GlobalCatalogBrowseItem[]>(
        '/marketplace/catalog'
      );
      setStandardCatalog(rows ?? []);
    } catch (err) {
      handleError(
        err,
        isSw
          ? 'Imeshindikana kupakia orodha rasmi ya bidhaa.'
          : 'Failed to load the standard catalog.'
      );
    }
  }, [handleError, isSw]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    setBackendOffline(false);
    try {
      const [ordersRes, driversRes] = await Promise.all([
        SokoApiClient.get<{ supplierBusinessId: string; orders: SupplierOrder[] }>(
          '/supplier/orders'
        ),
        SokoApiClient.get<{ count: number; drivers: AvailableDriver[] }>(
          '/dispatch/available-drivers'
        ),
      ]);
      setOrders(ordersRes.orders ?? []);
      setDrivers(driversRes.drivers ?? []);
    } catch (err) {
      handleError(
        err,
        isSw
          ? 'Imeshindikana kupakia oda za supplier.'
          : 'Failed to load supplier incoming orders.'
      );
    } finally {
      setLoading(false);
    }
  }, [handleError, isSw]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    setBackendOffline(false);
    try {
      const res = await SokoApiClient.get<SupplierReport>('/supplier/reports/summary');
      setReport(res);
    } catch (err) {
      handleError(
        err,
        isSw ? 'Imeshindikana kupakia ripoti ya supplier.' : 'Failed to load supplier report.'
      );
    } finally {
      setLoading(false);
    }
  }, [handleError, isSw]);

  useEffect(() => {
    void loadInventory();
    void flushPendingDelivery().finally(() => void loadDeliverySettings());
  }, [flushPendingDelivery, loadInventory, loadDeliverySettings]);

  useEffect(() => {
    const onOnline = () => {
      void flushPendingDelivery().finally(() => void loadDeliverySettings());
    };
    const onOffline = () => setBackendOffline(true);
    const onFreeDeliveryUpdated = () => {
      // Settings owns the Free Delivery toggle — refresh the badge whenever it changes.
      void loadDeliverySettings();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('sokokuu:free-delivery-updated', onFreeDeliveryUpdated);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('sokokuu:free-delivery-updated', onFreeDeliveryUpdated);
    };
  }, [flushPendingDelivery, loadDeliverySettings]);

  useEffect(() => {
    if (activeTab === 'publish') {
      void loadListings();
      void loadStandardCatalog();
    }
    if (activeTab === 'orders') void loadOrders();
    if (activeTab === 'reports') void loadReport();
  }, [activeTab, loadListings, loadOrders, loadReport, loadStandardCatalog]);

  const publishItem = useMemo(
    () => inventory?.items.find((item) => item.globalCatalogId === publishForm.globalCatalogId),
    [inventory, publishForm.globalCatalogId]
  );

  const filteredStandardCatalog = useMemo(() => {
    const needle = catalogSearch.trim().toLowerCase();
    if (!needle) return standardCatalog;
    return standardCatalog.filter((entry) =>
      [entry.canonicalSku, entry.fixedNameSw, entry.fixedNameEn, entry.categoryCode]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [catalogSearch, standardCatalog]);

  const purchaseProduct = useMemo(
    () => inventory?.items.find((item) => item.productId === purchaseForm.productId) ?? null,
    [inventory, purchaseForm.productId]
  );

  const handleCloneStandardCatalog = async (entry: GlobalCatalogBrowseItem) => {
    setApiError(null);
    setNotice(null);
    if (!businessId) {
      setApiError(
        isSw
          ? 'Kitambulisho cha biashara ya supplier hakipatikani; ingia tena.'
          : 'Supplier business identity is unavailable; sign in again.'
      );
      return;
    }
    setCloningCatalogId(entry.id);
    try {
      const res = await SokoApiClient.post<StandardCatalogCloneResult>(
        '/marketplace/catalog/clone-standard',
        {
          globalCatalogId: entry.id,
          retailerBusinessId: businessId,
        }
      );
      setNotice(
        res.idempotentReplay
          ? isSw
            ? `${entry.fixedNameSw} tayari iko kwenye ghala lako.`
            : `${entry.fixedNameEn} is already in your warehouse.`
          : isSw
            ? `${entry.fixedNameSw} imenakiliwa kwenye ghala (quanta ${res.initializedStockQuanta}, bei TZS ${res.initializedPriceTzs}).`
            : `${entry.fixedNameEn} cloned into your warehouse (${res.initializedStockQuanta} quanta, TZS ${res.initializedPriceTzs}).`
      );
      setPublishForm((prev) => ({
        ...prev,
        globalCatalogId: res.globalCatalogId,
        imagekitCdnUrl: res.imagekitCdnUrl || entry.imagekitCdnUrl,
      }));
      await loadInventory();
      await loadStandardCatalog();
    } catch (err) {
      handleError(
        err,
        isSw
          ? 'Imeshindikana kunakili bidhaa ya kawaida kwenye ghala.'
          : 'Failed to clone the standard catalog item into your warehouse.'
      );
    } finally {
      setCloningCatalogId(null);
    }
  };

  const handleOpenPurchase = () => {
    setApiError(null);
    setNotice(null);
    const first = inventory?.items.find((item) => item.globalCatalogId) ?? inventory?.items[0];
    setPurchaseForm({
      productId: first?.productId ?? '',
      globalProductUnitId: first?.unitConversions[0]?.globalProductUnitId ?? '',
      quarterQuantaPerUnit: String(first?.unitConversions[0]?.quarterQuantaPerUnit ?? ''),
      supplierName: '',
      supplierReference: '',
      receiptStatus: 'GOODS_RECEIVED',
      quantityUnits: '',
      agreedTotalCostTzs: '',
      note: '',
    });
    setPurchaseOpen(true);
  };

  const handleRecordPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    const units = Math.trunc(Number(purchaseForm.quantityUnits));
    const quantaPerUnit = Math.trunc(Number(purchaseForm.quarterQuantaPerUnit));
    const cost = purchaseForm.agreedTotalCostTzs.trim();
    if (
      !purchaseForm.productId ||
      !purchaseForm.supplierName.trim() ||
      !Number.isSafeInteger(units) ||
      units < 1 ||
      !Number.isSafeInteger(quantaPerUnit) ||
      quantaPerUnit < 1 ||
      !/^\d+$/.test(cost)
    ) {
      setApiError(
        isSw
          ? 'Jaza bidhaa, jina la msambizaji, idadi na gharama halali ya TZS.'
          : 'Select a product and enter supplier name, valid quantity and whole-TZS cost.'
      );
      return;
    }

    setPurchaseSaving(true);
    try {
      const res = await SokoApiClient.post<SupplierPurchaseReceiptResult>(
        '/supplier/purchases/external-receipt',
        {
          productId: purchaseForm.productId,
          globalProductUnitId: purchaseForm.globalProductUnitId || undefined,
          quarterQuantaPerUnit: purchaseForm.globalProductUnitId
            ? undefined
            : quantaPerUnit,
          supplierName: purchaseForm.supplierName.trim(),
          supplierReference: purchaseForm.supplierReference.trim() || undefined,
          receiptStatus: purchaseForm.receiptStatus,
          quantityUnits: units,
          agreedTotalCostTzs: cost,
          note: purchaseForm.note.trim() || undefined,
        }
      );
      setPurchaseOpen(false);
      setNotice(
        res.receiptStatus === 'GOODS_RECEIVED'
          ? isSw
            ? `Risiti imehifadhiwa: quanta ${res.receivedQuanta} zimeingia ghala kwa TZS ${formatTzs(res.agreedTotalCostTzs)}.`
            : `Receipt recorded: ${res.receivedQuanta} quanta received into the warehouse at TZS ${formatTzs(res.agreedTotalCostTzs)}.`
          : isSw
            ? 'Ada iliyokubaliwa imehifadhiwa; bidhaa bado hazijaingia ghala.'
            : 'Agreed cost recorded; goods have not arrived in the warehouse yet.'
      );
      await loadInventory();
    } catch (err) {
      handleError(
        err,
        isSw
          ? 'Imeshindikana kuhifadhi risiti ya ununuzi.'
          : 'Failed to record the supplier purchase receipt.'
      );
    } finally {
      setPurchaseSaving(false);
    }
  };

  const handleStockIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    setNotice(null);
    const quantity = Math.trunc(Number(stockForm.quantityQuanta));
    if (!stockForm.productId || !Number.isSafeInteger(quantity) || quantity < 1) {
      setApiError(
        isSw
          ? 'Chagua bidhaa ya ghala na weka idadi halali ya Quarter-Quanta.'
          : 'Select a warehouse product and enter a valid Quarter-Quanta quantity.'
      );
      return;
    }

    try {
      const res = await SokoApiClient.post<{ availableQuantaStock: number; movementId: string }>(
        '/supplier/inventory/stock-in',
        {
          productId: stockForm.productId,
          quantityQuanta: quantity,
          movementType: stockForm.movementType,
          note: stockForm.note.trim() || undefined,
          referenceId: stockForm.referenceId.trim() || undefined,
        }
      );
      setNotice(
        isSw
          ? `Quarter-Quanta ${quantity} zimeongezwa kwenye ghala. Sasa zipo ${res.availableQuantaStock}.`
          : `${quantity} Quarter-Quanta received into the warehouse. Available stock is now ${res.availableQuantaStock}.`
      );
      setStockForm((prev) => ({ ...prev, quantityQuanta: '', note: '', referenceId: '' }));
      await loadInventory();
    } catch (err) {
      handleError(
        err,
        isSw ? 'Imeshindikana kuhifadhi stock-in.' : 'Failed to record warehouse stock-in.'
      );
    }
  };

  const handleSaveDeliverySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    setNotice(null);
    const minimum = deliveryForm.freeDeliveryMinOrderTzs.trim();
    const standardFee = deliveryForm.standardDeliveryFeeTzs.trim();
    if (!/^\d+$/.test(minimum) || !/^\d+$/.test(standardFee)) {
      setApiError(
        isSw
          ? 'Weka kiasi halali cha TZS (namba nzima tu).'
          : 'Enter valid whole-TZS amounts (digits only).'
      );
      return;
    }

    const payload: SupplierDeliveryPayload = {
      // Free Delivery itself is managed in Settings; preserve the server value.
      isFreeDeliveryEnabled: Boolean(deliverySettings?.isFreeDeliveryEnabled),
      freeDeliveryMinOrderTzs: minimum,
      standardDeliveryFeeTzs: standardFee,
      deliveryCoverageRegions: deliveryForm.deliveryCoverageRegions
        .split(/[,\n]/)
        .map((region) => region.trim())
        .filter(Boolean),
    };

    setDeliverySaving(true);
    if (deliverySettings) {
      await writeSupplierDeliveryOffline({
        businessScope: deliveryScope,
        lastKnown: toDeliveryCache(deliverySettings),
      });
    }
    await stageSupplierDeliveryChange(
      deliveryScope,
      {
        isFreeDeliveryEnabled: payload.isFreeDeliveryEnabled,
        freeDeliveryMinOrderTzs: minimum,
        standardDeliveryFeeTzs: standardFee,
        deliveryCoverageRegions: payload.deliveryCoverageRegions,
      },
      payload
    );
    setDeliveryPendingSync(true);

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setBackendOffline(true);
      setNotice(
        isSw
          ? 'Nje ya mtandao: sera imehifadhiwa kwenye foleni ya kifaa; itasawazishwa mtandao unaporudi.'
          : 'Offline: policy queued on this device and will sync when connectivity returns.'
      );
      setDeliverySaving(false);
      return;
    }

    try {
      const res = await SokoApiClient.patch<DeliverySettings>('/supplier/delivery-settings', payload);
      applyDeliverySettings(res);
      await writeSupplierDeliveryOffline({
        businessScope: deliveryScope,
        lastKnown: toDeliveryCache(res),
      });
      setDeliveryPendingSync(false);
      setNotice(
        isSw
          ? 'Sera ya usafiri wa B2B imehifadhiwa.'
          : 'Supplier B2B delivery policy saved.'
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setNotice(
          isSw
            ? 'Mtandao haupatikani: sera imehifadhiwa kwenye foleni ya kifaa.'
            : 'Network unavailable: policy kept in the offline queue.'
        );
      } else {
        await clearSupplierDeliveryPending(deliveryScope);
        setDeliveryPendingSync(false);
        handleError(
          err,
          isSw
            ? 'Imeshindikana kuhifadhi sera ya usafiri.'
            : 'Failed to save supplier delivery policy.'
        );
      }
    } finally {
      setDeliverySaving(false);
    }
  };

  const handlePublishListing = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    setNotice(null);
    const price = publishForm.supplierBulkPriceTzs.trim();
    const moq = Math.trunc(Number(publishForm.minOrderQuantity));
    if (
      !publishForm.globalCatalogId ||
      !publishForm.systemUnitId ||
      !/^\d+$/.test(price) ||
      BigInt(price) <= 0n ||
      !Number.isSafeInteger(moq) ||
      moq < 1
    ) {
      setApiError(
        isSw
          ? 'Chagua bidhaa, kitengo, bei halali ya TZS na MOQ.'
          : 'Select a product, unit, valid TZS price and MOQ.'
      );
      return;
    }

    try {
      await SokoApiClient.post('/supplier/catalog/publish', {
        globalCatalogId: publishForm.globalCatalogId,
        systemUnitId: publishForm.systemUnitId,
        supplierBulkPriceTzs: price,
        minOrderQuantity: moq,
        isPublishedToMarket: publishForm.isPublishedToMarket,
        imagekitCdnUrl: publishForm.imagekitCdnUrl.trim() || undefined,
      });
      setNotice(
        isSw
          ? 'Orodha ya jumla imepelekwa Sokoni kwa wauzaji wa jumla.'
          : 'Bulk listing published to the wholesaler Sokoni marketplace.'
      );
      await loadListings();
    } catch (err) {
      handleError(
        err,
        isSw ? 'Imeshindikana kupeleka orodha sokoni.' : 'Failed to publish supplier listing.'
      );
    }
  };

  const handleDispatchOrder = async (order: SupplierOrder) => {
    setApiError(null);
    setNotice(null);
    const driverUserId = selectedDriverByOrder[order.orderId];
    if (!driverUserId) {
      setApiError(
        isSw
          ? 'Chagua dereva aliyesajiliwa kabla ya kutuma oda hii.'
          : 'Select a registered driver before dispatching this order.'
      );
      return;
    }

    setDispatchingOrderId(order.orderId);
    try {
      const res = await SokoApiClient.post<{
        orderRef: string;
        buyerConfirmationPin: string;
        driverConfirmationPin: string;
        expectedCashAmountTzs: number;
      }>(`/orders/${order.orderId}/dispatch`, { driverUserId });
      setDispatchNotice({
        orderRef: res.orderRef,
        buyerPin: res.buyerConfirmationPin,
        driverPin: res.driverConfirmationPin,
        totalTzs: formatTzs(res.expectedCashAmountTzs),
      });
      await loadOrders();
    } catch (err) {
      handleError(
        err,
        isSw ? 'Imeshindikana kutuma oda kwa dereva.' : 'Failed to dispatch order to driver.'
      );
    } finally {
      setDispatchingOrderId(null);
    }
  };

  const handleDownloadCsv = async () => {
    setApiError(null);
    try {
      const blob = await SokoApiClient.downloadBlob('/supplier/reports/export-csv');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'sokokuu-supplier-ripoti.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      handleError(
        err,
        isSw ? 'Imeshindikana kupakua ripoti ya CSV.' : 'Failed to download supplier CSV report.'
      );
    }
  };

  const tabs: SupplierTab[] = ['warehouse', 'publish', 'orders', 'reports'];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-emerald-600">
            <Factory className="w-4 h-4" aria-hidden="true" />
            <span>
              SUPPLIER · {formatCodeWithoutUnderscores('MANUFACTURER_SUPPLIER').toUpperCase()} · B2B
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {isSw ? 'Dashibodi ya Msambizaji' : 'Supplier Warehouse'}
          </h1>
          <p className="text-xs text-slate-500">
            {isSw
              ? 'Ghala, soko la jumla, oda za usafirishaji na ripoti — vyote.'
              : 'Warehouse, B2B marketplace, dispatch orders and reports — all.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (activeTab === 'warehouse') void loadInventory();
            if (activeTab === 'publish') void loadListings();
            if (activeTab === 'orders') void loadOrders();
            if (activeTab === 'reports') void loadReport();
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-lg">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md whitespace-nowrap cursor-pointer transition-colors ${
              activeTab === tab
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {SUPPLIER_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {apiError && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg p-3.5 text-xs text-red-900 flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{apiError}</span>
          </div>
          <button
            type="button"
            onClick={() => setApiError(null)}
            className="text-red-700 hover:text-red-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {backendOffline && (
        <div
          role="alert"
          className="border border-amber-200 bg-amber-50 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          {isSw
            ? 'API ya SokoKuu haipatikani. Hakuna data ya demo inayotumika.'
            : 'SokoKuu API is unreachable. No demo data is being substituted.'}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-3.5 text-xs font-semibold text-emerald-900 flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{notice}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-800 hover:text-emerald-950 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {activeTab === 'warehouse' && (
        <div className="space-y-6">
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                <Warehouse className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                {isSw ? 'Jumla ya Quarter-Quanta' : 'Total Warehouse Quarter-Quanta'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {formatTzs(inventory?.totalWarehouseQuanta ?? 0)}
              </div>
            </div>
            <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Bidhaa Zilizosajiliwa' : 'Warehouse SKUs'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-800">
                {inventory?.items.length ?? 0}
              </div>
            </div>
            <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Thamani ya Ghala (TZS)' : 'Warehouse Valuation (TZS)'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {formatTzs(report?.warehouseValuationTzs ?? 0)}
              </div>
            </div>
          </section>

          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                {isSw ? 'Hifadhi ya Kiwanja (PostgreSQL)' : 'Factory Warehouse Stock'}
              </h2>
            </div>
            {!inventory || inventory.items.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">
                {loading
                  ? isSw
                    ? 'Inapakia ghala...'
                    : 'Loading warehouse stock...'
                  : isSw
                    ? 'Hakuna bidhaa za ghala zilizosajiliwa.'
                    : 'No warehouse products have been registered.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                      <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Bidhaa' : 'Product'}</th>
                      <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'SKU' : 'SKU'}</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">{isSw ? 'Quanta' : 'Quanta'}</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">{isSw ? 'Magunia' : 'Sealed'}</th>
                      <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Vipimo' : 'Conversions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {inventory.items.map((item) => (
                      <tr key={item.productId} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            {item.imagekitCdnUrl && (
                              <img
                                src={item.imagekitCdnUrl}
                                alt={isSw ? item.nameSw : item.nameEn}
                                referrerPolicy="no-referrer"
                                className="w-9 h-9 rounded-md object-cover border border-slate-200 bg-white shrink-0"
                              />
                            )}
                            <div>
                              <div className="font-semibold text-slate-900">
                                {isSw ? item.nameSw : item.nameEn}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500">
                                {item.smsItemCode}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                          {item.canonicalSku ?? '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold tabular-nums text-emerald-800 whitespace-nowrap">
                          {formatTzs(item.availableQuantaStock)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {formatTzs(item.sealedBulkPackagesStock)}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {item.unitConversions
                            .map((unit) => `${unit.abbreviation}:${unit.quarterQuantaPerUnit}`)
                            .join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <PackagePlus className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  {isSw ? 'Rekodi Stock-In ya Kiwanja' : 'Record Factory Stock-In'}
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  {isSw
                    ? 'Kila mabadiliko yanaandikwa kwenye ledger ya supplierStockMovement.'
                    : 'Every movement is appended to the supplierStockMovement ledger.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenPurchase}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer"
              >
                <ReceiptText className="w-3.5 h-3.5" aria-hidden="true" />
                {isSw ? 'Risiti ya Ununuzi' : 'Manual Purchase Receipt'}
              </button>
            </div>
            <form
              onSubmit={(e) => void handleStockIn(e)}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-4 items-end"
            >
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Bidhaa ya Ghala' : 'Warehouse Product'}
                </span>
                <select
                  required
                  value={stockForm.productId}
                  onChange={(e) => setStockForm((p) => ({ ...p, productId: e.target.value }))}
                  className="w-full min-h-[40px] px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                >
                  <option value="">{isSw ? 'Chagua bidhaa...' : 'Select product...'}</option>
                  {(inventory?.items ?? []).map((item) => (
                    <option key={item.productId} value={item.productId}>
                      {isSw ? item.nameSw : item.nameEn} ({item.smsItemCode})
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Quarter-Quanta' : 'Quarter-Quanta'}
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={stockForm.quantityQuanta}
                  onChange={(e) =>
                    setStockForm((p) => ({ ...p, quantityQuanta: e.target.value }))
                  }
                  className="w-full min-h-[40px] px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Aina ya Mabadiliko' : 'Movement Type'}
                </span>
                <select
                  value={stockForm.movementType}
                  onChange={(e) =>
                    setStockForm((p) => ({
                      ...p,
                      movementType: e.target.value as StockMovementType,
                    }))
                  }
                  className="w-full min-h-[40px] px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                >
                  <option value="WAREHOUSE_STOCK_IN">WAREHOUSE_STOCK_IN</option>
                  <option value="FACTORY_PRODUCTION">FACTORY_PRODUCTION</option>
                  <option value="STOCK_ADJUSTMENT">STOCK_ADJUSTMENT</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Rejea (hiari)' : 'Reference (optional)'}
                </span>
                <input
                  type="text"
                  maxLength={80}
                  value={stockForm.referenceId}
                  onChange={(e) =>
                    setStockForm((p) => ({ ...p, referenceId: e.target.value }))
                  }
                  placeholder="DN-2026-001"
                  className="w-full min-h-[40px] px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
                />
              </label>
              <button
                type="submit"
                className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer inline-flex items-center justify-center gap-1.5"
              >
                <PackagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isSw ? 'Hifadhi Stock-In' : 'Save Stock-In'}</span>
              </button>
              <label className="sm:col-span-2 lg:col-span-5 space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Maelezo (hiari)' : 'Note (optional)'}
                </span>
                <input
                  type="text"
                  maxLength={240}
                  value={stockForm.note}
                  onChange={(e) => setStockForm((p) => ({ ...p, note: e.target.value }))}
                  className="w-full min-h-[40px] px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                />
              </label>
            </form>
          </section>
        </div>
      )}

      {activeTab === 'publish' && (
        <div className="space-y-6">
          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Store className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                {isSw ? 'Sera ya Usafiri wa B2B' : 'Supplier B2B Delivery Policy'}
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                {isSw
                  ? 'Ikiwashwa, wateja wanaona usafiri wa bure kwenye duka lako na bei ya usafiri inakuwa TZS 0 kwenye oda mpya.'
                  : 'When enabled, buyers see free delivery on your storefront and new orders are quoted at TZS 0 delivery.'}
              </p>
            </div>
            <form
              onSubmit={(e) => void handleSaveDeliverySettings(e)}
              className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4"
            >
              <div className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Usafiri wa Bure' : 'Free Delivery'}
                </span>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span
                    role="status"
                    aria-live="polite"
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold uppercase tracking-wide whitespace-nowrap ${
                      deliveryLoading
                        ? 'bg-slate-50 border-slate-200 text-slate-600'
                        : deliveryForm.isFreeDeliveryEnabled
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-slate-100 border-slate-200 text-slate-600'
                    }`}
                  >
                    {deliveryLoading || deliverySaving ? (
                      <LoaderCircle className="w-3 h-3 animate-spin" aria-hidden="true" />
                    ) : (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          deliveryForm.isFreeDeliveryEnabled ? 'bg-emerald-600' : 'bg-slate-400'
                        }`}
                      />
                    )}
                    <span>
                      {deliveryLoading
                        ? isSw ? 'Inakagua hali...' : 'Checking status...'
                        : deliverySaving
                          ? isSw ? 'Inahifadhi...' : 'Saving...'
                          : deliveryForm.isFreeDeliveryEnabled
                            ? isSw ? 'IMEWASHWA' : 'ENABLED'
                            : isSw ? 'IMEZIMWA' : 'DISABLED'}
                    </span>
                  </span>
                  {deliveryPendingSync && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-800">
                      {isSw ? 'Inasubiri mtandao' : 'Queued for sync'}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-500">
                    {isSw
                      ? 'Hali hii inadhibitiwa kwenye Settings.'
                      : 'This status is managed in Settings.'}
                  </span>
                </div>
              </div>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Kiwango cha Chini cha Bure (TZS)' : 'Free Delivery Minimum (TZS)'}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={deliveryForm.freeDeliveryMinOrderTzs}
                  onChange={(e) =>
                    setDeliveryForm((p) => ({
                      ...p,
                      freeDeliveryMinOrderTzs: e.target.value,
                    }))
                  }
                  className="w-full min-h-[40px] px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Ada ya Kawaida (TZS)' : 'Standard Delivery Fee (TZS)'}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={deliveryForm.standardDeliveryFeeTzs}
                  onChange={(e) =>
                    setDeliveryForm((p) => ({
                      ...p,
                      standardDeliveryFeeTzs: e.target.value,
                    }))
                  }
                  className="w-full min-h-[40px] px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
                />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Mikoa Inayohudumiwa' : 'Coverage Regions'}
                </span>
                <input
                  type="text"
                  required
                  value={deliveryForm.deliveryCoverageRegions}
                  onChange={(e) =>
                    setDeliveryForm((p) => ({
                      ...p,
                      deliveryCoverageRegions: e.target.value,
                    }))
                  }
                  placeholder="Dar es Salaam, Pwani"
                  className="w-full min-h-[40px] px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                />
              </label>
              <div className="sm:col-span-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <span className="text-[11px] text-slate-500">
                  {!deliveryLoading && !deliveryForm.isFreeDeliveryEnabled
                    ? isSw
                      ? 'Washa Free Delivery kwenye Settings ili uhariri sera.'
                      : 'Enable Free Delivery in Settings to edit the policy.'
                    : formatDeliveryPolicy(deliverySettings?.policy, isSw)}
                </span>
                <button
                  type="submit"
                  disabled={deliveryLoading || deliverySaving || !deliveryForm.isFreeDeliveryEnabled}
                  title={
                    !deliveryForm.isFreeDeliveryEnabled
                      ? isSw
                        ? 'Free Delivery imezimwa kwenye Settings.'
                        : 'Free Delivery is disabled in Settings.'
                      : undefined
                  }
                  className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  {deliverySaving && <LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                  {isSw ? 'Hifadhi Sera' : 'Save Policy'}
                </button>
              </div>
            </form>
          </section>

          <section className="border border-emerald-200 bg-emerald-50/40 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-emerald-200">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <PackagePlus className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                {isSw ? 'Peleka Orodha ya Jumla Sokoni' : 'Publish Bulk Listing to Sokoni'}
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                {isSw
                  ? 'Bei ya jumla na MOQ vinathibitishwa na server wakati wa kuweka oda.'
                  : 'Bulk price and MOQ are revalidated server-side at order placement.'}
              </p>
            </div>
            <form
              onSubmit={(e) => void handlePublishListing(e)}
              className="p-5 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Bidhaa ya Ghala' : 'Warehouse Product'}
                  </span>
                  <select
                    required
                    value={publishForm.globalCatalogId}
                    onChange={(e) => {
                      const nextItem = inventory?.items.find(
                        (item) => item.globalCatalogId === e.target.value
                      );
                      setPublishForm((p) => ({
                        ...p,
                        globalCatalogId: e.target.value,
                        systemUnitId: nextItem?.unitConversions[0]?.systemUnitId ?? '',
                      }));
                    }}
                    className="w-full min-h-[40px] px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                  >
                    <option value="">{isSw ? 'Chagua bidhaa...' : 'Select product...'}</option>
                    {(inventory?.items ?? [])
                      .filter((item) => item.globalCatalogId)
                      .map((item) => (
                        <option key={item.productId} value={item.globalCatalogId ?? ''}>
                          {isSw ? item.nameSw : item.nameEn} ({item.canonicalSku})
                        </option>
                      ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Kitengo cha Mfumo' : 'System Unit'}
                  </span>
                  <select
                    required
                    value={publishForm.systemUnitId}
                    onChange={(e) =>
                      setPublishForm((p) => ({ ...p, systemUnitId: e.target.value }))
                    }
                    className="w-full min-h-[40px] px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                  >
                    <option value="">{isSw ? 'Chagua kitengo...' : 'Select unit...'}</option>
                    {(publishItem?.unitConversions ?? []).map((unit) => (
                      <option key={unit.systemUnitId} value={unit.systemUnitId}>
                        {unit.abbreviation} · {unit.quarterQuantaPerUnit} quanta
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Bei ya Jumla (TZS)' : 'Bulk Price (TZS)'}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={publishForm.supplierBulkPriceTzs}
                    onChange={(e) =>
                      setPublishForm((p) => ({
                        ...p,
                        supplierBulkPriceTzs: e.target.value,
                      }))
                    }
                    placeholder="132000"
                    className="w-full min-h-[40px] px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'MOQ (vitengo)' : 'MOQ (units)'}
                  </span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={publishForm.minOrderQuantity}
                    onChange={(e) =>
                      setPublishForm((p) => ({
                        ...p,
                        minOrderQuantity: e.target.value,
                      }))
                    }
                    className="w-full min-h-[40px] px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
                  />
                </label>
              </div>

              <ImageKitUpload
                locale={locale}
                label={isSw ? 'Picha ya Orodha ya Soko' : 'Market Listing Image'}
                folder="/sokokuu/supplier-listings"
                value={publishForm.imagekitCdnUrl}
                onChange={(url) =>
                  setPublishForm((p) => ({ ...p, imagekitCdnUrl: url }))
                }
              />

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={publishForm.isPublishedToMarket}
                    onChange={(e) =>
                      setPublishForm((p) => ({
                        ...p,
                        isPublishedToMarket: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 accent-emerald-600"
                  />
                  {isSw ? 'Ionekane kwenye soko la wauzaji wa jumla' : 'Visible on the wholesaler marketplace'}
                </label>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isSw ? 'Peleka Sokoni' : 'Publish to Market'}</span>
                </button>
              </div>
            </form>
          </section>

          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                {isSw ? 'Orodha Zilizochapishwa' : 'Published Marketplace Listings'}
              </h2>
            </div>
            {listings.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">
                {loading
                  ? isSw ? 'Inapakia orodha...' : 'Loading listings...'
                  : isSw
                    ? 'Hakuna orodha zilizochapishwa bado.'
                    : 'No published listings yet.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {listings.map((listing) => (
                  <div
                    key={listing.listingId}
                    className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div className="min-w-0 space-y-0.5 flex items-center gap-2.5">
                      {listing.imagekitCdnUrl && (
                        <img
                          src={listing.imagekitCdnUrl}
                          alt={isSw ? listing.nameSw : listing.nameEn}
                          referrerPolicy="no-referrer"
                          className="w-9 h-9 rounded-md object-cover border border-slate-200 bg-white shrink-0"
                        />
                      )}
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-xs font-semibold text-slate-900">
                          {isSw ? listing.nameSw : listing.nameEn}{' '}
                          <span className="font-mono text-slate-500">({listing.canonicalSku})</span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {listing.systemUnitCode} · {listing.quarterQuantaPerUnit} quanta · MOQ{' '}
                          {listing.minOrderQuantity} · {listing.systemUnitId}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="font-mono font-bold text-emerald-800">
                        TZS {formatTzs(listing.supplierBulkPriceTzs)}
                      </span>
                      <span
                        className={`px-2 py-1 rounded-md font-mono text-[10px] font-semibold ${
                          listing.isAvailable
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {listing.isAvailable
                          ? isSw ? 'INAPATIKANA' : 'AVAILABLE'
                          : isSw ? 'HAIPATIKANI' : 'OUT OF STOCK'}
                      </span>
                      {listing.isFreeDeliveryEnabled && (
                        <span className="px-2 py-1 rounded-md bg-emerald-600 text-white font-mono text-[10px] font-semibold inline-flex items-center gap-1">
                          <Truck className="w-3 h-3" aria-hidden="true" />
                          FREE DELIVERY
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Copy className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  {isSw
                    ? 'Tumia Bidhaa za Orodha Rasmi (Clone / Reuse)'
                    : 'Reuse the Standard Catalog (Clone)'}
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  {isSw
                    ? 'Majina, kategoria na picha zinatoka kwenye orodha rasmi; ghala lako linaanza na quanta 0.'
                    : 'Names, category and imagery come from the immutable catalog; your warehouse starts at 0 quanta.'}
                </p>
              </div>
              <label className="relative">
                <Search
                  className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder={isSw ? 'Tafuta SKU au bidhaa...' : 'Search SKU or product...'}
                  className="min-h-[40px] w-56 pl-8 pr-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                />
              </label>
            </div>
            {filteredStandardCatalog.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">
                {loading
                  ? isSw ? 'Inapakia orodha rasmi...' : 'Loading standard catalog...'
                  : isSw
                    ? 'Hakuna bidhaa zinazolingana na utafutaji.'
                    : 'No standard catalog items match your search.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-5">
                {filteredStandardCatalog.map((entry) => (
                  <div
                    key={entry.id}
                    className="border border-slate-200 rounded-lg p-3 flex items-start gap-3 bg-slate-50/40"
                  >
                    <img
                      src={entry.imagekitCdnUrl || entry.staticImageUrl || undefined}
                      alt={isSw ? entry.fixedNameSw : entry.fixedNameEn}
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-md object-cover border border-slate-200 bg-white shrink-0"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {isSw ? entry.fixedNameSw : entry.fixedNameEn}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 truncate">
                        {entry.canonicalSku} · {formatCodeWithoutUnderscores(entry.categoryCode)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {isSw ? 'Imenakiliwa na' : 'Adopted by'} {entry.clonedByStoresCount}{' '}
                        {isSw ? 'maduka' : 'stores'}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCloneStandardCatalog(entry)}
                        disabled={cloningCatalogId === entry.id}
                        className="inline-flex items-center gap-1.5 min-h-[32px] px-2.5 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {cloningCatalogId === entry.id ? (
                          <LoaderCircle className="w-3 h-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <Copy className="w-3 h-3" aria-hidden="true" />
                        )}
                        {isSw ? 'Nakili kwenye Ghala' : 'Clone to Warehouse'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="space-y-6">
          {dispatchNotice && (
            <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-2.5">
                <KeyRound className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-slate-900">
                    {isSw
                      ? `Oda #${dispatchNotice.orderRef} Imetumwa kwa Dereva`
                      : `Order #${dispatchNotice.orderRef} Dispatched with Dual-PIN`}
                  </div>
                  <div className="font-mono flex flex-wrap gap-3">
                    <span>Buyer PIN: <strong>{dispatchNotice.buyerPin}</strong></span>
                    <span>Driver PIN: <strong>{dispatchNotice.driverPin}</strong></span>
                    <span>CoD: <strong>TZS {dispatchNotice.totalTzs}</strong></span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDispatchNotice(null)}
                className="text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                {isSw ? 'Oda Zinazoingia kutoka kwa Wauzaji wa Jumla' : 'Incoming Wholesaler B2B Orders'}
              </h2>
              <span className="text-xs font-mono font-semibold text-emerald-800">
                {orders.length} {isSw ? 'oda' : 'orders'}
              </span>
            </div>

            {orders.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">
                {loading
                  ? isSw ? 'Inapakia oda...' : 'Loading incoming orders...'
                  : isSw
                    ? 'Hakuna oda za B2B zilizowekwa bado.'
                    : 'No supplier B2B orders have been placed yet.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {orders.map((order) => (
                  <div
                    key={order.orderId}
                    data-order-ref={order.orderRef}
                    data-order-id={order.orderId}
                    className="px-5 py-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1 text-xs">
                        <div className="font-semibold text-slate-900">
                          <span className="font-mono">{order.orderRef}</span> ·{' '}
                          {order.buyer.fullName}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {isSw ? 'Mnunuzi' : 'Recipient'}: {order.buyer.phoneE164} ·{' '}
                          {isSw ? 'Supplier' : 'Seller'}: {sellerPhone ?? '—'}
                        </div>
                        <div className="text-[11px] text-slate-600">
                          {order.items
                            .map((item) => `${item.nameSw} × ${item.quantity} (${item.quarterQuanta} quanta)`)
                            .join(' + ')}
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <div className="font-mono font-bold text-emerald-800 text-sm">
                          TZS {formatTzs(order.expectedTotalTzs)}
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <span
                            className={`px-2 py-1 rounded-md font-mono text-[10px] font-semibold ${
                              order.status === 'DISPATCHED'
                                ? 'bg-amber-100 text-amber-900'
                                : order.status === 'DELIVERED'
                                  ? 'bg-emerald-100 text-emerald-900'
                                  : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {order.status}
                          </span>
                          {order.status === 'DISPATCHED' && (
                            <span className="px-2 py-1 rounded-md bg-amber-500 text-white font-mono text-[10px] font-bold">
                              IN TRANSIT
                            </span>
                          )}
                          {order.isFreeDeliveryApplied && (
                            <span className="px-2 py-1 rounded-md bg-emerald-600 text-white font-mono text-[10px] font-bold inline-flex items-center gap-1">
                              <Truck className="w-3 h-3" aria-hidden="true" />
                              FREE DELIVERY
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                      {order.driver && (
                        <span className="text-[11px] font-mono text-slate-600">
                          {isSw ? 'Dereva' : 'Driver'}: {order.driver.fullName} (
                          {order.driver.phoneE164})
                        </span>
                      )}
                      {order.dualPinStatus && (
                        <span className="text-[10px] font-mono text-slate-500">
                          DUAL-PIN: {order.dualPinStatus.verificationStatus} · B{' '}
                          {order.dualPinStatus.isBuyerConfirmed ? '✓' : '·'} / D{' '}
                          {order.dualPinStatus.isDriverConfirmed ? '✓' : '·'}
                        </span>
                      )}
                      {order.status === 'PLACED' && (
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                          <select
                            aria-label={isSw ? 'Chagua dereva' : 'Select driver'}
                            value={selectedDriverByOrder[order.orderId] ?? ''}
                            onChange={(e) =>
                              setSelectedDriverByOrder((prev) => ({
                                ...prev,
                                [order.orderId]: e.target.value,
                              }))
                            }
                            className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                          >
                            <option value="">{isSw ? 'Chagua dereva...' : 'Select driver...'}</option>
                            {drivers.map((driver) => (
                              <option key={driver.driverUserId} value={driver.driverUserId}>
                                {driver.driverName} ({driver.phoneE164})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={dispatchingOrderId === order.orderId}
                            onClick={() => void handleDispatchOrder(order)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer disabled:opacity-60"
                          >
                            {dispatchingOrderId === order.orderId ? (
                              <LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Send className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            <span>
                              {isSw ? 'Tuma kwa Dereva & Toa PIN' : 'Dispatch & Issue Dual-PIN'}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="space-y-6">
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                <Banknote className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                {isSw ? 'Mapato ya B2B (TZS)' : 'B2B Revenue (TZS)'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {formatTzs(report?.totalB2bRevenueTzs ?? 0)}
              </div>
            </div>
            <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Oda Zilizotimizwa' : 'Orders Fulfilled'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-800">
                {report?.totalOrdersFulfilled ?? 0}
              </div>
            </div>
            <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Zinazosubiri Usafirishaji' : 'Pending Dispatch'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {report?.pendingDispatchCount ?? 0}
              </div>
            </div>
            <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Oda za Usafiri wa Bure' : 'Free-Delivery Orders'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {report?.freeDeliveryOrdersSponsored ?? 0}
              </div>
            </div>
          </section>

          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-900">
                  {isSw ? 'Bidhaa Zinazouzwa Zaidi' : 'Top Selling Warehouse Products'}
                </h2>
                <p className="text-xs text-slate-500">{report?.supplierName ?? '—'}</p>
              </div>
              <button
                type="button"
                onClick={() => void handleDownloadCsv()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isSw ? 'Pakua Ripoti (CSV)' : 'Export Swahili CSV'}</span>
              </button>
            </div>
            {(report?.topProducts.length ?? 0) === 0 ? (
              <div className="p-6 text-xs text-slate-500">
                {isSw
                  ? 'Hakuna mauzo yaliyotimizwa bado.'
                  : 'No fulfilled B2B sales recorded yet.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                      <th className="py-3 px-4">{isSw ? 'Bidhaa' : 'Product'}</th>
                      <th className="py-3 px-4 text-right">{isSw ? 'Vitengo' : 'Units'}</th>
                      <th className="py-3 px-4 text-right">Quanta</th>
                      <th className="py-3 px-4 text-right">{isSw ? 'Mapato (TZS)' : 'Revenue (TZS)'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(report?.topProducts ?? []).map((product) => (
                      <tr key={product.productId} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {isSw ? product.nameSw : product.nameEn}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          {formatTzs(product.quantity)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          {formatTzs(product.quanta)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold tabular-nums text-emerald-800">
                          {formatTzs(product.revenueTzs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {purchaseOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={isSw ? 'Risiti ya Ununuzi wa Supplier' : 'Supplier Manual Purchase Receipt'}
        >
          <div className="w-full sm:max-w-2xl bg-white rounded-t-xl sm:rounded-xl shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <ReceiptText className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  {isSw ? 'Rekodi Risiti ya Ununuzi' : 'Record Manual Purchase Receipt'}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {isSw
                    ? 'Gharama imehifadhiwa kwenye PostgreSQL na wastani wa gharama unasasishwa.'
                    : 'Cost is persisted in PostgreSQL and the weighted average is recalculated.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPurchaseOpen(false)}
                className="text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={(e) => void handleRecordPurchase(e)} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Bidhaa ya Ghala' : 'Warehouse Product'}
                  </span>
                  <select
                    required
                    value={purchaseForm.productId}
                    onChange={(e) => {
                      const item = inventory?.items.find(
                        (entry) => entry.productId === e.target.value
                      );
                      setPurchaseForm((p) => ({
                        ...p,
                        productId: e.target.value,
                        globalProductUnitId: item?.unitConversions[0]?.globalProductUnitId ?? '',
                        quarterQuantaPerUnit: String(
                          item?.unitConversions[0]?.quarterQuantaPerUnit ?? ''
                        ),
                      }));
                    }}
                    className="w-full min-h-[40px] px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                  >
                    <option value="">{isSw ? 'Chagua bidhaa...' : 'Select product...'}</option>
                    {(inventory?.items ?? []).map((item) => (
                      <option key={item.productId} value={item.productId}>
                        {isSw ? item.nameSw : item.nameEn} ({item.smsItemCode})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Msambizaji / Kianda' : 'Supplier / Factory'}
                  </span>
                  <input
                    type="text"
                    required
                    maxLength={180}
                    value={purchaseForm.supplierName}
                    onChange={(e) =>
                      setPurchaseForm((p) => ({ ...p, supplierName: e.target.value }))
                    }
                    className="w-full min-h-[40px] px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Rejea (hiari)' : 'Reference (optional)'}
                  </span>
                  <input
                    type="text"
                    maxLength={80}
                    value={purchaseForm.supplierReference}
                    onChange={(e) =>
                      setPurchaseForm((p) => ({ ...p, supplierReference: e.target.value }))
                    }
                    placeholder="INV-2281"
                    className="w-full min-h-[40px] px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Hali ya Risiti' : 'Receipt Status'}
                  </span>
                  <select
                    value={purchaseForm.receiptStatus}
                    onChange={(e) =>
                      setPurchaseForm((p) => ({
                        ...p,
                        receiptStatus: e.target.value as 'GOODS_RECEIVED' | 'ORDER_CONFIRMED',
                      }))
                    }
                    className="w-full min-h-[40px] px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                  >
                    <option value="GOODS_RECEIVED">
                      {isSw ? 'Bidhaa Zimefika' : 'Goods Received'}
                    </option>
                    <option value="ORDER_CONFIRMED">
                      {isSw ? 'Oda Imeidhinishwa' : 'Order Confirmed'}
                    </option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Kitengo cha Mfumo' : 'System Unit'}
                  </span>
                  <select
                    value={purchaseForm.globalProductUnitId}
                    onChange={(e) => {
                      const unit = purchaseProduct?.unitConversions.find(
                        (entry) => entry.globalProductUnitId === e.target.value
                      );
                      setPurchaseForm((p) => ({
                        ...p,
                        globalProductUnitId: e.target.value,
                        quarterQuantaPerUnit: String(unit?.quarterQuantaPerUnit ?? ''),
                      }));
                    }}
                    className="w-full min-h-[40px] px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                  >
                    <option value="">{isSw ? 'Chagua kitengo...' : 'Select unit...'}</option>
                    {(purchaseProduct?.unitConversions ?? []).map((unit) => (
                      <option key={unit.globalProductUnitId} value={unit.globalProductUnitId}>
                        {unit.abbreviation} · {unit.quarterQuantaPerUnit} quanta
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Quanta kwa Kitengo' : 'Quanta per Unit'}
                  </span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    required={!purchaseForm.globalProductUnitId}
                    disabled={Boolean(purchaseForm.globalProductUnitId)}
                    value={purchaseForm.quarterQuantaPerUnit}
                    onChange={(e) =>
                      setPurchaseForm((p) => ({
                        ...p,
                        quarterQuantaPerUnit: e.target.value,
                      }))
                    }
                    className="w-full min-h-[40px] px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 disabled:bg-slate-50"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Idadi ya Vitengo' : 'Quantity (units)'}
                  </span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={purchaseForm.quantityUnits}
                    onChange={(e) =>
                      setPurchaseForm((p) => ({ ...p, quantityUnits: e.target.value }))
                    }
                    className="w-full min-h-[40px] px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Gharama Iliyokubaliwa (TZS)' : 'Agreed Total Cost (TZS)'}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={purchaseForm.agreedTotalCostTzs}
                    onChange={(e) =>
                      setPurchaseForm((p) => ({
                        ...p,
                        agreedTotalCostTzs: e.target.value,
                      }))
                    }
                    className="w-full min-h-[40px] px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
                  />
                </label>
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Maelezo (hiari)' : 'Note (optional)'}
                  </span>
                  <input
                    type="text"
                    maxLength={240}
                    value={purchaseForm.note}
                    onChange={(e) => setPurchaseForm((p) => ({ ...p, note: e.target.value }))}
                    className="w-full min-h-[40px] px-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                  />
                </label>
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setPurchaseOpen(false)}
                  className="min-h-[40px] px-4 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md cursor-pointer"
                >
                  {isSw ? 'Funga' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={purchaseSaving}
                  className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {purchaseSaving && (
                    <LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  )}
                  {isSw ? 'Hifadhi Risiti' : 'Save Purchase Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
