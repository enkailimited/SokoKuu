import { useEffect, useState } from 'react';
import {
  Check,
  Minus,
  Wifi,
  WifiOff,
  RefreshCw,
  Plus,
  Trash2,
  Send,
  KeyRound,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { TRANSLATIONS, type Locale } from '../data/i18n';
import {
  clearSyncedOrders,
  listQueuedOrders,
  putQueuedOrder,
  type DemoQueuedOrder,
} from '../lib/indexedDbDemo';
import { formatOrderStatusLabel } from '../lib/sokoManagedState';

function formatTzs(amount: number): string {
  return `TZS ${amount.toLocaleString('en-US')}`;
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRef8(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
}

async function computeWebCryptoSig6(segment: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(segment));
  const first3 = new Uint8Array(sig).slice(0, 3);
  return Array.from(first3, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function RbacMatrixPanel({ locale }: { locale: Locale }) {
  const t = TRANSLATIONS[locale].rbac;
  return (
    <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-900">{t.heading}</h2>
        <p className="text-sm text-slate-600 mt-0.5">{t.subheading}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
              <th className="py-2.5 px-5">{t.endpointCol}</th>
              {t.roles.map((role) => (
                <th key={role} className="py-2.5 px-4 text-center font-mono whitespace-nowrap">
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {t.rows.map((row) => (
              <tr key={row.endpoint} className="hover:bg-slate-50/70 transition-colors">
                <td className="py-2.5 px-5 font-mono text-xs text-slate-800 whitespace-nowrap">
                  {row.endpoint}
                </td>
                {row.perms.map((allowed, idx) => (
                  <td key={idx} className="py-2.5 px-4 text-center">
                    {allowed ? (
                      <span
                        className="inline-flex items-center justify-center text-emerald-700 font-medium text-xs"
                        aria-label="Allowed"
                      >
                        <Check className="w-4 h-4" />
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center justify-center text-slate-300 text-xs"
                        aria-label="Denied"
                      >
                        <Minus className="w-4 h-4" />
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const SAMPLE_SKUS = [
  {
    id: 'azania-flour',
    code: 'P01',
    nameEn: 'Azania Wheat Flour (2kg Pack)',
    nameSw: 'Unga wa Ngano Azania (Pakiti 2kg)',
    baseStock: 480,
    tiers: {
      CARTON: { units: 24, priceTzs: 81600, minQty: 2 },
      DOZEN: { units: 12, priceTzs: 42000, minQty: 1 },
      PACK: { units: 6, priceTzs: 21600, minQty: 1 },
      UNIT: { units: 1, priceTzs: 3800, minQty: 1 },
    },
  },
  {
    id: 'korie-oil',
    code: 'P02',
    nameEn: 'Korie Cooking Oil (1L Bottle)',
    nameSw: 'Mafuta ya Kupikia Korie (Lita 1)',
    baseStock: 600,
    tiers: {
      CARTON: { units: 20, priceTzs: 94000, minQty: 2 },
      DOZEN: { units: 12, priceTzs: 57600, minQty: 1 },
      PACK: { units: 4, priceTzs: 19600, minQty: 1 },
      UNIT: { units: 1, priceTzs: 5100, minQty: 1 },
    },
  },
] as const;

type TierKey = 'CARTON' | 'DOZEN' | 'PACK' | 'UNIT';

export function TieredPricingSimulator({ locale }: { locale: Locale }) {
  const t = TRANSLATIONS[locale].pricing;
  const [skuId, setSkuId] = useState<string>(SAMPLE_SKUS[0].id);
  const [tier, setTier] = useState<TierKey>('CARTON');
  const [qty, setQty] = useState<number>(2);

  const sku = SAMPLE_SKUS.find((s) => s.id === skuId) ?? SAMPLE_SKUS[0];
  const tierSpec = sku.tiers[tier];
  const safeQty = Math.max(tierSpec.minQty, qty);
  const unitsDeducted = safeQty * tierSpec.units;
  const remaining = Math.max(0, sku.baseStock - unitsDeducted);
  const lineTotal = safeQty * tierSpec.priceTzs;

  return (
    <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t.heading}</h2>
        <p className="text-sm text-slate-600 mt-0.5">{t.subheading}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label htmlFor="sku-select" className="block text-xs font-medium text-slate-700 mb-1.5">
            {t.productLabel}
          </label>
          <select
            id="sku-select"
            value={skuId}
            onChange={(e) => setSkuId(e.target.value)}
            className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
          >
            {SAMPLE_SKUS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {locale === 'sw' ? item.nameSw : item.nameEn}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="block text-xs font-medium text-slate-700 mb-1.5">{t.tierLabel}</span>
          <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-md">
            {(['CARTON', 'DOZEN', 'PACK', 'UNIT'] as TierKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTier(key);
                  setQty((prev) => Math.max(sku.tiers[key].minQty, prev));
                }}
                className={`py-1.5 px-2 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  tier === key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="tier-qty" className="block text-xs font-medium text-slate-700 mb-1.5">
            {t.qtyLabel} (min {tierSpec.minQty})
          </label>
          <input
            id="tier-qty"
            type="number"
            min={tierSpec.minQty}
            max={Math.floor(sku.baseStock / tierSpec.units)}
            value={safeQty}
            onChange={(e) => setQty(Number(e.target.value) || tierSpec.minQty)}
            className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-200">
        <div>
          <div className="text-xs text-slate-500">{t.unitPrice}</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-1">
            {formatTzs(tierSpec.priceTzs)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
            1 {tier} = {tierSpec.units} UNIT
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">{t.unitsDeducted}</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-1">
            -{unitsDeducted} UNIT
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">{t.stockRemaining}</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-1">
            {remaining} / {sku.baseStock}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">{t.lineTotal}</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-emerald-800 mt-1">
            {formatTzs(lineTotal)}
          </div>
        </div>
      </div>
    </section>
  );
}

type VerificationStatus = 'WAITING' | 'BUYER_CONFIRMED' | 'DRIVER_CONFIRMED' | 'SUCCESSFUL';

export function DualPinReconciliationSimulator({ locale }: { locale: Locale }) {
  const t = TRANSLATIONS[locale].reconciliationSim;
  const expectedCash = 163200;
  const [status, setStatus] = useState<VerificationStatus>('WAITING');
  const [buyerPinInput, setBuyerPinInput] = useState('4821');
  const [driverPinInput, setDriverPinInput] = useState('7390');
  const [collectedCashInput, setCollectedCashInput] = useState('163200');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const orderStatus = status === 'SUCCESSFUL' ? 'DELIVERED' : 'DISPATCHED';

  const handleBuyerConfirm = () => {
    setErrorMsg(null);
    if (buyerPinInput.trim() !== '4821') {
      setErrorMsg(t.pinError);
      return;
    }
    setStatus((prev) => (prev === 'DRIVER_CONFIRMED' ? 'SUCCESSFUL' : 'BUYER_CONFIRMED'));
  };

  const handleDriverConfirm = () => {
    setErrorMsg(null);
    const declared = Number(collectedCashInput);
    if (driverPinInput.trim() !== '7390' || declared !== expectedCash) {
      setErrorMsg(t.pinError);
      return;
    }
    setStatus((prev) => (prev === 'BUYER_CONFIRMED' ? 'SUCCESSFUL' : 'DRIVER_CONFIRMED'));
  };

  const handleReset = () => {
    setStatus('WAITING');
    setBuyerPinInput('4821');
    setDriverPinInput('7390');
    setCollectedCashInput('163200');
    setErrorMsg(null);
  };

  return (
    <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t.heading}</h2>
          <p className="text-sm text-slate-600 mt-0.5">{t.subheading}</p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t.resetBtn}</span>
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-4 border-y border-slate-200">
        <div>
          <div className="text-xs text-slate-500">{t.orderRefLabel}</div>
          <div className="text-base font-semibold font-mono text-slate-900 mt-1">A9K4M2X7</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">{t.expectedCashLabel}</div>
          <div className="text-base font-semibold font-mono tabular-nums text-slate-900 mt-1">
            {formatTzs(expectedCash)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">{t.orderStatusLabel}</div>
          <div
            className={`text-base font-semibold mt-1 ${
              orderStatus === 'DELIVERED' ? 'text-emerald-800' : 'text-amber-800'
            }`}
          >
            {formatOrderStatusLabel(orderStatus, locale)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">{t.ledgerStatusLabel}</div>
          <div
            className={`text-base font-semibold mt-1 ${
              status === 'SUCCESSFUL'
                ? 'text-emerald-800'
                : status === 'WAITING'
                  ? 'text-slate-700'
                  : 'text-sky-800'
            }`}
          >
            {formatOrderStatusLabel(status, locale)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <label htmlFor="buyer-pin" className="block text-xs font-medium text-slate-700">
            {t.buyerPinLabel}
          </label>
          <div className="flex gap-2">
            <input
              id="buyer-pin"
              type="text"
              maxLength={4}
              value={buyerPinInput}
              disabled={status === 'BUYER_CONFIRMED' || status === 'SUCCESSFUL'}
              onChange={(e) => setBuyerPinInput(e.target.value)}
              className="flex-1 h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900 disabled:bg-slate-50"
            />
            <button
              type="button"
              onClick={handleBuyerConfirm}
              disabled={status === 'BUYER_CONFIRMED' || status === 'SUCCESSFUL'}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t.confirmBuyerBtn}</span>
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="driver-pin" className="block text-xs font-medium text-slate-700 mb-1.5">
                {t.driverPinLabel}
              </label>
              <input
                id="driver-pin"
                type="text"
                maxLength={4}
                value={driverPinInput}
                disabled={status === 'DRIVER_CONFIRMED' || status === 'SUCCESSFUL'}
                onChange={(e) => setDriverPinInput(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label htmlFor="collected-cash" className="block text-xs font-medium text-slate-700 mb-1.5">
                {t.collectedCashLabel}
              </label>
              <input
                id="collected-cash"
                type="number"
                value={collectedCashInput}
                disabled={status === 'DRIVER_CONFIRMED' || status === 'SUCCESSFUL'}
                onChange={(e) => setCollectedCashInput(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900 disabled:bg-slate-50"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={handleDriverConfirm}
            disabled={status === 'DRIVER_CONFIRMED' || status === 'SUCCESSFUL'}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.confirmDriverBtn}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md px-3.5 py-2.5">
          {errorMsg}
        </div>
      )}

      {status === 'SUCCESSFUL' && (
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3.5 py-2.5">
          <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{t.successNote}</span>
        </div>
      )}
    </section>
  );
}

export function NextSmsPayloadSimulator({ locale }: { locale: Locale }) {
  const t = TRANSLATIONS[locale].nextsmsSim;
  const [sellerCode, setSellerCode] = useState('S12');
  const [itemsBlock, setItemsBlock] = useState('P01:C:2,P02:D:1');
  const [secret, setSecret] = useState('sk_live_tz_9928174_kariakoo');
  const [ref8, setRef8] = useState(() => generateRef8());
  const [sig6, setSig6] = useState('------');
  const [webhookAck, setWebhookAck] = useState<string | null>(null);

  const signedSegment = `SK#${ref8}#${sellerCode}#${itemsBlock}`;
  const fullSms = `${signedSegment}#${sig6}`;
  const isOverLimit = fullSms.length > 160;
  const smsHref = `sms:+255754000999?body=${encodeURIComponent(fullSms)}`;

  useEffect(() => {
    let cancelled = false;
    computeWebCryptoSig6(signedSegment, secret).then((computed) => {
      if (!cancelled) setSig6(computed);
    });
    return () => {
      cancelled = true;
    };
  }, [signedSegment, secret]);

  return (
    <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t.heading}</h2>
          <p className="text-sm text-slate-600 mt-0.5">{t.subheading}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setRef8(generateRef8());
            setWebhookAck(null);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t.regenerateBtn}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label htmlFor="sms-seller" className="block text-xs font-medium text-slate-700 mb-1.5">
            {t.sellerLabel}
          </label>
          <select
            id="sms-seller"
            value={sellerCode}
            onChange={(e) => {
              setSellerCode(e.target.value);
              setWebhookAck(null);
            }}
            className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900"
          >
            <option value="S12">S12 · Kariakoo Msimbazi Hub</option>
            <option value="S19">S19 · Ilala Boma Grain Depot</option>
            <option value="S04">S04 · Congo St. Wholesale</option>
          </select>
        </div>

        <div>
          <label htmlFor="sms-items" className="block text-xs font-medium text-slate-700 mb-1.5">
            {t.skuLabel}
          </label>
          <input
            id="sms-items"
            type="text"
            value={itemsBlock}
            onChange={(e) => {
              setItemsBlock(e.target.value.toUpperCase().replace(/[^A-Z0-9:,]/g, ''));
              setWebhookAck(null);
            }}
            className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900"
          />
        </div>

        <div>
          <label htmlFor="sms-secret" className="block text-xs font-medium text-slate-700 mb-1.5">
            {t.secretLabel}
          </label>
          <input
            id="sms-secret"
            type="text"
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
              setWebhookAck(null);
            }}
            className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900"
          />
        </div>
      </div>

      <div className="border border-slate-200 bg-slate-50 rounded-md p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-medium text-slate-700">{t.payloadLabel}</span>
          <span
            className={`font-mono tabular-nums font-medium ${
              isOverLimit ? 'text-red-700' : 'text-emerald-800'
            }`}
          >
            {fullSms.length} / 160 chars ({isOverLimit ? 'EXCEEDS SINGLE SMS' : 'SINGLE GSM-7 SMS OK'})
          </span>
        </div>

        <div className="font-mono text-sm text-slate-950 bg-white border border-slate-200 rounded px-3.5 py-2.5 break-all">
          {fullSms}
        </div>

        <div className="text-xs font-mono text-slate-500 break-all">
          {t.uriLabel}: {smsHref}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            disabled={isOverLimit}
            onClick={() => setWebhookAck(t.webhookVerified)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.verifyWebhookBtn}</span>
          </button>

          <a
            href={isOverLimit ? undefined : smsHref}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium border border-slate-300 rounded-md whitespace-nowrap shrink-0 ${
              isOverLimit
                ? 'text-slate-400 bg-slate-100 pointer-events-none'
                : 'text-slate-800 bg-white hover:bg-slate-100'
            }`}
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.launchLabel}</span>
          </a>
        </div>

        {webhookAck && (
          <div className="text-xs font-mono text-emerald-800 pt-1">
            {webhookAck} · orderRef={ref8} · SIG6={sig6}
          </div>
        )}
      </div>
    </section>
  );
}

const WHOLESALE_HUBS = [
  { name: 'Kariakoo Msimbazi Hub', code: 'S12' },
  { name: 'Kariakoo Congo St. Depot', code: 'S04' },
  { name: 'Ilala Boma Grain Hub', code: 'S19' },
];

export function OfflineQueueSimulator({ locale }: { locale: Locale }) {
  const t = TRANSLATIONS[locale].offlineSim;
  const [isOnline, setIsOnline] = useState(false);
  const [orders, setOrders] = useState<DemoQueuedOrder[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const reload = async () => {
    const items = await listQueuedOrders();
    setOrders(items);
  };

  useEffect(() => {
    void reload();
  }, []);

  const syncPendingToServer = async (itemsToSync: DemoQueuedOrder[]) => {
    setIsSyncing(true);
    for (const item of itemsToSync) {
      if (item.syncStatus === 'QUEUED_OFFLINE') {
        await putQueuedOrder({ ...item, syncStatus: 'SYNCING' });
        await reload();
        await new Promise((r) => setTimeout(r, 200));
        await putQueuedOrder({
          ...item,
          syncStatus: 'SYNCED',
          serverNote: '201 Created · CoD Ledger WAITING Dual-PIN',
        });
      }
    }
    await reload();
    setIsSyncing(false);
  };

  const handleQueueOrder = async () => {
    const hub = WHOLESALE_HUBS[orders.length % WHOLESALE_HUBS.length];
    const total = [163200, 282000, 94000, 408000][orders.length % 4];
    const ref8 = generateRef8();
    const segment = `SK#${ref8}#${hub.code}#P01:C:2`;
    const sig6 = await computeWebCryptoSig6(segment, 'sk_demo_device_secret');
    const draft: DemoQueuedOrder = {
      idempotencyKey: ref8,
      sellerHub: hub.name,
      compactSmsBody: `${segment}#${sig6}`,
      totalTzs: total,
      clientCreatedAt: new Date().toISOString(),
      syncStatus: isOnline ? 'SYNCING' : 'QUEUED_OFFLINE',
      retryCount: 0,
    };
    await putQueuedOrder(draft);
    await reload();

    if (isOnline) {
      await syncPendingToServer([{ ...draft, syncStatus: 'QUEUED_OFFLINE' }]);
    }
  };

  const handleToggleNetwork = async () => {
    const nextOnline = !isOnline;
    setIsOnline(nextOnline);
    if (nextOnline) {
      const current = await listQueuedOrders();
      await syncPendingToServer(current);
    }
  };

  const handleSendViaSms = async () => {
    const target = orders.find((o) => o.syncStatus === 'QUEUED_OFFLINE');
    if (!target) return;
    await putQueuedOrder({
      ...target,
      syncStatus: 'SENT_VIA_SMS',
      serverNote: `SMS queued: ${target.compactSmsBody} (${target.compactSmsBody.length} chars)`,
    });
    await reload();
  };

  const handleClear = async () => {
    await clearSyncedOrders();
    await reload();
  };

  return (
    <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t.heading}</h2>
          <p className="text-sm text-slate-600 mt-0.5">{t.subheading}</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium">
          {isOnline ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-800">
              <Wifi className="w-4 h-4" aria-hidden="true" />
              <span>{t.networkOnline}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-amber-800">
              <WifiOff className="w-4 h-4" aria-hidden="true" />
              <span>{t.networkOffline}</span>
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={handleToggleNetwork}
          disabled={isSyncing}
          className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            isOnline
              ? 'bg-slate-900 text-white hover:bg-slate-800'
              : 'bg-emerald-700 text-white hover:bg-emerald-800'
          }`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>{isOnline ? t.toggleOffline : t.toggleOnline}</span>
        </button>

        <button
          type="button"
          onClick={handleQueueOrder}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t.queueOrderBtn}</span>
        </button>

        <button
          type="button"
          onClick={handleSendViaSms}
          disabled={!orders.some((o) => o.syncStatus === 'QUEUED_OFFLINE')}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t.markSmsBtn}</span>
        </button>

        <button
          type="button"
          onClick={handleClear}
          disabled={!orders.some((o) => o.syncStatus === 'SYNCED' || o.syncStatus === 'SENT_VIA_SMS')}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer ml-auto"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t.clearSyncedBtn}</span>
        </button>
      </div>

      {orders.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-500">{t.emptyQueue}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-600">
                <th className="py-2.5 px-5">{t.colKey}</th>
                <th className="py-2.5 px-4">{t.colStore}</th>
                <th className="py-2.5 px-4 text-right">{t.colTotal}</th>
                <th className="py-2.5 px-4">{t.colStatus}</th>
                <th className="py-2.5 px-4 text-right">{t.colRetries}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {orders.map((order) => (
                <tr key={order.idempotencyKey} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-5 font-mono text-xs text-slate-800 whitespace-nowrap">
                    {order.idempotencyKey}
                  </td>
                  <td className="py-2.5 px-4 text-slate-900">
                    <div className="font-medium text-xs">{order.sellerHub}</div>
                    <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                      {order.serverNote ?? order.compactSmsBody}
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-slate-900 whitespace-nowrap">
                    {formatTzs(order.totalTzs)}
                  </td>
                  <td className="py-2.5 px-4 text-xs whitespace-nowrap">
                    <span
                      className={
                        order.syncStatus === 'SYNCED'
                          ? 'text-emerald-700 font-medium'
                          : order.syncStatus === 'SENT_VIA_SMS'
                            ? 'text-sky-700 font-medium'
                            : order.syncStatus === 'SYNCING'
                              ? 'text-slate-700 font-medium'
                              : 'text-amber-700 font-medium'
                      }
                    >
                      {formatOrderStatusLabel(order.syncStatus, locale)}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                    {order.retryCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
