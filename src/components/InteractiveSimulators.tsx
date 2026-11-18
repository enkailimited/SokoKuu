import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Minus,
  Wifi,
  WifiOff,
  RefreshCw,
  Trash2,
  Send,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { TRANSLATIONS, type Locale } from '../data/i18n';
import {
  clearSyncedOrders,
  listQueuedOrders,
  putQueuedOrder,
  type OfflineQueuedOrder,
} from '../lib/indexedDbDemo';
import { formatOrderStatusLabel } from '../lib/sokoManagedState';
import { SokoApiClient, isSokoNetworkError } from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

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
  if (!secret) return '------';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
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

interface MerchantOption {
  merchantId: string;
  merchantName: string;
  smsShortCode: string;
}

interface MerchantProductRow {
  productId: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  unitPriceTzs: number;
  cartonPriceTzs: number;
  availableQuarterQuanta: number;
}

interface QuoteResponse {
  expectedTotalTzs: number;
  totalQuarterQuanta: number;
  lines: Array<{
    productId: string;
    unitType: string;
    quantity: number;
    unitPriceTzs: number;
    lineTotalTzs: number;
    totalQuarterQuanta: number;
  }>;
}

type TierKey = 'CARTON' | 'DOZEN' | 'PACK' | 'SINGLE_KILO_LITRE';

export function TieredPricingSimulator({ locale }: { locale: Locale }) {
  const t = TRANSLATIONS[locale].pricing;
  const isSw = locale === 'sw';
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState('');
  const [products, setProducts] = useState<MerchantProductRow[]>([]);
  const [productId, setProductId] = useState('');
  const [tier, setTier] = useState<TierKey>('CARTON');
  const [qty, setQty] = useState(1);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [backendOffline, setBackendOffline] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadMerchants = useCallback(async () => {
    try {
      const list = await SokoApiClient.get<MerchantOption[]>('/marketplace/merchants');
      const items = Array.isArray(list) ? list : [];
      setMerchants(items);
      if (items.length > 0) {
        setSelectedMerchantId((prev) => prev || items[0].merchantId);
      }
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
    }
  }, []);

  useEffect(() => {
    void loadMerchants();
  }, [loadMerchants]);

  useEffect(() => {
    if (!selectedMerchantId) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    SokoApiClient.get<MerchantProductRow[]>(`/products/active?businessId=${selectedMerchantId}`)
      .then((list) => {
        if (cancelled) return;
        const rows = Array.isArray(list) ? list : [];
        setProducts(rows);
        setProductId(rows[0]?.productId ?? '');
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMerchantId]);

  useEffect(() => {
    if (!selectedMerchantId || !productId) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setErrorMsg(null);
    SokoApiClient.post<QuoteResponse>('/pricing/calculate-quote', {
      sellerBusinessId: selectedMerchantId,
      items: [{ productId, unitType: tier, quantity: Math.max(1, qty) }],
    })
      .then((res) => {
        if (!cancelled) {
          setQuote(res);
          setBackendOffline(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setQuote(null);
          if (isSokoNetworkError(err)) setBackendOffline(true);
          else setErrorMsg(err instanceof Error ? err.message : 'Quote error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMerchantId, productId, tier, qty]);

  const activeLine = quote?.lines?.[0];

  return (
    <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t.heading}</h2>
        <p className="text-sm text-slate-600 mt-0.5">{t.subheading}</p>
      </div>

      {backendOffline && (
        <BackendOfflineBanner locale={locale} onRetry={() => void loadMerchants()} />
      )}

      {merchants.length === 0 ? (
        <EmptyStateCard
          locale={locale}
          titleSw="Hakuna Wafanyabiashara au Bidhaa bado"
          titleEn="No Merchants or active SKUs in PostgreSQL yet"
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label htmlFor="merchant-select" className="block text-xs font-medium text-slate-700 mb-1.5">
                {isSw ? 'Mfanyabiashara' : 'Merchant'}
              </label>
              <select
                id="merchant-select"
                value={selectedMerchantId}
                onChange={(e) => setSelectedMerchantId(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900"
              >
                {merchants.map((m) => (
                  <option key={m.merchantId} value={m.merchantId}>
                    {m.merchantName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="sku-select" className="block text-xs font-medium text-slate-700 mb-1.5">
                {t.productLabel}
              </label>
              <select
                id="sku-select"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900"
              >
                {products.map((item) => (
                  <option key={item.productId} value={item.productId}>
                    {item.sku} · {isSw ? item.nameSw : item.nameEn}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-700 mb-1.5">{t.tierLabel}</span>
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-md">
                {(['CARTON', 'DOZEN', 'PACK', 'SINGLE_KILO_LITRE'] as TierKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTier(key)}
                    className={`py-1.5 px-1 text-[11px] font-mono font-medium rounded transition-colors cursor-pointer ${
                      tier === key
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {key === 'SINGLE_KILO_LITRE' ? '1KG' : key}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="tier-qty" className="block text-xs font-medium text-slate-700 mb-1.5">
                {t.qtyLabel}
              </label>
              <input
                id="tier-qty"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900"
              />
            </div>
          </div>

          {errorMsg && <div className="text-xs text-red-700 font-medium">{errorMsg}</div>}

          {activeLine && quote && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 pt-4 border-t border-slate-200">
              <div>
                <div className="text-xs text-slate-500">{t.unitPrice}</div>
                <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-1">
                  {formatTzs(activeLine.unitPriceTzs)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Quarter-Quanta Required</div>
                <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-1">
                  {activeLine.totalQuarterQuanta} Q
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{t.lineTotal}</div>
                <div className="text-lg font-semibold font-mono tabular-nums text-emerald-800 mt-1">
                  {formatTzs(quote.expectedTotalTzs)}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

interface ActiveOrderRow {
  orderId: string;
  orderRef: string;
  status: string;
  expectedTotalTzs: number;
  cashLedger: {
    verificationStatus: string;
    isBuyerConfirmed: boolean;
    isDriverConfirmed: boolean;
  } | null;
}

export function DualPinReconciliationSimulator({ locale }: { locale: Locale }) {
  const t = TRANSLATIONS[locale].reconciliationSim;
  const isSw = locale === 'sw';
  const [orders, setOrders] = useState<ActiveOrderRow[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [buyerPinInput, setBuyerPinInput] = useState('');
  const [driverPinInput, setDriverPinInput] = useState('');
  const [collectedCashInput, setCollectedCashInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [backendOffline, setBackendOffline] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      const res = await SokoApiClient.get<{ orders: ActiveOrderRow[] }>('/orders/my-orders');
      const list = res.orders ?? [];
      setOrders(list);
      if (list.length > 0) {
        setSelectedOrderId((prev) => prev || list[0].orderId);
      }
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const activeOrder = orders.find((o) => o.orderId === selectedOrderId) ?? null;

  const handleBuyerConfirm = async () => {
    if (!activeOrder) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      await SokoApiClient.post(`/ledgers/${activeOrder.orderId}/buyer-confirm`, {
        buyerPin: buyerPinInput.trim(),
      });
      setBuyerPinInput('');
      setSuccessMsg(t.successNote);
      await loadOrders();
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      else setErrorMsg(err instanceof Error ? err.message : t.pinError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDriverConfirm = async () => {
    if (!activeOrder) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      await SokoApiClient.post(`/ledgers/${activeOrder.orderId}/driver-confirm`, {
        driverPin: driverPinInput.trim(),
        collectedCashTzs: Number(collectedCashInput),
      });
      setDriverPinInput('');
      setSuccessMsg(t.successNote);
      await loadOrders();
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      else setErrorMsg(err instanceof Error ? err.message : t.pinError);
    } finally {
      setSubmitting(false);
    }
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
          onClick={() => void loadOrders()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
        </button>
      </div>

      {backendOffline && (
        <BackendOfflineBanner locale={locale} onRetry={() => void loadOrders()} />
      )}

      {!activeOrder ? (
        <EmptyStateCard
          locale={locale}
          titleSw="Hakuna oda za kuthibitisha bado"
          titleEn="No active orders in PostgreSQL for PIN reconciliation"
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 py-4 border-y border-slate-200">
            <div>
              <label className="block text-xs text-slate-500 mb-1">{t.orderRefLabel}</label>
              <select
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                className="w-full h-9 px-2 text-xs font-mono bg-white border border-slate-300 rounded"
              >
                {orders.map((o) => (
                  <option key={o.orderId} value={o.orderId}>
                    #{o.orderRef} ({formatOrderStatusLabel(o.status, locale)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.expectedCashLabel}</div>
              <div className="text-base font-semibold font-mono tabular-nums text-slate-900 mt-1">
                {formatTzs(activeOrder.expectedTotalTzs)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.orderStatusLabel}</div>
              <div className="text-base font-semibold mt-1 text-slate-900">
                {formatOrderStatusLabel(activeOrder.status, locale)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.ledgerStatusLabel}</div>
              <div className="text-base font-semibold mt-1 text-emerald-800">
                {formatOrderStatusLabel(
                  activeOrder.cashLedger?.verificationStatus ?? 'WAITING',
                  locale,
                )}
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
                  type="password"
                  maxLength={6}
                  placeholder="PIN"
                  value={buyerPinInput}
                  onChange={(e) => setBuyerPinInput(e.target.value)}
                  className="flex-1 h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900"
                />
                <button
                  type="button"
                  disabled={submitting || !buyerPinInput.trim()}
                  onClick={() => void handleBuyerConfirm()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-45 cursor-pointer"
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
                    type="password"
                    maxLength={6}
                    placeholder="PIN"
                    value={driverPinInput}
                    onChange={(e) => setDriverPinInput(e.target.value)}
                    className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="collected-cash" className="block text-xs font-medium text-slate-700 mb-1.5">
                    {t.collectedCashLabel}
                  </label>
                  <input
                    id="collected-cash"
                    type="number"
                    placeholder="TZS"
                    value={collectedCashInput}
                    onChange={(e) => setCollectedCashInput(e.target.value)}
                    className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900"
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={submitting || !driverPinInput.trim() || !collectedCashInput.trim()}
                onClick={() => void handleDriverConfirm()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-45 cursor-pointer"
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

          {successMsg && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3.5 py-2.5">
              <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{successMsg}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function NextSmsPayloadSimulator({ locale }: { locale: Locale }) {
  const t = TRANSLATIONS[locale].nextsmsSim;
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [sellerCode, setSellerCode] = useState('');
  const [itemsBlock, setItemsBlock] = useState('');
  const [secret, setSecret] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [ref8, setRef8] = useState(() => generateRef8());
  const [sig6, setSig6] = useState('------');
  const [webhookAck, setWebhookAck] = useState<string | null>(null);
  const [webhookErr, setWebhookErr] = useState<string | null>(null);

  useEffect(() => {
    SokoApiClient.get<MerchantOption[]>('/marketplace/merchants')
      .then((list) => {
        const rows = Array.isArray(list) ? list : [];
        setMerchants(rows);
        if (rows.length > 0) {
          setSellerCode((prev) => prev || rows[0].smsShortCode);
        }
      })
      .catch(() => {});
  }, []);

  const signedSegment = `SK#${ref8}#${sellerCode}#${itemsBlock}`;
  const fullSms = `${signedSegment}#${sig6}`;
  const isOverLimit = fullSms.length > 160;
  const smsHref = `sms:?body=${encodeURIComponent(fullSms)}`;

  useEffect(() => {
    let cancelled = false;
    computeWebCryptoSig6(signedSegment, secret).then((computed) => {
      if (!cancelled) setSig6(computed);
    });
    return () => {
      cancelled = true;
    };
  }, [signedSegment, secret]);

  const handleVerifyWebhook = async () => {
    setWebhookAck(null);
    setWebhookErr(null);
    try {
      await SokoApiClient.post('/callback/nextsms/incoming', {
        from: senderPhone.trim(),
        text: fullSms,
      });
      setWebhookAck(t.webhookVerified);
    } catch (err) {
      setWebhookErr(err instanceof Error ? err.message : 'Webhook rejected request');
    }
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
          onClick={() => {
            setRef8(generateRef8());
            setWebhookAck(null);
            setWebhookErr(null);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t.regenerateBtn}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label htmlFor="sms-seller" className="block text-xs font-medium text-slate-700 mb-1.5">
            {t.sellerLabel}
          </label>
          <select
            id="sms-seller"
            value={sellerCode}
            onChange={(e) => setSellerCode(e.target.value)}
            className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900"
          >
            {merchants.length === 0 ? (
              <option value="">No Merchants loaded</option>
            ) : (
              merchants.map((m) => (
                <option key={m.merchantId} value={m.smsShortCode}>
                  {m.smsShortCode} · {m.merchantName}
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label htmlFor="sms-sender" className="block text-xs font-medium text-slate-700 mb-1.5">
            Sender MSISDN
          </label>
          <input
            id="sms-sender"
            type="text"
            placeholder="+255..."
            value={senderPhone}
            onChange={(e) => setSenderPhone(e.target.value)}
            className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900"
          />
        </div>

        <div>
          <label htmlFor="sms-items" className="block text-xs font-medium text-slate-700 mb-1.5">
            {t.skuLabel}
          </label>
          <input
            id="sms-items"
            type="text"
            placeholder="SKU:C:1"
            value={itemsBlock}
            onChange={(e) => setItemsBlock(e.target.value.toUpperCase().replace(/[^A-Z0-9:,]/g, ''))}
            className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900"
          />
        </div>

        <div>
          <label htmlFor="sms-secret" className="block text-xs font-medium text-slate-700 mb-1.5">
            {t.secretLabel}
          </label>
          <input
            id="sms-secret"
            type="password"
            placeholder="HMAC Key"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
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

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            disabled={isOverLimit || !sellerCode || !itemsBlock || !secret || !senderPhone}
            onClick={() => void handleVerifyWebhook()}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-45 cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.verifyWebhookBtn}</span>
          </button>

          <a
            href={isOverLimit ? undefined : smsHref}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium border border-slate-300 rounded-md ${
              isOverLimit
                ? 'text-slate-400 bg-slate-100 pointer-events-none'
                : 'text-slate-800 bg-white hover:bg-slate-100'
            }`}
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.launchLabel}</span>
          </a>
        </div>

        {webhookAck && <div className="text-xs font-mono text-emerald-800 pt-1">{webhookAck}</div>}
        {webhookErr && <div className="text-xs font-mono text-red-700 pt-1">{webhookErr}</div>}
      </div>
    </section>
  );
}

export function OfflineQueueSimulator({ locale }: { locale: Locale }) {
  const t = TRANSLATIONS[locale].offlineSim;
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [orders, setOrders] = useState<OfflineQueuedOrder[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const reload = useCallback(async () => {
    const items = await listQueuedOrders();
    setOrders(items);
  }, []);

  useEffect(() => {
    void reload();
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [reload]);

  const syncPendingToServer = async () => {
    setIsSyncing(true);
    const current = await listQueuedOrders();
    for (const item of current) {
      if (item.syncStatus !== 'QUEUED_OFFLINE') continue;
      if (!item.sellerBusinessId || !item.items || item.items.length === 0) {
        continue;
      }
      await putQueuedOrder({ ...item, syncStatus: 'SYNCING' });
      try {
        const res = await SokoApiClient.post<{ orderRef: string }>(
          '/orders/request',
          {
            sellerBusinessId: item.sellerBusinessId,
            originChannel: 'PWA_OFFLINE_SYNC',
            paymentMethod: 'CASH',
            items: item.items,
          },
          true,
        );
        await putQueuedOrder({
          ...item,
          syncStatus: 'SYNCED',
          serverNote: `201 Created · Order #${res.orderRef}`,
        });
      } catch (err) {
        await putQueuedOrder({
          ...item,
          syncStatus: 'QUEUED_OFFLINE',
          retryCount: item.retryCount + 1,
          serverNote: err instanceof Error ? err.message : 'Sync pending',
        });
      }
    }
    await reload();
    setIsSyncing(false);
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
          onClick={() => void syncPendingToServer()}
          disabled={isSyncing || !isOnline || !orders.some((o) => o.syncStatus === 'QUEUED_OFFLINE')}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-45 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>{locale === 'sw' ? 'Sawazisha Foleni Sasa' : 'Replay Queued Orders to NestJS'}</span>
        </button>

        <button
          type="button"
          onClick={() => void handleClear()}
          disabled={!orders.some((o) => o.syncStatus === 'SYNCED' || o.syncStatus === 'SENT_VIA_SMS')}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-45 cursor-pointer ml-auto"
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
                  <td className="py-2.5 px-4 text-xs whitespace-nowrap font-medium text-slate-700">
                    {formatOrderStatusLabel(order.syncStatus, locale)}
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
