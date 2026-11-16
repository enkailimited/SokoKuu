import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  MapPin,
  Minus,
  Plus,
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
import {
  formatOrderStatusLabel,
  formatRoutingLabel,
  recordOrderDispatchAuditTrace,
} from '../lib/sokoManagedState';
import { SmartStoreCatalog } from './SmartStoreCatalog';
import { SmartGridStoreCatalog } from './SmartGridStoreCatalog';
import { IsolatedQrVerificationTerminal } from './IsolatedQrVerificationTerminal';
import azaniaFlourImg from '../assets/images/azania_wheat_flour_1794734183041.jpg';
import korieOilImg from '../assets/images/korie_cooking_oil_1794734183539.jpg';
import kilomberoSugarImg from '../assets/images/kilombero_brown_sugar_1794734184028.jpg';
import mbeyaRiceImg from '../assets/images/mbeya_super_rice_1794734184118.jpg';

type ActiveScreen = 'HOME' | 'DIRECTORY' | 'CATALOG' | 'PIN_TERMINAL';

interface WholesaleHub {
  businessId: string;
  name: string;
  initials: string;
  brandRingColor: string;
  ward: string;
  distanceMeters: number;
  deliveryFeeTzs: number;
}

interface CatalogProduct {
  productId: string;
  businessId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  imageSrc: string;
  quantaStep: number;
  quantaUnitLabelSw: string;
  quantaUnitLabelEn: string;
  wholesaleThresholdQuanta: number;
  retailPricePerQuantaTzs: number;
  wholesalePricePerQuantaTzs: number;
  availableQuantaStock: number;
  isLowStockInDuka?: boolean;
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
  buyerPin4: string;
  status: 'DISPATCHED' | 'DELIVERED';
}

const WHOLESALE_HUBS: WholesaleHub[] = [
  {
    businessId: '11111111-aaaa-4111-8111-000000000001',
    name: 'Mo Wholesale Hub',
    initials: 'MWH',
    brandRingColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ward: 'Kariakoo, Dar es Salaam',
    distanceMeters: 300,
    deliveryFeeTzs: 3_500,
  },
  {
    businessId: '22222222-bbbb-4222-8222-000000000002',
    name: 'Bakhresa Group',
    initials: 'BG',
    brandRingColor: 'bg-slate-100 text-slate-800 border-slate-200',
    ward: 'Ilala, Dar es Salaam',
    distanceMeters: 620,
    deliveryFeeTzs: 4_500,
  },
  {
    businessId: '33333333-cccc-4333-8333-000000000003',
    name: 'Kilombero Wholesalers',
    initials: 'KW',
    brandRingColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ward: 'Mchikichini, Dar es Salaam',
    distanceMeters: 950,
    deliveryFeeTzs: 5_000,
  },
];

const STORE_PRODUCTS_BY_ID: Record<string, CatalogProduct[]> = {
  '11111111-aaaa-4111-8111-000000000001': [
    {
      productId: 'prod-mwh-flour',
      businessId: '11111111-aaaa-4111-8111-000000000001',
      sku: 'AZN-2KG',
      nameSw: 'Unga wa Ngano Azania (1KG = Quanta 4)',
      nameEn: 'Azania Wheat Flour (1KG = 4 Quanta)',
      imageSrc: azaniaFlourImg,
      quantaStep: 4,
      quantaUnitLabelSw: 'Quanta 4 (1KG)',
      quantaUnitLabelEn: '4 Quanta (1KG)',
      wholesaleThresholdQuanta: 16,
      retailPricePerQuantaTzs: 900,
      wholesalePricePerQuantaTzs: 800,
      availableQuantaStock: 400,
      isLowStockInDuka: true,
    },
    {
      productId: 'prod-mwh-oil',
      businessId: '11111111-aaaa-4111-8111-000000000001',
      sku: 'KOR-OIL',
      nameSw: 'Mafuta ya Kupikia Korie (Robo = Quanta 1)',
      nameEn: 'Korie Cooking Oil (Robo 250mL = 1 Quantum)',
      imageSrc: korieOilImg,
      quantaStep: 1,
      quantaUnitLabelSw: 'Quanta 1 (Robo 250mL)',
      quantaUnitLabelEn: '1 Quantum (250mL)',
      wholesaleThresholdQuanta: 8,
      retailPricePerQuantaTzs: 1_550,
      wholesalePricePerQuantaTzs: 1_350,
      availableQuantaStock: 320,
    },
    {
      productId: 'prod-mwh-sugar',
      businessId: '11111111-aaaa-4111-8111-000000000001',
      sku: 'KLM-SUG',
      nameSw: 'Sukari ya Kilombero (5KG = Quanta 20)',
      nameEn: 'Kilombero Brown Sugar (5KG = 20 Quanta)',
      imageSrc: kilomberoSugarImg,
      quantaStep: 20,
      quantaUnitLabelSw: 'Quanta 20 (5KG)',
      quantaUnitLabelEn: '20 Quanta (5KG)',
      wholesaleThresholdQuanta: 40,
      retailPricePerQuantaTzs: 920,
      wholesalePricePerQuantaTzs: 840,
      availableQuantaStock: 600,
      isLowStockInDuka: true,
    },
    {
      productId: 'prod-mwh-rice',
      businessId: '11111111-aaaa-4111-8111-000000000001',
      sku: 'MBY-RIC',
      nameSw: 'Mchele wa Mbeya Super (25KG = Quanta 100)',
      nameEn: 'Mbeya Super Rice (25KG = 100 Quanta)',
      imageSrc: mbeyaRiceImg,
      quantaStep: 100,
      quantaUnitLabelSw: 'Quanta 100 (25KG)',
      quantaUnitLabelEn: '100 Quanta (25KG)',
      wholesaleThresholdQuanta: 200,
      retailPricePerQuantaTzs: 680,
      wholesalePricePerQuantaTzs: 620,
      availableQuantaStock: 1000,
    },
  ],
  '22222222-bbbb-4222-8222-000000000002': [
    {
      productId: 'prod-bg-flour',
      businessId: '22222222-bbbb-4222-8222-000000000002',
      sku: 'AZM-2KG',
      nameSw: 'Unga wa Azam Ngano (2KG = Quanta 8)',
      nameEn: 'Azam Wheat Flour (2KG = 8 Quanta)',
      imageSrc: azaniaFlourImg,
      quantaStep: 8,
      quantaUnitLabelSw: 'Quanta 8 (2KG)',
      quantaUnitLabelEn: '8 Quanta (2KG)',
      wholesaleThresholdQuanta: 24,
      retailPricePerQuantaTzs: 880,
      wholesalePricePerQuantaTzs: 790,
      availableQuantaStock: 480,
      isLowStockInDuka: true,
    },
  ],
  '33333333-cccc-4333-8333-000000000003': [
    {
      productId: 'prod-kw-sugar',
      businessId: '33333333-cccc-4333-8333-000000000003',
      sku: 'KLM-25KG',
      nameSw: 'Sukari ya Kilombero (5KG = Quanta 20)',
      nameEn: 'Kilombero Sugar Bulk (5KG = 20 Quanta)',
      imageSrc: kilomberoSugarImg,
      quantaStep: 20,
      quantaUnitLabelSw: 'Quanta 20 (5KG)',
      quantaUnitLabelEn: '20 Quanta (5KG)',
      wholesaleThresholdQuanta: 40,
      retailPricePerQuantaTzs: 910,
      wholesalePricePerQuantaTzs: 830,
      availableQuantaStock: 800,
      isLowStockInDuka: true,
    },
  ],
};

const INITIAL_DISPATCHED_ORDERS: DispatchedOrderRecord[] = [
  {
    orderId: 'ord-disp-01',
    orderRef8: 'SK8421F9',
    sellerBusinessId: '11111111-aaaa-4111-8111-000000000001',
    sellerName: 'Mo Wholesale Hub',
    subtotalTzs: 146_500,
    deliveryFeeTzs: 3_500,
    totalCashDueTzs: 150_000,
    itemsSummary: 'Azania Flour (16 Quanta / 4KG) + Korie Oil (8 Quanta / 2L)',
    buyerPin4: '4821',
    status: 'DISPATCHED',
  },
];

async function computeWebCryptoSmsSig6(rawPayload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('sokokuu-retailer-offline-hmac'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawPayload));
  return Array.from(new Uint8Array(sig))
    .slice(0, 3)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

// ============================================================================
// SokoniCoreEngine.tsx — Refactored to max-w-2xl mx-auto container layout
// Inazuia kukunjuka vibaya kwenye skrini kubwa na kuhifadhi mandhari ya Light UI.
// ============================================================================
export function SokoniCoreEngine({ locale = 'en' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const { isLowDataModeActive } = useDataSaver();

  const [screen, setScreen] = useState<ActiveScreen>('HOME');
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [selectedStore, setSelectedStore] = useState<WholesaleHub | null>(null);
  const [cartQuantaByProduct, setCartQuantaByProduct] = useState<Record<string, number>>({});
  const [checkoutSheetOpen, setCheckoutSheetOpen] = useState<boolean>(false);
  const [smartReorderMode, setSmartReorderMode] = useState<boolean>(false);
  const [smartGridMode, setSmartGridMode] = useState<boolean>(false);
  const [catalogSearchQuery, setCatalogSearchQuery] = useState<string>('');

  const [orders, setOrders] = useState<DispatchedOrderRecord[]>(INITIAL_DISPATCHED_ORDERS);
  const [activePinOrderId, setActivePinOrderId] = useState<string | null>(null);

  const [floatingToast, setFloatingToast] = useState<{
    title: string;
    detail: string;
  } | null>(null);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const cashNeededTodayTzs = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'DISPATCHED')
        .reduce((sum, o) => sum + o.totalCashDueTzs, 0),
    [orders]
  );

  const settledTodayTzs = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'DELIVERED')
        .reduce((sum, o) => sum + o.totalCashDueTzs, 0),
    [orders]
  );

  const handleOpenStore = (hub: WholesaleHub) => {
    setSelectedStore(hub);
    setCartQuantaByProduct({});
    setCheckoutSheetOpen(false);
    setSmartReorderMode(false);
    setSmartGridMode(false);
    setCatalogSearchQuery('');
    setScreen('CATALOG');
  };

  const activeCatalog = useMemo(() => {
    if (!selectedStore) return [];
    const items = (STORE_PRODUCTS_BY_ID[selectedStore.businessId] ?? []).filter(
      (item) => item.businessId === selectedStore.businessId
    );
    return [...items].sort((a, b) => {
      const aLow = a.isLowStockInDuka ? 1 : 0;
      const bLow = b.isLowStockInDuka ? 1 : 0;
      if (aLow !== bLow) return bLow - aLow;
      return a.nameSw.localeCompare(b.nameSw);
    });
  }, [selectedStore]);

  const lowStockCarouselItems = useMemo(
    () => activeCatalog.filter((item) => item.isLowStockInDuka),
    [activeCatalog]
  );

  const filteredActiveCatalog = useMemo(() => {
    const q = catalogSearchQuery.trim().toLowerCase();
    if (!q) return activeCatalog;
    return activeCatalog.filter(
      (item) =>
        item.nameSw.toLowerCase().includes(q) ||
        item.nameEn.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q)
    );
  }, [activeCatalog, catalogSearchQuery]);

  const adjustProductQuanta = (item: CatalogProduct, direction: 1 | -1) => {
    setCartQuantaByProduct((prev) => {
      const current = prev[item.productId] ?? 0;
      const next = Math.max(
        0,
        Math.min(item.availableQuantaStock, current + direction * item.quantaStep)
      );
      return { ...prev, [item.productId]: next };
    });
  };

  const cartBreakdown = useMemo(() => {
    if (!selectedStore) {
      return { lines: [], subtotalTzs: 0, deliveryFeeTzs: 0, totalTzs: 0, totalQuanta: 0 };
    }

    const lines: Array<{
      item: CatalogProduct;
      quanta: number;
      unitPricePerQuanta: number;
      lineTotalTzs: number;
      wholesaleApplied: boolean;
    }> = [];
    let subtotalTzs = 0;
    let totalQuanta = 0;

    for (const item of activeCatalog) {
      const quanta = cartQuantaByProduct[item.productId] ?? 0;
      if (quanta <= 0) continue;
      const wholesaleApplied = quanta >= item.wholesaleThresholdQuanta;
      const unitPricePerQuanta = wholesaleApplied
        ? item.wholesalePricePerQuantaTzs
        : item.retailPricePerQuantaTzs;
      const lineTotalTzs = quanta * unitPricePerQuanta;

      subtotalTzs += lineTotalTzs;
      totalQuanta += quanta;
      lines.push({ item, quanta, unitPricePerQuanta, lineTotalTzs, wholesaleApplied });
    }

    const deliveryFeeTzs = lines.length > 0 ? selectedStore.deliveryFeeTzs : 0;
    return {
      lines,
      subtotalTzs,
      deliveryFeeTzs,
      totalTzs: subtotalTzs + deliveryFeeTzs,
      totalQuanta,
    };
  }, [selectedStore, activeCatalog, cartQuantaByProduct]);

  const handlePlaceOrderOrSms = async () => {
    if (!selectedStore || cartBreakdown.lines.length === 0) return;

    const orderRef8 = 'SK' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const buyerPin4 = String(Math.floor(1000 + Math.random() * 9000));

    if (!isOnline) {
      const compactItems = cartBreakdown.lines
        .map((l, idx) => `P${idx + 1}:${l.quanta}Q`)
        .join(',');
      const unsigned = `SK#${orderRef8}#${selectedStore.initials}#${compactItems}`;
      const sig6 = await computeWebCryptoSmsSig6(unsigned);
      const smsString = `${unsigned}#${sig6}`;

      setFloatingToast({
        title: isSw
          ? `Ujumbe wa SMS Umetumwa (${selectedStore.name})`
          : `NextSMS Offline Order Dispatched (${selectedStore.name})`,
        detail: `${smsString} · ${smsString.length}/160 chars`,
      });
    } else {
      const newOrder: DispatchedOrderRecord = {
        orderId: crypto.randomUUID(),
        orderRef8,
        sellerBusinessId: selectedStore.businessId,
        sellerName: selectedStore.name,
        subtotalTzs: cartBreakdown.subtotalTzs,
        deliveryFeeTzs: cartBreakdown.deliveryFeeTzs,
        totalCashDueTzs: cartBreakdown.totalTzs,
        itemsSummary: cartBreakdown.lines
          .map((l) => `${l.item.sku} (${l.quanta} Quanta)`)
          .join(' + '),
        buyerPin4,
        status: 'DISPATCHED',
      };

      const trace = recordOrderDispatchAuditTrace({
        orderRef8,
        sellerBusinessId: selectedStore.businessId,
        sellerBusinessName: selectedStore.name,
        totalCashDueTzs: cartBreakdown.totalTzs,
        itemsSummary: newOrder.itemsSummary,
      });

      setOrders((prev) => [newOrder, ...prev]);
      setFloatingToast({
        title: `Oda yako imetumwa (${selectedStore.name})!`,
        detail: `Oda #${orderRef8} · ${formatRoutingLabel(trace.routingCode, locale)} · PIN: ${buyerPin4} · TZS ${cartBreakdown.totalTzs.toLocaleString('en-US')}`,
      });
    }

    setCartQuantaByProduct({});
    setCheckoutSheetOpen(false);
    setScreen('HOME');
  };

  const activePinOrder = orders.find((o) => o.orderId === activePinOrderId) ?? null;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Top Status Banner */}
      <div className="bg-white border border-slate-100 rounded-lg px-4 py-3 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          {isOnline ? (
            <>
              <Wifi className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              <span className="text-slate-900">
                {isSw ? 'Mtandao Uko Sawa (Online)' : 'Network Online — Live System Sync Engine'}
              </span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-amber-600" aria-hidden="true" />
              <span className="text-amber-800">
                {isSw
                  ? 'Hali ya Dharura Nje ya Mtandao (NextSMS Fallback Mode)'
                  : 'Offline Fallback Mode — WebCrypto NextSMS Ready'}
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsOnline((prev) => !prev)}
          className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap shadow-xs"
        >
          {isOnline
            ? isSw
              ? 'Jaribu Nje ya Mtandao'
              : 'Simulate Offline'
            : isSw
              ? 'Rejesha Mtandao'
              : 'Restore Online'}
        </button>
      </div>

      {/* Floating Success Toast Overlay */}
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
                  ? 'Jumla ya oda zilizo njiani (DISPATCHED) zinazosubiri malipo ya mlangoni'
                  : 'Total cash required today for orders currently DISPATCHED'}
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

          {/* Prominent Emerald Green Launcher Card: "Nenda Sokoni 🛒" */}
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

          {/* Incoming DISPATCHED Orders Ready for Doorstep PIN Verification */}
          <section className="bg-white border border-slate-100 rounded-lg shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">
                {isSw
                  ? 'Mizigo Inayokuja (DISPATCHED) — Tayari kwa PIN ya Mlangoni'
                  : 'Active Orders (DISPATCHED) — Doorstep PIN Reconciliation'}
              </h2>
              <span className="text-xs font-mono text-slate-500">
                {orders.filter((o) => o.status === 'DISPATCHED').length} active
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {orders.map((order) => (
                <div
                  key={order.orderId}
                  className="p-4 sm:px-5 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-slate-900">{order.orderRef8}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-slate-700">{order.sellerName}</span>
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
                      Buyer PIN: <span className="font-bold text-slate-900">{order.buyerPin4}</span> ·{' '}
                      <span className="font-bold text-emerald-600">
                        TZS {order.totalCashDueTzs.toLocaleString('en-US')}
                      </span>
                    </div>
                  </div>

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
                      <span>Order Confirmation</span>
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-600">
                      {formatOrderStatusLabel('SETTLED', locale)}
                    </span>
                  )}
                </div>
              ))}
            </div>
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
              PostGIS Proximity Sorted
            </span>
          </div>

          <div className="space-y-3">
            {WHOLESALE_HUBS.map((hub) => (
              <article
                key={hub.businessId}
                className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={`w-12 h-12 rounded-full border flex items-center justify-center shrink-0 font-mono font-bold text-sm ${hub.brandRingColor}`}
                  >
                    {hub.initials}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <h3 className="text-sm font-bold text-slate-900 truncate">{hub.name}</h3>
                    <div className="text-xs text-slate-500 truncate">{hub.ward}</div>
                    <div className="text-xs font-mono font-semibold text-emerald-600 tabular-nums">
                      📍 Mita {hub.distanceMeters} karibu
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleOpenStore(hub)}
                  className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                >
                  Fungua Duka
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* SCREEN 3: ISOLATED STORE CATALOG (2-Column Grid Template) */}
      {screen === 'CATALOG' && selectedStore && (
        <section className="space-y-4 pb-20">
          <div className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedStore(null);
                setCartQuantaByProduct({});
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
              {/* SEARCH BAR OVERLAY (Instant Swahili Title & Canonical SKU Filter) */}
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

              {/* DYNAMIC LOW-STOCK RECOMMENDATION HORIZONTAL CAROUSEL */}
              {lowStockCarouselItems.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-1.5 text-emerald-700 font-bold text-xs uppercase tracking-wider">
                      <Zap className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                      <h3>
                        {isSw
                          ? 'Inashauriwa Ununue (Duka Lako Limeshaisha)'
                          : 'Inashauriwa Ununue (Low Shelf Stock)'}
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

                  <div className="flex gap-2.5 overflow-x-auto pb-1">
                    {lowStockCarouselItems.map((suggest) => {
                      const active =
                        catalogSearchQuery.toLowerCase() === suggest.sku.toLowerCase();
                      return (
                        <button
                          type="button"
                          key={suggest.productId}
                          onClick={() =>
                            setCatalogSearchQuery((prev) =>
                              prev.toLowerCase() === suggest.sku.toLowerCase() ? '' : suggest.sku
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

              {/* Clean 2-column card grid template for mobile/desktop container */}
              {filteredActiveCatalog.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-xs text-slate-500">
                  {isSw
                    ? `Hakuna bidhaa inayolingana na "${catalogSearchQuery}".`
                    : `No catalog products matched "${catalogSearchQuery}".`}
                </div>
              ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filteredActiveCatalog.map((item) => {
              const quanta = cartQuantaByProduct[item.productId] ?? 0;
              const wholesaleApplied = quanta >= item.wholesaleThresholdQuanta;
              const pricePerQuantum = wholesaleApplied
                ? item.wholesalePricePerQuantaTzs
                : item.retailPricePerQuantaTzs;
              const stepPriceTzs = pricePerQuantum * item.quantaStep;

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
                          {item.sku} · {isSw ? item.quantaUnitLabelSw : item.quantaUnitLabelEn}
                        </span>
                        {wholesaleApplied && (
                          <span className="font-semibold text-emerald-600">
                            Bei ya Jumla Applied 🎉
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
                        TZS {stepPriceTzs.toLocaleString('en-US')}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                        {quanta} Quanta ({(quanta * 0.25).toFixed(2)} KG/L)
                      </div>
                    </div>

                    <div className="inline-flex items-center border border-slate-200 rounded-md bg-white">
                      <button
                        type="button"
                        aria-label={`Decrease ${item.sku}`}
                        onClick={() => adjustProductQuanta(item, -1)}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <span className="w-8 text-center text-sm font-bold font-mono tabular-nums text-slate-900">
                        {quanta}
                      </span>
                      <button
                        type="button"
                        aria-label={`Increase ${item.sku}`}
                        onClick={() => adjustProductQuanta(item, 1)}
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

          {/* Persistent Bottom Action Bar opening Checkout Sheet */}
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

      {/* SCREEN 4: SLIDE-UP CHECKOUT SHEET (CART DRAWER) */}
      {checkoutSheetOpen && selectedStore && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-lg border border-slate-100 shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
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

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="divide-y divide-slate-100">
                {cartBreakdown.lines.map(({ item, quanta, lineTotalTzs, wholesaleApplied }) => (
                  <div key={item.productId} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {isSw ? item.nameSw : item.nameEn}
                      </div>
                      <div className="text-slate-500 font-mono">
                        {quanta} Quanta ({(quanta * 0.25).toFixed(2)} KG/L)
                        {wholesaleApplied && (
                          <span className="text-emerald-600 font-semibold"> · Bei ya Jumla Applied 🎉</span>
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
                    <span>{isSw ? 'Usafiri wa Dereva' : 'Independent Driver Fee'}</span>
                  </span>
                  <span className="font-mono font-semibold tabular-nums">
                    TZS {cartBreakdown.deliveryFeeTzs.toLocaleString('en-US')}
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

              {/* Dynamic Submit CTA: Online Emerald vs Offline Orange SMS Fallback */}
              <button
                type="button"
                onClick={handlePlaceOrderOrSms}
                className={`w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white rounded-md transition-colors cursor-pointer shadow-xs ${
                  isOnline
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-orange-600 hover:bg-orange-700'
                }`}
              >
                {isOnline
                  ? isSw
                    ? 'Thibitisha & Agiza (CoD)'
                    : 'Confirm & Dispatch CoD Order'
                  : 'Tuma Oda kwa SMS 📡'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SCREEN 5: ORDER CONFIRMATION (ISOLATED QR + DEVICE-SEPARATED PIN) */}
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
            orderRef8={activePinOrder.orderRef8}
            destinationLabel={activePinOrder.sellerName}
            expectedCashTzs={activePinOrder.totalCashDueTzs}
            expectedBuyerPin={activePinOrder.buyerPin4}
            expectedDriverPin="1122"
            onBack={() => setScreen('HOME')}
            onVerifiedSuccess={(consumedToken) => {
              setOrders((prev) =>
                prev.map((o) =>
                  o.orderId === activePinOrder.orderId ? { ...o, status: 'DELIVERED' } : o
                )
              );
              setFloatingToast({
                title: isSw
                  ? `Order Confirmation ya ${activePinOrder.orderRef8} Imekamilika`
                  : `Order Confirmation ${activePinOrder.orderRef8} Settled`,
                detail: `QR ${consumedToken} consumed · TZS ${activePinOrder.totalCashDueTzs.toLocaleString('en-US')} settled.`,
              });
            }}
          />
        </section>
      )}
    </div>
  );
}
