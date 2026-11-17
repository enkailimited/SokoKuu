import { useEffect, useMemo, useState } from 'react';
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
import { SokoApiClient } from '../services/sokoApiClient';
import { sokoRealtime } from '../services/sokoRealtimeClient';

export type IsolatedDeviceOwner = 'RETAILER_PHONE' | 'DRIVER_PHONE';

export interface IsolatedQrVerificationTerminalProps {
  locale?: Locale;
  defaultDeviceOwner?: IsolatedDeviceOwner;
  orderRef8?: string;
  driverUserId?: string;
  destinationLabel?: string;
  expectedCashTzs?: number;
  expectedBuyerPin?: string;
  expectedDriverPin?: string;
  onVerifiedSuccess?: (consumedQrToken: string) => void;
  onBack?: () => void;
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
  orderRef8 = 'SK8421F9',
  driverUserId = 'drv-7390-tz',
  destinationLabel = 'Makabidhiano',
  expectedCashTzs = 150_000,
  expectedBuyerPin = '4821',
  expectedDriverPin = '1122',
  onVerifiedSuccess,
  onBack,
}: IsolatedQrVerificationTerminalProps) {
  const isSw = locale === 'sw';

  const [deviceOwner, setDeviceOwner] = useState<IsolatedDeviceOwner>(defaultDeviceOwner);
  const [isQrGenerated, setIsQrGenerated] = useState<boolean>(false);
  const [isQrScannedAndVerified, setIsQrScannedAndVerified] = useState<boolean>(false);
  const [activeQrToken, setActiveQrToken] = useState<string>('SKQR-GIRT58B59B');
  const [consumedTokens, setConsumedTokens] = useState<string[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  // Strictly isolated per-device PIN state
  const [localBuyerPin, setLocalBuyerPin] = useState<string>('');
  const [localDriverPin, setLocalDriverPin] = useState<string>('');
  const [buyerPinConfirmed, setBuyerPinConfirmed] = useState<boolean>(false);
  const [driverPinConfirmed, setDriverPinConfirmed] = useState<boolean>(false);
  const [isTransactionComplete, setIsTransactionComplete] = useState<boolean>(false);

  const [feedback, setFeedback] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);

  const driverTopic = `/topic/driver/reconciliation/${driverUserId}`;

  const qrMatrix = useMemo(() => buildQrMatrix(activeQrToken), [activeQrToken]);

  // Listen for real-time WebSocket and BroadcastChannel triggers targeted at /topic/driver/reconciliation/{driverId}
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
      driverUserId,
      handleSignal
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
  }, [driverTopic, driverUserId]);

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
        ? `Oda #${orderRef8} imefungwa salama! Tokeni ${token} imezimwa (is_qr_token_consumed = TRUE) na stoo imesasishwa.`
        : `Order #${orderRef8} settled! Token ${token} marked consumed (is_qr_token_consumed = TRUE) and ledger closed.`,
    });
    onVerifiedSuccess?.(token);
  };

  // 1. DRIVER PHONE: Initialize unique one-time QR graphic upon doorstep arrival
  const triggerDriverArrivalAndQr = () => {
    const suffix = Math.random().toString(36).substring(2, 12).toUpperCase().padEnd(10, 'B');
    const freshToken = `SKQR-${suffix.slice(0, 10)}`;
    setActiveQrToken(freshToken);
    setIsQrGenerated(true);
    setIsQrScannedAndVerified(false);
    setIsTransactionComplete(false);
    setBuyerPinConfirmed(false);
    setDriverPinConfirmed(false);
    setFeedback({
      type: 'info',
      text: isSw
        ? `Msimbo wa QR (${freshToken}) umetengenezwa kwenye simu ya Dereva. Mpe Retailer a-scan au mtumie WhatsApp.`
        : `One-time QR (${freshToken}) generated on Driver Phone. Present to Retailer or send via WhatsApp.`,
    });
  };

  const handleDownloadQrSvg = () => {
    const cell = 10;
    const size = qrMatrix.length * cell;
    const rects = qrMatrix
      .flatMap((row, r) =>
        row.map((filled, c) =>
          filled
            ? `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="#0f172a"/>`
            : ''
        )
      )
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#ffffff"/>${rects}</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${orderRef8}-${activeQrToken}.svg`;
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
    const shareText = `SokoKuu TZ Order Confirmation QR (${orderRef8}): ${activeQrToken} · TZS ${expectedCashTzs.toLocaleString('en-US')}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `SokoKuu TZ · ${orderRef8}`, text: shareText });
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
        ? `QR (${activeQrToken}) imenakiliwa tayari kutumwa kwa WhatsApp.`
        : `QR (${activeQrToken}) copied to clipboard for WhatsApp delivery.`,
    });
  };

  // 2. RETAILER PHONE: Scan or Upload QR -> Verify unconsumed & fire STOMP WebSocket trigger to Driver Phone
  const handleRetailerQrScanSuccess = (source: 'CAMERA' | 'FILE', fileName?: string) => {
    if (consumedTokens.includes(activeQrToken)) {
      setFeedback({
        type: 'error',
        text: isSw
          ? `Msimbo wa QR (${activeQrToken}) umeshatumika au muda wake umekwisha.`
          : `QR code (${activeQrToken}) has already been used or expired.`,
      });
      return;
    }

    if (fileName) setUploadedFileName(fileName);
    setIsQrScannedAndVerified(true);

    sokoRealtime.emitReconciliationSignal(driverUserId, {
      orderRef8,
      actionRequired: 'TRIGGER_DRIVER_PIN_MODAL_OPEN',
      oneTimeQrToken: activeQrToken,
    });

    void SokoApiClient.post('/orders/reconcile/retailer-qr-scan', {
      orderId: orderRef8,
      qrToken: activeQrToken,
    }).catch(() => {
      // Offline fallback
    });

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const channel = new BroadcastChannel(DRIVER_RECONCILIATION_CHANNEL);
        channel.postMessage({
          orderRef8,
          topic: driverTopic,
          actionRequired: 'TRIGGER_DRIVER_PIN_MODAL_OPEN',
          oneTimeQrToken: activeQrToken,
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
        ? `QR imethibitishwa (${source === 'CAMERA' ? 'Kamera' : 'Faili'}). Weka PIN yako ya mteja. Signal ya WebSocket imetumwa kwenda ${driverTopic}.`
        : `QR verified (${source}). Enter your Buyer PIN only. WebSocket trigger dispatched to ${driverTopic}.`,
    });
  };

  // 3. RETAILER SUBMIT: Submits Buyer Confirmation PIN ONLY
  const submitBuyerPinOnly = (e: React.FormEvent) => {
    e.preventDefault();
    if (consumedTokens.includes(activeQrToken)) {
      setFeedback({
        type: 'error',
        text: isSw
          ? 'Msimbo wa QR umeshatumika au muda wake umekwisha.'
          : 'QR code has already been used.',
      });
      return;
    }

    if (localBuyerPin.trim() !== expectedBuyerPin) {
      setFeedback({
        type: 'error',
        text: isSw
          ? `PIN ya mteja si sahihi. Tumia ${expectedBuyerPin}.`
          : `Invalid Buyer Confirmation PIN. Expected ${expectedBuyerPin}.`,
      });
      return;
    }

    void SokoApiClient.post('/orders/reconcile/buyer-pin', {
      orderId: orderRef8,
      buyerPin: localBuyerPin,
    }).catch(() => {
      // Offline fallback
    });

    setBuyerPinConfirmed(true);
    if (driverPinConfirmed) {
      completeAtomicTransaction(activeQrToken);
    } else {
      setFeedback({
        type: 'success',
        text: isSw
          ? 'PIN ya mteja imekubaliwa. Fungua "Simu ya Dereva" au subiri dereva aweke PIN yake kukamilisha.'
          : 'Buyer PIN verified. Switch to Driver Phone or await Driver PIN confirmation.',
      });
    }
  };

  // 4. DRIVER SUBMIT: Submits Driver Private PIN ONLY
  const submitDriverPinOnly = (e: React.FormEvent) => {
    e.preventDefault();
    if (consumedTokens.includes(activeQrToken)) {
      setFeedback({
        type: 'error',
        text: isSw
          ? 'Msimbo wa QR umeshatumika au muda wake umekwisha.'
          : 'QR code has already been used.',
      });
      return;
    }

    if (localDriverPin.trim() !== expectedDriverPin) {
      setFeedback({
        type: 'error',
        text: isSw
          ? `PIN ya dereva si sahihi. Tumia ${expectedDriverPin}.`
          : `Invalid Driver Private PIN. Expected ${expectedDriverPin}.`,
      });
      return;
    }

    void SokoApiClient.post('/orders/reconcile/driver-pin', {
      orderId: orderRef8,
      driverPin: localDriverPin,
      collectedCashTzs: expectedCashTzs,
    }).catch(() => {
      // Offline fallback
    });

    setDriverPinConfirmed(true);
    if (buyerPinConfirmed) {
      completeAtomicTransaction(activeQrToken);
    } else {
      setFeedback({
        type: 'info',
        text: isSw
          ? 'PIN ya dereva imekubaliwa. Inasubiri uthibitisho wa PIN ya mteja (Simu ya Retailer) kufunga oda.'
          : 'Driver PIN verified. Awaiting Buyer Confirmation PIN on Retailer Phone to close ledger.',
      });
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
          #{orderRef8} · TZS {expectedCashTzs.toLocaleString('en-US')}
        </span>
      </div>

      {/* ISOLATED DEVICE SWITCHER */}
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

      {/* ==================== SCREEN A: RETAILER PHONE VIEW ==================== */}
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
                ? 'Scan QR ya msafirishaji ili kufungua upande wako wa kuweka PIN ya mteja pekee.'
                : 'Scan the driver QR or upload image snapshot to enter your Buyer PIN only.'}
            </p>
          </div>

          {!isQrScannedAndVerified && !isTransactionComplete && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => handleRetailerQrScanSuccess('CAMERA')}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs p-4 rounded-xl shadow-sm text-center flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>
                  {isSw ? 'Scan QR Code ya Msafirishaji' : 'Scan Driver QR Code'}
                </span>
              </button>
              <label className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs p-3.5 rounded-xl text-center flex items-center justify-center gap-2 cursor-pointer transition-colors">
                <FileUp className="w-4 h-4" aria-hidden="true" />
                <span>
                  {uploadedFileName
                    ? uploadedFileName
                    : isSw
                      ? 'Pakia kutoka faili za simu (WhatsApp)'
                      : 'Upload QR from phone storage (WhatsApp)'}
                </span>
                <input
                  type="file"
                  accept="image/*,.svg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleRetailerQrScanSuccess('FILE', file.name);
                  }}
                />
              </label>
            </div>
          )}

          {/* RETAILER PIN INPUT ONLY */}
          {isQrScannedAndVerified && !isTransactionComplete && (
            <form
              onSubmit={submitBuyerPinOnly}
              className="space-y-3.5 border-t border-slate-100 pt-4"
            >
              <div className="bg-emerald-50 text-emerald-800 p-3 rounded-xl text-[11px] font-medium border border-emerald-100 flex items-start gap-2">
                <Lock className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  {isSw
                    ? `Msimbo wa QR umethibitishwa! Ingiza PIN yako ya siri ya mteja pekee (Jaribio: ${expectedBuyerPin}).`
                    : `QR verified! Enter your isolated Buyer PIN only (Demo: ${expectedBuyerPin}).`}
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
                  disabled={buyerPinConfirmed}
                  value={localBuyerPin}
                  onChange={(e) => setLocalBuyerPin(e.target.value)}
                  className="w-full p-3 border border-slate-200 rounded-xl text-center text-lg font-mono tracking-widest font-black bg-slate-50 text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                  placeholder="****"
                />
              </div>
              <button
                type="submit"
                disabled={buyerPinConfirmed}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-200 disabled:text-emerald-900 text-white font-bold text-xs p-3.5 rounded-xl shadow-sm cursor-pointer"
              >
                {buyerPinConfirmed
                  ? isSw
                    ? 'PIN ya Mteja Imethibitishwa (Inasubiri Dereva)'
                    : 'Buyer PIN Verified (Awaiting Driver)'
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
                <span>{isSw ? 'Anzisha Jaribio Jipya' : 'Start New Confirmation'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ==================== SCREEN B: DRIVER PHONE VIEW ==================== */}
      {deviceOwner === 'DRIVER_PHONE' && (
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
          <div>
            <span className="text-[9px] bg-slate-900 text-white font-bold px-2 py-0.5 rounded uppercase tracking-wider">
              Driver App Terminal · Order Confirmation
            </span>
            <h2 className="text-base font-black text-slate-900 mt-1">
              {isSw ? `Oda #${orderRef8} — ${destinationLabel}` : `Order #${orderRef8} — ${destinationLabel}`}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isSw
                ? 'Toa mzigo rafu ya gari na uonyeshe QR mteja a-scan ili kufungua PIN ya dereva kwenye simu yako.'
                : 'Deliver goods, display one-time QR, and await WebSocket modal unlock.'}
            </p>
          </div>

          {!isQrGenerated && !isQrScannedAndVerified && !isTransactionComplete && (
            <button
              type="button"
              onClick={triggerDriverArrivalAndQr}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs p-4 rounded-xl shadow-sm cursor-pointer inline-flex items-center justify-center gap-2"
            >
              <Truck className="w-4 h-4" aria-hidden="true" />
              <span>
                {isSw
                  ? 'Nimefika mlangoni / Onyesha QR Code'
                  : 'Arrived / Display One-Time QR'}
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
                      ) : null
                    )
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
                  onClick={handleShareQrWhatsApp}
                  className="bg-blue-50 hover:bg-blue-100 text-blue-700 p-2.5 rounded-lg border border-blue-100 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isSw ? 'Tuma WhatsApp' : 'Send WhatsApp'}</span>
                </button>
              </div>
            </div>
          )}

          {/* DRIVER PIN MODAL TRIGGERED VIA WEBSOCKET / BROADCAST CHANNEL */}
          {isQrScannedAndVerified && !isTransactionComplete && (
            <form
              onSubmit={submitDriverPinOnly}
              className="space-y-3.5 border-t border-slate-100 pt-4"
            >
              <div className="bg-amber-50 text-amber-900 p-3 rounded-xl text-[11px] font-medium border border-amber-200 flex items-start gap-2">
                <BellRing className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  {isSw
                    ? `Mteja ameshascan QR! Ingiza PIN yako binafsi ya dereva pekee (Jaribio: ${expectedDriverPin}).`
                    : `Retailer scanned QR! Enter your isolated Driver Private PIN only (Demo: ${expectedDriverPin}).`}
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
                  disabled={driverPinConfirmed}
                  value={localDriverPin}
                  onChange={(e) => setLocalDriverPin(e.target.value)}
                  className="w-full p-3 border border-slate-200 rounded-xl text-center text-lg font-mono tracking-widest font-black bg-slate-50 text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                  placeholder="****"
                />
              </div>
              <button
                type="submit"
                disabled={driverPinConfirmed}
                className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:text-slate-700 text-white font-bold text-xs p-3.5 rounded-xl shadow-sm cursor-pointer"
              >
                {driverPinConfirmed
                  ? isSw
                    ? 'PIN ya Dereva Imekubaliwa (Inasubiri Mteja)'
                    : 'Driver PIN Verified (Awaiting Buyer)'
                  : isSw
                    ? 'Kamilisha na Kata Stock'
                    : 'Confirm & Deduct Stock'}
              </button>
            </form>
          )}

          {isTransactionComplete && (
            <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 p-4 rounded-2xl text-center space-y-2">
              <div className="text-xs font-bold flex items-center justify-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                <span>
                  {isSw
                    ? 'Oda imefungwa salama! Msimbo wa QR umefutwa na hauwezi kutumika tena.'
                    : 'Order closed cleanly! One-time QR token permanently disabled.'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleRetailerQrScanSuccess('CAMERA')}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 hover:underline cursor-pointer mr-4"
              >
                <span>{isSw ? 'Jaribu Kurudia QR' : 'Test Replay Block'}</span>
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
    </div>
  );
}

export default IsolatedQrVerificationTerminal;
