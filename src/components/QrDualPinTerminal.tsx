import { useMemo, useState } from 'react';
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

export type DoorstepTerminalRole = 'DRIVER' | 'RETAILER';
export type DoorstepOrderStage = 'DISPATCHED' | 'ARRIVED' | 'PIN_MODAL' | 'SUCCESS';

export interface QrDualPinTerminalProps {
  locale?: Locale;
  defaultRole?: DoorstepTerminalRole;
  orderRef8?: string;
  destinationLabel?: string;
  expectedCashTzs?: number;
  expectedBuyerPin?: string;
  expectedDriverPin?: string;
  itemsSummary?: string;
  onVerifiedSuccess?: (consumedQrToken: string) => void;
  onBack?: () => void;
}

/**
 * Generates a deterministic 21x21 visual QR matrix from any SKQR token string
 * so drivers have a crisp, vector-rendered handover graphic ready to scan or save.
 */
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
  orderRef8 = 'SK88410A',
  destinationLabel = 'Tabata, Dar es Salaam',
  expectedCashTzs = 150_000,
  expectedBuyerPin = '4821',
  expectedDriverPin = '1122',
  itemsSummary,
  onVerifiedSuccess,
  onBack,
}: QrDualPinTerminalProps) {
  const isSw = locale === 'sw';
  const [userRole, setUserRole] = useState<DoorstepTerminalRole>(defaultRole);
  const [orderStatus, setOrderStatus] = useState<DoorstepOrderStage>('DISPATCHED');
  const [generatedQr, setGeneratedQr] = useState<string | null>(null);
  const [activeScannedQr, setActiveScannedQr] = useState<string>('SKQR-A1B2C3D4E5F6');
  const [consumedTokens, setConsumedTokens] = useState<string[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const [buyerPin, setBuyerPin] = useState<string>('');
  const [driverPin, setDriverPin] = useState<string>('');
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const qrMatrix = useMemo(
    () => (generatedQr ? buildQrMatrix(generatedQr) : []),
    [generatedQr]
  );

  const isTokenConsumed = (token: string) => consumedTokens.includes(token);

  // 1. DRIVER: Generate single-use SKQR token on arrival
  const handleDriverArrivalNotification = () => {
    const suffix = Math.random().toString(36).substring(2, 14).toUpperCase().padEnd(12, 'X');
    const freshToken = `SKQR-${suffix.slice(0, 12)}`;
    setGeneratedQr(freshToken);
    setActiveScannedQr(freshToken);
    setOrderStatus('ARRIVED');
    setFeedback({
      type: 'info',
      text: isSw
        ? `Msimbo wa QR (${freshToken}) umetengenezwa kwa matumizi ya mara moja tu. Mteja anaweza ku-scan sasa.`
        : `One-time QR token (${freshToken}) initialized. Ready for retailer camera scan or local upload.`,
    });
  };

  // Download generated QR graphic as crisp SVG file
  const handleDownloadQrSvg = () => {
    if (!generatedQr || qrMatrix.length === 0) return;
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
    a.download = `${orderRef8}-${generatedQr}.svg`;
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

  // Share QR handover token/details cleanly without window.alert
  const handleShareQrToCustomer = async () => {
    if (!generatedQr) return;
    const shareText = `SokoKuu TZ Handover QR (${orderRef8}): ${generatedQr} · TZS ${expectedCashTzs.toLocaleString('en-US')}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `SokoKuu TZ QR · ${orderRef8}`,
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
        // Fall through to clipboard fallback if share sheet cancelled
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(shareText).catch(() => undefined);
    }
    setFeedback({
      type: 'info',
      text: isSw
        ? `Msimbo wa QR (${generatedQr}) umenakiliwa tayari kutumwa kwa mteja (WhatsApp/SMS).`
        : `QR token (${generatedQr}) copied to clipboard for remote customer delivery.`,
    });
  };

  // 2. RETAILER: Twin ingestion (Hardware Camera Scan OR Local WhatsApp Image Upload)
  const handleQrCodeProcessed = (
    source: 'CAMERA_SCAN' | 'LOCAL_FILE_UPLOAD',
    fileName?: string
  ) => {
    const tokenToVerify = generatedQr || activeScannedQr;
    if (isTokenConsumed(tokenToVerify)) {
      setFeedback({
        type: 'error',
        text: isSw
          ? `Msimbo wa QR (${tokenToVerify}) umeshatumika au muda wake umekwisha.`
          : `QR code (${tokenToVerify}) has already been used or expired.`,
      });
      return;
    }
    setActiveScannedQr(tokenToVerify);
    if (fileName) setUploadedFileName(fileName);
    setOrderStatus('PIN_MODAL');
    setFeedback({
      type: 'info',
      text: isSw
        ? `Msimbo wa QR (${tokenToVerify}) umesomwa kupitia ${source === 'CAMERA_SCAN' ? 'Kamera' : 'Picha ya Faili'}. Ingiza PIN pacha hapa chini.`
        : `QR (${tokenToVerify}) verified via ${source}. Enter both Buyer and Driver PINs below.`,
    });
  };

  // 3. ATOMIC DUAL-PIN CLOSURE & ONE-TIME QR CONSUMPTION
  const handleFinalReconciliationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isTokenConsumed(activeScannedQr)) {
      setFeedback({
        type: 'error',
        text: isSw
          ? 'Msimbo wa QR umeshatumika au muda wake umekwisha.'
          : 'QR code has already been used or expired.',
      });
      return;
    }

    if (
      buyerPin.trim() !== expectedBuyerPin ||
      driverPin.trim() !== expectedDriverPin
    ) {
      setFeedback({
        type: 'error',
        text: isSw
          ? 'Mchanganyiko wa PIN si sahihi: PIN ya mteja au ya dereva haijalingana. Jaribu tena.'
          : 'Invalid PIN Combination: Buyer or Driver PIN mismatch.',
      });
      return;
    }

    setConsumedTokens((prev) => [...prev, activeScannedQr]);
    setOrderStatus('SUCCESS');
    setGeneratedQr(null);
    setBuyerPin('');
    setDriverPin('');
    setFeedback({
      type: 'success',
      text: isSw
        ? `Makabidhiano yamekamilika! Token ${activeScannedQr} imezimwa na stoo imesasishwa.`
        : `Handover settled! Token ${activeScannedQr} has been marked used.`,
    });
    onVerifiedSuccess?.(activeScannedQr);
  };

  const handleResetDemoCycle = () => {
    setOrderStatus('DISPATCHED');
    setGeneratedQr(null);
    setBuyerPin('');
    setDriverPin('');
    setUploadedFileName(null);
    setFeedback(null);
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-4 bg-slate-50 rounded-2xl border border-slate-100 font-sans antialiased text-slate-900">
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

      {/* ROLE SWITCHER CONTROLS */}
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

      {/* ==================== SCREEN A: DELIVERY DRIVER INTERFACE WORKSPACE ==================== */}
      {userRole === 'DRIVER' && (
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-[9px] bg-slate-900 text-white font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                Driver Terminal
              </span>
              <h2 className="text-lg font-black text-slate-900 mt-1">
                {isSw ? `Oda #${orderRef8}` : `Order #${orderRef8}`} — {destinationLabel}
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
                TZS {expectedCashTzs.toLocaleString('en-US')}
              </div>
            </div>
          </div>

          {orderStatus === 'DISPATCHED' && (
            <button
              type="button"
              onClick={handleDriverArrivalNotification}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs p-4 rounded-xl shadow-sm transition-transform active:scale-95 cursor-pointer inline-flex items-center justify-center gap-2"
            >
              <Truck className="w-4 h-4" aria-hidden="true" />
              <span>
                {isSw
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
                      ) : null
                    )
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
                  onClick={handleShareQrToCustomer}
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
                onClick={handleResetDemoCycle}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" aria-hidden="true" />
                <span>{isSw ? 'Anzisha Jaribio Jipya' : 'Reset Verification Cycle'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ==================== SCREEN B: RETAILER RECEIVING INTERFACE WORKSPACE ==================== */}
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
              <div className="text-[10px] font-mono text-slate-400">#{orderRef8}</div>
              <div className="text-xs font-mono font-bold text-emerald-700 tabular-nums">
                TZS {expectedCashTzs.toLocaleString('en-US')}
              </div>
            </div>
          </div>

          {orderStatus === 'DISPATCHED' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => handleQrCodeProcessed('CAMERA_SCAN')}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-black text-xs p-4 rounded-xl shadow-sm text-center flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>
                  {isSw
                    ? 'Scan QR Code ya Dereva Mlangoni'
                    : 'Scan Driver Doorstep QR Code'}
                </span>
              </button>

              <div className="relative flex py-1.5 items-center">
                <div className="flex-grow border-t border-slate-200" />
                <span className="flex-shrink mx-3 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                  {isSw ? 'Au Kama Umetumiwa Picha' : 'Or Remote Snapshot Upload'}
                </span>
                <div className="flex-grow border-t border-slate-200" />
              </div>

              <label className="w-full bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold text-xs p-4 rounded-xl text-center flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.99]">
                <FileUp className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {uploadedFileName
                    ? `${uploadedFileName}`
                    : isSw
                      ? 'Pakia QR Picha Kutoka Faili / WhatsApp'
                      : 'Upload QR Snapshot from File / WhatsApp'}
                </span>
                <input
                  type="file"
                  accept="image/*,.svg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleQrCodeProcessed('LOCAL_FILE_UPLOAD', file.name);
                    }
                  }}
                />
              </label>
            </div>
          )}

          {orderStatus === 'PIN_MODAL' && (
            <form
              onSubmit={handleFinalReconciliationSubmit}
              className="space-y-4 border-t border-slate-100 pt-4"
            >
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-[11px] text-amber-900 font-medium flex items-start gap-2">
                <QrCode className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  {isSw
                    ? `QR (${activeScannedQr}) imethibitishwa! Ingiza PIN zote mbili (Jaribio: Mteja ${expectedBuyerPin}, Dereva ${expectedDriverPin}) ili kufunga hesabu.`
                    : `QR (${activeScannedQr}) verified! Enter both PINs (Demo: Buyer ${expectedBuyerPin}, Driver ${expectedDriverPin}) to settle ledger.`}
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
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs p-4 rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                {isSw
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
                onClick={() => handleQrCodeProcessed('CAMERA_SCAN')}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 hover:underline cursor-pointer mr-4"
              >
                <span>{isSw ? 'Jaribu Kurudia QR (Test Replay Block)' : 'Test Replay Block'}</span>
              </button>
              <button
                type="button"
                onClick={handleResetDemoCycle}
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

export default QrDualPinTerminal;
