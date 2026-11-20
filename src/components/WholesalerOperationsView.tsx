import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Download,
  KeyRound,
  PackagePlus,
  RefreshCw,
  Search,
  Send,
  Store,
  Truck,
  X,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { formatOrderStatusLabel } from '../lib/sokoManagedState';
import { useFocusOrderScroll, type FocusOrderTarget } from '../lib/sokoFocusOrder';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { WholesalerEodReconciliation } from './WholesalerEodReconciliation';
import { HybridAnalyticsDashboard } from './HybridAnalyticsDashboard';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

type WholesalerTab = 'riders' | 'eod' | 'analytics' | 'market' | 'restock';

type SupplierPackagingUnit =
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

interface SupplierListingRow {
  listingId: string;
  supplierBusinessId: string;
  supplierName: string;
  productId: string | null;
  canonicalSku: string;
  nameSw: string;
  nameEn: string;
  imagekitCdnUrl: string;
  systemUnitCode: string;
  quarterQuantaPerUnit: number;
  supplierBulkPriceTzs: string;
  minOrderQuantity: number;
  maxOrderQuantity: number;
  isAvailable: boolean;
  isFreeDeliveryEnabled: boolean;
  freeDeliveryMinOrderTzs: string;
  standardDeliveryFeeTzs: string;
  deliveryCoverageRegions: string[];
}

interface SupplierOrderQuote {
  sellerBusinessId: string;
  sellerBusinessName: string;
  sellerTier: string;
  orderChannel: string;
  currency: 'TZS';
  itemsSubtotalTzs: number;
  deliveryFeeTzs: number;
  expectedTotalTzs: number;
  totalQuarterQuanta: number;
  lines: Array<{
    productId: string;
    unitType: SupplierPackagingUnit;
    quantity: number;
    quarterQuantaPerUnit: number;
    totalQuarterQuanta: number;
    unitPriceTzs: number;
    lineTotalTzs: number;
    pricingRuleReason: string;
  }>;
}

interface SupplierOrderPayload {
  sellerBusinessId: string;
  orderChannel: 'SUPPLIER_TO_WHOLESALER';
  deliveryFeeTzs: number;
  items: Array<{
    productId: string;
    unitType: SupplierPackagingUnit;
    quantity: number;
    supplierListingId: string;
  }>;
}

interface MarketProductRow {
  productId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitPriceTzs: number;
  cartonPriceTzs: number;
  cartonUnits: number;
  quantaPerSealedPackage: number;
  sealedParentUnitType: string;
  lowStockThresholdQuanta: number;
  availableQuarterQuanta: number;
  sealedBulkPackagesStock: number;
}

interface ProductVipimoDraft {
  productId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitPriceTzs: string;
  cartonPriceTzs: string;
  cartonUnits: string;
  quantaPerSealedPackage: string;
  sealedBulkPackagesStock: string;
  baseQuarterQuantaStock: string;
  sealedParentUnitType: string;
}

interface ActiveRiderTrack {
  riderId: string;
  riderName: string;
  vehiclePlate: string;
  vehicleType: string;
  activeWard: string;
  activeDropsCount: number;
  completedDropsCount: number;
  cashOnStreetsTzs: number;
  lastPinSyncEat: string;
  routeStatus: 'ON_ROUTE' | 'RETURNING_WITH_CASH' | 'CLEARED';
}

interface SellingOrderSummary {
  orderId: string;
  orderRef: string;
  buyerName: string;
  buyerPhoneE164: string;
  expectedTotalTzs: number;
  status: 'PLACED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED' | 'DISPUTED';
  placedAt: string;
  itemsSummary: string;
}

interface BackendEodDriversResponse {
  sellerBusinessId: string;
  count: number;
  drivers: Array<{
    driverId: string;
    driverName: string;
    phoneE164: string;
    unsettledOrdersCount: number;
    expectedTotalTzs: number;
    collectedTotalTzs: number;
    outstandingBalanceTzs: number;
    cashTotalTzs: number;
    mpesaTotalTzs: number;
    tigoPesaTotalTzs: number;
    disputedOrPendingCount: number;
    unverifiedMobileMoneyCount: number;
  }>;
}

interface BackendOrdersResponse {
  count: number;
  orders: Array<{
    orderId: string;
    orderRef: string;
    buyerName: string;
    buyerPhoneE164: string;
    expectedTotalTzs: number;
    status: 'PLACED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED' | 'DISPUTED';
    placedAt: string;
    items: Array<{
      smsItemCode?: string;
      nameSw?: string;
      unitType: string;
      quantity: number;
    }>;
  }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}

function supplierPackagingUnit(unitCode: string, quarterQuantaPerUnit: number): SupplierPackagingUnit {
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

export function WholesalerOperationsView({
  locale = 'en',
  businessId,
  focusOrder,
}: {
  locale?: Locale;
  businessId?: string | null;
  focusOrder?: FocusOrderTarget | null;
}) {
  const isSw = locale === 'sw';
  useFocusOrderScroll(focusOrder, true);
  const [subTab, setSubTab] = useState<WholesalerTab>('riders');
  const [wardFilter, setWardFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [riders, setRiders] = useState<ActiveRiderTrack[]>([]);
  const [availableDrivers, setAvailableDrivers] = useState<
    Array<{ driverId: string; driverName: string }>
  >([]);
  const [selectedDriverByOrder, setSelectedDriverByOrder] = useState<Record<string, string>>({});
  const [sellingOrders, setSellingOrders] = useState<SellingOrderSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [dispatchingOrderId, setDispatchingOrderId] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [dispatchNotice, setDispatchNotice] = useState<{
    orderRef: string;
    buyerPin: string;
    driverPin: string;
    expectedCashTzs: number;
  } | null>(null);

  const [marketProducts, setMarketProducts] = useState<MarketProductRow[]>([]);
  const [offersFreeDelivery, setOffersFreeDelivery] = useState<boolean>(false);
  const [savingFreeDelivery, setSavingFreeDelivery] = useState<boolean>(false);
  const [selectedMarketQty, setSelectedMarketQty] = useState<Record<string, number>>({});
  const [publishingMarket, setPublishingMarket] = useState<boolean>(false);
  const [marketNotice, setMarketNotice] = useState<string | null>(null);
  const [editingVipimo, setEditingVipimo] = useState<ProductVipimoDraft | null>(null);
  const [savingVipimo, setSavingVipimo] = useState<boolean>(false);

  const [supplierListings, setSupplierListings] = useState<SupplierListingRow[]>([]);
  const [supplierRestockQty, setSupplierRestockQty] = useState<Record<string, number>>({});
  const [supplierQuotes, setSupplierQuotes] = useState<SupplierOrderQuote[]>([]);
  const [quotingSupplierOrder, setQuotingSupplierOrder] = useState<boolean>(false);
  const [placingSupplierOrder, setPlacingSupplierOrder] = useState<boolean>(false);
  const [restockNotice, setRestockNotice] = useState<string | null>(null);

  const loadWholesalerData = useCallback(async () => {
    if (!SokoApiClient.hasAccessToken()) {
      setRiders([]);
      setAvailableDrivers([]);
      setSellingOrders([]);
      return;
    }

    setLoading(true);
    setApiError(null);
    setBackendOffline(false);
    try {
      const bizQuery = isUuid(businessId) ? `?businessId=${encodeURIComponent(businessId)}` : '';
      const [eodRes, ordersRes] = await Promise.all([
        SokoApiClient.get<BackendEodDriversResponse>(`/wholesale/eod/drivers${bizQuery}`),
        SokoApiClient.get<BackendOrdersResponse>('/orders/my-orders?scope=selling'),
      ]);

      const driverTracks: ActiveRiderTrack[] = (eodRes?.drivers ?? []).map((d) => ({
        riderId: d.driverId,
        riderName: d.driverName,
        vehiclePlate: d.phoneE164,
        vehicleType: isSw ? 'Dereva wa Usambazaji' : 'Delivery Fleet',
        activeWard: 'Dar es Salaam',
        activeDropsCount: d.disputedOrPendingCount,
        completedDropsCount: Math.max(0, d.unsettledOrdersCount - d.disputedOrPendingCount),
        cashOnStreetsTzs: d.cashTotalTzs,
        lastPinSyncEat: `${d.unsettledOrdersCount} orders`,
        routeStatus:
          d.cashTotalTzs > 0
            ? d.disputedOrPendingCount > 0
              ? 'ON_ROUTE'
              : 'RETURNING_WITH_CASH'
            : 'CLEARED',
      }));
      setRiders(driverTracks);
      setAvailableDrivers(
        (eodRes?.drivers ?? []).map((d) => ({
          driverId: d.driverId,
          driverName: d.driverName,
        }))
      );

      setSellingOrders(
        (ordersRes?.orders ?? []).map((o) => ({
          orderId: o.orderId,
          orderRef: o.orderRef,
          buyerName: o.buyerName,
          buyerPhoneE164: o.buyerPhoneE164,
          expectedTotalTzs: Number(o.expectedTotalTzs ?? 0),
          status: o.status,
          placedAt: o.placedAt,
          itemsSummary: o.items
            .map((i) => `${i.smsItemCode ?? i.nameSw ?? 'SKU'} (${i.quantity} × ${i.unitType})`)
            .join(' + '),
        }))
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setRiders([]);
        setAvailableDrivers([]);
        setSellingOrders([]);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia taarifa za usambazaji.'
              : 'Failed to load wholesaler fleet and order queue.'
        );
      }
    } finally {
      setLoading(false);
    }
  }, [businessId, isSw]);

  useEffect(() => {
    void loadWholesalerData();
  }, [loadWholesalerData]);

  const loadMarketData = useCallback(async () => {
    if (!isUuid(businessId) || !SokoApiClient.hasAccessToken()) {
      setMarketProducts([]);
      return;
    }

    setApiError(null);
    setBackendOffline(false);
    try {
      const [settings, products] = await Promise.all([
        SokoApiClient.get<{ businessId: string; offersFreeDelivery: boolean }>(
          `/merchant/market-settings?businessId=${encodeURIComponent(businessId)}`,
        ),
        SokoApiClient.get<MarketProductRow[]>(
          `/products/active?businessId=${encodeURIComponent(businessId)}`,
        ),
      ]);

      setOffersFreeDelivery(Boolean(settings?.offersFreeDelivery));
      setMarketProducts(
        (products ?? []).map((p) => ({
          productId: p.productId,
          sku: p.sku,
          nameSw: p.nameSw,
          nameEn: p.nameEn,
          unitPriceTzs: Number(p.unitPriceTzs ?? 0),
          cartonPriceTzs: Number(p.cartonPriceTzs ?? 0),
          cartonUnits: Number(p.cartonUnits ?? 24),
          quantaPerSealedPackage: Number(p.quantaPerSealedPackage ?? 24),
          sealedParentUnitType: p.sealedParentUnitType ?? 'CARTON',
          lowStockThresholdQuanta: Number(p.lowStockThresholdQuanta ?? 20),
          availableQuarterQuanta: Number(p.availableQuarterQuanta ?? 0),
          sealedBulkPackagesStock: Number(p.sealedBulkPackagesStock ?? 0),
        })),
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia bidhaa za sokoni.'
              : 'Failed to load market products and delivery settings.',
        );
      }
    }
  }, [businessId, isSw]);

  useEffect(() => {
    if (subTab === 'market') {
      void loadMarketData();
    }
  }, [subTab, loadMarketData]);

  const loadSupplierCatalog = useCallback(async () => {
    setApiError(null);
    setBackendOffline(false);
    try {
      const res = await SokoApiClient.get<{ items: SupplierListingRow[] }>(
        '/marketplace/suppliers/catalog',
      );
      const items = Array.isArray(res?.items) ? res.items : [];
      setSupplierListings(items);
      setSupplierRestockQty((prev) => {
        const next: Record<string, number> = {};
        for (const listing of items) {
          next[listing.listingId] = prev[listing.listingId] ?? listing.minOrderQuantity;
        }
        return next;
      });
      setSupplierQuotes([]);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setSupplierListings([]);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : isSw
              ? 'Imeshindikana kupakia orodha ya msambizaji.'
              : 'Failed to load the supplier restock catalog.',
        );
      }
    }
  }, [isSw]);

  useEffect(() => {
    if (subTab === 'restock') {
      void loadSupplierCatalog();
    }
  }, [subTab, loadSupplierCatalog]);

  const buildSupplierOrderPayloads = useCallback(
    (): SupplierOrderPayload[] => {
      const grouped = new Map<string, SupplierOrderPayload>();
      for (const [listingId, rawQuantity] of Object.entries(supplierRestockQty)) {
        const quantity = Math.trunc(Number(rawQuantity));
        const listing = supplierListings.find((entry) => entry.listingId === listingId);
        if (!listing || !listing.productId || !listing.isAvailable || quantity < 1) continue;

        let payload = grouped.get(listing.supplierBusinessId);
        if (!payload) {
          payload = {
            sellerBusinessId: listing.supplierBusinessId,
            orderChannel: 'SUPPLIER_TO_WHOLESALER',
            deliveryFeeTzs: 0,
            items: [],
          };
          grouped.set(listing.supplierBusinessId, payload);
        }
        payload.items.push({
          productId: listing.productId,
          unitType: supplierPackagingUnit(listing.systemUnitCode, listing.quarterQuantaPerUnit),
          quantity,
          supplierListingId: listing.listingId,
        });
      }
      return Array.from(grouped.values());
    },
    [supplierListings, supplierRestockQty],
  );

  const handleQuoteSupplierRestock = async () => {
    setApiError(null);
    setRestockNotice(null);
    setSupplierQuotes([]);
    const payloads = buildSupplierOrderPayloads();
    if (payloads.length === 0) {
      setApiError(
        isSw
          ? 'Chagua angalau orodha moja ya msambizaji iliyo tayari na idadi halali.'
          : 'Select at least one available supplier listing with a valid quantity.',
      );
      return;
    }

    setQuotingSupplierOrder(true);
    try {
      const quotes = await Promise.all(
        payloads.map((payload) =>
          SokoApiClient.post<SupplierOrderQuote>('/pricing/calculate-quote', payload),
        ),
      );
      setSupplierQuotes(quotes);
      setRestockNotice(
        isSw
          ? 'Bei imethibitishwa na server kwa kutumia sera ya msambizaji (B2B).'
          : 'Server-authoritative B2B quote calculated from the supplier delivery policy.',
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : isSw
              ? 'Imeshindikana kuhesabu bei ya oda la msambizaji.'
              : 'Failed to calculate the supplier restock quote.',
        );
      }
    } finally {
      setQuotingSupplierOrder(false);
    }
  };

  const handlePlaceSupplierRestock = async () => {
    setApiError(null);
    setRestockNotice(null);
    const payloads = buildSupplierOrderPayloads();
    if (payloads.length === 0) {
      setApiError(
        isSw
          ? 'Chagua angalau orodha moja ya msambizaji iliyo tayari na idadi halali.'
          : 'Select at least one available supplier listing with a valid quantity.',
      );
      return;
    }

    setPlacingSupplierOrder(true);
    try {
      const orderRefs: string[] = [];
      for (const payload of payloads) {
        const quote = await SokoApiClient.post<SupplierOrderQuote>('/pricing/calculate-quote', payload);
        const receipt = await SokoApiClient.post<{ orderRef?: string }>(
          '/marketplace/orders/submit-request',
          { ...payload, deliveryFeeTzs: quote.deliveryFeeTzs },
        );
        orderRefs.push(receipt?.orderRef ?? quote.sellerBusinessName);
      }
      setRestockNotice(
        isSw
          ? `Oda za B2B zimewasilishwa: ${orderRefs.join(', ')}.`
          : `Supplier B2B order(s) submitted: ${orderRefs.join(', ')}.`,
      );
      setSupplierRestockQty({});
      setSupplierQuotes([]);
      await Promise.all([loadSupplierCatalog(), loadWholesalerData()]);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : isSw
              ? 'Imeshindikana kuwasilisha oda la msambizaji.'
              : 'Failed to submit the supplier restock order.',
        );
      }
    } finally {
      setPlacingSupplierOrder(false);
    }
  };

  const handleToggleFreeDelivery = async () => {
    setApiError(null);
    setMarketNotice(null);
    setSavingFreeDelivery(true);
    try {
      const res = await SokoApiClient.patch<{ offersFreeDelivery: boolean }>(
        '/merchant/market-settings/free-delivery',
        { offersFreeDelivery: !offersFreeDelivery },
      );
      setOffersFreeDelivery(Boolean(res?.offersFreeDelivery));
      setMarketNotice(
        res?.offersFreeDelivery
          ? isSw
            ? 'Usafiri wa bure umewashwa kwenye soko.'
            : 'Free delivery is now enabled on your marketplace storefront.'
          : isSw
            ? 'Usafiri wa bure umezimwa.'
            : 'Free delivery has been disabled.',
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kubadili mpangilio wa usafiri.'
              : 'Failed to update free delivery setting.',
        );
      }
    } finally {
      setSavingFreeDelivery(false);
    }
  };

  const handleToggleMarketProduct = (product: MarketProductRow) => {
    setSelectedMarketQty((prev) => {
      const next = { ...prev };
      if (next[product.productId] && next[product.productId] > 0) {
        delete next[product.productId];
      } else {
        next[product.productId] = 10;
      }
      return next;
    });
  };

  const openVipimoEditor = (product: MarketProductRow) => {
    setApiError(null);
    setMarketNotice(null);
    setEditingVipimo({
      productId: product.productId,
      sku: product.sku,
      nameSw: product.nameSw,
      nameEn: product.nameEn,
      unitPriceTzs: String(product.unitPriceTzs),
      cartonPriceTzs: String(product.cartonPriceTzs),
      cartonUnits: String(product.cartonUnits),
      quantaPerSealedPackage: String(product.quantaPerSealedPackage),
      sealedBulkPackagesStock: String(product.sealedBulkPackagesStock),
      baseQuarterQuantaStock: String(product.availableQuarterQuanta),
      sealedParentUnitType: product.sealedParentUnitType,
    });
  };

  const handleSaveVipimo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVipimo) return;
    setApiError(null);
    setMarketNotice(null);
    setSavingVipimo(true);
    try {
      await SokoApiClient.patch(`/products/${editingVipimo.productId}`, {
        unitPriceTzs: Math.max(0, Math.trunc(Number(editingVipimo.unitPriceTzs))),
        cartonPriceTzs: Math.max(0, Math.trunc(Number(editingVipimo.cartonPriceTzs))),
        cartonUnits: Math.max(1, Math.trunc(Number(editingVipimo.cartonUnits))),
        quantaPerSealedPackage: Math.max(1, Math.trunc(Number(editingVipimo.quantaPerSealedPackage))),
        sealedBulkPackagesStock: Math.max(
          0,
          Math.trunc(Number(editingVipimo.sealedBulkPackagesStock)),
        ),
        baseQuarterQuantaStock: Math.max(
          0,
          Math.trunc(Number(editingVipimo.baseQuarterQuantaStock)),
        ),
        sealedParentUnitType: editingVipimo.sealedParentUnitType,
      });
      setMarketNotice(
        isSw
          ? `Vipimo, bei na stock vya ${editingVipimo.sku} vimehifadhiwa.`
          : `Measurements, prices and stock for ${editingVipimo.sku} saved.`,
      );
      setEditingVipimo(null);
      await loadMarketData();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kuhifadhi vipimo vya bidhaa.'
              : 'Failed to save product measurements.',
        );
      }
    } finally {
      setSavingVipimo(false);
    }
  };

  const handlePublishMarketStock = async () => {
    setApiError(null);
    setMarketNotice(null);

    const items = Object.entries(selectedMarketQty)
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([productId, quantityQuanta]) => ({
        productId,
        quantityQuanta: Math.max(1, Math.trunc(Number(quantityQuanta))),
      }));

    if (items.length === 0) {
      setApiError(
        isSw
          ? 'Chagua angalau bidhaa moja na weka quantity ya kupeleka sokoni.'
          : 'Select at least one product and enter a market quantity.',
      );
      return;
    }

    setPublishingMarket(true);
    try {
      const res = await SokoApiClient.post<{ publishedCount: number }>(
        '/merchant/market-stock',
        { items },
      );
      setMarketNotice(
        isSw
          ? `Bidhaa ${res?.publishedCount ?? items.length} zimepelekwa sokoni kikamilifu.`
          : `${res?.publishedCount ?? items.length} product(s) published to the market shelf.`,
      );
      setSelectedMarketQty({});
      await loadMarketData();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupeleka bidhaa sokoni.'
              : 'Failed to publish products to the market.',
        );
      }
    } finally {
      setPublishingMarket(false);
    }
  };

  const selectedMarketCount = Object.values(selectedMarketQty).filter(
    (qty) => Number(qty) > 0,
  ).length;

  const handleDispatchOrder = async (orderId: string) => {
    setApiError(null);
    const driverUserId = selectedDriverByOrder[orderId];
    if (!isUuid(driverUserId)) {
      setApiError(
        isSw
          ? 'Chagua dereva aliyesajiliwa kabla ya kutuma oda hii.'
          : 'Select a registered driver before dispatching this order.'
      );
      return;
    }
    setDispatchingOrderId(orderId);
    try {
      const resp = await SokoApiClient.post<{
        orderId: string;
        orderRef: string;
        expectedCashAmountTzs: number;
        buyerConfirmationPin: string;
        driverConfirmationPin: string;
      }>(`/orders/${orderId}/dispatch`, { driverUserId });

      setDispatchNotice({
        orderRef: resp.orderRef,
        buyerPin: resp.buyerConfirmationPin,
        driverPin: resp.driverConfirmationPin,
        expectedCashTzs: resp.expectedCashAmountTzs,
      });
      await loadWholesalerData();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kutuma mzigo kwa dereva.'
              : 'Failed to dispatch order.'
        );
      }
    } finally {
      setDispatchingOrderId(null);
    }
  };

  const totalCashOutTzs = riders.reduce((sum, r) => sum + r.cashOnStreetsTzs, 0);
  const activeRidersCount = riders.filter((r) => r.routeStatus !== 'CLEARED').length;
  const openDropsCount = riders.reduce((sum, r) => sum + r.activeDropsCount, 0);

  const filteredRiders = riders.filter((rider) => {
    const matchesWard = wardFilter === 'ALL' || rider.activeWard === wardFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      rider.riderName.toLowerCase().includes(q) ||
      rider.vehiclePlate.toLowerCase().includes(q) ||
      rider.activeWard.toLowerCase().includes(q);
    return matchesWard && matchesSearch;
  });

  const handleDownloadSwahiliCsv = async () => {
    setApiError(null);
    try {
      const bizQuery = isUuid(businessId) ? `?businessId=${encodeURIComponent(businessId)}` : '';
      const blob = await SokoApiClient.downloadBlob(`/hybrid/analytics/export-csv${bizQuery}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sokokuu-mauzo.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakua ripoti ya CSV.'
              : 'Failed to export Swahili ledger CSV.'
        );
      }
    }
  };

  const placedOrders = sellingOrders.filter((o) => o.status === 'PLACED');

  return (
    <div className="space-y-6">
      {backendOffline && (
        <BackendOfflineBanner locale={locale} onRetry={() => void loadWholesalerData()} />
      )}

      {/* Sub-navigation inside Wholesaler Workspace */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="sk-scroll-x items-center gap-1 bg-slate-100 p-1 rounded-lg max-w-full">
          <button
            type="button"
            onClick={() => setSubTab('riders')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              subTab === 'riders'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Truck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Madereva & Oda Zinazoingia' : 'Active Riders & Dispatch Queue'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('eod')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              subTab === 'eod'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Hesabu za Jioni (EOD)' : 'Evening EOD Settlement'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('analytics')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              subTab === 'analytics'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Mapato & Uvunjaji Magunia' : 'Split Revenue & Stock'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('market')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              subTab === 'market'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Store className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Soko & Usafiri' : 'Market & Delivery'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('restock')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              subTab === 'restock'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PackagePlus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Kagiza kutoka Supplier' : 'Supplier Restock'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadWholesalerData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleDownloadSwahiliCsv()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Pakua Ripoti (CSV)' : 'Export Ledger CSV'}</span>
          </button>
        </div>
      </div>

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

      {dispatchNotice && (
        <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-slate-900">
                {isSw
                  ? `Oda #${dispatchNotice.orderRef} Imetumwa kwa Dereva!`
                  : `Order #${dispatchNotice.orderRef} Dispatched & Dual-PIN Issued`}
              </div>
              <div className="font-mono text-slate-800 flex flex-wrap gap-3">
                <span>
                  <KeyRound className="w-3.5 h-3.5 inline mr-1 text-emerald-700" />
                  Buyer PIN: <strong>{dispatchNotice.buyerPin}</strong>
                </span>
                <span>
                  Driver PIN: <strong>{dispatchNotice.driverPin}</strong>
                </span>
                <span>
                  CoD: <strong>TZS {dispatchNotice.expectedCashTzs.toLocaleString('en-US')}</strong>
                </span>
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

      {subTab === 'riders' && (
        <div className="space-y-6">
          {placedOrders.length > 0 && (
            <section className="border border-emerald-200 bg-emerald-50/40 rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-emerald-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  {isSw
                    ? 'Oda Mpya Zinazosubiri Kutumwa (PLACED)'
                    : 'Incoming Orders Ready for Dispatch (PLACED)'}
                </h2>
                <span className="text-xs font-mono font-semibold text-emerald-800">
                  {placedOrders.length} {isSw ? 'oda' : 'pending'}
                </span>
              </div>
              <div className="divide-y divide-emerald-100 bg-white">
                {placedOrders.map((order) => (
                  <div
                    key={order.orderId}
                    data-order-ref={order.orderRef}
                    data-order-id={order.orderId}
                    className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div className="space-y-0.5 text-xs">
                      <div className="font-semibold text-slate-900">
                        <span className="font-mono">{order.orderRef}</span> · {order.buyerName} (
                        {order.buyerPhoneE164})
                      </div>
                      <div className="text-slate-500">{order.itemsSummary}</div>
                      <div className="font-mono font-bold text-emerald-700">
                        TZS {order.expectedTotalTzs.toLocaleString('en-US')}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={isSw ? 'Chagua dereva' : 'Assign driver'}
                        value={selectedDriverByOrder[order.orderId] ?? ''}
                        onChange={(e) =>
                          setSelectedDriverByOrder((prev) => ({
                            ...prev,
                            [order.orderId]: e.target.value,
                          }))
                        }
                        className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                      >
                        <option value="">
                          {isSw ? 'Chagua dereva...' : 'Select driver...'}
                        </option>
                        {availableDrivers.map((driver) => (
                          <option key={driver.driverId} value={driver.driverId}>
                            {driver.driverName}
                          </option>
                        ))}
                      </select>
                      <button
                      type="button"
                      disabled={dispatchingOrderId === order.orderId}
                      onClick={() => void handleDispatchOrder(order.orderId)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer disabled:opacity-60"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>
                        {dispatchingOrderId === order.orderId
                          ? isSw
                            ? 'Inatuma...'
                            : 'Dispatching...'
                          : isSw
                            ? 'Tuma kwa Dereva & Toa PIN'
                            : 'Dispatch & Issue Dual-PIN'}
                      </span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Top Summary Strip */}
          <section className="grid grid-cols-1 md:grid-cols-3 border border-slate-200 bg-white rounded-lg divide-y md:divide-y-0 md:divide-x divide-slate-200">
            <div className="p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                <Banknote className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                <span>{isSw ? 'Jumla ya Taslimu Mtaani (CoD)' : 'Total Physical Cash on Streets'}</span>
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                TZS {totalCashOutTzs.toLocaleString('en-US')}
              </div>
              <div className="text-xs text-slate-500">
                {isSw ? 'Inasubiri kurejeshwa ghalani' : 'Unsettled CoD cash held by active fleet'}
              </div>
            </div>

            <div className="p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Madereva Waliopo Kazini' : 'Live Active Delivery Riders'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-800">
                {activeRidersCount} / {riders.length}
              </div>
              <div className="text-xs text-slate-500">
                {isSw ? 'Madereva waliosajiliwa' : 'In-house riders & trusted fleet'}
              </div>
            </div>

            <div className="p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Oda Zinazoendelea Kushushwa' : 'Pending Street Drop-Offs'}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {openDropsCount}
              </div>
              <div className="text-xs text-slate-500">
                {isSw ? 'Zinasubiri uhakiki wa Dual-PIN' : 'Awaiting Dual-PIN handover consensus'}
              </div>
            </div>
          </section>

          {/* Live Fleet Cash Table */}
          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-slate-900">
                {isSw ? 'Ufuatiliaji wa Madereva & Fedha za Leo' : 'Live Fleet Cash Tracking Ledger'}
              </h2>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search
                    className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={isSw ? 'Tafuta dereva au namba...' : 'Search rider or phone...'}
                    className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                  />
                </div>

                <select
                  value={wardFilter}
                  onChange={(e) => setWardFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                >
                  <option value="ALL">{isSw ? 'Kata Zote' : 'All Wards'}</option>
                  <option value="Dar es Salaam">Dar es Salaam</option>
                </select>
              </div>
            </div>

            {filteredRiders.length === 0 ? (
              <div className="p-6">
                <EmptyStateCard
                  locale={locale}
                  titleSw={loading ? 'Inapakia madereva...' : 'Hakuna rekodi bado'}
                  titleEn={
                    loading
                      ? 'Loading fleet ledger...'
                      : 'No unsettled riders or street drop-offs right now'
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                      <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Dereva / Mawasiliano' : 'Rider & Contact'}</th>
                      <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Kata' : 'Active Ward'}</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">{isSw ? 'Zilizoshushwa / Zilizobaki' : 'Delivered / Open'}</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">{isSw ? 'Taslimu Mkononi (TZS)' : 'Cash on Street (TZS)'}</th>
                      <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Kiasi cha Oda' : 'Activity'}</th>
                      <th className="py-3 px-4 whitespace-nowrap">{isSw ? 'Hali' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredRiders.map((rider) => (
                      <tr key={rider.riderId} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{rider.riderName}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {rider.vehicleType} · {rider.vehiclePlate}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 whitespace-nowrap">{rider.activeWard}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {rider.completedDropsCount} / {rider.activeDropsCount}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold tabular-nums text-slate-900 whitespace-nowrap">
                          TZS {rider.cashOnStreetsTzs.toLocaleString('en-US')}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {rider.lastPinSyncEat}
                        </td>
                        <td className="py-3 px-4 font-semibold whitespace-nowrap">
                          <span
                            className={
                              rider.routeStatus === 'CLEARED'
                                ? 'text-emerald-800'
                                : rider.routeStatus === 'RETURNING_WITH_CASH'
                                  ? 'text-amber-800'
                                  : 'text-slate-800'
                            }
                          >
                            {formatOrderStatusLabel(rider.routeStatus, locale)}
                          </span>
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

      {subTab === 'eod' && <WholesalerEodReconciliation locale={locale} businessId={businessId} />}
      {subTab === 'analytics' && (
        <HybridAnalyticsDashboard locale={locale} businessId={businessId} />
      )}

      {subTab === 'market' && (
        <div className="space-y-6">
          {marketNotice && (
            <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-3.5 text-xs font-semibold text-emerald-900 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <span>{marketNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setMarketNotice(null)}
                className="text-emerald-800 hover:text-emerald-950 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Free delivery toggle */}
          <section className="border border-slate-200 bg-white rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1 max-w-xl">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Truck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                <span>{isSw ? 'Usafiri wa Bure (Free Delivery)' : 'Free Delivery'}</span>
              </h2>
              <p className="text-xs text-slate-600">
                {isSw
                  ? 'Ikiwashwa, wateja wanaona usafiri wa bure kwenye duka lako na bei ya usafiri inakuwa TZS 0 kwenye oda mpya.'
                  : 'When enabled, buyers see free delivery on your storefront and new orders are quoted at TZS 0 delivery.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={offersFreeDelivery}
              disabled={savingFreeDelivery}
              onClick={() => void handleToggleFreeDelivery()}
              className={`min-h-[44px] px-4 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-60 ${
                offersFreeDelivery
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
              }`}
            >
              <span
                className={`w-8 h-4 rounded-full relative transition-colors ${
                  offersFreeDelivery ? 'bg-emerald-900/40' : 'bg-slate-300'
                }`}
                aria-hidden="true"
              >
                <span
                  className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                    offersFreeDelivery ? 'left-4' : 'left-0.5'
                  }`}
                />
              </span>
              <span>
                {savingFreeDelivery
                  ? isSw
                    ? 'Inahifadhi...'
                    : 'Saving...'
                  : offersFreeDelivery
                    ? isSw
                      ? 'Imewashwa'
                      : 'Enabled'
                    : isSw
                      ? 'Imezimwa'
                      : 'Disabled'}
              </span>
            </button>
          </section>

          {/* Publish products to market */}
          <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <PackagePlus className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  <span>
                    {isSw ? 'Peleka Bidhaa Sokoni' : 'Publish Products to the Market'}
                  </span>
                </h2>
                <p className="text-xs text-slate-600">
                  {isSw
                    ? 'Chagua bidhaa na quantity ya kuongeza kwenye rafu ya soko lako.'
                    : 'Select products and quantities to add to your live market shelf.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadMarketData()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isSw ? 'Sasisha' : 'Refresh'}</span>
                </button>
                <button
                  type="button"
                  disabled={publishingMarket || selectedMarketCount === 0}
                  onClick={() => void handlePublishMarketStock()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                >
                  <PackagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {publishingMarket
                      ? isSw
                        ? 'Inapeleka...'
                        : 'Publishing...'
                      : isSw
                        ? `Peleka Sokoni (${selectedMarketCount})`
                        : `Publish (${selectedMarketCount})`}
                  </span>
                </button>
              </div>
            </div>

            {marketProducts.length === 0 ? (
              <div className="p-6">
                <EmptyStateCard
                  locale={locale}
                  titleSw="Hakuna bidhaa bado"
                  titleEn="No products yet"
                  descriptionSw="Ongeza bidhaa kwenye rafu yako kwanza kisha uzilete sokoni."
                  descriptionEn="Add products to your shelf first, then publish them to the market."
                />
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {marketProducts.map((product) => {
                  const quantity = selectedMarketQty[product.productId] ?? 0;
                  const isSelected = quantity > 0;
                  return (
                    <div
                      key={product.productId}
                      className={`px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 ${
                        isSelected ? 'bg-emerald-50/50' : 'bg-white'
                      }`}
                    >
                      <label className="flex items-start gap-3 min-w-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleMarketProduct(product)}
                          className="mt-0.5 w-4 h-4 accent-emerald-600"
                        />
                        <span className="min-w-0 space-y-0.5">
                          <span className="block text-xs font-semibold text-slate-900 truncate">
                            {isSw ? product.nameSw : product.nameEn}{' '}
                            <span className="font-mono text-slate-500">({product.sku})</span>
                          </span>
                          <span className="block text-[11px] text-slate-500 font-mono">
                            {product.availableQuarterQuanta > 0 ? (
                              <>
                                {isSw ? 'Rafuni' : 'On shelf'}: {product.availableQuarterQuanta} ·{' '}
                              </>
                            ) : (
                              <span className="text-emerald-700">
                                {isSw ? 'Katoni pekee' : 'Carton only'} ·{' '}
                              </span>
                            )}
                            {isSw ? 'Magunia/Katoni' : 'Sealed cartons'}:{' '}
                            {product.sealedBulkPackagesStock} ·{' '}
                            <strong className="text-slate-800">
                              TZS {product.cartonPriceTzs.toLocaleString('en-US')} /{' '}
                              {isSw ? 'Katoni' : 'Carton'}
                            </strong>
                          </span>
                        </span>
                      </label>

                      <div className="flex items-center gap-2">
                        <label
                          htmlFor={`market-qty-${product.productId}`}
                          className="text-[11px] font-semibold text-slate-600"
                        >
                          {isSw ? 'Quantity' : 'Qty'}
                        </label>
                        <input
                          id={`market-qty-${product.productId}`}
                          type="number"
                          min={1}
                          step={1}
                          disabled={!isSelected}
                          value={isSelected ? quantity : ''}
                          placeholder="0"
                          onChange={(e) => {
                            const parsed = Math.max(1, Math.trunc(Number(e.target.value) || 1));
                            setSelectedMarketQty((prev) => ({
                              ...prev,
                              [product.productId]: parsed,
                            }));
                          }}
                          className="w-24 px-2.5 py-1.5 text-xs font-mono font-bold text-right bg-white border border-slate-300 rounded-md text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                        />
                        <button
                          type="button"
                          onClick={() => openVipimoEditor(product)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                          aria-label={`${isSw ? 'Hariri vipimo' : 'Edit vipimo'} ${product.sku}`}
                        >
                          {isSw ? 'Hariri vipimo' : 'Edit vipimo'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {editingVipimo && (
        <div className="sk-dialog-overlay backdrop-blur-xs" role="dialog" aria-modal="true">
          <div className="sk-dialog-panel max-w-2xl">
            <div className="shrink-0 px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {isSw ? 'Hariri Vipimo vya Bidhaa' : 'Edit Product Vipimo'}
                </h3>
                <p className="text-[11px] text-slate-500 font-mono">
                  {editingVipimo.sku} · {editingVipimo.nameSw}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingVipimo(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveVipimo} className="p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Bei ya Katoni (TZS)' : 'Carton price (TZS)'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={editingVipimo.cartonPriceTzs}
                    onChange={(e) =>
                      setEditingVipimo({ ...editingVipimo, cartonPriceTzs: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Bei ya Chupa/Kipimo (TZS)' : 'Unit/bottle price (TZS)'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={editingVipimo.unitPriceTzs}
                    onChange={(e) =>
                      setEditingVipimo({ ...editingVipimo, unitPriceTzs: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Aina ya kifungashio' : 'Sealed package type'}
                  </span>
                  <select
                    value={editingVipimo.sealedParentUnitType}
                    onChange={(e) =>
                      setEditingVipimo({ ...editingVipimo, sealedParentUnitType: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  >
                    <option value="CARTON">CARTON</option>
                    <option value="CRATE">CRATE</option>
                    <option value="SACK_25KG">SACK_25KG</option>
                    <option value="SACK_50KG">SACK_50KG</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Chupa / Katoni' : 'Bottles / carton'}
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={editingVipimo.cartonUnits}
                    onChange={(e) =>
                      setEditingVipimo({ ...editingVipimo, cartonUnits: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Quanta / Katoni' : 'Quanta / carton'}
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={editingVipimo.quantaPerSealedPackage}
                    onChange={(e) =>
                      setEditingVipimo({
                        ...editingVipimo,
                        quantaPerSealedPackage: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Magunia/Katoni' : 'Sealed stock'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={editingVipimo.sealedBulkPackagesStock}
                    onChange={(e) =>
                      setEditingVipimo({
                        ...editingVipimo,
                        sealedBulkPackagesStock: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Rafuni (loose Q)' : 'On shelf (loose Q)'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={editingVipimo.baseQuarterQuantaStock}
                    onChange={(e) =>
                      setEditingVipimo({
                        ...editingVipimo,
                        baseQuarterQuantaStock: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingVipimo(null)}
                  className="px-4 py-2 text-xs font-semibold border border-slate-300 rounded-lg"
                >
                  {isSw ? 'Ghairi' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingVipimo}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg disabled:opacity-50"
                >
                  {savingVipimo
                    ? isSw
                      ? 'Inahifadhi...'
                      : 'Saving...'
                    : isSw
                      ? 'Hifadhi vipimo'
                      : 'Save vipimo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {subTab === 'restock' && (
        <div className="space-y-6">
          {restockNotice && (
            <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-3.5 text-xs font-semibold text-emerald-900 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <span>{restockNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setRestockNotice(null)}
                className="text-emerald-800 hover:text-emerald-950 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <section className="border border-emerald-200 bg-emerald-50/40 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <PackagePlus className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  {isSw ? 'Kagiza Bidhaa kutoka Supplier' : 'Restock Bulk Stock from Suppliers'}
                </h2>
                <p className="text-xs text-slate-600">
                  {isSw
                    ? 'Oda zote zinakokotolewa na API kwa kutumia channel SUPPLIER_TO_WHOLESALER na bei iliyochapishwa na supplier.'
                    : 'Every order is server-quoted through SUPPLIER_TO_WHOLESALER using published supplier bulk pricing.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadSupplierCatalog()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isSw ? 'Sasisha' : 'Refresh'}</span>
                </button>
                <button
                  type="button"
                  disabled={quotingSupplierOrder}
                  onClick={() => void handleQuoteSupplierRestock()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                >
                  <Search className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {quotingSupplierOrder
                      ? isSw ? 'Inahesabu...' : 'Quoting...'
                      : isSw ? 'Hesabu Bei (Server)' : 'Calculate Server Quote'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={placingSupplierOrder}
                  onClick={() => void handlePlaceSupplierRestock()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {placingSupplierOrder
                      ? isSw ? 'Inawasilisha...' : 'Submitting...'
                      : isSw ? 'Wasilisha Oda za B2B' : 'Submit B2B Orders'}
                  </span>
                </button>
              </div>
            </div>

            {supplierListings.length === 0 ? (
              <div className="p-6">
                <EmptyStateCard
                  locale={locale}
                  titleSw="Hakuna orodha ya supplier iliyochapishwa"
                  titleEn="No published supplier listings"
                  descriptionSw="Msambizaji anapopeleka orodha sokoni, bidhaa zake zitaonekana hapa."
                  descriptionEn="Published supplier bulk offerings will appear here for restocking."
                />
              </div>
            ) : (
              <div className="divide-y divide-emerald-100 bg-white">
                {supplierListings.map((listing) => {
                  const quantity = supplierRestockQty[listing.listingId] ?? listing.minOrderQuantity;
                  return (
                    <div
                      key={listing.listingId}
                      className={`px-5 py-4 flex flex-wrap items-center justify-between gap-4 ${
                        listing.isAvailable ? '' : 'opacity-60'
                      }`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-900">
                          {listing.imagekitCdnUrl ? (
                            <img
                              src={listing.imagekitCdnUrl}
                              alt=""
                              className="w-10 h-10 rounded-md object-cover border border-slate-200"
                            />
                          ) : null}
                          <span>
                            {isSw ? listing.nameSw : listing.nameEn}{' '}
                            <span className="font-mono text-slate-500">({listing.canonicalSku})</span>
                          </span>
                          {listing.isFreeDeliveryEnabled && (
                            <span className="px-2 py-1 rounded-md bg-emerald-600 text-white font-mono text-[10px] font-bold inline-flex items-center gap-1">
                              <Truck className="w-3 h-3" aria-hidden="true" />
                              FREE DELIVERY
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {listing.supplierName} · {listing.systemUnitCode} ·{' '}
                          {listing.quarterQuantaPerUnit} quanta/kitengo · MOQ{' '}
                          {listing.minOrderQuantity} · {isSw ? 'Zilizopo' : 'Available'}{' '}
                          {listing.maxOrderQuantity}
                        </div>
                        <div className="text-xs font-mono font-bold text-emerald-800">
                          TZS {Number(listing.supplierBulkPriceTzs).toLocaleString('en-US')}
                          {listing.isFreeDeliveryEnabled && (
                            <span className="ml-2 text-[10px] font-semibold text-slate-500">
                              {isSw
                                ? 'Kiwango cha bure: TZS '
                                : 'Free threshold: TZS '}
                              {Number(listing.freeDeliveryMinOrderTzs).toLocaleString('en-US')}
                            </span>
                          )}
                        </div>
                      </div>
                      <label className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-600">
                          {isSw ? 'Idadi' : 'Qty'}
                        </span>
                        <input
                          type="number"
                          min={listing.minOrderQuantity}
                          max={Math.max(listing.minOrderQuantity, listing.maxOrderQuantity)}
                          step={1}
                          disabled={!listing.isAvailable || !listing.productId}
                          value={quantity}
                          onChange={(e) => {
                            const parsed = Math.trunc(Number(e.target.value) || 0);
                            setSupplierRestockQty((prev) => ({
                              ...prev,
                              [listing.listingId]: parsed,
                            }));
                            setSupplierQuotes([]);
                          }}
                          className="w-24 px-2.5 py-1.5 text-xs font-mono font-bold text-right bg-white border border-slate-300 rounded-md text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {supplierQuotes.length > 0 && (
            <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">
                  {isSw ? 'Nukuu Rasmi kutoka API' : 'Authoritative API Quotes'}
                </h2>
              </div>
              <div className="divide-y divide-slate-100">
                {supplierQuotes.map((quote) => (
                  <div key={quote.sellerBusinessId} className="px-5 py-4 space-y-2 text-xs">
                    <div className="font-semibold text-slate-900">
                      {quote.sellerBusinessName} · {quote.sellerTier} · {quote.orderChannel}
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-slate-700">
                      <span>{isSw ? 'Bidhaa' : 'Items'}: {quote.itemsSubtotalTzs.toLocaleString('en-US')}</span>
                      <span>
                        {isSw ? 'Usafiri' : 'Delivery'}: {quote.deliveryFeeTzs.toLocaleString('en-US')}
                      </span>
                      <span className="font-bold text-emerald-800">
                        {isSw ? 'Jumla' : 'Total'}: {quote.expectedTotalTzs.toLocaleString('en-US')} TZS
                      </span>
                      <span>Quanta: {quote.totalQuarterQuanta.toLocaleString('en-US')}</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {quote.lines
                        .map(
                          (line) =>
                            `${line.quantity} × ${line.unitType} @ ${line.unitPriceTzs} (${line.pricingRuleReason})`,
                        )
                        .join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
