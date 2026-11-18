import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  MapPin,
  Phone,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { formatOrderStatusLabel } from '../lib/sokoManagedState';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';
import { IsolatedQrVerificationTerminal } from './IsolatedQrVerificationTerminal';

export interface DriverDeliveryTask {
  orderId: string;
  orderRef: string;
  dukaName: string;
  dukaAddress: string;
  dukaWard: string;
  ownerPhone: string;
  itemsSummarySw: string;
  itemsSummaryEn: string;
  expectedCashTzs: number;
  status: 'PLACED' | 'DISPATCHED' | 'IN_TRANSIT' | 'DELIVERED' | 'DISPUTED';
}

interface BackendDriverQueueResponse {
  count: number;
  deliveries: Array<{
    orderId: string;
    orderRef: string;
    sellerBusinessId: string;
    buyerUserId: string;
    status: 'PLACED' | 'DISPATCHED' | 'DELIVERED' | 'DISPUTED';
    expectedTotalTzs: number;
    paymentMethod: string;
    placedAt: string;
    dispatchedAt: string | null;
    ledger?: {
      verificationStatus: string;
      expectedCashAmount: number;
      isBuyerConfirmed: boolean;
      isDriverConfirmed: boolean;
      isQrTokenConsumed: boolean;
    } | null;
  }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val));
}

export function MobileDriverReceiptCard({ locale = 'en' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [tasks, setTasks] = useState<DriverDeliveryTask[]>([]);
  const [selectedRef, setSelectedRef] = useState<string>('');
  const [driverPin, setDriverPin] = useState<string>('');
  const [ownerPin, setOwnerPin] = useState<string>('');
  const [collectedCash, setCollectedCash] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'M-PESA' | 'TIGO-PESA'>('CASH');
  const [mobileMoneyRef, setMobileMoneyRef] = useState<string>('');
  const [loadingQueue, setLoadingQueue] = useState<boolean>(false);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null,
  );
  const [driverViewMode, setDriverViewMode] = useState<'QR_TERMINAL' | 'PIN_SHEET'>(
    'QR_TERMINAL',
  );

  const loadDriverQueue = useCallback(async () => {
    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    setLoadingQueue(true);
    setBackendOffline(false);
    try {
      const res = await SokoApiClient.get<BackendDriverQueueResponse>('/dispatch/driver-queue');
      const liveTasks: DriverDeliveryTask[] = (res?.deliveries ?? []).map((d) => ({
        orderId: d.orderId,
        orderRef: d.orderRef,
        dukaName: isSw ? `Oda ya Mteja #${d.orderRef}` : `Delivery Order #${d.orderRef}`,
        dukaAddress: d.dispatchedAt
          ? `${isSw ? 'Ilitumwa' : 'Dispatched'}: ${d.dispatchedAt.slice(0, 16).replace('T', ' ')}`
          : isSw
            ? 'Inasubiri Dispatch'
            : 'Awaiting Dispatch',
        dukaWard: d.paymentMethod,
        ownerPhone: d.ledger?.verificationStatus ?? 'PENDING',
        itemsSummarySw: `Hali ya Uhakiki: ${d.ledger?.verificationStatus ?? d.status}`,
        itemsSummaryEn: `Verification: ${d.ledger?.verificationStatus ?? d.status}`,
        expectedCashTzs: Number(d.ledger?.expectedCashAmount ?? d.expectedTotalTzs),
        status: d.status === 'DISPATCHED' ? 'IN_TRANSIT' : d.status,
      }));
      setTasks(liveTasks);
      if (liveTasks.length > 0) {
        setSelectedRef((prev) => {
          const current = liveTasks.find((t) => t.orderRef === prev) ?? liveTasks[0];
          setCollectedCash(String(current.expectedCashTzs));
          return current.orderRef;
        });
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
                ? 'Imeshindikana kupakia orodha ya mizigo ya dereva.'
                : 'Failed to load driver delivery queue.',
        });
      }
    } finally {
      setLoadingQueue(false);
    }
  }, [isSw]);

  useEffect(() => {
    void loadDriverQueue();
  }, [loadDriverQueue]);

  const activeTask = tasks.find((t) => t.orderRef === selectedRef) ?? tasks[0] ?? null;

  const handleSelectTask = (task: DriverDeliveryTask) => {
    setSelectedRef(task.orderRef);
    setDriverPin('');
    setOwnerPin('');
    setMobileMoneyRef('');
    setCollectedCash(String(task.expectedCashTzs));
    setFeedback(null);
  };

  const handleConfirmHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTask || activeTask.status === 'DELIVERED' || !isUuid(activeTask.orderId)) return;
    setFeedback(null);

    if (!navigator.onLine) {
      setBackendOffline(true);
      return;
    }

    const declaredTzs = Number(collectedCash.replace(/[^0-9]/g, ''));

    setSubmitting(true);
    setBackendOffline(false);
    try {
      if (declaredTzs < activeTask.expectedCashTzs) {
        await SokoApiClient.post(`/financials/ledgers/${activeTask.orderId}/record-payment`, {
          collectedAmountTzs: declaredTzs,
          paymentMethod,
          ...(mobileMoneyRef.trim() ? { mobileMoneyRef: mobileMoneyRef.trim() } : {}),
        });
        setFeedback({
          type: 'success',
          text: isSw
            ? `Malipo ya awali TZS ${declaredTzs.toLocaleString('en-US')} yamehifadhiwa kwa ${activeTask.orderRef}.`
            : `Partial payment of TZS ${declaredTzs.toLocaleString('en-US')} recorded on ${activeTask.orderRef}.`,
        });
        await loadDriverQueue();
        return;
      }

      if (ownerPin.trim()) {
        const qr = await SokoApiClient.post<{
          oneTimeQrToken: string;
          qrSignature: string;
        }>(`/orders/${activeTask.orderId}/driver-arrival-qr`, {});

        await SokoApiClient.post('/orders/verify-doorstep-qr', {
          orderId: activeTask.orderId,
          qrToken: qr.oneTimeQrToken,
          qrSignature: qr.qrSignature,
          buyerPin: ownerPin.trim(),
          driverPin: driverPin.trim(),
          collectedCashTzs: declaredTzs,
        });

        setFeedback({
          type: 'success',
          text: isSw
            ? `Makabidhiano ya ${activeTask.orderRef} yamekamilika (DELIVERED). Leja ya TZS imefungwa.`
            : `Handover ${activeTask.orderRef} verified via Dual-PIN & QR. Order marked DELIVERED.`,
        });
      } else {
        const res = await SokoApiClient.post<{
          reconciled: boolean;
          verificationStatus: string;
        }>('/orders/reconcile/driver-pin', {
          orderId: activeTask.orderId,
          driverPin: driverPin.trim(),
          collectedCashTzs: declaredTzs,
          paymentMethod,
          ...(mobileMoneyRef.trim() ? { mobileMoneyRef: mobileMoneyRef.trim() } : {}),
        });

        setFeedback({
          type: 'success',
          text: res.reconciled
            ? isSw
              ? `Makabidhiano ya ${activeTask.orderRef} yamekamilika (DELIVERED).`
              : `Handover ${activeTask.orderRef} reconciled and DELIVERED.`
            : isSw
              ? `PIN ya Dereva imethibitishwa (${res.verificationStatus}). Inasubiri PIN ya Mnunuzi.`
              : `Driver PIN confirmed (${res.verificationStatus}). Awaiting Buyer PIN.`,
        });
      }

      await loadDriverQueue();
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
                ? 'Uhakiki wa makabidhiano umeshindikana.'
                : 'Doorstep verification failed.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          retrying={loadingQueue}
          onRetry={() => void loadDriverQueue()}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-1 inline-flex gap-1 shadow-xs">
          <button
            type="button"
            onClick={() => setDriverViewMode('QR_TERMINAL')}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              driverViewMode === 'QR_TERMINAL'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Order Confirmation</span>
          </button>
          <button
            type="button"
            onClick={() => setDriverViewMode('PIN_SHEET')}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              driverViewMode === 'PIN_SHEET'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Truck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Orodha ya Shusha Mzigo' : 'Delivery Queue Sheet'}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => void loadDriverQueue()}
          disabled={loadingQueue}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingQueue ? 'animate-spin' : ''}`} />
          <span>{isSw ? 'Onyesha Upya' : 'Refresh Queue'}</span>
        </button>
      </div>

      {loadingQueue && tasks.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-slate-500">
          {isSw ? 'Inapakia orodha ya mizigo ya dereva...' : 'Loading driver delivery queue...'}
        </div>
      ) : !activeTask ? (
        <EmptyStateCard
          locale={locale}
          titleSw="Hakuna rekodi bado"
          titleEn="No records yet"
          descriptionSw="Huna mizigo ya kushusha iliyopangwa kwako katika PostgreSQL kwa sasa."
          descriptionEn="No active deliveries are assigned to your driver queue in PostgreSQL."
        />
      ) : driverViewMode === 'QR_TERMINAL' ? (
        <IsolatedQrVerificationTerminal
          locale={locale}
          defaultDeviceOwner="DRIVER_PHONE"
          orderId={activeTask.orderId}
          orderRef8={activeTask.orderRef}
          destinationLabel={`${activeTask.dukaName} · ${activeTask.dukaWard}`}
          expectedCashTzs={activeTask.expectedCashTzs}
          onVerifiedSuccess={() => {
            setTasks((prev) =>
              prev.map((t) =>
                t.orderRef === activeTask.orderRef ? { ...t, status: 'DELIVERED' } : t,
              ),
            );
            void loadDriverQueue();
          }}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Queue Sheet */}
          <section className="lg:col-span-5 border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">
                {isSw ? 'Orodha ya Shusha Mzigo Leo' : 'Active Delivery Queue'}
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                {isSw
                  ? 'Chagua duka unalofikia kukamilisha makabidhiano ya taslimu.'
                  : 'Select an active neighborhood drop to enter Dual-PIN cash verification.'}
              </p>
            </div>

            <div className="divide-y divide-slate-200">
              {tasks.map((task) => {
                const isSelected = task.orderRef === activeTask.orderRef;
                return (
                  <button
                    key={task.orderRef}
                    type="button"
                    onClick={() => handleSelectTask(task)}
                    className={`w-full px-5 py-4 text-left transition-colors min-h-[56px] cursor-pointer ${
                      isSelected ? 'bg-slate-100/80' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">{task.dukaName}</span>
                      <span
                        className={`text-xs font-semibold whitespace-nowrap ${
                          task.status === 'DELIVERED'
                            ? 'text-emerald-800'
                            : task.status === 'DISPUTED'
                              ? 'text-red-700'
                              : 'text-amber-800'
                        }`}
                      >
                        {formatOrderStatusLabel(task.status, locale)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      {task.dukaAddress} · {task.dukaWard}
                    </div>
                    <div className="flex items-center justify-between mt-2 text-xs font-mono tabular-nums">
                      <span className="text-slate-500">{task.orderRef}</span>
                      <span className="font-bold text-slate-900">
                        TZS {task.expectedCashTzs.toLocaleString('en-US')}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Right Card: High-Contrast Budget-Android Dual-PIN Receipt Card */}
          <section className="lg:col-span-7 border border-slate-300 bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-5 bg-slate-900 text-white space-y-2">
              <div className="flex items-center justify-between gap-4 text-xs font-mono text-slate-300">
                <span>ODA: {activeTask.orderRef}</span>
                <span className="font-sans font-semibold">
                  {formatOrderStatusLabel(activeTask.status, locale)}
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums tracking-tight text-white">
                POKEA CASH: TZS {activeTask.expectedCashTzs.toLocaleString('en-US')}
              </div>
              <p className="text-xs text-slate-300">
                {isSw ? activeTask.itemsSummarySw : activeTask.itemsSummaryEn}
              </p>
            </div>

            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 space-y-2">
              <div className="text-sm font-semibold text-slate-900">{activeTask.dukaName}</div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                  <span>
                    {activeTask.dukaAddress}, {activeTask.dukaWard}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                  <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                  <span>{activeTask.ownerPhone}</span>
                </span>
              </div>
            </div>

            <form onSubmit={(e) => void handleConfirmHandover(e)} className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                    <span>{isSw ? 'PIN ya Dereva (4-digit)' : 'Driver Verification PIN (4-digit)'}</span>
                  </span>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    disabled={activeTask.status === 'DELIVERED'}
                    value={driverPin}
                    onChange={(e) => setDriverPin(e.target.value)}
                    placeholder="••••"
                    className="w-full min-h-[48px] px-3.5 text-lg font-mono tracking-widest tabular-nums bg-white border-2 border-slate-300 rounded-md text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-100"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                    <span>
                      {isSw
                        ? 'PIN ya Mteja (Hiari ikiwa QR inatumiwa)'
                        : 'Buyer PIN (Optional if QR scan separate)'}
                    </span>
                  </span>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    disabled={activeTask.status === 'DELIVERED'}
                    value={ownerPin}
                    onChange={(e) => setOwnerPin(e.target.value)}
                    placeholder="••••"
                    className="w-full min-h-[48px] px-3.5 text-lg font-mono tracking-widest tabular-nums bg-white border-2 border-slate-300 rounded-md text-slate-900 focus:border-emerald-700 focus:outline-none disabled:bg-slate-100"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-800">
                    {isSw ? 'Taslimu Halisi Iliyopokelewa (TZS)' : 'Physical Cash Collected (TZS)'}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    disabled={activeTask.status === 'DELIVERED'}
                    value={collectedCash}
                    onChange={(e) => setCollectedCash(e.target.value)}
                    className="w-full min-h-[48px] px-3.5 text-base font-bold font-mono tabular-nums bg-white border-2 border-slate-300 rounded-md text-slate-900 focus:border-slate-900 focus:outline-none disabled:bg-slate-100"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-800">
                    {isSw ? 'Njia ya Malipo' : 'Payment Channel'}
                  </span>
                  <select
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(e.target.value as 'CASH' | 'M-PESA' | 'TIGO-PESA')
                    }
                    className="w-full min-h-[48px] px-3.5 text-sm font-medium bg-white border-2 border-slate-300 rounded-md text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    <option value="CASH">CASH</option>
                    <option value="M-PESA">M-PESA</option>
                    <option value="TIGO-PESA">TIGO-PESA</option>
                  </select>
                </label>
              </div>

              {paymentMethod !== 'CASH' && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-800">
                    {isSw ? 'Kumbukumbu ya Muamala wa Simu' : 'Mobile Money Reference'}
                  </span>
                  <input
                    type="text"
                    value={mobileMoneyRef}
                    onChange={(e) => setMobileMoneyRef(e.target.value)}
                    placeholder={isSw ? 'Namba ya muamala...' : 'Transaction reference ID'}
                    className="w-full px-3.5 py-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                  />
                </label>
              )}

              {feedback && (
                <div
                  className={`px-4 py-3 rounded-md border text-xs flex items-start gap-2 ${
                    feedback.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-red-50 border-red-200 text-red-900'
                  }`}
                >
                  {feedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                  )}
                  <span>{feedback.text}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={activeTask.status === 'DELIVERED' || submitting}
                className="w-full min-h-[48px] px-5 py-3 text-sm font-semibold text-white bg-emerald-800 rounded-md hover:bg-emerald-900 disabled:bg-slate-300 disabled:text-slate-600 transition-colors cursor-pointer"
              >
                {submitting
                  ? isSw
                    ? 'Inahakiki...'
                    : 'Verifying...'
                  : activeTask.status === 'DELIVERED'
                    ? isSw
                      ? 'Malipo Yamethibitishwa (DELIVERED)'
                      : 'Delivery Settled (DELIVERED)'
                    : isSw
                      ? 'Thibitisha PIN & Funga Malipo'
                      : 'Verify PIN & Complete Handover'}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
