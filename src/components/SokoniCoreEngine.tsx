import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingCart,
  Truck,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { useDataSaver } from '../context/DataSaverContext';
import { listQueuedOrders, putQueuedOrder } from '../lib/indexedDbDemo';
import { formatOrderStatusLabel, formatRoutingLabel } from '../lib/sokoManagedState';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';
import { SmartStoreCatalog } from './SmartStoreCatalog';
import { SmartGridStoreCatalog } from './SmartGridStoreCatalog';
import { IsolatedQrVerificationTerminal } from './IsolatedQrVerificationTerminal';
import { resolveBackendImageUrl } from '../lib/sokoProductImage';

type ActiveScreen = 'HOME' | 'DIRECTORY' | 'CATALOG' | 'PIN_TERMINAL';

type MarketplaceAudience = 'SUPPLIERS' | 'WHOLESALE_MERCHANTS' | 'RETAIL_MERCHANTS';

type PackagingUnit =
  | 'CARTON'
  | 'DOZEN'
  | 'PACK'
  | 'UNIT'
  | 'SACK_50KG'
  | 'SACK_25KG'
  | 'QUARTER_KILO_LITRE'
  | 'HALF_KILO_LITRE'
  | 'THREE_QUARTER_KILO'
  | 'SINGLE_KILO_LITRE';

interface WholesaleHub {
  businessId: string;
  name: string;
  initials: string;
  brandRingColor: string;
  ward: string;
  tier?: string;
  smsShortCode?: string;
  logoUrl?: string;
  distanceMeters: number;
  deliveryFeeTzs: number;
  /** Supplier hubs order through SUPPLIER_TO_WHOLESALER with server quotes. */
  kind?: 'MERCHANT' | 'SUPPLIER';
}

interface CatalogProduct {
  productId: string;
  businessId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  imageSrc: string;
  orderUnitType: PackagingUnit;
  quantaPerOrderUnit: number;
  quantaUnitLabelSw: string;
  quantaUnitLabelEn: string;
  wholesaleThresholdUnits: number;
  retailPricePerUnitTzs: number;
  wholesalePricePerUnitTzs: number;
  availableQuantaStock: number;
  isLowStockInDuka?: boolean;
  supplierListingId?: string;
  minOrderUnits?: number;
}

interface DispatchedOrderRecord {
  orderId: string;
  orderRef8: string;
  sellerBusinessId: string;
  sellerName: string;
  subtotalTzs: number;
  deliveryFeeTzs: number;
  totalCashDueTzs: number;
  itemsSummary: string;
  status: 'PLACED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
}

interface BackendMerchantDto {
  merchantId: string;
  smsShortCode: string;
  merchantName: string;
  tier: string;
  ward: string;
  district: string;
  isPlatformManaged: boolean;
  offersFreeDelivery?: boolean;
  activeSkusCount: number;
  logoUrl?: string;
}

interface BackendSupplierListingDto {
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

interface BackendProductDto {
  productId: string;
  sellerBusinessId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitPriceTzs: number;
  cartonPriceTzs: number;
  wholesaleThresholdUnits: number;
  availableQuarterQuanta: number;
  sealedBulkPackagesStock: number;
  globalCatalogId?: string | null;
  imagekitCdnUrl?: string;
  staticImageUrl?: string;
  priceTiers?: Array<{
    id: string;
    unitType: PackagingUnit;
    quarterQuantaPerUnit: number;
    priceTzs: number;
    isWholesaleTier: boolean;
  }>;
}

interface BackendIntelligentItemDto {
  productId: string;
  sku: string;
  requiresUrgentReorder: boolean;
}

interface BackendOrderDto {
  orderId: string;
  orderRef: string;
  sellerBusinessId: string;
  sellerBusinessName: string;
  expectedTotalTzs: number;
  deliveryFeeTzs: number;
  status: 'PLACED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
  items: Array<{
    sku?: string;
    smsItemCode?: string;
    nameSw?: string;
    unitType: string;
    quantity: number;
    baseUnitsTotal: number;
  }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}

function supplierPackagingUnit(
  unitCode: string,
  quarterQuantaPerUnit: number,
): PackagingUnit {
  const code = unitCode.toUpperCase();
  if (code.includes('GUNIA') || code.includes('SACK')) {
    return quarterQuantaPerUnit >= 200 ? 'SACK_50KG' : 'SACK_25KG';
  }
  if (code.includes('DEBE') || code.includes('CARTON')) return 'CARTON';
  if (code.includes('DOZEN')) return 'DOZEN';
  if (code.includes('PACK')) return 'PACK';
  if (quarterQuantaPerUnit >= 200) return 'SACK_50KG';
  if (quarterQuantaPerUnit >= 100) return 'SACK_25KG';
  if (quarterQuantaPerUnit >= 48) return 'CARTON';
  if (quarterQuantaPerUnit >= 4) return 'UNIT';
  return 'QUARTER_KILO_LITRE';
}

function formatUnitShortLabel(unit: PackagingUnit, quanta: number, isSw: boolean): string {
  switch (unit) {
    case 'SACK_50KG':
      return isSw ? `Gunia 50KG (${quanta}Q)` : `50KG Sack (${quanta}Q)`;
    case 'SACK_25KG':
      return isSw ? `Gunia 25KG (${quanta}Q)` : `25KG Sack (${quanta}Q)`;
    case 'CARTON':
      return isSw ? `Katoni (${quanta}Q)` : `Carton (${quanta}Q)`;
    case 'DOZEN':
      return isSw ? `Dazani (${quanta}Q)` : `Dozen (${quanta}Q)`;
    case 'PACK':
      return isSw ? `Pakiti (${quanta}Q)` : `Pack (${quanta}Q)`;
    case 'SINGLE_KILO_LITRE':
      return isSw ? `1KG/1L (${quanta}Q)` : `1KG/1L (${quanta}Q)`;
    case 'HALF_KILO_LITRE':
      return isSw ? `Nusu (${quanta}Q)` : `Half KG/L (${quanta}Q)`;
    case 'THREE_QUARTER_KILO':
      return isSw ? `Tatu-Robo (${quanta}Q)` : `3/4 KG (${quanta}Q)`;
    case 'QUARTER_KILO_LITRE':
      return isSw ? `Robo (${quanta}Q)` : `Robo (${quanta}Q)`;
    default:
      return `${unit} (${quanta}Q)`;
  }
}

export function SokoniCoreEngine({
  locale = 'en',
  userRole = 'RETAILER',
  userTier = null,
}: {
  locale?: Locale;
  userRole?: 'RETAILER' | 'WHOLESALER' | 'CONSUMER';
  userTier?: string | null;
  businessId?: string | null;
}) {
  const isSw = locale === 'sw';
  const isSupplierBuyer =
    userRole === 'WHOLESALER' || (userRole === 'RETAILER' && userTier === 'HYBRID_STORE');
  const marketplaceAudience: MarketplaceAudience = isSupplierBuyer
    ? 'SUPPLIERS'
    : userRole === 'CONSUMER'
      ? 'RETAIL_MERCHANTS'
      : 'WHOLESALE_MERCHANTS';
  const isSupplierAudience = marketplaceAudience === 'SUPPLIERS';
  const buyerTerminalRoleLabel = userRole === 'WHOLESALER'
    ? (isSw ? 'Muuzaji Jumla' : 'Wholesaler')
    : userRole === 'CONSUMER'
      ? (isSw ? 'Mteja' : 'Consumer')
      : userTier === 'HYBRID_STORE'
        ? 'Hybrid Store'
        : (isSw ? 'Muuzaji Rejareja' : 'Retailer');
  const { isLowDataModeActive } = useDataSaver();
  const visibleMerchantTiers = useMemo(
    () =>
      marketplaceAudience === 'RETAIL_MERCHANTS'
        ? ['RETAIL_DUKA', 'HYBRID_STORE']
        : ['WHOLESALE', 'HYBRID_STORE'],
    [marketplaceAudience],
  );
  const directoryLabels =
    marketplaceAudience === 'SUPPLIERS'
      ? {
          countSw: 'Wasambizaji',
          countEn: 'Suppliers',
          loadingSw: 'Inatafuta wasambizaji...',
          loadingEn: 'Loading suppliers...',
          emptyTitleSw: 'Hakuna wasambizaji bado',
          emptyTitleEn: 'No suppliers yet',
          emptySw:
            'Hakuna wasambizaji waliopatikana kwenye PostgreSQL kwa sasa.',
          emptyEn: 'No available suppliers found in PostgreSQL yet.',
        }
      : marketplaceAudience === 'RETAIL_MERCHANTS'
        ? {
            countSw: 'Maduka ya Rejareja',
            countEn: 'Retail Merchants',
            loadingSw: 'Inatafuta maduka ya rejareja...',
            loadingEn: 'Loading retail merchants...',
            emptyTitleSw: 'Hakuna duka bado',
            emptyTitleEn: 'No merchants yet',
            emptySw:
              'Hakuna duka la rejareja au duka mseto lililosajiliwa katika PostgreSQL kwa sasa.',
            emptyEn: 'No open retail or hybrid merchants found in PostgreSQL yet.',
          }
        : {
            countSw: 'Maduka ya Jumla',
            countEn: 'Wholesale Merchants',
            loadingSw: 'Inatafuta maduka ya jumla...',
            loadingEn: 'Loading wholesale merchants...',
            emptyTitleSw: 'Hakuna duka bado',
            emptyTitleEn: 'No merchants yet',
            emptySw:
              'Hakuna duka la jumla au duka mseto lililosajiliwa katika PostgreSQL kwa sasa.',
            emptyEn: 'No open wholesale or hybrid merchants found in PostgreSQL yet.',
          };

  const [screen, setScreen] = useState<ActiveScreen>('HOME');
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [hubs, setHubs] = useState<WholesaleHub[]>([]);
  const [selectedStore, setSelectedStore] = useState<WholesaleHub | null>(null);
  const [liveStoreCatalog, setLiveStoreCatalog] = useState<CatalogProduct[]>([]);
  const [loadingHubs, setLoadingHubs] = useState<boolean>(false);
  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(false);
  const [submittingOrder, setSubmittingOrder] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [queuedOfflineCount, setQueuedOfflineCount] = useState<number>(0);

  const [cartUnitsByProduct, setCartUnitsByProduct] = useState<Record<string, number>>({});
  const [checkoutSheetOpen, setCheckoutSheetOpen] = useState<boolean>(false);
  const [smartReorderMode, setSmartReorderMode] = useState<boolean>(false);
  const [smartGridMode, setSmartGridMode] = useState<boolean>(false);
  const [catalogSearchQuery, setCatalogSearchQuery] = useState<string>('');

  const [orders, setOrders] = useState<DispatchedOrderRecord[]>([]);
  const [activePinOrderId, setActivePinOrderId] = useState<string | null>(null);

  const [floatingToast, setFloatingToast] = useState<{
    title: string;
    detail: string;
  } | null>(null);

  const refreshQueueCount = useCallback(async () => {
    const q = await listQueuedOrders().catch(() => []);
    setQueuedOfflineCount(q.filter((o) => o.syncStatus === 'QUEUED_OFFLINE').length);
  }, []);

  const loadLiveHome = useCallback(async () => {
    await refreshQueueCount();
    if (!navigator.onLine) {
      setIsOnline(false);
      setBackendOffline(true);
      return;
    }

    setLoadingHubs(true);
    setApiError(null);
    setBackendOffline(false);
    try {
      const [merchantsRes, ordersRes, supplierCatalogRes] = await Promise.all([
        isSupplierAudience
          ? Promise.resolve([] as BackendMerchantDto[])
          : SokoApiClient.get<BackendMerchantDto[]>('/marketplace/merchants'),
        SokoApiClient.hasAccessToken()
          ? SokoApiClient.get<{ count: number; orders: BackendOrderDto[] }>(
              '/orders/my-orders?scope=buying',
            )
          : Promise.resolve({ count: 0, orders: [] as BackendOrderDto[] }),
        isSupplierAudience
          ? SokoApiClient.get<{ items?: BackendSupplierListingDto[] }>(
              '/marketplace/suppliers/catalog',
            ).catch((err) => {
              if (err instanceof SokoHttpError && (err.status === 401 || err.status === 403)) {
                return { items: [] as BackendSupplierListingDto[] };
              }
              throw err;
            })
          : Promise.resolve({ items: [] as BackendSupplierListingDto[] }),
      ]);

      const visibleMerchants = (Array.isArray(merchantsRes) ? merchantsRes : []).filter((m) =>
        visibleMerchantTiers.includes(m.tier),
      );
      const supplierHubs = new Map<string, WholesaleHub>();
      for (const listing of supplierCatalogRes?.items ?? []) {
        if (!listing.isAvailable || !isUuid(listing.supplierBusinessId)) continue;
        if (supplierHubs.has(listing.supplierBusinessId)) continue;
        supplierHubs.set(listing.supplierBusinessId, {
          businessId: listing.supplierBusinessId,
          name: listing.supplierName,
          initials: listing.supplierName
            .split(/\s+/)
            .slice(0, 2)
            .map((word) => word[0])
            .join('')
            .toUpperCase(),
          brandRingColor: 'bg-amber-50 text-amber-800 border-amber-200',
          ward: listing.deliveryCoverageRegions.join(', ') || 'Tanzania',
          tier: 'MANUFACTURER_SUPPLIER',
          distanceMeters: 400 + supplierHubs.size * 280,
          deliveryFeeTzs: listing.isFreeDeliveryEnabled
            ? 0
            : Number(listing.standardDeliveryFeeTzs || 0),
          kind: 'SUPPLIER',
        });
      }

      const merchantHubs = visibleMerchants.map((m, idx) => ({
        businessId: m.merchantId,
        name: m.merchantName,
        initials:
          m.smsShortCode ||
          m.merchantName
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0])
            .join('')
            .toUpperCase(),
        brandRingColor:
          idx % 2 === 0
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-slate-100 text-slate-800 border-slate-200',
        ward: `${m.ward}, ${m.district}`,
        tier: m.tier,
        smsShortCode: m.smsShortCode,
        logoUrl: m.logoUrl,
        distanceMeters: 250 + idx * 310,
        deliveryFeeTzs: m.offersFreeDelivery ? 0 : m.tier === 'WHOLESALE' ? 3_500 : 2_500,
        kind: 'MERCHANT' as const,
      }));

      setHubs(isSupplierAudience ? [...supplierHubs.values()] : merchantHubs);

      const liveOrders: DispatchedOrderRecord[] = (ordersRes?.orders ?? []).map((o) => {
        const fee = Number(o.deliveryFeeTzs ?? 0);
        const total = Number(o.expectedTotalTzs ?? 0);
        return {
          orderId: o.orderId,
          orderRef8: o.orderRef,
          sellerBusinessId: o.sellerBusinessId,
          sellerName: o.sellerBusinessName,
          subtotalTzs: Math.max(0, total - fee),
          deliveryFeeTzs: fee,
          totalCashDueTzs: total,
          itemsSummary: o.items
            .map((i) => `${i.smsItemCode ?? i.nameSw ?? 'SKU'} (${i.quantity} × ${i.unitType})`)
            .join(' + '),
          status: o.status,
        };
      });
      setOrders(liveOrders);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia data kutoka seva.'
              : 'Failed to load marketplace data from backend.',
        );
      }
    } finally {
      setLoadingHubs(false);
    }
  }, [isSupplierAudience, isSw, refreshQueueCount, visibleMerchantTiers]);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      void loadLiveHome();
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
  }, [loadLiveHome]);

  useEffect(() => {
    void loadLiveHome();
  }, [loadLiveHome]);

  const cashNeededTodayTzs = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'DISPATCHED' || o.status === 'PLACED')
        .reduce((sum, o) => sum + o.totalCashDueTzs, 0),
    [orders],
  );

  const settledTodayTzs = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'DELIVERED')
        .reduce((sum, o) => sum + o.totalCashDueTzs, 0),
    [orders],
  );

  const handleOpenStore = async (hub: WholesaleHub) => {
    setSelectedStore(hub);
    setCartUnitsByProduct({});
    setCheckoutSheetOpen(false);
    setSmartReorderMode(false);
    setSmartGridMode(false);
    setCatalogSearchQuery('');
    setApiError(null);
    setScreen('CATALOG');

    if (!navigator.onLine || !isUuid(hub.businessId)) {
      setBackendOffline(true);
      setLiveStoreCatalog([]);
      return;
    }

    setLoadingCatalog(true);
    setBackendOffline(false);
    try {
      if (hub.kind === 'SUPPLIER') {
        const res = await SokoApiClient.get<{ items?: BackendSupplierListingDto[] }>(
          '/marketplace/suppliers/catalog',
        );
        const mapped: CatalogProduct[] = (res.items ?? [])
          .filter(
            (listing) =>
              listing.supplierBusinessId === hub.businessId &&
              listing.isAvailable &&
              listing.productId,
          )
          .map((listing) => {
            const orderUnitType = supplierPackagingUnit(
              listing.systemUnitCode,
              listing.quarterQuantaPerUnit,
            );
            const price = Number(listing.supplierBulkPriceTzs || 0);
            const quantaPerOrderUnit = Math.max(1, listing.quarterQuantaPerUnit);
            return {
              productId: listing.productId as string,
              businessId: listing.supplierBusinessId,
              sku: listing.canonicalSku,
              nameSw: listing.nameSw,
              nameEn: listing.nameEn,
              imageSrc: resolveBackendImageUrl(listing.imagekitCdnUrl),
              orderUnitType,
              quantaPerOrderUnit,
              quantaUnitLabelSw: formatUnitShortLabel(orderUnitType, quantaPerOrderUnit, true),
              quantaUnitLabelEn: formatUnitShortLabel(orderUnitType, quantaPerOrderUnit, false),
              wholesaleThresholdUnits: 1,
              retailPricePerUnitTzs: price,
              wholesalePricePerUnitTzs: price,
              availableQuantaStock:
                Math.max(0, listing.maxOrderQuantity) * quantaPerOrderUnit,
              isLowStockInDuka: false,
              supplierListingId: listing.listingId,
              minOrderUnits: Math.max(1, listing.minOrderQuantity),
            };
          });
        setLiveStoreCatalog(mapped);
        return;
      }

      const [activeProducts, intelligentItems] = await Promise.all([
        SokoApiClient.get<BackendProductDto[]>(
          `/products/active?businessId=${encodeURIComponent(hub.businessId)}`,
        ),
        SokoApiClient.hasAccessToken()
          ? SokoApiClient.get<BackendIntelligentItemDto[]>(
              `/marketplace/catalog/intelligent-view?wholesalerId=${encodeURIComponent(hub.businessId)}`,
            ).catch((err) => {
              // Urgent-reorder intelligence is optional for consumers and for
              // role-restricted calls, but real backend failures must surface.
              if (err instanceof SokoHttpError && (err.status === 401 || err.status === 403)) {
                return [] as BackendIntelligentItemDto[];
              }
              throw err;
            })
          : Promise.resolve([] as BackendIntelligentItemDto[]),
      ]);

      const urgentIds = new Set(
        (Array.isArray(intelligentItems) ? intelligentItems : [])
          .filter((i) => i.requiresUrgentReorder)
          .map((i) => i.productId),
      );

      const mapped: CatalogProduct[] = (Array.isArray(activeProducts) ? activeProducts : []).map(
        (p) => {
          const tiers = p.priceTiers ?? [];
          const wholesaleTier = tiers.find((t) => t.isWholesaleTier);
          const primaryTier =
            wholesaleTier ?? tiers[tiers.length - 1] ?? tiers[0] ?? null;

          const orderUnitType: PackagingUnit = primaryTier
            ? primaryTier.unitType
            : 'SACK_50KG';
          const quantaPerOrderUnit = primaryTier ? primaryTier.quarterQuantaPerUnit : 200;
          const wholesalePricePerUnitTzs = wholesaleTier
            ? wholesaleTier.priceTzs
            : primaryTier
              ? primaryTier.priceTzs
              : Number(p.cartonPriceTzs || p.unitPriceTzs);
          const retailTier = tiers.find((t) => !t.isWholesaleTier);
          const retailPricePerUnitTzs = retailTier
            ? retailTier.priceTzs
            : wholesalePricePerUnitTzs;

          return {
            productId: p.productId,
            businessId: p.sellerBusinessId,
            sku: p.sku,
            nameSw: p.nameSw,
            nameEn: p.nameEn,
            imageSrc: resolveBackendImageUrl(p.imagekitCdnUrl, p.staticImageUrl),
            orderUnitType,
            quantaPerOrderUnit,
            quantaUnitLabelSw: formatUnitShortLabel(orderUnitType, quantaPerOrderUnit, true),
            quantaUnitLabelEn: formatUnitShortLabel(orderUnitType, quantaPerOrderUnit, false),
            wholesaleThresholdUnits: Math.max(1, Number(p.wholesaleThresholdUnits || 2)),
            retailPricePerUnitTzs,
            wholesalePricePerUnitTzs,
            availableQuantaStock: Number(p.availableQuarterQuanta ?? 0),
            isLowStockInDuka: urgentIds.has(p.productId),
          };
        },
      );
      setLiveStoreCatalog(mapped);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setLiveStoreCatalog([]);
      } else {
        setLiveStoreCatalog([]);
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia bidhaa za muuzaji.'
              : 'Failed to load seller catalog.',
        );
      }
    } finally {
      setLoadingCatalog(false);
    }
  };

  const activeCatalog = useMemo(() => {
    if (!selectedStore) return [];
    const items = liveStoreCatalog.filter(
      (item) => item.businessId === selectedStore.businessId,
    );
    return [...items].sort((a, b) => {
      const aLow = a.isLowStockInDuka ? 1 : 0;
      const bLow = b.isLowStockInDuka ? 1 : 0;
      if (aLow !== bLow) return bLow - aLow;
      return a.nameSw.localeCompare(b.nameSw);
    });
  }, [selectedStore, liveStoreCatalog]);

  const lowStockCarouselItems = useMemo(
    () => activeCatalog.filter((item) => item.isLowStockInDuka),
    [activeCatalog],
  );

  const filteredActiveCatalog = useMemo(() => {
    const q = catalogSearchQuery.trim().toLowerCase();
    if (!q) return activeCatalog;
    return activeCatalog.filter(
      (item) =>
        item.nameSw.toLowerCase().includes(q) ||
        item.nameEn.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q),
    );
  }, [activeCatalog, catalogSearchQuery]);

  const adjustProductUnits = (item: CatalogProduct, direction: 1 | -1) => {
    setCartUnitsByProduct((prev) => {
      const current = prev[item.productId] ?? 0;
      const maxUnits = Math.max(0, Math.floor(item.availableQuantaStock / item.quantaPerOrderUnit));
      const next = Math.max(0, Math.min(maxUnits > 0 ? maxUnits : 999, current + direction));
      return { ...prev, [item.productId]: next };
    });
  };

  const cartBreakdown = useMemo(() => {
    if (!selectedStore) {
      return { lines: [], subtotalTzs: 0, deliveryFeeTzs: 0, totalTzs: 0, totalQuanta: 0 };
    }

    const lines: Array<{
      item: CatalogProduct;
      units: number;
      quanta: number;
      unitPriceTzs: number;
      lineTotalTzs: number;
      wholesaleApplied: boolean;
    }> = [];
    let subtotalTzs = 0;
    let totalQuanta = 0;

    for (const item of activeCatalog) {
      const units = cartUnitsByProduct[item.productId] ?? 0;
      if (units <= 0) continue;
      const wholesaleApplied = units >= item.wholesaleThresholdUnits;
      const unitPriceTzs = wholesaleApplied
        ? item.wholesalePricePerUnitTzs
        : item.retailPricePerUnitTzs;
      const lineTotalTzs = units * unitPriceTzs;
      const quanta = units * item.quantaPerOrderUnit;

      subtotalTzs += lineTotalTzs;
      totalQuanta += quanta;
      lines.push({ item, units, quanta, unitPriceTzs, lineTotalTzs, wholesaleApplied });
    }

    const deliveryFeeTzs = lines.length > 0 ? selectedStore.deliveryFeeTzs : 0;
    return {
      lines,
      subtotalTzs,
      deliveryFeeTzs,
      totalTzs: subtotalTzs + deliveryFeeTzs,
      totalQuanta,
    };
  }, [selectedStore, activeCatalog, cartUnitsByProduct]);

  const queueRealOfflineOrder = async () => {
    if (!selectedStore || cartBreakdown.lines.length === 0) return;
    const idempotencyKey = crypto.randomUUID();
    const orderChannel = selectedStore.kind === 'SUPPLIER' ? 'SUPPLIER_TO_WHOLESALER' : undefined;
    const compactItems = cartBreakdown.lines
      .map((l) => `${l.item.sku}:${l.units}`)
      .join(',');

    await putQueuedOrder({
      idempotencyKey,
      sellerBusinessId: selectedStore.businessId,
      sellerHub: selectedStore.name,
      compactSmsBody: compactItems,
      totalTzs: cartBreakdown.totalTzs,
      ...(orderChannel ? { orderChannel } : {}),
      deliveryFeeTzs: cartBreakdown.deliveryFeeTzs,
      items: cartBreakdown.lines.map((l) => ({
        productId: l.item.productId,
        unitType: l.item.orderUnitType,
        quantity: l.units,
        ...(l.item.supplierListingId
          ? { supplierListingId: l.item.supplierListingId }
          : {}),
      })),
      clientCreatedAt: new Date().toISOString(),
      syncStatus: 'QUEUED_OFFLINE',
      retryCount: 0,
    });

    await refreshQueueCount();
    setFloatingToast({
      title: isSw
        ? `Oda Imewekwa Foleni (QUEUED_OFFLINE · ${selectedStore.name})`
        : `Order Queued for Sync (QUEUED_OFFLINE · ${selectedStore.name})`,
      detail: `${compactItems} · TZS ${cartBreakdown.totalTzs.toLocaleString('en-US')}`,
    });
    setCartUnitsByProduct({});
    setCheckoutSheetOpen(false);
    setScreen('HOME');
  };

  const handlePlaceOrder = async () => {
    if (!selectedStore || cartBreakdown.lines.length === 0) return;
    setApiError(null);

    if (!navigator.onLine) {
      setBackendOffline(true);
      await queueRealOfflineOrder();
      return;
    }

    setSubmittingOrder(true);
    try {
      const isSupplierOrder = selectedStore.kind === 'SUPPLIER';
      const orderChannel = isSupplierOrder ? 'SUPPLIER_TO_WHOLESALER' : undefined;
      const orderItems = cartBreakdown.lines.map((l) => ({
        productId: l.item.productId,
        unitType: l.item.orderUnitType,
        quantity: l.units,
        ...(l.item.supplierListingId
          ? { supplierListingId: l.item.supplierListingId }
          : {}),
      }));

      let deliveryFeeTzs = cartBreakdown.deliveryFeeTzs;
      if (isSupplierOrder) {
        // Supplier B2B delivery is server-authoritative: quote first, then submit
        // the exact fee returned by the pricing engine.
        const quote = await SokoApiClient.post<{ deliveryFeeTzs: number }>(
          '/pricing/calculate-quote',
          {
            sellerBusinessId: selectedStore.businessId,
            orderChannel,
            deliveryFeeTzs: 0,
            items: orderItems,
          },
        );
        deliveryFeeTzs = Number(quote.deliveryFeeTzs ?? 0);
      }

      const resp = await SokoApiClient.post<{
        orderId: string;
        orderRef: string;
        status: 'PLACED' | 'DISPATCHED';
        routingOutputCode: 'ROUTED_PLATFORM_MANAGED_HELPDESK' | 'ROUTED_DIRECT_MERCHANT_DB';
        expectedTotalTzs: number;
      }>('/marketplace/orders/submit-request', {
        sellerBusinessId: selectedStore.businessId,
        originChannel: 'PWA_ONLINE',
        paymentMethod: 'CASH',
        ...(orderChannel ? { orderChannel } : {}),
        deliveryFeeTzs,
        items: orderItems,
      });

      setFloatingToast({
        title: isSw
          ? `Oda yako imepokelewa (${selectedStore.name})!`
          : `Order placed with ${selectedStore.name}!`,
        detail: `Oda #${resp.orderRef} · ${formatRoutingLabel(resp.routingOutputCode, locale)} · TZS ${Number(resp.expectedTotalTzs).toLocaleString('en-US')}`,
      });

      setCartUnitsByProduct({});
      setCheckoutSheetOpen(false);
      setScreen('HOME');
      await loadLiveHome();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        await queueRealOfflineOrder();
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Oda imekataliwa na mfumo.'
              : 'Backend rejected order submission.',
        );
      }
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleCancelOrder = async (order: DispatchedOrderRecord) => {
    setApiError(null);
    if (!navigator.onLine || !isUuid(order.orderId)) {
      setBackendOffline(true);
      return;
    }

    try {
      await SokoApiClient.post(`/orders/${order.orderId}/cancel`, {
        reason: 'Cancelled by buyer from Sokoni workspace',
      });
      setFloatingToast({
        title: isSw ? `Oda ${order.orderRef8} Imeghairiwa` : `Order ${order.orderRef8} Cancelled`,
        detail: isSw ? 'Hisa zimerejeshwa kwa muuzaji.' : 'Reserved Quarter-Quanta restored.',
      });
      await loadLiveHome();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kughairi oda.'
              : 'Failed to cancel order.',
        );
      }
    }
  };

  const activePinOrder = orders.find((o) => o.orderId === activePinOrderId) ?? null;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Top Status Banner */}
      <div className="bg-white border border-slate-100 rounded-lg px-4 py-3 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          {isOnline && !backendOffline ? (
            <>
              <Wifi className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              <span className="text-slate-900">
                {isSw ? 'Mtandao Uko Sawa.' : 'Connected to SokoKuu.'}
              </span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-amber-600" aria-hidden="true" />
              <span className="text-amber-800">
                {isSw ? 'Nje ya Mtandao — Foleni ya IndexedDB' : 'Offline — Local Queue Active'}
              </span>
            </>
          )}
          {queuedOfflineCount > 0 && (
            <span className="text-[11px] font-mono bg-amber-50 border border-amber-200 text-amber-900 px-2 py-0.5 rounded">
              {queuedOfflineCount} QUEUED_OFFLINE
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => void loadLiveHome()}
          disabled={loadingHubs}
          className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 cursor-pointer inline-flex items-center gap-1"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingHubs ? 'animate-spin' : ''}`} />
          <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
        </button>
      </div>

      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          retrying={loadingHubs}
          onRetry={() => void loadLiveHome()}
        />
      )}

      {apiError && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg p-3.5 text-xs text-red-900 flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
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

      {floatingToast && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 shadow-sm flex items-start justify-between gap-4"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-slate-900">{floatingToast.title}</div>
              <div className="text-xs font-mono text-slate-700 break-all">{floatingToast.detail}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFloatingToast(null)}
            className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
            aria-label="Close notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* SCREEN 1: DASHBOARD HOME VIEW */}
      {screen === 'HOME' && (
        <div className="space-y-6">
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-100 rounded-lg p-5 shadow-sm space-y-1.5">
              <div className="text-xs font-medium text-slate-500">Cash Inayohitajika Leo</div>
              <div className="text-3xl font-bold font-mono tabular-nums text-emerald-600">
                TZS {cashNeededTodayTzs.toLocaleString('en-US')}
              </div>
              <div className="text-xs text-slate-500">
                {isSw
                  ? 'Jumla ya oda zilizo njiani (PLACED / DISPATCHED) zinazosubiri malipo ya mlangoni'
                  : 'Total cash required today for active orders awaiting CoD settlement'}
              </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-lg p-5 shadow-sm space-y-1.5">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Oda Zilizokamilika Leo (DELIVERED)' : 'Settled Cash Today (DELIVERED)'}
              </div>
              <div className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                TZS {settledTodayTzs.toLocaleString('en-US')}
              </div>
              <div className="text-xs text-slate-500">
                {isSw
                  ? 'Zimethibitishwa kwa PIN ya Mnunuzi mlangoni'
                  : 'Reconciled via Doorstep Buyer PIN'}
              </div>
            </div>
          </section>

          <button
            type="button"
            onClick={() => setScreen('DIRECTORY')}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg p-6 text-left flex items-center justify-between gap-4 transition-colors cursor-pointer shadow-sm"
          >
            <div className="space-y-1">
              <div className="text-xl font-bold">Nenda Sokoni 🛒</div>
              <div className="text-xs text-emerald-50">
                {isSw
                  ? 'Gundua maduka ya jumla yaliyo karibu nawe na agiza kwa Bei ya Jumla.'
                  : 'Discover nearby wholesale hubs and place store-isolated CoD orders.'}
              </div>
            </div>
            <ShoppingBag className="w-8 h-8 text-white shrink-0" aria-hidden="true" />
          </button>

          <section className="bg-white border border-slate-100 rounded-lg shadow-sm overflow-hidden">
            <div className="shrink-0 px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">
                {isSw
                  ? 'Oda Zako & Mizigo Inayokuja (Doorstep PIN)'
                  : 'Your Orders & Active Deliveries'}
              </h2>
              <span className="text-xs font-mono text-slate-500">
                {orders.filter((o) => o.status === 'DISPATCHED' || o.status === 'PLACED').length}{' '}
                active
              </span>
            </div>

            {loadingHubs && orders.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                {isSw ? 'Inapakia oda zako...' : 'Loading orders...'}
              </div>
            ) : orders.length === 0 ? (
              <div className="p-4">
                <EmptyStateCard
                  locale={locale}
                  titleSw="Hakuna rekodi bado"
                  titleEn="No records yet"
                  descriptionSw='Huna oda iliyorekodiwa kwenye PostgreSQL bado. Bofya "Nenda Sokoni" kuanza.'
                  descriptionEn='No orders exist in PostgreSQL yet. Click "Nenda Sokoni" to start sourcing.'
                />
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {orders.map((order) => (
                  <div
                    key={order.orderId}
                    className="p-4 sm:px-5 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-slate-900">
                          {order.orderRef8}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-slate-700">{order.sellerName}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold ${
                            order.status === 'DELIVERED'
                              ? 'text-emerald-600'
                              : order.status === 'CANCELLED'
                                ? 'text-slate-400'
                                : 'text-amber-700'
                          }`}
                        >
                          {order.status === 'DISPATCHED'
                            ? isSw
                              ? 'Mzigo Upo Njiani'
                              : 'In Transit'
                            : formatOrderStatusLabel(order.status, locale)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">{order.itemsSummary}</div>
                      <div className="text-xs font-mono text-slate-700">
                        <span className="font-bold text-emerald-600">
                          TZS {order.totalCashDueTzs.toLocaleString('en-US')}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {order.status === 'PLACED' && (
                        <button
                          type="button"
                          onClick={() => void handleCancelOrder(order)}
                          className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-red-700 border border-red-200 rounded-md hover:bg-red-50 cursor-pointer"
                        >
                          {isSw ? 'Ghairi Oda' : 'Cancel Order'}
                        </button>
                      )}
                      {order.status === 'DISPATCHED' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setActivePinOrderId(order.orderId);
                            setScreen('PIN_TERMINAL');
                          }}
                          className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-xs"
                        >
                          <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{isSw ? 'Pokea Mzigo (PIN Yangu)' : 'Receive Order (My PIN)'}</span>
                        </button>
                      ) : order.status === 'DELIVERED' ? (
                        <span className="text-xs font-semibold text-emerald-600">
                          {formatOrderStatusLabel('SETTLED', locale)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* SCREEN 2: SOKONI DIRECTORY VIEW */}
      {screen === 'DIRECTORY' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <button
              type="button"
              onClick={() => setScreen('HOME')}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-emerald-600 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{isSw ? 'Rudi Nyumbani' : 'Dashboard Home'}</span>
            </button>
            <span className="text-xs font-mono text-emerald-600 font-semibold">
              {hubs.length} {isSw ? directoryLabels.countSw : directoryLabels.countEn}
            </span>
          </div>

          {loadingHubs && hubs.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-xs text-slate-500">
              {isSw ? directoryLabels.loadingSw : directoryLabels.loadingEn}
            </div>
          ) : hubs.length === 0 ? (
            <EmptyStateCard
              locale={locale}
              titleSw={directoryLabels.emptyTitleSw}
              titleEn={directoryLabels.emptyTitleEn}
              descriptionSw={directoryLabels.emptySw}
              descriptionEn={directoryLabels.emptyEn}
            />
          ) : (
            <div className="space-y-3">
              {hubs.map((hub) => (
                <article
                  key={hub.businessId}
                  className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`w-12 h-12 rounded-full border flex items-center justify-center shrink-0 font-mono font-bold text-sm overflow-hidden ${hub.brandRingColor}`}
                    >
                      {hub.logoUrl ? (
                        <img src={hub.logoUrl} alt={hub.name} className="w-full h-full object-cover" />
                      ) : (
                        hub.initials
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <h3 className="text-sm font-bold text-slate-900 truncate">
                        {hub.name}
                        {hub.kind === 'SUPPLIER' && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-800 align-middle">
                            {isSw ? 'MSAMBIZAJI' : 'SUPPLIER'}
                          </span>
                        )}
                      </h3>
                      <div className="text-xs text-slate-500 truncate">{hub.ward}</div>
                      <div className="text-xs font-mono font-semibold text-emerald-600 tabular-nums">
                        📍 Mita {hub.distanceMeters} karibu
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleOpenStore(hub)}
                    className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                  >
                    Fungua Duka
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SCREEN 3: ISOLATED STORE CATALOG */}
      {screen === 'CATALOG' && selectedStore && (
        <section className="space-y-4 pb-20">
          <div className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedStore(null);
                setCartUnitsByProduct({});
                setScreen('DIRECTORY');
              }}
              className="inline-flex items-center gap-2 text-sm font-bold text-slate-900 hover:text-emerald-600 cursor-pointer truncate"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" />
              <span className="truncate">{selectedStore.name}</span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSmartGridMode((prev) => !prev);
                  setSmartReorderMode(false);
                }}
                className={`min-h-[40px] px-3 py-2 text-xs font-semibold rounded-md border whitespace-nowrap cursor-pointer transition-colors ${
                  smartGridMode
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                {smartGridMode
                  ? isSw
                    ? 'Mwonekano wa Kawaida'
                    : 'Standard Grid'
                  : 'Smart Grid View'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setSmartReorderMode((prev) => !prev);
                  setSmartGridMode(false);
                }}
                className={`min-h-[40px] px-3 py-2 text-xs font-semibold rounded-md border whitespace-nowrap cursor-pointer transition-colors ${
                  smartReorderMode
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {smartReorderMode
                  ? isSw
                    ? 'Mwonekano wa Kawaida'
                    : 'Standard Grid'
                  : 'Smart Re-Order View'}
              </button>

              <button
                type="button"
                onClick={() => setCheckoutSheetOpen(true)}
                disabled={cartBreakdown.lines.length === 0}
                className="inline-flex items-center gap-2 min-h-[40px] px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-500 whitespace-nowrap cursor-pointer shadow-xs"
              >
                <ShoppingCart className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="font-mono tabular-nums">
                  TZS {cartBreakdown.totalTzs.toLocaleString('en-US')}
                </span>
              </button>
            </div>
          </div>

          {smartGridMode && (
            <SmartGridStoreCatalog
              storeName={selectedStore.name}
              sellerBusinessId={selectedStore.businessId}
              locale={locale}
              onClose={() => setSmartGridMode(false)}
            />
          )}

          {smartReorderMode && !smartGridMode && (
            <SmartStoreCatalog
              storeName={selectedStore.name}
              sellerBusinessId={selectedStore.businessId}
              locale={locale}
              onClose={() => setSmartReorderMode(false)}
            />
          )}

          {!smartReorderMode && !smartGridMode && (
            <>
              <div className="bg-white border border-slate-100 rounded-lg p-3 shadow-sm">
                <label htmlFor="sokoni-catalog-search" className="sr-only">
                  {isSw ? 'Tafuta bidhaa kwa jina au SKU' : 'Search products by title or SKU'}
                </label>
                <div className="relative flex items-center">
                  <Search
                    className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="sokoni-catalog-search"
                    type="text"
                    value={catalogSearchQuery}
                    onChange={(e) => setCatalogSearchQuery(e.target.value)}
                    className="w-full py-2.5 pl-9 pr-9 border border-slate-200 rounded-md text-xs bg-slate-50 text-slate-900 font-medium focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none"
                    placeholder={
                      isSw
                        ? 'Tafuta bidhaa mtaani (e.g. Unga, Mafuta, SKU)...'
                        : 'Search store catalog (e.g. Flour, Oil, SKU)...'
                    }
                  />
                  {catalogSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setCatalogSearchQuery('')}
                      aria-label={isSw ? 'Futa utafutaji' : 'Clear search'}
                      className="absolute right-2.5 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              {lowStockCarouselItems.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-1.5 text-emerald-700 font-bold text-xs uppercase tracking-wider">
                      <Zap className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                      <h3>
                        {isSw
                          ? 'Inashauriwa Ununue (Duka Lako Limeshaisha)'
                          : 'Recommended Re-Order (Low Shelf Stock)'}
                      </h3>
                    </div>
                    {catalogSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setCatalogSearchQuery('')}
                        className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                      >
                        {isSw ? 'Onyesha zote' : 'Show all'}
                      </button>
                    )}
                  </div>

                  <div className="sk-scroll-x gap-2.5 pb-1 max-w-full">
                    {lowStockCarouselItems.map((suggest) => {
                      const active =
                        catalogSearchQuery.toLowerCase() === suggest.sku.toLowerCase();
                      return (
                        <button
                          type="button"
                          key={suggest.productId}
                          onClick={() =>
                            setCatalogSearchQuery((prev) =>
                              prev.toLowerCase() === suggest.sku.toLowerCase() ? '' : suggest.sku,
                            )
                          }
                          className={`flex-shrink-0 border p-3 rounded-lg flex items-center gap-3 cursor-pointer transition-colors text-left shadow-xs ${
                            active
                              ? 'bg-emerald-100 border-emerald-500 ring-1 ring-emerald-500'
                              : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100/70'
                          }`}
                        >
                          <div className="w-8 h-8 rounded-md bg-emerald-600 text-white flex items-center justify-center shrink-0">
                            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 text-xs max-w-[160px] truncate">
                              {isSw ? suggest.nameSw : suggest.nameEn}
                            </div>
                            <div className="text-[10px] font-mono text-emerald-700 font-semibold uppercase mt-0.5">
                              {suggest.sku} · {isSw ? 'Low Stock katika Rafu' : 'Low Shelf Stock'}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {loadingCatalog ? (
                <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-xs text-slate-500">
                  {isSw ? 'Inapakia orodha ya bidhaa...' : 'Loading store catalog...'}
                </div>
              ) : filteredActiveCatalog.length === 0 ? (
                <EmptyStateCard
                  locale={locale}
                  titleSw="Hakuna rekodi bado"
                  titleEn="No records yet"
                  descriptionSw="Duka hili halijaweka bidhaa zinazouzwa katika PostgreSQL bado."
                  descriptionEn="No active catalog items exist in PostgreSQL for this merchant yet."
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {filteredActiveCatalog.map((item) => {
                    const units = cartUnitsByProduct[item.productId] ?? 0;
                    const quanta = units * item.quantaPerOrderUnit;
                    const wholesaleApplied = units >= item.wholesaleThresholdUnits;
                    const unitPriceTzs = wholesaleApplied
                      ? item.wholesalePricePerUnitTzs
                      : item.retailPricePerUnitTzs;

                    return (
                      <article
                        key={item.productId}
                        className="bg-white border border-slate-100 rounded-lg shadow-sm overflow-hidden flex flex-col justify-between relative"
                      >
                        {item.isLowStockInDuka && (
                          <span className="absolute top-2.5 left-2.5 z-10 inline-flex items-center gap-1 bg-rose-500 text-white font-bold text-[10px] px-2 py-0.5 rounded uppercase tracking-wider shadow-xs">
                            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                            <span>Re-Order</span>
                          </span>
                        )}
                        <div className="p-4 space-y-3">
                          {!isLowDataModeActive ? (
                            <div className="h-32 w-full rounded-md bg-white border border-slate-100 overflow-hidden flex items-center justify-center p-2">
                              <img
                                src={item.imageSrc}
                                alt={isSw ? item.nameSw : item.nameEn}
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-contain"
                              />
                            </div>
                          ) : (
                            <div className="h-16 rounded-md bg-slate-50 border border-slate-100 flex items-center justify-center text-xs font-mono text-slate-500">
                              {item.sku} · LOW-DATA ASSET
                            </div>
                          )}

                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-mono text-slate-500">
                                {item.sku} ·{' '}
                                {isSw ? item.quantaUnitLabelSw : item.quantaUnitLabelEn}
                              </span>
                              {wholesaleApplied && (
                                <span className="font-semibold text-emerald-600">
                                  Bei ya Jumla 🎉
                                </span>
                              )}
                            </div>
                            <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                              {isSw ? item.nameSw : item.nameEn}
                            </h3>
                          </div>
                        </div>

                        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between gap-3">
                          <div>
                            <div
                              className={`text-sm font-bold font-mono tabular-nums ${
                                wholesaleApplied ? 'text-emerald-600' : 'text-slate-900'
                              }`}
                            >
                              TZS {unitPriceTzs.toLocaleString('en-US')}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                              {units} × {item.orderUnitType} ({(quanta * 0.25).toFixed(2)} KG/L)
                            </div>
                          </div>

                          <div className="inline-flex items-center border border-slate-200 rounded-md bg-white">
                            <button
                              type="button"
                              aria-label={`Decrease ${item.sku}`}
                              onClick={() => adjustProductUnits(item, -1)}
                              className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <span className="w-8 text-center text-sm font-bold font-mono tabular-nums text-slate-900">
                              {units}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase ${item.sku}`}
                              onClick={() => adjustProductUnits(item, 1)}
                              className="min-w-[40px] min-h-[40px] flex items-center justify-center bg-emerald-600 text-white hover:bg-emerald-700 rounded-r-md cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {cartBreakdown.lines.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs text-slate-500">
                      {cartBreakdown.totalQuanta} Quanta · {selectedStore.name}
                    </div>
                    <div className="text-lg font-bold font-mono tabular-nums text-emerald-600">
                      TZS {cartBreakdown.totalTzs.toLocaleString('en-US')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCheckoutSheetOpen(true)}
                    className="min-h-[44px] px-5 py-2.5 text-sm font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 whitespace-nowrap cursor-pointer shadow-xs"
                  >
                    {isSw ? 'Fungua Kikapu' : 'Review Checkout Sheet'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* SCREEN 4: SLIDE-UP CHECKOUT SHEET */}
      {checkoutSheetOpen && selectedStore && (
        <div
          className="sk-dialog-overlay"
          role="dialog"
          aria-modal="true"
        >
          <div className="sk-dialog-panel">
            <div className="shrink-0 px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {isSw ? 'Kikapu cha Oda' : 'Slide-Up Checkout Sheet'}
                </h3>
                <p className="text-xs text-slate-500">{selectedStore.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutSheetOpen(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-500 hover:text-slate-900 cursor-pointer"
                aria-label="Close drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="sk-dialog-body p-5 space-y-4 sk-safe-bottom">
              <div className="divide-y divide-slate-100">
                {cartBreakdown.lines.map(({ item, units, quanta, lineTotalTzs, wholesaleApplied }) => (
                  <div
                    key={item.productId}
                    className="py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">
                        {isSw ? item.nameSw : item.nameEn}
                      </div>
                      <div className="text-slate-500 font-mono">
                        {units} × {item.orderUnitType} ({quanta} Quanta · {(quanta * 0.25).toFixed(2)}{' '}
                        KG/L)
                        {wholesaleApplied && (
                          <span className="text-emerald-600 font-semibold"> · Bei ya Jumla 🎉</span>
                        )}
                      </div>
                    </div>
                    <div className="font-mono font-bold tabular-nums text-slate-900 whitespace-nowrap">
                      TZS {lineTotalTzs.toLocaleString('en-US')}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
                <div className="flex items-center justify-between text-slate-600">
                  <span>{isSw ? 'Jumla Ndogo (CoD)' : 'CoD Merchandise Subtotal'}</span>
                  <span className="font-mono font-semibold tabular-nums">
                    TZS {cartBreakdown.subtotalTzs.toLocaleString('en-US')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    <span>
                      {cartBreakdown.deliveryFeeTzs === 0
                        ? isSw
                          ? 'Usafiri Bure'
                          : 'FREE DELIVERY'
                        : isSupplierAudience
                          ? isSw
                            ? 'Ada ya Usafiri (Muuzaji)'
                            : 'Supplier Delivery Fee'
                          : isSw
                            ? 'Usafiri wa Dereva'
                            : 'Independent Driver Fee'}
                    </span>
                  </span>
                  <span className="font-mono font-semibold tabular-nums">
                    {cartBreakdown.deliveryFeeTzs === 0
                      ? isSw
                        ? 'BURE'
                        : 'TZS 0'
                      : `TZS ${cartBreakdown.deliveryFeeTzs.toLocaleString('en-US')}`}
                  </span>
                </div>
                <div className="flex items-baseline justify-between pt-2 border-t border-slate-100">
                  <span className="text-sm font-bold text-slate-900">
                    {isSw ? 'Taslimu ya Kulipa Mlangoni' : 'Total Cash on Delivery'}
                  </span>
                  <span className="text-xl font-bold font-mono tabular-nums text-emerald-600">
                    TZS {cartBreakdown.totalTzs.toLocaleString('en-US')}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={submittingOrder}
                onClick={() => void handlePlaceOrder()}
                className="w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white rounded-md transition-colors cursor-pointer shadow-xs disabled:opacity-60 bg-emerald-600 hover:bg-emerald-700"
              >
                {submittingOrder
                  ? isSw
                    ? 'Inatuma Oda...'
                    : 'Submitting Order...'
                  : isSw
                    ? 'Thibitisha & Agiza (CoD)'
                    : 'Confirm & Dispatch CoD Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SCREEN 5: ORDER CONFIRMATION */}
      {screen === 'PIN_TERMINAL' && activePinOrder && (
        <section className="max-w-md mx-auto space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-xs flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-900">
              Order Confirmation
            </span>
            <span className="text-[11px] font-mono font-bold text-emerald-700">
              {activePinOrder.orderRef8}
            </span>
          </div>

          <IsolatedQrVerificationTerminal
            locale={locale}
            defaultDeviceOwner="RETAILER_PHONE"
            orderId={activePinOrder.orderId}
            orderRef8={activePinOrder.orderRef8}
            destinationLabel={activePinOrder.sellerName}
            expectedCashTzs={activePinOrder.totalCashDueTzs}
            buyerRoleLabel={buyerTerminalRoleLabel}
            onBack={() => setScreen('HOME')}
            onVerifiedSuccess={(consumedToken) => {
              setOrders((prev) =>
                prev.map((o) =>
                  o.orderId === activePinOrder.orderId ? { ...o, status: 'DELIVERED' } : o,
                ),
              );
              setFloatingToast({
                title: isSw
                  ? `Order Confirmation ya ${activePinOrder.orderRef8} Imekamilika`
                  : `Order Confirmation ${activePinOrder.orderRef8} Settled`,
                detail: `QR ${consumedToken} consumed · TZS ${activePinOrder.totalCashDueTzs.toLocaleString('en-US')} settled.`,
              });
              void loadLiveHome();
            }}
          />
        </section>
      )}
    </div>
  );
}
