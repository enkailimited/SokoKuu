import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  Camera,
  CheckCircle2,
  Download,
  FileUp,
  Lock,
  Radio,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smartphone,
  Truck,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { sokoRealtime } from '../services/sokoRealtimeClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

export type IsolatedDeviceOwner = 'RETAILER_PHONE' | 'DRIVER_PHONE';

export interface IsolatedQrVerificationTerminalProps {
  locale?: Locale;
  defaultDeviceOwner?: IsolatedDeviceOwner;
  orderId?: string;
  orderRef8?: string;
  driverUserId?: string;
  destinationLabel?: string;
  expectedCashTzs?: number;
  onVerifiedSuccess?: (consumedQrToken: string) => void;
  onBack?: () => void;
}

interface BackendOrderItem {
  orderId: string;
  orderRef: string;
  sellerBusinessName?: string;
  expectedTotalTzs: number;
  status: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}

const DRIVER_RECONCILIATION_CHANNEL = 'sokokuu-driver-reconciliation';

function buildQrMatrix(token: string): boolean[][] {
  const size = 21;
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[r0 + r][c0 + c] = isBorder || isCore;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const inFinder =
        (r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8);
      if (inFinder) continue;
      hash ^= (r * 31 + c * 17) & 0xff;
      hash = Math.imul(hash, 16777619);
      grid[r][c] = (hash >>> 0) % 3 !== 0;
    }
  }
  return grid;
}

export function IsolatedQrVerificationTerminal({
  locale = 'sw',
  defaultDeviceOwner = 'RETAILER_PHONE',
  orderId,
  orderRef8,
  driverUserId,
  destinationLabel,
  expectedCashTzs,
  onVerifiedSuccess,
  onBack,
}: IsolatedQrVerificationTerminalProps) {
  const isSw = locale === 'sw';
  const [availableOrders, setAvailableOrders] = useState<BackendOrderItem[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>(orderId ?? '');
  const [loadingOrders, setLoadingOrders] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);

  const [deviceOwner, setDeviceOwner] = useState<IsolatedDeviceOwner>(defaultDeviceOwner);
  const [isQrGenerated, setIsQrGenerated] = useState<boolean>(false);
  const [isQrScannedAndVerified, setIsQrScannedAndVerified] = useState<boolean>(false);
  const [activeQrToken, setActiveQrToken] = useState<string>('');
  const [manualQrInput, setManualQrInput] = useState<string>('');
  const [qrSignature, setQrSignature] = useState<string | undefined>(undefined);
  const [consumedTokens, setConsumedTokens] = useState<string[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const [localBuyerPin, setLocalBuyerPin] = useState<string>('');
  const [localDriverPin, setLocalDriverPin] = useState<string>('');
  const [buyerPinConfirmed, setBuyerPinConfirmed] = useState<boolean>(false);
  const [driverPinConfirmed, setDriverPinConfirmed] = useState<boolean>(false);
  const [isTransactionComplete, setIsTransactionComplete] = useState<boolean>(false);

  const [feedback, setFeedback] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);

  const resolvedDriverId =
    driverUserId || SokoApiClient.getActiveUser()?.id || 'driver-session';
  const driverTopic = `/topic/driver/reconciliation/${resolvedDriverId}`;

  const loadOrdersIfNeeded = useCallback(async () => {
    if (isUuid(orderId)) return;
    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }
    setLoadingOrders(true);
    setBackendOffline(false);
    try {
      const res = await SokoApiClient.get<{ orders: BackendOrderItem[] }>('/orders/my-orders');
      const active = (res?.orders ?? []).filter(
        (o) => o.status === 'DISPATCHED' || o.status === 'PLACED',
      );
      setAvailableOrders(active);
      if (active.length > 0 && !active.some((o) => o.orderId === selectedOrderId)) {
        setSelectedOrderId(active[0].orderId);
      }
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setFeedback({
          type: 'error',
          text:
            err instanceof SokoHttpError
              ? err.message
              : isSw
                ? 'Imeshindikana kupakia oda za uhakiki.'
                : 'Failed to load active orders.',
        });
      }
    } finally {
      setLoadingOrders(false);
    }
  }, [isSw, orderId, selectedOrderId]);

  useEffect(() => {
    void loadOrdersIfNeeded();
  }, [loadOrdersIfNeeded]);

  const resolvedOrder = useMemo(() => {
    if (isUuid(orderId)) {
      return {
        orderId,
        orderRef: orderRef8 ?? orderId.slice(0, 8).toUpperCase(),
        sellerBusinessName: destinationLabel ?? '',
        expectedTotalTzs: Number(expectedCashTzs ?? 0),
        status: 'DISPATCHED',
      };
    }
    return availableOrders.find((o) => o.orderId === selectedOrderId) ?? availableOrders[0] ?? null;
  }, [availableOrders, destinationLabel, expectedCashTzs, orderId, orderRef8, selectedOrderId]);

  const qrMatrix = useMemo(
    () => (activeQrToken ? buildQrMatrix(activeQrToken) : []),
    [activeQrToken],
  );

  useEffect(() => {
    const handleSignal = (payload: {
      orderRef8?: string;
      actionRequired?: string;
      oneTimeQrToken?: string;
    }) => {
      if (payload?.actionRequired === 'TRIGGER_DRIVER_PIN_MODAL_OPEN') {
        if (payload.oneTimeQrToken) setActiveQrToken(payload.oneTimeQrToken);
        setIsQrScannedAndVerified(true);
      }
    };

    const unsubscribeRealtime = sokoRealtime.subscribeToReconciliation(
      resolvedDriverId,
      handleSignal,
    );

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(DRIVER_RECONCILIATION_CHANNEL);
        channel.onmessage = (event) => {
          const payload = event.data as {
            topic?: string;
            actionRequired?: string;
            oneTimeQrToken?: string;
          };
          if (
            payload?.topic === driverTopic &&
            payload?.actionRequired === 'TRIGGER_DRIVER_PIN_MODAL_OPEN'
          ) {
            handleSignal(payload);
          }
        };
      } catch {
        // BroadcastChannel unavailable
      }
    }

    return () => {
      unsubscribeRealtime();
      channel?.close();
    };
  }, [driverTopic, resolvedDriverId]);

  const completeAtomicTransaction = (token: string) => {
    setConsumedTokens((prev) => (prev.includes(token) ? prev : [...prev, token]));
    setIsTransactionComplete(true);
    setIsQrGenerated(false);
    setIsQrScannedAndVerified(false);
    setLocalBuyerPin('');
    setLocalDriverPin('');
    setFeedback({
      type: 'success',
      text: isSw
        ? `Oda #${resolvedOrder?.orderRef ?? ''} imefungwa salama! Tokeni ${token} imezimwa na leja imefungwa.`
        : `Order #${resolvedOrder?.orderRef ?? ''} settled! Token ${token} marked consumed and ledger closed.`,
    });
    onVerifiedSuccess?.(token);
  };

  const triggerDriverArrivalAndQr = async () => {
    if (!resolvedOrder) return;
    setFeedback(null);
    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setBusy(true);
    setBackendOffline(false);
    try {
      const issued = await SokoApiClient.post<{
        orderId: string;
        orderRef: string;
        oneTimeQrToken: string;
        qrSignature: string;
        expiresAt: string;
        ttlSeconds: number;
      }>(`/orders/${resolvedOrder.orderId}/driver-arrival-qr`);

      setActiveQrToken(issued.oneTimeQrToken);
      setManualQrInput(issued.oneTimeQrToken);
      setQrSignature(issued.qrSignature);
      setIsQrGenerated(true);
      setIsQrScannedAndVerified(false);
      setIsTransactionComplete(false);
      setBuyerPinConfirmed(false);
      setDriverPinConfirmed(false);
      setFeedback({
        type: 'info',
        text: isSw
          ? `Msimbo wa QR (${issued.oneTimeQrToken}) umetolewa na seva. Mpe Retailer a-scan.`
          : `Signed one-time QR (${issued.oneTimeQrToken}) issued by server (${issued.ttlSeconds}s TTL).`,
      });
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setFeedback({
          type: 'error',
          text:
            err instanceof SokoHttpError
              ? err.message
              : isSw
                ? 'Imeshindikana kutengeneza QR ya kuwasili.'
                : 'Failed to issue arrival QR token.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadQrSvg = () => {
    if (!activeQrToken || qrMatrix.length === 0 || !resolvedOrder) return;
    const cell = 10;
    const size = qrMatrix.length * cell;
    const rects = qrMatrix
      .flatMap((row, r) =>
        row.map((filled, c) =>
          filled
            ? `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="#0f172a"/>`
            : '',
        ),
      )
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#ffffff"/>${rects}</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resolvedOrder.orderRef}-${activeQrToken}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setFeedback({
      type: 'success',
      text: isSw
        ? `Picha ya QR (${activeQrToken}) imepakuliwa.`
        : `QR graphic (${activeQrToken}) downloaded cleanly.`,
    });
  };

  const handleShareQrWhatsApp = async () => {
    if (!activeQrToken || !resolvedOrder) return;
    const shareText = `SokoKuu TZ Order Confirmation QR (${resolvedOrder.orderRef}): ${activeQrToken} · TZS ${Number(resolvedOrder.expectedTotalTzs).toLocaleString('en-US')}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `SokoKuu TZ · ${resolvedOrder.orderRef}`, text: shareText });
        setFeedback({
          type: 'success',
          text: isSw ? 'QR imetumwa kupitia Share Sheet.' : 'QR shared via system sheet.',
        });
        return;
      } catch {
        // Fallback to clipboard copy
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(shareText).catch(() => undefined);
    }
    setFeedback({
      type: 'info',
      text: isSw
        ? `QR (${activeQrToken}) imenakiliwa tayari kutumwa.`
        : `QR (${activeQrToken}) copied to clipboard.`,
    });
  };

  const handleRetailerQrScanSuccess = async (source: 'CAMERA' | 'FILE', fileName?: string) => {
    if (!resolvedOrder) return;
    const tokenToScan = (manualQrInput.trim() || activeQrToken).toUpperCase();
    if (!tokenToScan) {
      setFeedback({
        type: 'error',
        text: isSw ? 'Weka msimbo wa QR wa dereva (SKQR-*) kwanza.' : 'Enter the driver QR token (SKQR-*) first.',
      });
      return;
    }

    if (consumedTokens.includes(tokenToScan)) {
      setFeedback({
        type: 'error',
        text: isSw
          ? `Msimbo wa QR (${tokenToScan}) umeshatumika au muda wake umekwisha.`
          : `QR code (${tokenToScan}) has already been used or expired.`,
      });
      return;
    }

    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setBusy(true);
    setFeedback(null);
    setBackendOffline(false);
    try {
      await SokoApiClient.post('/orders/reconcile/retailer-qr-scan', {
        orderId: resolvedOrder.orderId,
        qrToken: tokenToScan,
        ...(qrSignature ? { qrSignature } : {}),
      });
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setFeedback({
          type: 'error',
          text: err instanceof Error ? err.message : 'QR verification rejected by backend.',
        });
      }
      setBusy(false);
      return;
    } finally {
      setBusy(false);
    }

    if (fileName) setUploadedFileName(fileName);
    setActiveQrToken(tokenToScan);
    setIsQrScannedAndVerified(true);

    sokoRealtime.emitReconciliationSignal(resolvedDriverId, {
      orderRef8: resolvedOrder.orderRef,
      actionRequired: 'TRIGGER_DRIVER_PIN_MODAL_OPEN',
      oneTimeQrToken: tokenToScan,
    });

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const channel = new BroadcastChannel(DRIVER_RECONCILIATION_CHANNEL);
        channel.postMessage({
          orderRef8: resolvedOrder.orderRef,
          topic: driverTopic,
          actionRequired: 'TRIGGER_DRIVER_PIN_MODAL_OPEN',
          oneTimeQrToken: tokenToScan,
          timestamp: Date.now(),
        });
        channel.close();
      } catch {
        // Channel unavailable
      }
    }

    setFeedback({
      type: 'info',
      text: isSw
        ? `QR (${tokenToScan}) imethibitishwa (${source === 'CAMERA' ? 'Kamera' : 'Faili'}). Weka PIN yako ya mteja.`
        : `QR (${tokenToScan}) verified (${source}). Enter your Buyer PIN only.`,
    });
  };

  const submitBuyerPinOnly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedOrder) return;
    if (consumedTokens.includes(activeQrToken)) {
      setFeedback({
        type: 'error',
        text: isSw
          ? 'Msimbo wa QR umeshatumika au muda wake umekwisha.'
          : 'QR code has already been used.',
      });
      return;
    }

    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setBusy(true);
    setFeedback(null);
    setBackendOffline(false);
    try {
      const res = await SokoApiClient.post<{
        status?: string;
        reconciled?: boolean;
        verificationStatus?: string;
      }>('/orders/reconcile/buyer-pin', {
        orderId: resolvedOrder.orderId,
        buyerPin: localBuyerPin.trim(),
      });

      setBuyerPinConfirmed(true);
      if (res.status === 'DELIVERED' || res.verificationStatus === 'SUCCESSFUL' || res.reconciled) {
        completeAtomicTransaction(activeQrToken);
      } else {
        setFeedback({
          type: 'success',
          text: isSw
            ? 'PIN ya mteja imethibitishwa na seva! Inasubiri dereva aweke PIN yake kukamilisha.'
            : 'Buyer PIN verified by server! Awaiting Driver Private PIN to finalize delivery.',
        });
      }
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setFeedback({
          type: 'error',
          text: err instanceof Error ? err.message : 'Buyer PIN verification failed.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const submitDriverPinOnly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedOrder) return;
    if (consumedTokens.includes(activeQrToken)) {
      setFeedback({
        type: 'error',
        text: isSw
          ? 'Msimbo wa QR umeshatumika au muda wake umekwisha.'
          : 'QR code has already been used.',
      });
      return;
    }

    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setBusy(true);
    setFeedback(null);
    setBackendOffline(false);
    try {
      const res = await SokoApiClient.post<{
        status?: string;
        reconciled?: boolean;
        verificationStatus?: string;
      }>('/orders/reconcile/driver-pin', {
        orderId: resolvedOrder.orderId,
        driverPin: localDriverPin.trim(),
        collectedCashTzs: Number(resolvedOrder.expectedTotalTzs),
      });

      setDriverPinConfirmed(true);
      if (res.status === 'DELIVERED' || res.verificationStatus === 'SUCCESSFUL' || res.reconciled) {
        completeAtomicTransaction(activeQrToken);
      } else {
        setFeedback({
          type: 'info',
          text: isSw
            ? 'PIN ya dereva imethibitishwa na seva. Inasubiri uthibitisho wa PIN ya mteja kufunga oda.'
            : 'Driver PIN verified by server. Awaiting Buyer Confirmation PIN to close ledger.',
        });
      }
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setFeedback({
          type: 'error',
          text: err instanceof Error ? err.message : 'Driver PIN verification failed.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResetCycle = () => {
    setIsQrGenerated(false);
    setIsQrScannedAndVerified(false);
    setBuyerPinConfirmed(false);
    setDriverPinConfirmed(false);
    setIsTransactionComplete(false);
    setLocalBuyerPin('');
    setLocalDriverPin('');
    setUploadedFileName(null);
    setFeedback(null);
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-4 bg-slate-50 rounded-2xl border border-slate-100 font-sans antialiased text-slate-900">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          retrying={loadingOrders || busy}
          onRetry={() => void loadOrdersIfNeeded()}
        />
      )}

      {!isUuid(orderId) && availableOrders.length > 0 && (
        <select
          value={selectedOrderId}
          onChange={(e) => {
            setSelectedOrderId(e.target.value);
            handleResetCycle();
          }}
          className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-xl text-slate-900"
        >
          {availableOrders.map((o) => (
            <option key={o.orderId} value={o.orderId}>
              #{o.orderRef} — TZS {Number(o.expectedTotalTzs).toLocaleString('en-US')} ({o.status})
            </option>
          ))}
        </select>
      )}

      {loadingOrders && !resolvedOrder ? (
        <div className="bg-white border border-slate-100 rounded-2xl p-6 text-center text-xs text-slate-500">
          {isSw ? 'Inapakia oda...' : 'Loading active CoD orders...'}
        </div>
      ) : !resolvedOrder ? (
        <EmptyStateCard
          locale={locale}
          titleSw="Hakuna rekodi bado"
          titleEn="No records yet"
          descriptionSw="Hakuna oda zinazosubiri uthibitisho katika PostgreSQL."
          descriptionEn="No active CoD orders awaiting confirmation in PostgreSQL."
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isSw ? 'Rudi' : 'Back'}</span>
              </button>
            ) : (
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                Order Confirmation
              </span>
            )}
            <span className="text-[11px] font-mono font-bold text-emerald-700 tabular-nums">
              #{resolvedOrder.orderRef} · TZS {Number(resolvedOrder.expectedTotalTzs).toLocaleString('en-US')}
            </span>
          </div>

          <div className="bg-white p-1.5 rounded-2xl flex border border-slate-100 shadow-sm">
            <button
              type="button"
              onClick={() => setDeviceOwner('RETAILER_PHONE')}
              className={`w-1/2 text-xs font-black p-3 rounded-xl transition-all inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                deviceOwner === 'RETAILER_PHONE'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSw ? 'Simu ya Retailer' : 'Retailer Phone'}</span>
            </button>
            <button
              type="button"
              onClick={() => setDeviceOwner('DRIVER_PHONE')}
              className={`w-1/2 text-xs font-black p-3 rounded-xl transition-all inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                deviceOwner === 'DRIVER_PHONE'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Truck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSw ? 'Simu ya Dereva' : 'Driver Phone'}</span>
              {isQrScannedAndVerified && !driverPinConfirmed && !isTransactionComplete && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" aria-hidden="true" />
              )}
            </button>
          </div>

          {feedback && (
            <div
              role={feedback.type === 'error' ? 'alert' : 'status'}
              className={`p-3 rounded-xl border text-xs font-medium flex items-start gap-2 ${
                feedback.type === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : feedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-slate-100 border-slate-200 text-slate-800'
              }`}
            >
              {feedback.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" aria-hidden="true" />
              ) : (
                <CheckCircle2
                  className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600"
                  aria-hidden="true"
                />
              )}
              <span className="break-words">{feedback.text}</span>
            </div>
          )}

          {deviceOwner === 'RETAILER_PHONE' && (
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
              <div>
                <span className="text-[9px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded uppercase border border-emerald-100">
                  Retailer App Terminal · Order Confirmation
                </span>
                <h2 className="text-base font-black text-slate-900 mt-1">
                  {isSw ? 'Uhakiki wa Mzigo Mlangoni' : 'Doorstep Order Confirmation'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isSw
                    ? 'Ingiza au scan QR ya msafirishaji ili kufungua upande wako wa kuweka PIN ya mteja pekee.'
                    : 'Scan or enter the driver one-time QR token to unlock your Buyer PIN confirmation.'}
                </p>
              </div>

              {!isQrScannedAndVerified && !isTransactionComplete && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      {isSw ? 'Msimbo wa QR wa Dereva (SKQR-*)' : 'Driver One-Time QR Token (SKQR-*)'}
                    </label>
                    <input
                      type="text"
                      value={manualQrInput}
                      onChange={(e) => setManualQrInput(e.target.value.toUpperCase())}
                      placeholder="SKQR-..."
                      className="w-full p-2.5 border border-slate-200 rounded-xl font-mono text-xs bg-slate-50 text-slate-900 uppercase"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRetailerQrScanSuccess('CAMERA')}
                    className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold text-xs p-4 rounded-xl shadow-sm text-center flex items-center justify-center space-x-2 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {busy
                        ? isSw
                          ? 'Inahakiki QR...'
                          : 'Verifying QR...'
                        : isSw
                          ? 'Hakiki / Scan QR Code ya Msafirishaji'
                          : 'Verify / Scan Driver QR Code'}
                    </span>
                  </button>
                  <label className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs p-3.5 rounded-xl text-center flex items-center justify-center gap-2 cursor-pointer transition-colors">
                    <FileUp className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {uploadedFileName
                        ? uploadedFileName
                        : isSw
                          ? 'Pakia kutoka faili za simu'
                          : 'Upload QR from phone storage'}
                    </span>
                    <input
                      type="file"
                      accept="image/*,.svg"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleRetailerQrScanSuccess('FILE', file.name);
                      }}
                    />
                  </label>
                </div>
              )}

              {isQrScannedAndVerified && !isTransactionComplete && (
                <form
                  onSubmit={(e) => void submitBuyerPinOnly(e)}
                  className="space-y-3.5 border-t border-slate-100 pt-4"
                >
                  <div className="bg-emerald-50 text-emerald-800 p-3 rounded-xl text-[11px] font-medium border border-emerald-100 flex items-start gap-2">
                    <Lock className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                      {isSw
                        ? 'Msimbo wa QR umethibitishwa! Ingiza PIN yako ya siri ya mteja pekee.'
                        : 'QR verified! Enter your isolated Buyer Confirmation PIN only.'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="isolated-buyer-pin"
                      className="text-[10px] font-bold text-slate-500 uppercase"
                    >
                      {isSw
                        ? 'PIN ya Mteja (Buyer Confirmation PIN)'
                        : 'Buyer Confirmation PIN'}
                    </label>
                    <input
                      id="isolated-buyer-pin"
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      required
                      disabled={buyerPinConfirmed || busy}
                      value={localBuyerPin}
                      onChange={(e) => setLocalBuyerPin(e.target.value)}
                      className="w-full p-3 border border-slate-200 rounded-xl text-center text-lg font-mono tracking-widest font-black bg-slate-50 text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                      placeholder="****"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={buyerPinConfirmed || busy}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-200 disabled:text-emerald-900 text-white font-bold text-xs p-3.5 rounded-xl shadow-sm cursor-pointer"
                  >
                    {buyerPinConfirmed
                      ? isSw
                        ? 'PIN ya Mteja Imethibitishwa (Inasubiri Dereva)'
                        : 'Buyer PIN Verified (Awaiting Driver)'
                      : busy
                        ? isSw
                          ? 'Inahakiki...'
                          : 'Verifying...'
                        : isSw
                          ? 'Weka Uthibitisho Wako'
                          : 'Submit Order Confirmation'}
                  </button>
                </form>
              )}

              {isTransactionComplete && (
                <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 p-4 rounded-2xl text-center space-y-2">
                  <div className="text-xs font-bold flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                    <span>
                      {isSw
                        ? 'Mzigo umepokelewa na oda imefungwa kikamilifu!'
                        : 'Delivery received and Order Confirmation completed!'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetCycle}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" aria-hidden="true" />
                    <span>{isSw ? 'Anzisha Uthibitisho Mpya' : 'Start New Confirmation'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {deviceOwner === 'DRIVER_PHONE' && (
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
              <div>
                <span className="text-[9px] bg-slate-900 text-white font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                  Driver App Terminal · Order Confirmation
                </span>
                <h2 className="text-base font-black text-slate-900 mt-1">
                  {isSw
                    ? `Oda #${resolvedOrder.orderRef}`
                    : `Order #${resolvedOrder.orderRef}`}
                  {resolvedOrder.sellerBusinessName ? ` — ${resolvedOrder.sellerBusinessName}` : ''}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isSw
                    ? 'Toa QR Code ya mara moja mteja a-scan ili kufungua PIN ya dereva kwenye simu yako.'
                    : 'Issue signed one-time arrival QR, then enter your Driver Private PIN upon scan.'}
                </p>
              </div>

              {!isQrGenerated && !isQrScannedAndVerified && !isTransactionComplete && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void triggerDriverArrivalAndQr()}
                  className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold text-xs p-4 rounded-xl shadow-sm cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  <Truck className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {busy
                      ? isSw
                        ? 'Inatengeneza QR...'
                        : 'Issuing QR...'
                      : isSw
                        ? 'Nimefika mlangoni / Toa QR Code'
                        : 'Arrived / Issue One-Time QR'}
                  </span>
                </button>
              )}

              {isQrGenerated && !isQrScannedAndVerified && !isTransactionComplete && (
                <div className="text-center border-t border-slate-100 pt-4 space-y-3">
                  <div className="w-44 h-48 bg-slate-50 border border-slate-200 rounded-2xl mx-auto flex flex-col items-center justify-center p-4">
                    <svg
                      viewBox={`0 0 ${qrMatrix.length} ${qrMatrix.length}`}
                      className="w-32 h-32"
                      aria-label={`QR ${activeQrToken}`}
                    >
                      {qrMatrix.map((row, r) =>
                        row.map((filled, c) =>
                          filled ? (
                            <rect
                              key={`${r}-${c}`}
                              x={c}
                              y={r}
                              width={1}
                              height={1}
                              fill="#0f172a"
                            />
                          ) : null,
                        ),
                      )}
                    </svg>
                    <span className="text-[10px] font-mono font-bold text-slate-600 mt-2">
                      {activeQrToken}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 inline-flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" aria-hidden="true" />
                    <span>Listening on {driverTopic}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={handleDownloadQrSvg}
                      className="bg-slate-100 hover:bg-slate-200 p-2.5 rounded-lg text-slate-700 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{isSw ? 'Pakua QR' : 'Download QR'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleShareQrWhatsApp()}
                      className="bg-blue-50 hover:bg-blue-100 text-blue-700 p-2.5 rounded-lg border border-blue-100 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{isSw ? 'Tuma WhatsApp' : 'Share QR'}</span>
                    </button>
                  </div>
                </div>
              )}

              {isQrScannedAndVerified && !isTransactionComplete && (
                <form
                  onSubmit={(e) => void submitDriverPinOnly(e)}
                  className="space-y-3.5 border-t border-slate-100 pt-4"
                >
                  <div className="bg-amber-50 text-amber-900 p-3 rounded-xl text-[11px] font-medium border border-amber-200 flex items-start gap-2">
                    <BellRing className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                      {isSw
                        ? `QR (${activeQrToken}) imeshascanwa! Ingiza PIN yako binafsi ya dereva pekee.`
                        : `QR (${activeQrToken}) verified! Enter your isolated Driver Private PIN only.`}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="isolated-driver-pin"
                      className="text-[10px] font-bold text-slate-500 uppercase"
                    >
                      {isSw
                        ? 'PIN ya Dereva (Driver Private PIN)'
                        : 'Driver Private PIN'}
                    </label>
                    <input
                      id="isolated-driver-pin"
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      required
                      disabled={driverPinConfirmed || busy}
                      value={localDriverPin}
                      onChange={(e) => setLocalDriverPin(e.target.value)}
                      className="w-full p-3 border border-slate-200 rounded-xl text-center text-lg font-mono tracking-widest font-black bg-slate-50 text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                      placeholder="****"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={driverPinConfirmed || busy}
                    className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:text-slate-700 text-white font-bold text-xs p-3.5 rounded-xl shadow-sm cursor-pointer"
                  >
                    {driverPinConfirmed
                      ? isSw
                        ? 'PIN ya Dereva Imekubaliwa (Inasubiri Mteja)'
                        : 'Driver PIN Verified (Awaiting Buyer)'
                      : busy
                        ? isSw
                          ? 'Inahakiki...'
                          : 'Verifying...'
                        : isSw
                          ? 'Kamilisha na Kata Stock'
                          : 'Confirm Cash & Finalize'}
                  </button>
                </form>
              )}

              {isTransactionComplete && (
                <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 p-4 rounded-2xl text-center space-y-2">
                  <div className="text-xs font-bold flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                    <span>
                      {isSw
                        ? 'Oda imefungwa salama! Msimbo wa QR umefutwa.'
                        : 'Order closed cleanly! One-time QR token permanently consumed.'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetCycle}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" aria-hidden="true" />
                    <span>{isSw ? 'Anzisha Upya' : 'Reset'}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default IsolatedQrVerificationTerminal;
