import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  KeyRound,
  Minus,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  Tag,
  Truck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { t, type Locale } from '../i18n';
import { useDataSaver } from '../context/DataSaverContext';
import { listQueuedOrders } from '../lib/indexedDbDemo';
import { formatOrderStatusLabel } from '../lib/sokoManagedState';
import { resolveBackendImageUrl } from '../lib/sokoProductImage';
import {
  categoryFromSystemUnitCode,
  formatQuantaMeasurement,
  formatSystemUnitLabel,
} from '../utils/formatProductUnit';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';
import { IsolatedQrVerificationTerminal } from './IsolatedQrVerificationTerminal';
import {
  SokoniOrderDiscoveryView,
  type SokoniSelectionItem,
} from './SokoniOrderDiscoveryView';

export type SokoniSubView = 'BUY' | 'SELL' | 'ORDERS';
type ActiveStage = 'BROWSE' | 'DISCOVERY' | 'PIN_TERMINAL';

interface CatalogCategoryDto {
  id: string;
  categoryCode: string;
  nameSw: string;
  nameEn: string;
  imagekitFolderPath?: string;
  isActive: boolean;
}

interface GlobalProductUnitDto {
  id: string;
  systemUnitId: string;
  quarterQuantaPerUnit: number;
  displayLabelSw: string | null;
  displayLabelEn: string | null;
  isWholesaleUnit: boolean;
  systemUnit: {
    id: string;
    unitCode: string;
    nameSw: string;
    nameEn: string;
    abbreviation: string;
    category: string;
  };
}

interface GlobalStandardPriceDto {
  id: string;
  globalProductUnitId: string;
  profileType: string;
  minQty: number;
  maxQty: number | null;
  standardPriceTzs: number;
}

interface GlobalCatalogItemDto {
  id: string;
  canonicalSku: string;
  categoryCode: string;
  fixedNameSw: string;
  fixedNameEn: string;
  imagekitCdnUrl?: string | null;
  staticImageUrl?: string | null;
  baseQuantumUnit: string;
  clonedByStoresCount: number;
  productUnits?: GlobalProductUnitDto[];
  standardPrices?: GlobalStandardPriceDto[];
}

interface MerchantShelfProductDto {
  productId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitPriceTzs: number;
  cartonPriceTzs: number;
  availableQuarterQuanta: number;
  sealedBulkPackagesStock: number;
  quantaPerSealedPackage: number;
  isPublishedToMarket?: boolean;
}

interface SupplierInventoryItemDto {
  productId: string;
  smsItemCode: string;
  nameSw: string;
  nameEn: string;
  globalCatalogId: string | null;
  canonicalSku: string | null;
  availableQuantaStock: number;
  unitConversions: Array<{
    globalProductUnitId: string;
    systemUnitId: string;
    unitCode: string;
    nameSw: string;
    nameEn: string;
    quarterQuantaPerUnit: number;
    displayLabelSw: string | null;
    displayLabelEn: string | null;
  }>;
}

interface SupplierDeliverySettingsDto {
  isFreeDeliveryEnabled: boolean;
  freeDeliveryMinOrderTzs: string;
  standardDeliveryFeeTzs: string;
  deliveryCoverageRegions: string[];
}

interface BuyingOrderDto {
  orderId: string;
  orderRef: string;
  sellerBusinessId: string;
  sellerBusinessName: string;
  expectedTotalTzs: number;
  deliveryFeeTzs: number;
  status: 'PLACED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED' | 'DISPUTED';
  orderMode?: 'INSTANT' | 'SCHEDULED';
  scheduledDeliveryDate?: string | null;
  placedAt: string;
  items: Array<{
    sku?: string;
    smsItemCode?: string;
    nameSw?: string;
    nameEn?: string;
    unitType: string;
    quantity: number;
    baseUnitsTotal: number;
  }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}

function formatUnitOptionLabel(unit: GlobalProductUnitDto, isSw: boolean): string {
  const custom = isSw ? unit.displayLabelSw : unit.displayLabelEn;
  if (custom && custom.trim().length > 0) return custom;
  const code = unit.systemUnit?.unitCode ?? 'UNIT';
  const cat = categoryFromSystemUnitCode(code);
  const baseName = isSw
    ? unit.systemUnit?.nameSw || formatSystemUnitLabel(code, unit.quarterQuantaPerUnit, 'sw')
    : unit.systemUnit?.nameEn || formatSystemUnitLabel(code, unit.quarterQuantaPerUnit, 'en');
  if (cat === 'PACKAGING') {
    return baseName;
  }
  return `${baseName} (${formatQuantaMeasurement(unit.quarterQuantaPerUnit, cat, isSw ? 'sw' : 'en')})`;
}

export function SokoniCoreEngine({
  locale = 'sw',
  userRole = 'RETAILER',
  userTier = null,
  businessId = null,
  initialView = 'BUY',
  onBackToDashboard,
  initialGlobalCatalogId = null,
  onClearInitialCatalogFilter,
}: {
  locale?: Locale;
  userRole?: 'RETAILER' | 'WHOLESALER' | 'SUPPLIER' | 'CONSUMER';
  userTier?: string | null;
  businessId?: string | null;
  initialView?: SokoniSubView;
  onBackToDashboard?: () => void;
  initialGlobalCatalogId?: string | null;
  onClearInitialCatalogFilter?: () => void;
}) {
  const isSw = locale === 'sw';
  const isMerchantSeller =
    userRole === 'RETAILER' || userRole === 'WHOLESALER' || userRole === 'SUPPLIER';
  const { isLowDataModeActive } = useDataSaver();

  const [subView, setSubView] = useState<SokoniSubView>(
    initialView === 'SELL' && !isMerchantSeller ? 'BUY' : initialView,
  );
  const [stage, setStage] = useState<ActiveStage>('BROWSE');

  useEffect(() => {
    setSubView(initialView === 'SELL' && !isMerchantSeller ? 'BUY' : initialView);
    setStage('BROWSE');
  }, [initialView, isMerchantSeller]);

  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [queuedOfflineCount, setQueuedOfflineCount] = useState<number>(0);

  // Screen 2 — Nunua Sokoni state
  const [categories, setCategories] = useState<CatalogCategoryDto[]>([]);
  const [selectedCategoryCodes, setSelectedCategoryCodes] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [catalogItems, setCatalogItems] = useState<GlobalCatalogItemDto[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(true);
  const [selectedQtyByCatalogId, setSelectedQtyByCatalogId] = useState<Record<string, number>>({});
  const [selectedUnitByCatalogId, setSelectedUnitByCatalogId] = useState<
    Record<string, string>
  >({});

  // Orders & PIN state
  const [orders, setOrders] = useState<BuyingOrderDto[]>([]);
  const [loadingOrders, setLoadingOrders] = useState<boolean>(false);
  const [activePinOrderId, setActivePinOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialGlobalCatalogId) return;
    setSubView('BUY');
    setStage('BROWSE');
    setSelectedQtyByCatalogId((prev) =>
      prev[initialGlobalCatalogId] ? prev : { ...prev, [initialGlobalCatalogId]: 1 },
    );
    onClearInitialCatalogFilter?.();
  }, [initialGlobalCatalogId, onClearInitialCatalogFilter]);

  // Uza Sokoni (Merchant / Supplier Sell state)
  const [sellLoading, setSellLoading] = useState<boolean>(false);
  const [offersFreeDelivery, setOffersFreeDelivery] = useState<boolean>(false);
  const [savingFreeDelivery, setSavingFreeDelivery] = useState<boolean>(false);
  const [merchantProducts, setMerchantProducts] = useState<MerchantShelfProductDto[]>([]);
  const [publishQtyByProductId, setPublishQtyByProductId] = useState<Record<string, number>>({});
  const [publishingStock, setPublishingStock] = useState<boolean>(false);

  // Supplier Uza Sokoni state
  const [supplierDelivery, setSupplierDelivery] = useState<SupplierDeliverySettingsDto | null>(
    null,
  );
  const [supplierItems, setSupplierItems] = useState<SupplierInventoryItemDto[]>([]);
  const [supplierPublishTarget, setSupplierPublishTarget] = useState<{
    globalCatalogId: string;
    systemUnitId: string;
    bulkPriceTzs: string;
    minOrderQty: string;
  }>({
    globalCatalogId: '',
    systemUnitId: '',
    bulkPriceTzs: '',
    minOrderQty: '1',
  });

  const refreshQueueCount = useCallback(async () => {
    const q = await listQueuedOrders().catch(() => []);
    setQueuedOfflineCount(q.filter((o) => o.syncStatus === 'QUEUED_OFFLINE').length);
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res = await SokoApiClient.get<CatalogCategoryDto[]>(
        '/admin/marketplace/catalog/categories',
      );
      setCategories(Array.isArray(res) ? res.filter((c) => c.isActive !== false) : []);
    } catch {
      // Categories list can remain empty if backend is offline
    }
  }, []);

  const loadStandardCatalog = useCallback(async () => {
    await refreshQueueCount();
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      setBackendOffline(true);
      setLoadingCatalog(false);
      return;
    }

    setLoadingCatalog(true);
    setBackendOffline(false);
    setApiError(null);

    try {
      const params = new URLSearchParams();
      if (selectedCategoryCodes.length > 0) {
        params.set('categoryCodes', selectedCategoryCodes.join(','));
      }
      if (searchQuery.trim().length > 0) {
        params.set('q', searchQuery.trim());
      }
      const query = params.toString();
      const rows = await SokoApiClient.get<GlobalCatalogItemDto[]>(
        `/marketplace/catalog${query ? `?${query}` : ''}`,
      );
      setCatalogItems(Array.isArray(rows) ? rows : []);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia orodha ya bidhaa za Sokoni.'
              : 'Failed to load Sokoni standard catalog.',
        );
      }
    } finally {
      setLoadingCatalog(false);
    }
  }, [isSw, refreshQueueCount, searchQuery, selectedCategoryCodes]);

  const loadOrders = useCallback(async () => {
    if (!SokoApiClient.hasAccessToken()) {
      setOrders([]);
      return;
    }
    setLoadingOrders(true);
    try {
      const res = await SokoApiClient.get<{ orders?: BuyingOrderDto[] }>(
        '/orders/my-orders?scope=buying',
      );
      setOrders(Array.isArray(res?.orders) ? res.orders : []);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      }
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  const loadSellData = useCallback(async () => {
    if (!isMerchantSeller || !SokoApiClient.hasAccessToken()) return;
    setSellLoading(true);
    setApiError(null);
    setBackendOffline(false);
    try {
      if (userRole === 'SUPPLIER') {
        const [deliveryRes, invRes] = await Promise.all([
          SokoApiClient.get<SupplierDeliverySettingsDto>('/supplier/delivery-settings'),
          SokoApiClient.get<{ items?: SupplierInventoryItemDto[] }>('/supplier/inventory'),
        ]);
        setSupplierDelivery(deliveryRes);
        setOffersFreeDelivery(Boolean(deliveryRes.isFreeDeliveryEnabled));
        const items = Array.isArray(invRes?.items) ? invRes.items : [];
        setSupplierItems(items);
        const firstCatalogItem = items.find(
          (i) => i.globalCatalogId && i.unitConversions && i.unitConversions.length > 0,
        );
        if (firstCatalogItem && !supplierPublishTarget.globalCatalogId) {
          setSupplierPublishTarget((prev) => ({
            ...prev,
            globalCatalogId: firstCatalogItem.globalCatalogId ?? '',
            systemUnitId: firstCatalogItem.unitConversions[0]?.systemUnitId ?? '',
          }));
        }
      } else {
        const bizQuery = isUuid(businessId)
          ? `?businessId=${encodeURIComponent(businessId)}`
          : '';
        const [settingsRes, productsRes] = await Promise.all([
          SokoApiClient.get<{ offersFreeDelivery: boolean }>(
            `/merchant/market-settings${bizQuery}`,
          ),
          SokoApiClient.get<MerchantShelfProductDto[]>(`/products/active${bizQuery}`),
        ]);
        setOffersFreeDelivery(Boolean(settingsRes?.offersFreeDelivery));
        setMerchantProducts(Array.isArray(productsRes) ? productsRes : []);
      }
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia mipangilio ya kuuza sokoni.'
              : 'Failed to load Uza Sokoni seller workspace.',
        );
      }
    } finally {
      setSellLoading(false);
    }
  }, [businessId, isMerchantSeller, isSw, supplierPublishTarget.globalCatalogId, userRole]);

  useEffect(() => {
    void loadCategories();
    void loadOrders();
  }, [loadCategories, loadOrders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStandardCatalog();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loadStandardCatalog]);

  useEffect(() => {
    if (subView === 'SELL') {
      void loadSellData();
    } else if (subView === 'ORDERS') {
      void loadOrders();
    }
  }, [loadOrders, loadSellData, subView]);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      void loadStandardCatalog();
      void loadOrders();
    };
    const goOffline = () => {
      setIsOnline(false);
      setBackendOffline(true);
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [loadOrders, loadStandardCatalog]);

  const toggleCategory = (code: string) => {
    setSelectedCategoryCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const getActiveUnitForItem = useCallback(
    (item: GlobalCatalogItemDto): GlobalProductUnitDto | null => {
      const units = item.productUnits ?? [];
      if (units.length === 0) return null;
      const chosenId = selectedUnitByCatalogId[item.id];
      if (chosenId) {
        const match = units.find((u) => u.systemUnitId === chosenId);
        if (match) return match;
      }
      const prefersWholesale = userRole === 'WHOLESALER' || userRole === 'RETAILER';
      if (prefersWholesale) {
        return units.find((u) => u.isWholesaleUnit) ?? units[units.length - 1] ?? units[0];
      }
      return units[0];
    },
    [selectedUnitByCatalogId, userRole],
  );

  const adjustItemQty = (catalogId: string, delta: 1 | -1) => {
    setSelectedQtyByCatalogId((prev) => {
      const next = Math.max(0, Math.min(999, (prev[catalogId] ?? 0) + delta));
      if (next === 0) {
        const copy = { ...prev };
        delete copy[catalogId];
        return copy;
      }
      return { ...prev, [catalogId]: next };
    });
  };

  // Cache item snapshots so category switches preserve chosen items seamlessly
  const [selectedSnapshots, setSelectedSnapshots] = useState<Record<string, GlobalCatalogItemDto>>(
    {},
  );
  useEffect(() => {
    setSelectedSnapshots((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of catalogItems) {
        if (selectedQtyByCatalogId[item.id] && next[item.id] !== item) {
          next[item.id] = item;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [catalogItems, selectedQtyByCatalogId]);

  const selectedItemsForDiscovery: SokoniSelectionItem[] = useMemo(() => {
    const out: SokoniSelectionItem[] = [];
    for (const [catalogId, qty] of Object.entries(selectedQtyByCatalogId)) {
      if (qty <= 0) continue;
      const item = catalogItems.find((i) => i.id === catalogId) ?? selectedSnapshots[catalogId];
      if (!item) continue;
      const unit = getActiveUnitForItem(item);
      out.push({
        globalCatalogId: item.id,
        canonicalSku: item.canonicalSku,
        fixedNameSw: item.fixedNameSw,
        fixedNameEn: item.fixedNameEn,
        imageUrl: resolveBackendImageUrl(item.imagekitCdnUrl, item.staticImageUrl),
        ...(unit ? { systemUnitId: unit.systemUnitId } : {}),
        unitLabelSw: unit ? formatUnitOptionLabel(unit, true) : item.baseQuantumUnit,
        unitLabelEn: unit ? formatUnitOptionLabel(unit, false) : item.baseQuantumUnit,
        quantity: qty,
      });
    }
    return out;
  }, [catalogItems, getActiveUnitForItem, selectedQtyByCatalogId, selectedSnapshots]);

  const totalSelectedUnits = useMemo(
    () => Object.values(selectedQtyByCatalogId).reduce((sum, q) => sum + (q > 0 ? q : 0), 0),
    [selectedQtyByCatalogId],
  );

  const handleToggleFreeDelivery = async () => {
    setApiError(null);
    setStatusNotice(null);
    setSavingFreeDelivery(true);
    try {
      if (userRole === 'SUPPLIER') {
        if (!supplierDelivery) return;
        const res = await SokoApiClient.patch<SupplierDeliverySettingsDto>(
          '/supplier/delivery-settings',
          {
            isFreeDeliveryEnabled: !offersFreeDelivery,
            freeDeliveryMinOrderTzs: supplierDelivery.freeDeliveryMinOrderTzs,
            standardDeliveryFeeTzs: supplierDelivery.standardDeliveryFeeTzs,
            deliveryCoverageRegions: supplierDelivery.deliveryCoverageRegions,
          },
        );
        setSupplierDelivery(res);
        setOffersFreeDelivery(Boolean(res.isFreeDeliveryEnabled));
      } else {
        const res = await SokoApiClient.patch<{ offersFreeDelivery: boolean }>(
          '/merchant/market-settings/free-delivery',
          { offersFreeDelivery: !offersFreeDelivery },
        );
        setOffersFreeDelivery(Boolean(res.offersFreeDelivery));
      }
      window.dispatchEvent(new CustomEvent('sokokuu:free-delivery-updated'));
      setStatusNotice(
        isSw
          ? 'Mpangilio wa Usafiri wa Bure umehifadhiwa.'
          : 'Free Delivery setting saved to PostgreSQL.',
      );
    } catch (err) {
      setApiError(
        err instanceof SokoHttpError
          ? err.message
          : isSw
            ? 'Imeshindikana kuhifadhi Usafiri wa Bure.'
            : 'Failed to update Free Delivery setting.',
      );
    } finally {
      setSavingFreeDelivery(false);
    }
  };

  const handlePublishMerchantMarketStock = async () => {
    const items = Object.entries(publishQtyByProductId)
      .filter(([, q]) => q > 0)
      .map(([productId, quantityQuanta]) => ({
        productId,
        quantityQuanta: Math.max(1, Math.trunc(quantityQuanta)),
      }));
    if (items.length === 0) return;

    setApiError(null);
    setStatusNotice(null);
    setPublishingStock(true);
    try {
      const res = await SokoApiClient.post<{ publishedCount: number }>(
        '/merchant/market-stock',
        { items },
      );
      setStatusNotice(
        isSw
          ? `Bidhaa ${res?.publishedCount ?? items.length} zimechapishwa Sokoni.`
          : `${res?.publishedCount ?? items.length} product(s) published to Sokoni.`,
      );
      setPublishQtyByProductId({});
      await loadSellData();
    } catch (err) {
      setApiError(
        err instanceof SokoHttpError
          ? err.message
          : isSw
            ? 'Imeshindikana kuchapisha stock sokoni.'
            : 'Failed to publish market stock.',
      );
    } finally {
      setPublishingStock(false);
    }
  };

  const handlePublishSupplierListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierPublishTarget.globalCatalogId || !supplierPublishTarget.systemUnitId) return;
    setApiError(null);
    setStatusNotice(null);
    setPublishingStock(true);
    try {
      await SokoApiClient.post('/supplier/catalog/publish', {
        globalCatalogId: supplierPublishTarget.globalCatalogId,
        systemUnitId: supplierPublishTarget.systemUnitId,
        supplierBulkPriceTzs: String(
          Math.max(1, Math.trunc(Number(supplierPublishTarget.bulkPriceTzs || 0))),
        ),
        minOrderQuantity: Math.max(1, Math.trunc(Number(supplierPublishTarget.minOrderQty || 1))),
        isPublishedToMarket: true,
      });
      setStatusNotice(
        isSw
          ? 'Orodha ya Supplier imechapishwa Sokoni.'
          : 'Supplier bulk listing published to Sokoni.',
      );
      await loadSellData();
    } catch (err) {
      setApiError(
        err instanceof SokoHttpError
          ? err.message
          : isSw
            ? 'Imeshindikana kuchapisha orodha ya supplier.'
            : 'Failed to publish supplier listing.',
      );
    } finally {
      setPublishingStock(false);
    }
  };

  const handleCancelOrder = async (order: BuyingOrderDto) => {
    setApiError(null);
    try {
      await SokoApiClient.post(`/orders/${order.orderId}/cancel`, {
        reason: 'Cancelled by buyer from Sokoni workspace',
      });
      setStatusNotice(
        isSw
          ? `Oda ${order.orderRef} imeghairiwa na hisa zimerejeshwa.`
          : `Order ${order.orderRef} cancelled and stock restored.`,
      );
      await loadOrders();
    } catch (err) {
      setApiError(
        err instanceof SokoHttpError
          ? err.message
          : isSw
            ? 'Imeshindikana kughairi oda.'
            : 'Failed to cancel order.',
      );
    }
  };

  const buyerTerminalRoleLabel =
    userRole === 'WHOLESALER'
      ? isSw
        ? 'Muuzaji Jumla'
        : 'Wholesaler'
      : userRole === 'SUPPLIER'
        ? isSw
          ? 'Msambizaji'
          : 'Supplier'
        : userRole === 'CONSUMER'
          ? isSw
            ? 'Mteja'
            : 'Consumer'
          : userTier === 'HYBRID_STORE'
            ? 'Hybrid Store'
            : isSw
              ? 'Muuzaji Rejareja'
              : 'Retailer';

  const activePinOrder = orders.find((o) => o.orderId === activePinOrderId) ?? null;

  // Screen 3: Searching & Merchant Found
  if (stage === 'DISCOVERY') {
    return (
      <SokoniOrderDiscoveryView
        locale={locale}
        selectedItems={selectedItemsForDiscovery}
        onBackToSokoni={() => setStage('BROWSE')}
        onViewMyOrders={() => {
          setSelectedQtyByCatalogId({});
          setStage('BROWSE');
          setSubView('ORDERS');
          void loadOrders();
        }}
        onBackToDashboard={() => {
          setSelectedQtyByCatalogId({});
          setStage('BROWSE');
          onBackToDashboard?.();
        }}
      />
    );
  }

  // Dual-PIN Doorstep Verification Terminal
  if (stage === 'PIN_TERMINAL' && activePinOrder) {
    return (
      <section className="max-w-md mx-auto space-y-3 pb-24">
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-900">
            {isSw ? 'Uthibitisho wa Oda (PIN)' : 'Order Confirmation'}
          </span>
          <span className="text-xs font-mono font-bold text-[#15AC49]">
            #{activePinOrder.orderRef}
          </span>
        </div>

        <IsolatedQrVerificationTerminal
          locale={locale}
          defaultDeviceOwner="RETAILER_PHONE"
          orderId={activePinOrder.orderId}
          orderRef8={activePinOrder.orderRef}
          destinationLabel={activePinOrder.sellerBusinessName}
          expectedCashTzs={Number(activePinOrder.expectedTotalTzs)}
          buyerRoleLabel={buyerTerminalRoleLabel}
          onBack={() => {
            setStage('BROWSE');
            setSubView('ORDERS');
          }}
          onVerifiedSuccess={(consumedToken) => {
            setStatusNotice(
              isSw
                ? `Oda #${activePinOrder.orderRef} imethibitishwa (${consumedToken}).`
                : `Order #${activePinOrder.orderRef} confirmed (${consumedToken}).`,
            );
            setStage('BROWSE');
            setSubView('ORDERS');
            void loadOrders();
          }}
        />
      </section>
    );
  }

  return (
    <div className="space-y-4 pb-28 md:pb-12">
      {/* Top Bar: Network status + Mode Switch (Nunua Sokoni | Uza Sokoni | Oda Zangu) */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {onBackToDashboard && (
              <button
                type="button"
                onClick={onBackToDashboard}
                className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4 text-[#0054A6]" aria-hidden="true" />
                <span className="hidden sm:inline">{t(locale, 'nav.dashboard')}</span>
              </button>
            )}
            <div className="flex items-center gap-1.5 text-xs font-medium">
              {isOnline && !backendOffline ? (
                <>
                  <Wifi className="w-4 h-4 text-[#15AC49]" aria-hidden="true" />
                  <span className="text-slate-800 font-semibold">Sokoni</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-amber-600" aria-hidden="true" />
                  <span className="text-amber-800">Offline</span>
                </>
              )}
              {queuedOfflineCount > 0 && (
                <span className="text-[11px] font-mono bg-amber-50 border border-amber-200 text-amber-900 px-2 py-0.5 rounded-md tabular-nums">
                  {queuedOfflineCount} QUEUED
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSubView((prev) => (prev === 'ORDERS' ? 'BUY' : 'ORDERS'))}
              className={`min-h-[40px] px-3 py-1.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                subView === 'ORDERS'
                  ? 'bg-[#0054A6] border-[#0054A6] text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t(locale, 'sokoni.myOrders')}</span>
              <span className="font-mono tabular-nums text-[11px] opacity-90">
                ({orders.length})
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (subView === 'BUY') void loadStandardCatalog();
                else if (subView === 'SELL') void loadSellData();
                else void loadOrders();
              }}
              aria-label={isSw ? 'Onyesha upya' : 'Refresh'}
              className="min-h-[40px] min-w-[40px] p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 inline-flex items-center justify-center cursor-pointer"
            >
              <RefreshCw
                className={`w-4 h-4 ${loadingCatalog || sellLoading || loadingOrders ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* Wireframe 2 Mode Switch: Nunua Sokoni | Uza Sokoni */}
        {isMerchantSeller && subView !== 'ORDERS' && (
          <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setSubView('BUY')}
              className={`min-h-[44px] px-3 py-2 rounded-lg text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                subView === 'BUY'
                  ? 'bg-[#15AC49] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShoppingBag className="w-4 h-4" aria-hidden="true" />
              <span>{t(locale, 'sokoni.buyMode')}</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('SELL')}
              className={`min-h-[44px] px-3 py-2 rounded-lg text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                subView === 'SELL'
                  ? 'bg-[#0054A6] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Store className="w-4 h-4" aria-hidden="true" />
              <span>{t(locale, 'sokoni.sellMode')}</span>
            </button>
          </div>
        )}
      </div>

      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          retrying={loadingCatalog}
          onRetry={() => void loadStandardCatalog()}
        />
      )}

      {apiError && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-xl p-3.5 text-xs text-red-900 flex items-start justify-between gap-3"
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

      {statusNotice && (
        <div
          role="status"
          className="border border-[#15AC49]/30 bg-[#15AC49]/10 rounded-xl p-3.5 flex items-center justify-between gap-3 text-xs font-semibold text-slate-900"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#15AC49] shrink-0" aria-hidden="true" />
            <span>{statusNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ====================================================================
          NUNUA SOKONI — Multi-Category Standard Catalog & Stepper Grid
         ==================================================================== */}
      {subView === 'BUY' && (
        <div className="space-y-4">
          {/* Category Multi-Select Bar */}
          <section className="space-y-2" aria-labelledby="sokoni-category-heading">
            <div className="flex items-center justify-between">
              <h2
                id="sokoni-category-heading"
                className="text-sm font-bold text-slate-900 flex items-center gap-1.5"
              >
                <Tag className="w-4 h-4 text-[#0054A6]" aria-hidden="true" />
                <span>{t(locale, 'sokoni.selectCategory')}</span>
              </h2>
              {selectedCategoryCodes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedCategoryCodes([])}
                  className="text-xs font-semibold text-[#0054A6] hover:underline cursor-pointer"
                >
                  {t(locale, 'sokoni.allCategories')}
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategoryCodes([])}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  selectedCategoryCodes.length === 0
                    ? 'bg-[#0054A6] border-[#0054A6] text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t(locale, 'sokoni.allCategories')}
              </button>

              {categories.map((cat) => {
                const active = selectedCategoryCodes.includes(cat.categoryCode);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCategory(cat.categoryCode)}
                    aria-pressed={active}
                    className={`min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#15AC49] border-[#15AC49] text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {isSw ? cat.nameSw : cat.nameEn}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Search input */}
          <div className="relative flex items-center">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t(locale, 'sokoni.searchPlaceholder')}
              className="w-full min-h-[44px] pl-10 pr-10 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 focus:border-[#0054A6] focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={isSw ? 'Futa utafutaji' : 'Clear search'}
                className="absolute right-3 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Standard Product Grid (Wireframe 2: 2-column mobile grid with +/- steppers) */}
          {loadingCatalog && catalogItems.length === 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="bg-white border border-slate-200 rounded-2xl p-3 space-y-3 animate-pulse"
                >
                  <div className="h-28 bg-slate-100 rounded-xl" />
                  <div className="h-4 bg-slate-100 rounded w-3/4" />
                  <div className="h-9 bg-slate-100 rounded-lg" />
                </div>
              ))}
            </div>
          ) : catalogItems.length === 0 ? (
            <EmptyStateCard
              locale={locale}
              titleSw={t('sw', 'sokoni.noCatalogTitle')}
              titleEn={t('en', 'sokoni.noCatalogTitle')}
              descriptionSw={t('sw', 'sokoni.noCatalogDesc')}
              descriptionEn={t('en', 'sokoni.noCatalogDesc')}
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {catalogItems.map((item) => {
                const qty = selectedQtyByCatalogId[item.id] ?? 0;
                const activeUnit = getActiveUnitForItem(item);
                const units = item.productUnits ?? [];
                const priceHint = activeUnit
                  ? item.standardPrices?.find(
                      (sp) => sp.globalProductUnitId === activeUnit.id,
                    )?.standardPriceTzs
                  : item.standardPrices?.[0]?.standardPriceTzs;
                const imgSrc = resolveBackendImageUrl(
                  item.imagekitCdnUrl,
                  item.staticImageUrl,
                );

                return (
                  <article
                    key={item.id}
                    className={`bg-white border rounded-2xl p-3 flex flex-col justify-between gap-2.5 transition-colors ${
                      qty > 0
                        ? 'border-[#15AC49] ring-1 ring-[#15AC49]/40'
                        : 'border-slate-200'
                    }`}
                  >
                    <div className="space-y-2">
                      {!isLowDataModeActive ? (
                        <div className="h-28 w-full rounded-xl bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center p-2">
                          <img
                            src={imgSrc}
                            alt={isSw ? item.fixedNameSw : item.fixedNameEn}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-contain"
                          />
                        </div>
                      ) : (
                        <div className="h-14 w-full rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-[11px] font-mono text-slate-500">
                          {item.canonicalSku}
                        </div>
                      )}

                      <div className="space-y-1">
                        <h3 className="text-xs sm:text-sm font-bold text-slate-900 line-clamp-2 leading-snug">
                          {isSw ? item.fixedNameSw : item.fixedNameEn}
                        </h3>
                        <div className="text-[11px] font-mono text-slate-500 truncate">
                          {item.canonicalSku}
                        </div>
                      </div>

                      {units.length > 1 ? (
                        <select
                          aria-label={isSw ? 'Chagua kipimo' : 'Select unit'}
                          value={activeUnit?.systemUnitId ?? ''}
                          onChange={(e) =>
                            setSelectedUnitByCatalogId((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                          className="w-full min-h-[34px] px-2 py-1 text-[11px] font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:border-[#0054A6] focus:outline-none"
                        >
                          {units.map((u) => (
                            <option key={u.id} value={u.systemUnitId}>
                              {formatUnitOptionLabel(u, isSw)}
                            </option>
                          ))}
                        </select>
                      ) : activeUnit ? (
                        <div className="text-[11px] font-semibold text-[#0054A6] truncate">
                          {formatUnitOptionLabel(activeUnit, isSw)}
                        </div>
                      ) : null}

                      {priceHint !== undefined && priceHint > 0 && (
                        <div className="text-xs font-mono font-bold text-slate-700 tabular-nums">
                          ~TZS {Number(priceHint).toLocaleString('en-US')}
                        </div>
                      )}
                    </div>

                    {/* Quantity Stepper (- [qty] +) */}
                    <div className="flex items-center justify-between border border-slate-200 rounded-xl bg-slate-50 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => adjustItemQty(item.id, -1)}
                        disabled={qty === 0}
                        aria-label={`Decrease ${item.canonicalSku}`}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-700 hover:bg-slate-200/70 disabled:opacity-40 cursor-pointer"
                      >
                        <Minus className="w-4 h-4" aria-hidden="true" />
                      </button>

                      <span className="px-1 text-sm font-mono font-bold tabular-nums text-slate-900">
                        {qty}
                      </span>

                      <button
                        type="button"
                        onClick={() => adjustItemQty(item.id, 1)}
                        aria-label={`Increase ${item.canonicalSku}`}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center bg-[#15AC49] text-white hover:bg-emerald-700 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Sticky Bottom Checkout CTA above Mobile Fixed Bottom Nav */}
          {totalSelectedUnits > 0 && (
            <div className="sticky bottom-20 md:bottom-4 z-30 pt-2">
              <div className="bg-white/95 backdrop-blur-md border border-[#15AC49]/30 rounded-2xl p-2.5 shadow-lg flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedQtyByCatalogId({})}
                  className="min-h-[46px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer shrink-0"
                >
                  {t(locale, 'sokoni.clearSelection')}
                </button>
                <button
                  type="button"
                  onClick={() => setStage('DISCOVERY')}
                  className="flex-1 min-h-[46px] px-4 py-2.5 rounded-xl bg-[#15AC49] hover:bg-emerald-700 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>
                    {t(locale, 'sokoni.proceedToOrder')} ({totalSelectedUnits})
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          UZA SOKONI — Free Delivery & Live Market Stock Publishing
         ==================================================================== */}
      {subView === 'SELL' && isMerchantSeller && (
        <div className="space-y-4">
          {/* Free Delivery Card */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#15AC49]/10 text-[#15AC49] flex items-center justify-center shrink-0">
                <Truck className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="space-y-0.5">
                <h2 className="text-sm font-bold text-slate-900">
                  {t(locale, 'sokoni.freeDeliveryTitle')}
                </h2>
                <p className="text-xs text-slate-500">
                  {t(locale, 'sokoni.freeDeliveryDesc')}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={savingFreeDelivery || sellLoading}
              onClick={() => void handleToggleFreeDelivery()}
              className={`min-h-[44px] px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 ${
                offersFreeDelivery
                  ? 'bg-[#15AC49] border-[#15AC49] text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {offersFreeDelivery
                ? isSw
                  ? 'IMEWASHWA'
                  : 'ENABLED'
                : isSw
                  ? 'IMEZIMWA'
                  : 'DISABLED'}
            </button>
          </section>

          {userRole === 'SUPPLIER' ? (
            <form
              onSubmit={handlePublishSupplierListing}
              className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4"
            >
              <div className="flex items-center gap-2">
                <PackagePlus className="w-4 h-4 text-[#0054A6]" aria-hidden="true" />
                <h3 className="text-sm font-bold text-slate-900">
                  {t(locale, 'sokoni.publishStockTitle')}
                </h3>
              </div>

              {supplierItems.filter((i) => i.globalCatalogId).length === 0 ? (
                <EmptyStateCard
                  locale={locale}
                  titleSw="Hakuna bidhaa za ghala zilizounganishwa bado"
                  titleEn="No linked warehouse products yet"
                  descriptionSw="Ongeza bidhaa kutoka Ghala & Stock kwanza ili kuchapisha orodha ya jumla Sokoni."
                  descriptionEn="Add products in Warehouse & Stock first to publish Supplier bulk listings."
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-slate-700">
                      {isSw ? 'Bidhaa ya Ghala' : 'Warehouse Product'}
                    </span>
                    <select
                      value={supplierPublishTarget.globalCatalogId}
                      onChange={(e) => {
                        const chosen = supplierItems.find(
                          (item) => item.globalCatalogId === e.target.value,
                        );
                        setSupplierPublishTarget((prev) => ({
                          ...prev,
                          globalCatalogId: e.target.value,
                          systemUnitId: chosen?.unitConversions[0]?.systemUnitId ?? '',
                        }));
                      }}
                      className="w-full min-h-[44px] px-3 text-xs bg-white border border-slate-300 rounded-xl"
                    >
                      {supplierItems
                        .filter((i) => i.globalCatalogId)
                        .map((item) => (
                          <option
                            key={item.productId}
                            value={item.globalCatalogId ?? ''}
                          >
                            {isSw ? item.nameSw : item.nameEn} ({item.smsItemCode})
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-slate-700">
                      {isSw ? 'Kipimo cha Jumla' : 'Bulk Unit'}
                    </span>
                    <select
                      value={supplierPublishTarget.systemUnitId}
                      onChange={(e) =>
                        setSupplierPublishTarget((prev) => ({
                          ...prev,
                          systemUnitId: e.target.value,
                        }))
                      }
                      className="w-full min-h-[44px] px-3 text-xs bg-white border border-slate-300 rounded-xl"
                    >
                      {(
                        supplierItems.find(
                          (i) =>
                            i.globalCatalogId === supplierPublishTarget.globalCatalogId,
                        )?.unitConversions ?? []
                      ).map((u) => (
                        <option key={u.systemUnitId} value={u.systemUnitId}>
                          {isSw
                            ? u.displayLabelSw || u.nameSw
                            : u.displayLabelEn || u.nameEn}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-slate-700">
                      {isSw ? 'Bei ya Jumla (TZS)' : 'Bulk Price (TZS)'}
                    </span>
                    <input
                      type="number"
                      min={1}
                      required
                      value={supplierPublishTarget.bulkPriceTzs}
                      onChange={(e) =>
                        setSupplierPublishTarget((prev) => ({
                          ...prev,
                          bulkPriceTzs: e.target.value,
                        }))
                      }
                      className="w-full min-h-[44px] px-3 text-xs font-mono font-bold border border-slate-300 rounded-xl"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-slate-700">
                      {isSw ? 'Kiwango cha Chini (MOQ)' : 'Min Order Qty (MOQ)'}
                    </span>
                    <input
                      type="number"
                      min={1}
                      required
                      value={supplierPublishTarget.minOrderQty}
                      onChange={(e) =>
                        setSupplierPublishTarget((prev) => ({
                          ...prev,
                          minOrderQty: e.target.value,
                        }))
                      }
                      className="w-full min-h-[44px] px-3 text-xs font-mono font-bold border border-slate-300 rounded-xl"
                    />
                  </label>

                  <div className="sm:col-span-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={publishingStock}
                      className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#0054A6] hover:bg-blue-900 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      {t(locale, 'sokoni.publishBtn')}
                    </button>
                  </div>
                </div>
              )}
            </form>
          ) : (
            <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {t(locale, 'sokoni.publishStockTitle')}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isSw
                      ? 'Chagua bidhaa za rafu yako na weka idadi ya kuonekana Sokoni.'
                      : 'Select shelf products and enter quantities to publish live on Sokoni.'}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={
                    publishingStock ||
                    Object.values(publishQtyByProductId).filter((q) => q > 0).length === 0
                  }
                  onClick={() => void handlePublishMerchantMarketStock()}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-[#0054A6] hover:bg-blue-900 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <PackagePlus className="w-4 h-4" aria-hidden="true" />
                  <span>{t(locale, 'sokoni.publishBtn')}</span>
                </button>
              </div>

              {sellLoading && merchantProducts.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  {isSw ? 'Inapakia bidhaa zako...' : 'Loading your inventory...'}
                </div>
              ) : merchantProducts.length === 0 ? (
                <div className="p-4">
                  <EmptyStateCard
                    locale={locale}
                    titleSw="Hakuna bidhaa kwenye hifadhi bado"
                    titleEn="No products in inventory yet"
                    descriptionSw="Nenda kwenye Hifadhi kuongeza bidhaa kabla ya kuziuza Sokoni."
                    descriptionEn="Add products in Inventory first before publishing them to Sokoni."
                  />
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {merchantProducts.map((product) => {
                    const qty = publishQtyByProductId[product.productId] ?? 0;
                    const checked = qty > 0;
                    return (
                      <div
                        key={product.productId}
                        className={`px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${
                          checked ? 'bg-[#15AC49]/5' : 'bg-white'
                        }`}
                      >
                        <label className="flex items-start gap-3 min-w-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setPublishQtyByProductId((prev) => {
                                if (prev[product.productId]) {
                                  const next = { ...prev };
                                  delete next[product.productId];
                                  return next;
                                }
                                return { ...prev, [product.productId]: 24 };
                              })
                            }
                            className="mt-1 w-4 h-4 accent-[#15AC49]"
                          />
                          <div className="min-w-0 space-y-0.5">
                            <div className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                              {isSw ? product.nameSw : product.nameEn}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                              {product.sku} ·{' '}
                              {isSw ? 'Stock' : 'On hand'}:{' '}
                              {product.availableQuarterQuanta} Q · TZS{' '}
                              {Number(product.cartonPriceTzs || product.unitPriceTzs).toLocaleString(
                                'en-US',
                              )}
                            </div>
                          </div>
                        </label>

                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            disabled={!checked}
                            value={checked ? qty : ''}
                            placeholder="0"
                            onChange={(e) => {
                              const val = Math.max(1, Math.trunc(Number(e.target.value) || 1));
                              setPublishQtyByProductId((prev) => ({
                                ...prev,
                                [product.productId]: val,
                              }));
                            }}
                            className="w-24 min-h-[40px] px-2.5 py-1.5 text-xs font-mono font-bold text-right border border-slate-300 rounded-xl disabled:bg-slate-100"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ====================================================================
          ODA ZANGU & PIN — Buying Orders, Cancel & Doorstep PIN Verification
         ==================================================================== */}
      {subView === 'ORDERS' && (
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              {t(locale, 'sokoni.myOrders')}
            </h2>
            <button
              type="button"
              onClick={() => setSubView('BUY')}
              className="text-xs font-semibold text-[#15AC49] hover:underline cursor-pointer"
            >
              {t(locale, 'sokoni.buyMode')}
            </button>
          </div>

          {loadingOrders && orders.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              {isSw ? 'Inapakia oda zako...' : 'Loading your orders...'}
            </div>
          ) : orders.length === 0 ? (
            <div className="p-4">
              <EmptyStateCard
                locale={locale}
                titleSw="Hakuna oda za manunuzi bado"
                titleEn="No buying orders yet"
                descriptionSw="Chagua bidhaa kutoka Nunua Sokoni ili kutafuta wauzaji waliothibitishwa."
                descriptionEn="Select products in Nunua Sokoni to discover matched verified Merchants."
              />
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {orders.map((order) => (
                <div
                  key={order.orderId}
                  className="p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-slate-900">
                        #{order.orderRef}
                      </span>
                      <span className="font-semibold text-slate-700 truncate">
                        {order.sellerBusinessName}
                      </span>
                      {order.orderMode === 'SCHEDULED' && order.scheduledDeliveryDate && (
                        <span className="text-[11px] font-semibold text-[#0054A6]">
                          · {t(locale, 'dashboard.scheduledFor')} {order.scheduledDeliveryDate}
                        </span>
                      )}
                      <span
                        className={`text-[11px] font-bold ${
                          order.status === 'DELIVERED'
                            ? 'text-[#15AC49]'
                            : order.status === 'CANCELLED'
                              ? 'text-slate-400'
                              : 'text-amber-700'
                        }`}
                      >
                        · {formatOrderStatusLabel(order.status, locale)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {order.items
                        .map(
                          (i) =>
                            `${isSw ? i.nameSw ?? i.smsItemCode ?? 'SKU' : i.nameEn ?? i.smsItemCode ?? 'SKU'} (${i.quantity} × ${i.unitType})`,
                        )
                        .join(' + ')}
                    </div>
                    <div className="text-xs font-mono font-bold text-[#15AC49] tabular-nums">
                      TZS {Number(order.expectedTotalTzs).toLocaleString('en-US')}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {order.status === 'PLACED' && (
                      <button
                        type="button"
                        onClick={() => void handleCancelOrder(order)}
                        className="min-h-[40px] px-3 py-1.5 text-xs font-semibold text-red-700 border border-red-200 rounded-xl hover:bg-red-50 cursor-pointer"
                      >
                        {isSw ? 'Ghairi Oda' : 'Cancel'}
                      </button>
                    )}
                    {order.status === 'DISPATCHED' && (
                      <button
                        type="button"
                        onClick={() => {
                          setActivePinOrderId(order.orderId);
                          setStage('PIN_TERMINAL');
                        }}
                        className="min-h-[40px] px-3.5 py-2 text-xs font-bold text-white bg-slate-900 rounded-xl hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{isSw ? 'PIN ya Kupokea' : 'Receive (PIN)'}</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
