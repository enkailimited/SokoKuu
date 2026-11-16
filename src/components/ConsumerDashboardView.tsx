import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Lock,
  Minus,
  Plus,
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
import { useDataSaver } from '../context/DataSaverContext';
import azaniaFlourImg from '../assets/images/azania_wheat_flour_1794734183041.jpg';
import korieOilImg from '../assets/images/korie_cooking_oil_1794734183539.jpg';
import kilomberoSugarImg from '../assets/images/kilombero_brown_sugar_1794734184028.jpg';
import mbeyaRiceImg from '../assets/images/mbeya_super_rice_1794734184118.jpg';

type ConsumerScreen = 'HOME' | 'DUKAS' | 'SHOP' | 'PIN_VERIFY';

interface NeighborhoodDuka {
  dukaId: string;
  name: string;
  initials: string;
  ward: string;
  distanceMeters: number;
  deliveryFeeTzs: number;
  modeTagSw: string;
  modeTagEn: string;
}

interface ConsumerLooseProduct {
  productId: string;
  dukaId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitMeasureSw: string;
  unitMeasureEn: string;
  quarterQuantaPerUnit: number; // 1=Robo (250g/250mL), 2=Nusu (500g), 3=Tatu-Robo (750g), 4=1KG/1L
  pricePerUnitTzs: number;
  imageSrc: string;
}

interface ConsumerOrder {
  orderId: string;
  orderRef8: string;
  dukaName: string;
  itemsSummary: string;
  totalCashDueTzs: number;
  buyerPin4: string;
  status: 'DISPATCHED' | 'DELIVERED';
}

const NEIGHBORHOOD_DUKAS: NeighborhoodDuka[] = [
  {
    dukaId: 'duka-sinza-01',
    name: 'Sinza Corner Duka',
    initials: 'SCD',
    ward: 'Sinza Mori, Dar es Salaam',
    distanceMeters: 120,
    deliveryFeeTzs: 1_000,
    modeTagSw: 'Duka la Rejareja · Robo / Nusu / Lita',
    modeTagEn: 'Retail Duka · Loose Household Fractions',
  },
  {
    dukaId: 'duka-kinondoni-02',
    name: 'Kinondoni Mama Lishe Mart',
    initials: 'KML',
    ward: 'Kinondoni Studio, Dar es Salaam',
    distanceMeters: 280,
    deliveryFeeTzs: 1_500,
    modeTagSw: 'Duka Mseto (Rejareja B2C)',
    modeTagEn: 'Hybrid Storefront (Walk-in Retail Mode)',
  },
];

const DUKA_LOOSE_PRODUCTS: Record<string, ConsumerLooseProduct[]> = {
  'duka-sinza-01': [
    {
      productId: 'con-rice-nusu',
      dukaId: 'duka-sinza-01',
      sku: 'MBY-NUSU',
      nameSw: 'Mchele wa Mbeya Super (Nusu Kilo)',
      nameEn: 'Mbeya Super Rice (Nusu 1/2 KG)',
      unitMeasureSw: 'Nusu Kilo (500g · 2 Quanta)',
      unitMeasureEn: 'Nusu 1/2 KG (500g · 2 Quanta)',
      quarterQuantaPerUnit: 2,
      pricePerUnitTzs: 1_600,
      imageSrc: mbeyaRiceImg,
    },
    {
      productId: 'con-sugar-robo',
      dukaId: 'duka-sinza-01',
      sku: 'KLM-ROBO',
      nameSw: 'Sukari ya Kilombero (Robo Kilo)',
      nameEn: 'Kilombero Brown Sugar (Robo 1/4 KG)',
      unitMeasureSw: 'Robo Kilo (250g · 1 Quantum)',
      unitMeasureEn: 'Robo 1/4 KG (250g · 1 Quantum)',
      quarterQuantaPerUnit: 1,
      pricePerUnitTzs: 850,
      imageSrc: kilomberoSugarImg,
    },
    {
      productId: 'con-oil-robo',
      dukaId: 'duka-sinza-01',
      sku: 'KOR-250ML',
      nameSw: 'Mafuta ya Korie (Robo Lita)',
      nameEn: 'Korie Cooking Oil (Robo 250mL)',
      unitMeasureSw: 'Robo Lita (250mL · 1 Quantum)',
      unitMeasureEn: 'Robo 1/4 Litre (250mL · 1 Quantum)',
      quarterQuantaPerUnit: 1,
      pricePerUnitTzs: 1_650,
      imageSrc: korieOilImg,
    },
    {
      productId: 'con-flour-1kg',
      dukaId: 'duka-sinza-01',
      sku: 'AZN-1KG',
      nameSw: 'Unga wa Ngano Azania (Kilo 1)',
      nameEn: 'Azania Wheat Flour (1 KG)',
      unitMeasureSw: 'Kilo 1 (1,000g · 4 Quanta)',
      unitMeasureEn: '1 KG Pack (1,000g · 4 Quanta)',
      quarterQuantaPerUnit: 4,
      pricePerUnitTzs: 2_300,
      imageSrc: azaniaFlourImg,
    },
  ],
  'duka-kinondoni-02': [
    {
      productId: 'con-kin-sugar-tatu',
      dukaId: 'duka-kinondoni-02',
      sku: 'KLM-750G',
      nameSw: 'Sukari ya Kilombero (Tatu-Robo 3/4 KG)',
      nameEn: 'Kilombero Sugar (Tatu-Robo 3/4 KG)',
      unitMeasureSw: 'Tatu-Robo Kilo (750g · 3 Quanta)',
      unitMeasureEn: 'Tatu-Robo 3/4 KG (750g · 3 Quanta)',
      quarterQuantaPerUnit: 3,
      pricePerUnitTzs: 2_450,
      imageSrc: kilomberoSugarImg,
    },
    {
      productId: 'con-kin-oil-1l',
      dukaId: 'duka-kinondoni-02',
      sku: 'KOR-1L',
      nameSw: 'Mafuta ya Korie (Lita 1)',
      nameEn: 'Korie Cooking Oil (1 Litre)',
      unitMeasureSw: 'Lita 1 (1,000mL · 4 Quanta)',
      unitMeasureEn: '1 Litre (1,000mL · 4 Quanta)',
      quarterQuantaPerUnit: 4,
      pricePerUnitTzs: 5_800,
      imageSrc: korieOilImg,
    },
  ],
};

const INITIAL_CONSUMER_ORDERS: ConsumerOrder[] = [
  {
    orderId: 'con-ord-01',
    orderRef8: 'CN3910A4',
    dukaName: 'Sinza Corner Duka',
    itemsSummary: 'Mchele Nusu (2x) + Mafuta Robo (1x)',
    totalCashDueTzs: 5_850,
    buyerPin4: '5192',
    status: 'DISPATCHED',
  },
];

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
    typeof window !== 'undefined' ? window.navigator.onLine : true
  );
  const [selectedDuka, setSelectedDuka] = useState<NeighborhoodDuka | null>(null);
  const [cartByProduct, setCartByProduct] = useState<Record<string, number>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [orders, setOrders] = useState<ConsumerOrder[]>(INITIAL_CONSUMER_ORDERS);
  const [pinOrderId, setPinOrderId] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    const goUp = () => setIsOnline(true);
    const goDown = () => setIsOnline(false);
    window.addEventListener('online', goUp);
    window.addEventListener('offline', goDown);
    return () => {
      window.removeEventListener('online', goUp);
      window.removeEventListener('offline', goDown);
    };
  }, []);

  const cashReadyTodayTzs = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'DISPATCHED')
        .reduce((sum, o) => sum + o.totalCashDueTzs, 0),
    [orders]
  );

  const openDuka = (duka: NeighborhoodDuka) => {
    setSelectedDuka(duka);
    setCartByProduct({});
    setDrawerOpen(false);
    setScreen('SHOP');
  };

  const dukaCatalog = useMemo(
    () => (selectedDuka ? DUKA_LOOSE_PRODUCTS[selectedDuka.dukaId] ?? [] : []),
    [selectedDuka]
  );

  const cartSummary = useMemo(() => {
    if (!selectedDuka) {
      return { lines: [], subtotalTzs: 0, deliveryFeeTzs: 0, totalTzs: 0, totalQuanta: 0 };
    }
    const lines: Array<{ item: ConsumerLooseProduct; qty: number; lineTzs: number }> = [];
    let subtotalTzs = 0;
    let totalQuanta = 0;

    for (const item of dukaCatalog) {
      const qty = cartByProduct[item.productId] ?? 0;
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
  }, [selectedDuka, dukaCatalog, cartByProduct]);

  const submitConsumerOrder = () => {
    if (!selectedDuka || cartSummary.lines.length === 0) return;
    const orderRef8 = 'CN' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const buyerPin4 = String(Math.floor(1000 + Math.random() * 9000));

    if (!isOnline) {
      const compact = cartSummary.lines.map((l, idx) => `C${idx + 1}:${l.qty}`).join(',');
      setToast({
        title: isSw
          ? `Oda ya Nyumbani Imetumwa kwa SMS (${selectedDuka.name})`
          : `Consumer NextSMS Order Sent (${selectedDuka.name})`,
        detail: `SK#${orderRef8}#${selectedDuka.initials}#${compact} · CoD TZS ${cartSummary.totalTzs.toLocaleString('en-US')}`,
      });
    } else {
      const newOrder: ConsumerOrder = {
        orderId: crypto.randomUUID(),
        orderRef8,
        dukaName: selectedDuka.name,
        itemsSummary: cartSummary.lines
          .map((l) => `${l.item.sku} (${l.qty}x)`)
          .join(' + '),
        totalCashDueTzs: cartSummary.totalTzs,
        buyerPin4,
        status: 'DISPATCHED',
      };
      setOrders((prev) => [newOrder, ...prev]);
      setToast({
        title: isSw
          ? `Oda yako inatoka ${selectedDuka.name}!`
          : `Order dispatched from ${selectedDuka.name}!`,
        detail: `Oda #${orderRef8} · PIN ya Kupokea Mlangoni: ${buyerPin4} · TZS ${cartSummary.totalTzs.toLocaleString('en-US')}`,
      });
    }

    setCartByProduct({});
    setDrawerOpen(false);
    setScreen('HOME');
  };

  const activePinOrder = orders.find((o) => o.orderId === pinOrderId) ?? null;

  const verifyDoorstepPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePinOrder) return;
    if (pinInput.trim() !== activePinOrder.buyerPin4) {
      setPinError(
        isSw
          ? `PIN si sahihi. Tumia PIN (${activePinOrder.buyerPin4}) kuthibitisha.`
          : `Incorrect PIN. Enter ${activePinOrder.buyerPin4} to confirm receipt.`
      );
      return;
    }

    setOrders((prev) =>
      prev.map((o) =>
        o.orderId === activePinOrder.orderId ? { ...o, status: 'DELIVERED' } : o
      )
    );
    setToast({
      title: isSw
        ? `Mzigo ${activePinOrder.orderRef8} Umepokelewa (DELIVERED)`
        : `Delivery ${activePinOrder.orderRef8} Confirmed (DELIVERED)`,
      detail: `TZS ${activePinOrder.totalCashDueTzs.toLocaleString('en-US')} settled at doorstep.`,
    });
    setPinOrderId(null);
    setScreen('HOME');
  };

  return (
    <div className="space-y-5">
      {/* Consumer Screen Step Bar + Network & Data Saver */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-100 rounded-lg px-4 py-3">
        <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-lg">
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
          <button
            type="button"
            onClick={() => setIsOnline((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
          >
            {isOnline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
            )}
            <span>{isOnline ? 'Online' : 'Offline SMS'}</span>
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
                {isSw
                  ? 'Taslimu ya Kulipa Mlangoni Leo'
                  : 'Cash Needed for Home Deliveries'}
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
                  {isSw ? 'Nunua Dukani 🛒' : 'Shop Nearby Dukas 🛒'}
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
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                {isSw
                  ? 'Oda Zako Zinazokuja Nyumbani (CoD & PIN)'
                  : 'Your Active Home Deliveries (Doorstep PIN)'}
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
                        setPinOrderId(order.orderId);
                        setPinInput('');
                        setPinError(null);
                        setScreen('PIN_VERIFY');
                      }}
                      className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{isSw ? 'Thibitisha kwa PIN' : 'Confirm Delivery PIN'}</span>
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-600">
                      {formatOrderStatusLabel('DELIVERED', locale)}
                    </span>
                  )}
                </div>
              ))}
            </div>
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
              {isSw ? 'Maduka ya Rejareja Karibu Nawe' : 'Retail Dukas Near You'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {NEIGHBORHOOD_DUKAS.map((duka) => (
              <article
                key={duka.dukaId}
                className="bg-white border border-slate-100 rounded-lg p-5 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center font-mono font-bold text-sm text-emerald-700 shrink-0">
                    {duka.initials}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <h3 className="text-sm font-bold text-slate-900 truncate">{duka.name}</h3>
                    <div className="text-xs text-slate-500 truncate">
                      {isSw ? duka.modeTagSw : duka.modeTagEn}
                    </div>
                    <div className="text-xs font-mono font-semibold text-emerald-600 tabular-nums">
                      📍 Mita {duka.distanceMeters} karibu
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openDuka(duka)}
                  className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Store className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isSw ? 'Ingia Dukani' : 'Open Duka'}</span>
                </button>
              </article>
            ))}
          </div>
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
                setCartByProduct({});
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {dukaCatalog.map((item) => {
              const qty = cartByProduct[item.productId] ?? 0;
              return (
                <article
                  key={item.productId}
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
                          setCartByProduct((p) => ({
                            ...p,
                            [item.productId]: Math.max(0, (p[item.productId] ?? 0) - 1),
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
                          setCartByProduct((p) => ({
                            ...p,
                            [item.productId]: (p[item.productId] ?? 0) + 1,
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
        </section>
      )}

      {/* SCREEN 4: SLIDE-UP CONSUMER CHECKOUT SHEET */}
      {drawerOpen && selectedDuka && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-lg border border-slate-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
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

            <div className="p-5 space-y-4">
              <div className="divide-y divide-slate-100">
                {cartSummary.lines.map(({ item, qty, lineTzs }) => (
                  <div
                    key={item.productId}
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
                onClick={submitConsumerOrder}
                className={`w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white rounded-md cursor-pointer ${
                  isOnline
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-orange-600 hover:bg-orange-700'
                }`}
              >
                {isOnline
                  ? isSw
                    ? 'Agiza Sasa (Lipa Mlangoni)'
                    : 'Confirm Cash-on-Delivery Order'
                  : 'Tuma Oda kwa SMS 📡'}
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

          <form onSubmit={verifyDoorstepPin} className="p-5 space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span>
                  {isSw
                    ? `Ingiza PIN yako ya Mlangoni (Jaribio: ${activePinOrder.buyerPin4})`
                    : `Enter Your 4-Digit Buyer PIN (Demo: ${activePinOrder.buyerPin4})`}
                </span>
              </span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                required
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="••••"
                className="w-full min-h-[48px] px-4 text-xl font-mono tracking-widest bg-white border-2 border-slate-300 rounded-md focus:border-emerald-600 focus:outline-none"
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
                className="flex-1 min-h-[48px] px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
              >
                {isSw ? 'Hakiki PIN & Pokea Bidhaa' : 'Confirm Receipt & Pay CoD'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
