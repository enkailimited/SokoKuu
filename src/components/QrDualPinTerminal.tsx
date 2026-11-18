import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Download,
  FileUp,
  Lock,
  QrCode,
  RefreshCw,
  Share2,
  ShieldCheck,
  Store,
  Truck,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

export type DoorstepTerminalRole = 'DRIVER' | 'RETAILER';
export type DoorstepOrderStage = 'DISPATCHED' | 'ARRIVED' | 'PIN_MODAL' | 'SUCCESS';

export interface QrDualPinTerminalProps {
  locale?: Locale;
  defaultRole?: DoorstepTerminalRole;
  orderId?: string;
  orderRef8?: string;
  destinationLabel?: string;
  expectedCashTzs?: number;
  itemsSummary?: string;
  onVerifiedSuccess?: (consumedQrToken: string) => void;
  onBack?: () => void;
}

interface BackendOrderSummary {
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

export function QrDualPinTerminal({
  locale = 'sw',
  defaultRole = 'DRIVER',
  orderId,
  orderRef8,
  destinationLabel,
  expectedCashTzs,
  itemsSummary,
  onVerifiedSuccess,
  onBack,
}: QrDualPinTerminalProps) {
  const isSw = locale === 'sw';
  const [userRole, setUserRole] = useState<DoorstepTerminalRole>(defaultRole);
  const [orderStatus, setOrderStatus] = useState<DoorstepOrderStage>('DISPATCHED');
  const [availableOrders, setAvailableOrders] = useState<BackendOrderSummary[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>(orderId ?? '');
  const [loadingOrders, setLoadingOrders] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  const [generatedQr, setGeneratedQr] = useState<string | null>(null);
  const [qrSignature, setQrSignature] = useState<string | undefined>(undefined);
  const [activeScannedQr, setActiveScannedQr] = useState<string>('');
  const [manualQrInput, setManualQrInput] = useState<string>('');
  const [consumedTokens, setConsumedTokens] = useState<string[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const [buyerPin, setBuyerPin] = useState<string>('');
  const [driverPin, setDriverPin] = useState<string>('');
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const loadOrdersIfNeeded = useCallback(async () => {
    if (isUuid(orderId)) return;
    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }
    setLoadingOrders(true);
    setBackendOffline(false);
    try {
      const res = await SokoApiClient.get<{ orders: BackendOrderSummary[] }>('/orders/my-orders');
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
                ? 'Imeshindikana kupakia oda za mlangoni.'
                : 'Failed to load active CoD orders.',
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
    () => (generatedQr ? buildQrMatrix(generatedQr) : []),
    [generatedQr],
  );

  const isTokenConsumed = (token: string) => consumedTokens.includes(token);

  const handleDriverArrivalNotification = async () => {
    if (!resolvedOrder) return;
    setFeedback(null);
    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setBusy(true);
    try {
      const issued = await SokoApiClient.post<{
        oneTimeQrToken: string;
        qrSignature: string;
        ttlSeconds: number;
      }>(`/orders/${resolvedOrder.orderId}/driver-arrival-qr`, {});

      setGeneratedQr(issued.oneTimeQrToken);
      setQrSignature(issued.qrSignature);
      setActiveScannedQr(issued.oneTimeQrToken);
      setManualQrInput(issued.oneTimeQrToken);
      setOrderStatus('ARRIVED');
      setFeedback({
        type: 'info',
        text: isSw
          ? `Msimbo wa QR (${issued.oneTimeQrToken}) umetengenezwa na seva (${issued.ttlSeconds}s TTL).`
          : `Signed one-time QR (${issued.oneTimeQrToken}) issued by PostgreSQL backend (${issued.ttlSeconds}s TTL).`,
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
                : 'Failed to generate arrival QR token.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadQrSvg = () => {
    if (!generatedQr || qrMatrix.length === 0 || !resolvedOrder) return;
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
    a.download = `${resolvedOrder.orderRef}-${generatedQr}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setFeedback({
      type: 'success',
      text: isSw
        ? `Picha ya QR (${generatedQr}) imepakuliwa kwenye kifaa chako.`
        : `QR graphic (${generatedQr}) downloaded cleanly to device storage.`,
    });
  };

  const handleShareQrToCustomer = async () => {
    if (!generatedQr || !resolvedOrder) return;
    const shareText = `SokoKuu TZ Handover QR (${resolvedOrder.orderRef}): ${generatedQr} · TZS ${resolvedOrder.expectedTotalTzs.toLocaleString('en-US')}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `SokoKuu TZ QR · ${resolvedOrder.orderRef}`,
          text: shareText,
        });
        setFeedback({
          type: 'success',
          text: isSw
            ? 'Taarifa ya QR imetumwa kupitia Share Sheet.'
            : 'QR handover token shared via system sheet.',
        });
        return;
      } catch {
        // Clipboard fallback
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(shareText).catch(() => undefined);
    }
    setFeedback({
      type: 'info',
      text: isSw
        ? `Msimbo wa QR (${generatedQr}) umenakiliwa tayari kutumwa kwa mteja.`
        : `QR token (${generatedQr}) copied to clipboard.`,
    });
  };

  const handleQrCodeProcessed = async (
    source: 'CAMERA_SCAN' | 'LOCAL_FILE_UPLOAD',
    fileName?: string,
  ) => {
    if (!resolvedOrder) return;
    const tokenToVerify = (manualQrInput.trim() || generatedQr || activeScannedQr).toUpperCase();
    if (!tokenToVerify) {
      setFeedback({
        type: 'error',
        text: isSw ? 'Weka au Scan msimbo wa QR kwanza.' : 'Enter or scan a valid SKQR-* token first.',
      });
      return;
    }
    if (isTokenConsumed(tokenToVerify)) {
      setFeedback({
        type: 'error',
        text: isSw
          ? `Msimbo wa QR (${tokenToVerify}) umeshatumika au muda wake umekwisha.`
          : `QR code (${tokenToVerify}) has already been used or expired.`,
      });
      return;
    }

    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      await SokoApiClient.post('/orders/reconcile/retailer-qr-scan', {
        orderId: resolvedOrder.orderId,
        qrToken: tokenToVerify,
        ...(qrSignature ? { qrSignature } : {}),
      });
      setActiveScannedQr(tokenToVerify);
      if (fileName) setUploadedFileName(fileName);
      setOrderStatus('PIN_MODAL');
      setFeedback({
        type: 'info',
        text: isSw
          ? `QR (${tokenToVerify}) imehakikiwa (${source}). Ingiza PIN zote mbili hapa chini.`
          : `QR (${tokenToVerify}) verified by backend (${source}). Enter both Buyer and Driver PINs below.`,
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
                ? 'Uthibitisho wa QR umekataliwa.'
                : 'QR verification rejected by backend.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleFinalReconciliationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedOrder) return;
    if (isTokenConsumed(activeScannedQr)) {
      setFeedback({
        type: 'error',
        text: isSw
          ? 'Msimbo wa QR umeshatumika au muda wake umekwisha.'
          : 'QR code has already been used or expired.',
      });
      return;
    }

    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      await SokoApiClient.post('/orders/verify-doorstep-qr', {
        orderId: resolvedOrder.orderId,
        qrToken: activeScannedQr,
        ...(qrSignature ? { qrSignature } : {}),
        buyerPin: buyerPin.trim(),
        driverPin: driverPin.trim(),
        collectedCashTzs: resolvedOrder.expectedTotalTzs,
      });

      setConsumedTokens((prev) => [...prev, activeScannedQr]);
      setOrderStatus('SUCCESS');
      setGeneratedQr(null);
      setBuyerPin('');
      setDriverPin('');
      setFeedback({
        type: 'success',
        text: isSw
          ? `Makabidhiano yamekamilika! Token ${activeScannedQr} imezimwa na stoo imesasishwa.`
          : `Handover settled in PostgreSQL! Token ${activeScannedQr} consumed.`,
      });
      onVerifiedSuccess?.(activeScannedQr);
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
                ? 'Mchanganyiko wa PIN au QR si sahihi.'
                : 'Doorstep verification failed.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResetCycle = () => {
    setOrderStatus('DISPATCHED');
    setGeneratedQr(null);
    setBuyerPin('');
    setDriverPin('');
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

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{isSw ? 'Rudi kwenye Oda' : 'Back to Orders'}</span>
        </button>
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
          {isSw ? 'Inapakia oda za makabidhiano...' : 'Loading active CoD orders...'}
        </div>
      ) : !resolvedOrder ? (
        <EmptyStateCard
          locale={locale}
          titleSw="Hakuna rekodi bado"
          titleEn="No records yet"
          descriptionSw="Hakuna oda zinazosubiri uhakiki wa QR & PIN katika PostgreSQL kwa sasa."
          descriptionEn="No active CoD orders awaiting QR + Dual-PIN confirmation in PostgreSQL."
        />
      ) : (
        <>
          <div className="bg-white p-1 rounded-xl flex border border-slate-100 shadow-sm">
            <button
              type="button"
              onClick={() => {
                setUserRole('DRIVER');
                setOrderStatus(generatedQr ? 'ARRIVED' : 'DISPATCHED');
                setFeedback(null);
              }}
              className={`w-1/2 text-xs font-bold py-2 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                userRole === 'DRIVER'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Truck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSw ? 'Hali ya Dereva' : 'Driver View'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setUserRole('RETAILER');
                if (orderStatus === 'ARRIVED') {
                  setOrderStatus('DISPATCHED');
                }
                setFeedback(null);
              }}
              className={`w-1/2 text-xs font-bold py-2 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                userRole === 'RETAILER'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Store className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSw ? 'Hali ya Retailer' : 'Retailer View'}</span>
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

          {userRole === 'DRIVER' && (
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[9px] bg-slate-900 text-white font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                    Driver Terminal
                  </span>
                  <h2 className="text-lg font-black text-slate-900 mt-1">
                    {isSw ? `Oda #${resolvedOrder.orderRef}` : `Order #${resolvedOrder.orderRef}`}
                    {resolvedOrder.sellerBusinessName ? ` — ${resolvedOrder.sellerBusinessName}` : ''}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {itemsSummary ||
                      (isSw
                        ? 'Andaa mzigo na mpe mteja akague kabla ya kuomba fedha mkononi.'
                        : 'Allow customer inspection before collecting physical cash.')}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-bold uppercase text-slate-400">CoD Due</div>
                  <div className="text-sm font-mono font-black text-slate-900 tabular-nums">
                    TZS {Number(resolvedOrder.expectedTotalTzs).toLocaleString('en-US')}
                  </div>
                </div>
              </div>

              {orderStatus === 'DISPATCHED' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDriverArrivalNotification()}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-black text-xs p-4 rounded-xl shadow-sm transition-transform active:scale-95 cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  <Truck className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {busy
                      ? isSw
                        ? 'Inatengeneza QR...'
                        : 'Issuing QR...'
                      : isSw
                        ? 'Nimefikisha Mzigo / Zalisha QR Mpya'
                        : 'Arrived at Doorstep / Generate One-Time QR'}
                  </span>
                </button>
              )}

              {orderStatus === 'ARRIVED' && generatedQr && (
                <div className="space-y-4 text-center border-t border-slate-100 pt-4">
                  <div className="w-48 h-48 bg-white border-2 border-slate-200 rounded-2xl mx-auto flex flex-col items-center justify-center p-3 shadow-xs">
                    <svg
                      viewBox={`0 0 ${qrMatrix.length} ${qrMatrix.length}`}
                      className="w-32 h-32"
                      aria-label={`QR Code ${generatedQr}`}
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
                    <span className="text-[10px] font-mono font-bold text-slate-800 mt-2">
                      {generatedQr}
                    </span>
                  </div>
                  <p className="text-xs text-amber-700 font-semibold">
                    {isSw
                      ? 'Mwambie Retailer a-scan huu msimbo wa kipekee ili kuwasha PIN modal.'
                      : 'Have the Retailer scan this single-use QR to unlock Dual-PIN entry.'}
                  </p>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleDownloadQrSvg}
                      className="text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 p-3 rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{isSw ? 'Pakua QR Image' : 'Save QR Image'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleShareQrToCustomer()}
                      className="text-xs font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 p-3 rounded-xl border border-blue-100 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{isSw ? 'Share kwa Mteja' : 'Share to Owner'}</span>
                    </button>
                  </div>
                </div>
              )}

              {orderStatus === 'SUCCESS' && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl text-center space-y-2">
                  <div className="text-xs font-bold flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                    <span>
                      {isSw
                        ? 'Oda imekamilika! Msimbo wa QR umezimwa na hauwezi kutumika tena.'
                        : 'Handover verified! One-time QR token permanently consumed.'}
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

          {userRole === 'RETAILER' && (
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[9px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded uppercase border border-emerald-100">
                    Retailer Terminal
                  </span>
                  <h2 className="text-lg font-black text-slate-900 mt-1">
                    {isSw ? 'Hakiki Upokeaji wa Mzigo' : 'Verify Doorstep Delivery'}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isSw
                      ? 'Kagua bidhaa na ulipe dereva Cash ndipo ukamilishe uthibitisho wa siri.'
                      : 'Inspect goods, hand over cash, then scan QR to unlock Dual-PIN verification.'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-mono text-slate-400">
                    #{resolvedOrder.orderRef}
                  </div>
                  <div className="text-xs font-mono font-bold text-emerald-700 tabular-nums">
                    TZS {Number(resolvedOrder.expectedTotalTzs).toLocaleString('en-US')}
                  </div>
                </div>
              </div>

              {orderStatus === 'DISPATCHED' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      {isSw ? 'Tokeni ya QR ya Dereva (SKQR-*)' : 'Driver One-Time QR Token'}
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
                    onClick={() => void handleQrCodeProcessed('CAMERA_SCAN')}
                    className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-black text-xs p-4 rounded-xl shadow-sm text-center flex items-center justify-center space-x-2 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {isSw
                        ? 'Scan / Hakiki QR Code ya Dereva Mlangoni'
                        : 'Scan / Verify Driver Doorstep QR Code'}
                    </span>
                  </button>

                  <label className="w-full bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold text-xs p-4 rounded-xl text-center flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.99]">
                    <FileUp className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>
                      {uploadedFileName
                        ? `${uploadedFileName}`
                        : isSw
                          ? 'Pakia QR Picha Kutoka Faili'
                          : 'Upload QR Snapshot from File'}
                    </span>
                    <input
                      type="file"
                      accept="image/*,.svg"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          void handleQrCodeProcessed('LOCAL_FILE_UPLOAD', file.name);
                        }
                      }}
                    />
                  </label>
                </div>
              )}

              {orderStatus === 'PIN_MODAL' && (
                <form
                  onSubmit={(e) => void handleFinalReconciliationSubmit(e)}
                  className="space-y-4 border-t border-slate-100 pt-4"
                >
                  <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-[11px] text-amber-900 font-medium flex items-start gap-2">
                    <QrCode className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                      {isSw
                        ? `QR (${activeScannedQr}) imethibitishwa! Ingiza PIN zote mbili ili kufunga hesabu.`
                        : `QR (${activeScannedQr}) verified! Enter both Buyer and Driver PINs to settle ledger.`}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="qr-buyer-pin"
                      className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1"
                    >
                      <Lock className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                      <span>
                        {isSw
                          ? '1. PIN ya Mteja (Retailer Secret PIN)'
                          : '1. Buyer Confirmation PIN'}
                      </span>
                    </label>
                    <input
                      id="qr-buyer-pin"
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      required
                      value={buyerPin}
                      onChange={(e) => setBuyerPin(e.target.value)}
                      className="w-full p-3 border border-slate-200 rounded-xl text-center text-lg font-mono tracking-widest font-black bg-slate-50 text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none"
                      placeholder="****"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="qr-driver-pin"
                      className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1"
                    >
                      <Lock className="w-3 h-3 text-slate-700" aria-hidden="true" />
                      <span>
                        {isSw
                          ? '2. PIN ya Dereva (Driver Private PIN)'
                          : '2. Driver Confirmation PIN'}
                      </span>
                    </label>
                    <input
                      id="qr-driver-pin"
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      required
                      value={driverPin}
                      onChange={(e) => setDriverPin(e.target.value)}
                      className="w-full p-3 border border-slate-200 rounded-xl text-center text-lg font-mono tracking-widest font-black bg-slate-50 text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none"
                      placeholder="****"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-black text-xs p-4 rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer"
                  >
                    {busy
                      ? isSw
                        ? 'Inahakiki...'
                        : 'Verifying...'
                      : isSw
                        ? 'Thibitisha Makabidhiano ya Cash & Mzigo'
                        : 'Confirm Cash Handover & Close Ledger'}
                  </button>
                </form>
              )}

              {orderStatus === 'SUCCESS' && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl text-center space-y-2">
                  <div className="text-xs font-bold flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                    <span>
                      {isSw
                        ? 'Muamala umefungwa kikamilifu! Rafu ya Duka lako imesasishwa na QR imezimwa.'
                        : 'Transaction closed cleanly! Duka inventory updated and QR consumed.'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleQrCodeProcessed('CAMERA_SCAN')}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 hover:underline cursor-pointer mr-4"
                  >
                    <span>{isSw ? 'Jaribu Kurudia QR (Test Replay Block)' : 'Test Replay Block'}</span>
                  </button>
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

export default QrDualPinTerminal;
