import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { formatOrderStatusLabel } from '../lib/sokoManagedState';
import { putQueuedOrder } from '../lib/indexedDbDemo';
import { useDataSaver } from '../context/DataSaverContext';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';
import { resolveBackendImageUrl } from '../lib/sokoProductImage';

type ConsumerScreen = 'HOME' | 'DUKAS' | 'SHOP' | 'PIN_VERIFY';

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

interface NeighborhoodDuka {
  dukaId: string;
  name: string;
  initials: string;
  logoUrl?: string;
  ward: string;
  distanceMeters: number;
  deliveryFeeTzs: number;
  modeTagSw: string;
  modeTagEn: string;
}

interface ConsumerLooseProduct {
  cartKey: string;
  productId: string;
  unitType: PackagingUnit;
  dukaId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitMeasureSw: string;
  unitMeasureEn: string;
  quarterQuantaPerUnit: number;
  pricePerUnitTzs: number;
  imageSrc: string;
}

interface ConsumerOrder {
  orderId: string;
  orderRef8: string;
  dukaName: string;
  itemsSummary: string;
  totalCashDueTzs: number;
  status: 'PLACED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
}

interface BackendMerchantDto {
  merchantId: string;
  smsShortCode: string;
  merchantName: string;
  tier: string;
  ward: string;
  district: string;
  offersFreeDelivery?: boolean;
  logoUrl?: string;
}

interface BackendProductDto {
  productId: string;
  sellerBusinessId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitPriceTzs: number;
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

interface BackendOrderDto {
  orderId: string;
  orderRef: string;
  sellerBusinessName: string;
  expectedTotalTzs: number;
  status: 'PLACED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
  items: Array<{
    smsItemCode?: string;
    nameSw?: string;
    unitType: string;
    quantity: number;
  }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}

function formatLooseMeasure(unit: PackagingUnit, quanta: number, isSw: boolean): string {
  switch (unit) {
    case 'QUARTER_KILO_LITRE':
      return isSw ? `Robo 1/4 (${quanta}Q)` : `Robo 1/4 (${quanta}Q)`;
    case 'HALF_KILO_LITRE':
      return isSw ? `Nusu 1/2 (${quanta}Q)` : `Nusu 1/2 (${quanta}Q)`;
    case 'THREE_QUARTER_KILO':
      return isSw ? `Tatu-Robo 3/4 (${quanta}Q)` : `Tatu-Robo 3/4 (${quanta}Q)`;
    case 'SINGLE_KILO_LITRE':
      return isSw ? `1KG / 1L (${quanta}Q)` : `1KG / 1L (${quanta}Q)`;
    case 'PACK':
      return isSw ? `Pakiti (${quanta}Q)` : `Pack (${quanta}Q)`;
    default:
      return `${unit} (${quanta}Q)`;
  }
}

export function ConsumerDashboardView({
  locale = 'en',
  consumerWard,
}: {
  locale?: Locale;
  consumerWard: string;
}) {
  const isSw = locale === 'sw';
  const { isLowDataModeActive, toggleLowDataMode } = useDataSaver();

  const [screen, setScreen] = useState<ConsumerScreen>('HOME');
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof window !== 'undefined' ? window.navigator.onLine : true,
  );
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [dukas, setDukas] = useState<NeighborhoodDuka[]>([]);
  const [selectedDuka, setSelectedDuka] = useState<NeighborhoodDuka | null>(null);
  const [liveDukaCatalog, setLiveDukaCatalog] = useState<ConsumerLooseProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [cartByKey, setCartByKey] = useState<Record<string, number>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [orders, setOrders] = useState<ConsumerOrder[]>([]);
  const [pinOrderId, setPinOrderId] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [qrTokenInput, setQrTokenInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [toast, setToast] = useState<{ title: string; detail: string } | null>(null);

  const loadLiveConsumerState = useCallback(async () => {
    if (!navigator.onLine) {
      setIsOnline(false);
      setBackendOffline(true);
      return;
    }

    setLoading(true);
    setApiError(null);
    setBackendOffline(false);
    try {
      const [merchantsRes, ordersRes] = await Promise.all([
        SokoApiClient.get<BackendMerchantDto[]>('/marketplace/merchants'),
        SokoApiClient.hasAccessToken()
          ? SokoApiClient.get<{ count: number; orders: BackendOrderDto[] }>(
              '/orders/my-orders?scope=buying',
            )
          : Promise.resolve({ count: 0, orders: [] as BackendOrderDto[] }),
      ]);

      const retailMerchants = (Array.isArray(merchantsRes) ? merchantsRes : []).filter(
        (m) => m.tier === 'RETAIL_DUKA' || m.tier === 'HYBRID_STORE',
      );
      setDukas(
        retailMerchants.map((m, idx) => ({
          dukaId: m.merchantId,
          name: m.merchantName,
          initials:
            m.smsShortCode ||
            m.merchantName
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join('')
              .toUpperCase(),
          ward: `${m.ward}, ${m.district}`,
          logoUrl: m.logoUrl,
          distanceMeters: 150 + idx * 190,
          deliveryFeeTzs: m.offersFreeDelivery ? 0 : 1_000,
          modeTagSw:
            m.tier === 'HYBRID_STORE'
              ? 'Duka Mseto (Rejareja B2C)'
              : 'Duka la Rejareja · Robo / Nusu / Lita',
          modeTagEn:
            m.tier === 'HYBRID_STORE'
              ? 'Hybrid Storefront (Walk-in Retail Mode)'
              : 'Retail Duka · Loose Household Fractions',
        })),
      );

      setOrders(
        (ordersRes?.orders ?? []).map((o) => ({
          orderId: o.orderId,
          orderRef8: o.orderRef,
          dukaName: o.sellerBusinessName,
          itemsSummary: o.items
            .map((i) => `${i.smsItemCode ?? i.nameSw ?? 'SKU'} (${i.quantity}x ${i.unitType})`)
            .join(' + '),
          totalCashDueTzs: Number(o.expectedTotalTzs ?? 0),
          status: o.status,
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
              ? 'Imeshindikana kupakia maduka na oda.'
              : 'Failed to load dukas and orders.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [isSw]);

  useEffect(() => {
    const goUp = () => {
      setIsOnline(true);
      void loadLiveConsumerState();
    };
    const goDown = () => {
      setIsOnline(false);
      setBackendOffline(true);
    };
    window.addEventListener('online', goUp);
    window.addEventListener('offline', goDown);
    return () => {
      window.removeEventListener('online', goUp);
      window.removeEventListener('offline', goDown);
    };
  }, [loadLiveConsumerState]);

  useEffect(() => {
    void loadLiveConsumerState();
  }, [loadLiveConsumerState]);

  const cashReadyTodayTzs = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'DISPATCHED' || o.status === 'PLACED')
        .reduce((sum, o) => sum + o.totalCashDueTzs, 0),
    [orders],
  );

  const openDuka = async (duka: NeighborhoodDuka) => {
    setSelectedDuka(duka);
    setCartByKey({});
    setDrawerOpen(false);
    setApiError(null);
    setScreen('SHOP');

    if (!navigator.onLine || !isUuid(duka.dukaId)) {
      setBackendOffline(true);
      setLiveDukaCatalog([]);
      return;
    }

    setLoadingCatalog(true);
    setBackendOffline(false);
    try {
      const products = await SokoApiClient.get<BackendProductDto[]>(
        `/products/active?businessId=${encodeURIComponent(duka.dukaId)}`,
      );
      const flattened: ConsumerLooseProduct[] = [];
      for (const p of Array.isArray(products) ? products : []) {
        const retailTiers = (p.priceTiers ?? []).filter((t) => !t.isWholesaleTier);
        const tiersToUse =
          retailTiers.length > 0
            ? retailTiers
            : p.priceTiers && p.priceTiers.length > 0
              ? [p.priceTiers[0]]
              : [
                  {
                    id: 'unit-default',
                    unitType: 'SINGLE_KILO_LITRE' as PackagingUnit,
                    quarterQuantaPerUnit: 4,
                    priceTzs: Number(p.unitPriceTzs || 0),
                    isWholesaleTier: false,
                  },
                ];

        for (const t of tiersToUse) {
          const measureSw = formatLooseMeasure(t.unitType, t.quarterQuantaPerUnit, true);
          const measureEn = formatLooseMeasure(t.unitType, t.quarterQuantaPerUnit, false);
          flattened.push({
            cartKey: `${p.productId}:${t.unitType}`,
            productId: p.productId,
            unitType: t.unitType,
            dukaId: p.sellerBusinessId,
            sku: p.sku,
            nameSw: `${p.nameSw} (${measureSw})`,
            nameEn: `${p.nameEn} (${measureEn})`,
            unitMeasureSw: measureSw,
            unitMeasureEn: measureEn,
            quarterQuantaPerUnit: t.quarterQuantaPerUnit,
            pricePerUnitTzs: Number(t.priceTzs),
            imageSrc: resolveBackendImageUrl(p.imagekitCdnUrl, p.staticImageUrl),
          });
        }
      }
      setLiveDukaCatalog(flattened);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setLiveDukaCatalog([]);
      } else {
        setLiveDukaCatalog([]);
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia bidhaa za duka.'
              : 'Failed to load duka catalog.',
        );
      }
    } finally {
      setLoadingCatalog(false);
    }
  };

  const dukaCatalog = useMemo(
    () => (selectedDuka ? liveDukaCatalog.filter((i) => i.dukaId === selectedDuka.dukaId) : []),
    [selectedDuka, liveDukaCatalog],
  );

  const cartSummary = useMemo(() => {
    if (!selectedDuka) {
      return { lines: [], subtotalTzs: 0, deliveryFeeTzs: 0, totalTzs: 0, totalQuanta: 0 };
    }
    const lines: Array<{ item: ConsumerLooseProduct; qty: number; lineTzs: number }> = [];
    let subtotalTzs = 0;
    let totalQuanta = 0;

    for (const item of dukaCatalog) {
      const qty = cartByKey[item.cartKey] ?? 0;
      if (qty <= 0) continue;
      const lineTzs = qty * item.pricePerUnitTzs;
      subtotalTzs += lineTzs;
      totalQuanta += qty * item.quarterQuantaPerUnit;
      lines.push({ item, qty, lineTzs });
    }

    const deliveryFeeTzs = lines.length > 0 ? selectedDuka.deliveryFeeTzs : 0;
    return {
      lines,
      subtotalTzs,
      deliveryFeeTzs,
      totalTzs: subtotalTzs + deliveryFeeTzs,
      totalQuanta,
    };
  }, [selectedDuka, dukaCatalog, cartByKey]);

  const queueOfflineConsumerOrder = async () => {
    if (!selectedDuka || cartSummary.lines.length === 0) return;
    const compact = cartSummary.lines.map((l) => `${l.item.sku}:${l.qty}`).join(',');
    await putQueuedOrder({
      idempotencyKey: crypto.randomUUID(),
      sellerBusinessId: selectedDuka.dukaId,
      sellerHub: selectedDuka.name,
      compactSmsBody: compact,
      totalTzs: cartSummary.totalTzs,
      items: cartSummary.lines.map((l) => ({
        productId: l.item.productId,
        unitType: l.item.unitType,
        quantity: l.qty,
      })),
      clientCreatedAt: new Date().toISOString(),
      syncStatus: 'QUEUED_OFFLINE',
      retryCount: 0,
    });
    setToast({
      title: isSw
        ? `Oda Imehifadhiwa Foleni (QUEUED_OFFLINE · ${selectedDuka.name})`
        : `Order Queued Offline (QUEUED_OFFLINE · ${selectedDuka.name})`,
      detail: `${compact} · CoD TZS ${cartSummary.totalTzs.toLocaleString('en-US')}`,
    });
    setCartByKey({});
    setDrawerOpen(false);
    setScreen('HOME');
  };

  const submitConsumerOrder = async () => {
    if (!selectedDuka || cartSummary.lines.length === 0) return;
    setApiError(null);

    if (!navigator.onLine) {
      setBackendOffline(true);
      await queueOfflineConsumerOrder();
      return;
    }

    setSubmitting(true);
    try {
      const resp = await SokoApiClient.post<{
        orderId: string;
        orderRef: string;
        expectedTotalTzs: number;
      }>('/marketplace/orders/submit-request', {
        sellerBusinessId: selectedDuka.dukaId,
        originChannel: 'PWA_ONLINE',
        paymentMethod: 'CASH',
        deliveryFeeTzs: cartSummary.deliveryFeeTzs,
        items: cartSummary.lines.map((l) => ({
          productId: l.item.productId,
          unitType: l.item.unitType,
          quantity: l.qty,
        })),
      });

      setToast({
        title: isSw
          ? `Oda #${resp.orderRef} Imetumwa kwa ${selectedDuka.name}!`
          : `Order #${resp.orderRef} Placed at ${selectedDuka.name}!`,
        detail: `TZS ${Number(resp.expectedTotalTzs).toLocaleString('en-US')} CoD`,
      });
      setCartByKey({});
      setDrawerOpen(false);
      setScreen('HOME');
      await loadLiveConsumerState();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        await queueOfflineConsumerOrder();
      } else {
        setApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kutuma oda.'
              : 'Order submission rejected.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const activePinOrder = orders.find((o) => o.orderId === pinOrderId) ?? null;

  const verifyDoorstepPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePinOrder || !isUuid(activePinOrder.orderId)) return;
    setPinError(null);

    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setVerifyingPin(true);
    try {
      const payload: { buyerPin: string; qrToken?: string } = {
        buyerPin: pinInput.trim(),
      };
      if (qrTokenInput.trim()) {
        payload.qrToken = qrTokenInput.trim();
      }
      const res = await SokoApiClient.post<{
        reconciled: boolean;
        verificationStatus: string;
      }>('/orders/reconcile/buyer-pin', {
        orderId: activePinOrder.orderId,
        ...payload,
      });

      setToast({
        title: res.reconciled
          ? isSw
            ? `Mzigo ${activePinOrder.orderRef8} Umepokelewa (DELIVERED)`
            : `Delivery ${activePinOrder.orderRef8} Confirmed (DELIVERED)`
          : isSw
            ? `PIN ya Mnunuzi Imethibitishwa (${activePinOrder.orderRef8})`
            : `Buyer PIN Verified (${activePinOrder.orderRef8})`,
        detail: res.reconciled
          ? `TZS ${activePinOrder.totalCashDueTzs.toLocaleString('en-US')} reconciled.`
          : isSw
            ? 'Inasubiri uthibitisho wa dereva.'
            : 'Awaiting Driver PIN confirmation.',
      });
      setPinOrderId(null);
      setScreen('HOME');
      await loadLiveConsumerState();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setPinError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Uhakiki wa PIN umeshindikana.'
              : 'Buyer PIN confirmation failed.',
        );
      }
    } finally {
      setVerifyingPin(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-100 rounded-lg px-4 py-3">
        <div className="sk-scroll-x items-center gap-1 bg-slate-100 p-1 rounded-lg max-w-full">
          {(
            [
              { id: 'HOME', labelSw: 'Nyumbani & Oda', labelEn: 'Home & Cash Due' },
              { id: 'DUKAS', labelSw: 'Maduka ya Mtaa', labelEn: 'Nearby Dukas' },
              ...(selectedDuka
                ? [{ id: 'SHOP', labelSw: selectedDuka.name, labelEn: selectedDuka.name }]
                : []),
            ] as Array<{ id: ConsumerScreen; labelSw: string; labelEn: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScreen(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                screen === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {isSw ? tab.labelSw : tab.labelEn}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700">
            {isOnline && !backendOffline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
            )}
            <span>{isOnline && !backendOffline ? 'Online' : 'Offline'}</span>
          </span>

          <button
            type="button"
            onClick={() => void loadLiveConsumerState()}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            onClick={toggleLowDataMode}
            className={`px-3 py-1.5 text-xs font-medium border rounded-md whitespace-nowrap cursor-pointer ${
              isLowDataModeActive
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {isLowDataModeActive
              ? isSw
                ? 'Kubana Data: ON'
                : 'Low-Data: ON'
              : isSw
                ? 'Kubana Data: OFF'
                : 'Low-Data: OFF'}
          </button>
        </div>
      </div>

      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          retrying={loading}
          onRetry={() => void loadLiveConsumerState()}
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

      {toast && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-slate-900">{toast.title}</div>
              <div className="text-xs font-mono text-slate-700">{toast.detail}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* SCREEN 1: CONSUMER HOME */}
      {screen === 'HOME' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-100 rounded-lg p-5 space-y-1.5">
              <div className="text-xs font-medium text-slate-500">
                {isSw ? 'Taslimu ya Kulipa Mlangoni Leo' : 'Cash Needed for Home Deliveries'}
              </div>
              <div className="text-3xl font-bold font-mono tabular-nums text-emerald-600">
                TZS {cashReadyTodayTzs.toLocaleString('en-US')}
              </div>
              <div className="text-xs text-slate-500">
                {isSw ? `Eneo lako: ${consumerWard}` : `Delivery ward: ${consumerWard}`}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setScreen('DUKAS')}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg p-5 text-left flex items-center justify-between gap-4 transition-colors cursor-pointer"
            >
              <div className="space-y-1">
                <div className="text-xl font-bold">
                  {isSw ? 'Nunua Dukani 🛒' : 'Visit Nearby Dukas 🛒'}
                </div>
                <div className="text-xs text-emerald-50">
                  {isSw
                    ? 'Agiza Robo (1/4), Nusu (1/2), Tatu-Robo (3/4) au Lita 1 kutoka maduka ya mtaani.'
                    : 'Order Robo (1/4), Nusu (1/2), Tatu-Robo (3/4), or 1KG packs with CoD delivery.'}
                </div>
              </div>
              <ShoppingBag className="w-8 h-8 text-white shrink-0" aria-hidden="true" />
            </button>
          </div>

          <section className="bg-white border border-slate-100 rounded-lg overflow-hidden">
            <div className="shrink-0 px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                {isSw
                  ? 'Oda Zako Zinazokuja Nyumbani (CoD & PIN)'
                  : 'Your Active Home Deliveries (Doorstep PIN)'}
              </h2>
              <span className="text-xs font-mono text-slate-500">
                {orders.filter((o) => o.status === 'DISPATCHED' || o.status === 'PLACED').length}{' '}
                active
              </span>
            </div>

            {loading && orders.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                {isSw ? 'Inapakia oda...' : 'Loading orders...'}
              </div>
            ) : orders.length === 0 ? (
              <div className="p-4">
                <EmptyStateCard
                  locale={locale}
                  titleSw="Hakuna rekodi bado"
                  titleEn="No records yet"
                  descriptionSw="Huna oda ya nyumbani iliyohifadhiwa kwenye PostgreSQL bado."
                  descriptionEn="No consumer orders exist in PostgreSQL yet."
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
                        <span className="font-medium text-slate-700">{order.dukaName}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold ${
                            order.status === 'DELIVERED' ? 'text-emerald-600' : 'text-amber-700'
                          }`}
                        >
                          {formatOrderStatusLabel(order.status, locale)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">{order.itemsSummary}</div>
                      <div className="text-xs font-mono text-slate-700">
                        <span className="font-bold text-emerald-600">
                          TZS {order.totalCashDueTzs.toLocaleString('en-US')}
                        </span>
                      </div>
                    </div>

                    {order.status === 'DISPATCHED' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPinOrderId(order.orderId);
                          setPinInput('');
                          setQrTokenInput('');
                          setPinError(null);
                          setScreen('PIN_VERIFY');
                        }}
                        className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{isSw ? 'Thibitisha kwa PIN' : 'Confirm Delivery PIN'}</span>
                      </button>
                    ) : order.status === 'DELIVERED' ? (
                      <span className="text-xs font-semibold text-emerald-600">
                        {formatOrderStatusLabel('DELIVERED', locale)}
                      </span>
                    ) : (
                      <span className="text-xs font-mono text-slate-500">
                        {formatOrderStatusLabel(order.status, locale)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* SCREEN 2: NEARBY DUKAS */}
      {screen === 'DUKAS' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <button
              type="button"
              onClick={() => setScreen('HOME')}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-emerald-600 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{isSw ? 'Rudi Nyumbani' : 'Back Home'}</span>
            </button>
            <span className="text-xs font-mono text-emerald-600 font-medium">
              {dukas.length} {isSw ? 'Maduka ya Rejareja' : 'Retail Dukas Available'}
            </span>
          </div>

          {loading && dukas.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-lg p-6 text-center text-xs text-slate-500">
              {isSw ? 'Inapakia maduka ya rejareja...' : 'Loading retail dukas...'}
            </div>
          ) : dukas.length === 0 ? (
            <EmptyStateCard
              locale={locale}
              titleSw="Hakuna rekodi bado"
              titleEn="No records yet"
              descriptionSw="Hakuna duka la rejareja lililosajiliwa kwenye PostgreSQL kwa sasa."
              descriptionEn="No retail dukas exist in PostgreSQL yet."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {dukas.map((duka) => (
                <article
                  key={duka.dukaId}
                  className="bg-white border border-slate-100 rounded-lg p-5 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center font-mono font-bold text-sm text-emerald-700 shrink-0 overflow-hidden">
                      {duka.logoUrl ? (
                        <img src={duka.logoUrl} alt={duka.name} className="w-full h-full object-cover" />
                      ) : (
                        duka.initials
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <h3 className="text-sm font-bold text-slate-900 truncate">{duka.name}</h3>
                      <div className="text-xs text-slate-500 truncate">
                        {isSw ? duka.modeTagSw : duka.modeTagEn}
                      </div>
                      <div className="text-xs font-mono font-semibold text-emerald-600 tabular-nums">
                        📍 {duka.ward} · {duka.distanceMeters}m
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void openDuka(duka)}
                    className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Store className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{isSw ? 'Ingia Dukani' : 'Open Duka'}</span>
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SCREEN 3: LOOSE FRACTION SHOPPING */}
      {screen === 'SHOP' && selectedDuka && (
        <section className="space-y-4">
          <div className="bg-white border border-slate-100 rounded-lg p-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedDuka(null);
                setCartByKey({});
                setScreen('DUKAS');
              }}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-emerald-600 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{selectedDuka.name}</span>
            </button>

            <button
              type="button"
              disabled={cartSummary.lines.length === 0}
              onClick={() => setDrawerOpen(true)}
              className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md inline-flex items-center gap-1.5 disabled:bg-slate-200 disabled:text-slate-500 whitespace-nowrap cursor-pointer"
            >
              <ShoppingCart className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="font-mono tabular-nums">
                TZS {cartSummary.totalTzs.toLocaleString('en-US')}
              </span>
            </button>
          </div>

          {loadingCatalog ? (
            <div className="bg-white border border-slate-100 rounded-lg p-6 text-center text-xs text-slate-500">
              {isSw ? 'Inapakia bidhaa za rejareja...' : 'Loading retail shelf...'}
            </div>
          ) : dukaCatalog.length === 0 ? (
            <EmptyStateCard
              locale={locale}
              titleSw="Hakuna rekodi bado"
              titleEn="No records yet"
              descriptionSw="Duka hili halijaweka bidhaa za rejareja katika PostgreSQL bado."
              descriptionEn="No loose retail items exist in PostgreSQL for this duka yet."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {dukaCatalog.map((item) => {
                const qty = cartByKey[item.cartKey] ?? 0;
                return (
                  <article
                    key={item.cartKey}
                    className="bg-white border border-slate-100 rounded-lg overflow-hidden flex flex-col justify-between"
                  >
                    <div className="p-4 space-y-3">
                      {!isLowDataModeActive ? (
                        <div className="h-36 w-full rounded-md bg-white border border-slate-100 overflow-hidden flex items-center justify-center p-2">
                          <img
                            src={item.imageSrc}
                            alt={isSw ? item.nameSw : item.nameEn}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-contain"
                          />
                        </div>
                      ) : (
                        <div className="h-16 rounded-md bg-slate-50 border border-slate-100 flex items-center justify-center text-xs font-mono text-slate-500">
                          {item.sku} · LOW-DATA ASSET SKIPPED
                        </div>
                      )}

                      <div className="space-y-1">
                        <div className="text-xs font-mono text-slate-500">
                          {isSw ? item.unitMeasureSw : item.unitMeasureEn}
                        </div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          {isSw ? item.nameSw : item.nameEn}
                        </h3>
                      </div>
                    </div>

                    <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between gap-3">
                      <div className="text-sm font-bold font-mono tabular-nums text-slate-900">
                        TZS {item.pricePerUnitTzs.toLocaleString('en-US')}
                      </div>

                      <div className="inline-flex items-center border border-slate-200 rounded-md bg-white">
                        <button
                          type="button"
                          onClick={() =>
                            setCartByKey((p) => ({
                              ...p,
                              [item.cartKey]: Math.max(0, (p[item.cartKey] ?? 0) - 1),
                            }))
                          }
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
                          aria-label={`Remove ${item.sku}`}
                        >
                          <Minus className="w-4 h-4" aria-hidden="true" />
                        </button>
                        <span className="w-9 text-center text-sm font-bold font-mono tabular-nums">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setCartByKey((p) => ({
                              ...p,
                              [item.cartKey]: (p[item.cartKey] ?? 0) + 1,
                            }))
                          }
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-emerald-600 text-white hover:bg-emerald-700 rounded-r-md cursor-pointer"
                          aria-label={`Add ${item.sku}`}
                        >
                          <Plus className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* SCREEN 4: SLIDE-UP CONSUMER CHECKOUT SHEET */}
      {drawerOpen && selectedDuka && (
        <div
          className="sk-dialog-overlay"
          role="dialog"
          aria-modal="true"
        >
          <div className="sk-dialog-panel">
            <div className="shrink-0 px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {isSw ? 'Kikapu cha Nyumbani' : 'Consumer CoD Checkout'}
                </h3>
                <p className="text-xs text-slate-500">{selectedDuka.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="sk-dialog-body p-5 space-y-4 sk-safe-bottom">
              <div className="divide-y divide-slate-100">
                {cartSummary.lines.map(({ item, qty, lineTzs }) => (
                  <div
                    key={item.cartKey}
                    className="py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">
                        {isSw ? item.nameSw : item.nameEn}
                      </div>
                      <div className="font-mono text-slate-500">
                        {qty}x ({qty * item.quarterQuantaPerUnit} Quanta)
                      </div>
                    </div>
                    <div className="font-mono font-bold tabular-nums text-slate-900">
                      TZS {lineTzs.toLocaleString('en-US')}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>{isSw ? 'Bidhaa (CoD)' : 'Items Subtotal'}</span>
                  <span className="font-mono font-semibold tabular-nums">
                    TZS {cartSummary.subtotalTzs.toLocaleString('en-US')}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    <span>{isSw ? 'Usafiri wa Mtaani' : 'Neighborhood Delivery'}</span>
                  </span>
                  <span className="font-mono font-semibold tabular-nums">
                    TZS {cartSummary.deliveryFeeTzs.toLocaleString('en-US')}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-100 text-sm font-bold">
                  <span>{isSw ? 'Taslimu Mlangoni' : 'Total Cash Due'}</span>
                  <span className="font-mono tabular-nums text-emerald-600">
                    TZS {cartSummary.totalTzs.toLocaleString('en-US')}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={() => void submitConsumerOrder()}
                className="w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white rounded-md cursor-pointer disabled:opacity-60 bg-emerald-600 hover:bg-emerald-700"
              >
                {submitting
                  ? isSw
                    ? 'Inatuma Oda...'
                    : 'Submitting Order...'
                  : isSw
                    ? 'Agiza Sasa (Lipa Mlangoni)'
                    : 'Confirm Cash-on-Delivery Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SCREEN 5: CONSUMER DOORSTEP PIN */}
      {screen === 'PIN_VERIFY' && activePinOrder && (
        <section className="max-w-lg mx-auto bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-900 text-white p-5 space-y-1">
            <div className="text-xs font-mono text-slate-300">
              {activePinOrder.orderRef8} · {activePinOrder.dukaName}
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums">
              LIPA CASH: TZS {activePinOrder.totalCashDueTzs.toLocaleString('en-US')}
            </div>
          </div>

          <form onSubmit={(e) => void verifyDoorstepPin(e)} className="p-5 space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span>
                  {isSw
                    ? 'Ingiza PIN yako ya Mlangoni (4-digit)'
                    : 'Enter Your 4-Digit Buyer PIN'}
                </span>
              </span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="••••"
                className="w-full min-h-[48px] px-4 text-xl font-mono tracking-widest bg-white border-2 border-slate-300 rounded-md focus:border-emerald-600 focus:outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-600">
                {isSw
                  ? 'Tokeni ya QR ya Dereva (Hiari — ikiwa dereva ameshahakiki)'
                  : 'Driver Arrival QR Token (Optional — if Driver already confirmed)'}
              </span>
              <input
                type="text"
                value={qrTokenInput}
                onChange={(e) => setQrTokenInput(e.target.value)}
                placeholder="SKQR-..."
                className="w-full px-3.5 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:border-emerald-600 focus:outline-none"
              />
            </label>

            {pinError && <div className="text-xs font-medium text-red-700">{pinError}</div>}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setScreen('HOME')}
                className="min-h-[48px] px-4 py-2 text-xs font-medium border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                {isSw ? 'Ghairi' : 'Back'}
              </button>
              <button
                type="submit"
                disabled={verifyingPin}
                className="flex-1 min-h-[48px] px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer disabled:opacity-60"
              >
                {verifyingPin
                  ? isSw
                    ? 'Inahakiki...'
                    : 'Verifying...'
                  : isSw
                    ? 'Hakiki PIN & Pokea Bidhaa'
                    : 'Confirm Receipt & Pay CoD'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
