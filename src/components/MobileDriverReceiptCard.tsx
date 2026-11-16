import { useState } from 'react';
import { MapPin, Phone, ShieldCheck, AlertCircle, CheckCircle2, Lock, QrCode, Truck } from 'lucide-react';
import type { Locale } from '../data/i18n';
import { formatOrderStatusLabel } from '../lib/sokoManagedState';
import { IsolatedQrVerificationTerminal } from './IsolatedQrVerificationTerminal';

export interface DriverDeliveryTask {
  orderRef: string;
  dukaName: string;
  dukaAddress: string;
  dukaWard: string;
  ownerPhone: string;
  itemsSummarySw: string;
  itemsSummaryEn: string;
  expectedCashTzs: number;
  expectedDriverPin: string;
  expectedOwnerPin: string;
  status: 'IN_TRANSIT' | 'DELIVERED' | 'DISPUTED';
}

const INITIAL_DRIVER_TASKS: DriverDeliveryTask[] = [
  {
    orderRef: 'SK-8421F9A0',
    dukaName: 'Duka la Mama Amina',
    dukaAddress: 'Mtaa wa Msimbazi, Nyumba #14B',
    dukaWard: 'Kariakoo, Dar es Salaam',
    ownerPhone: '+255 714 220 891',
    itemsSummarySw: 'Mchele Mbeya (Gunia 2 · 50KG) + Mafuta Korie (Katoni 1)',
    itemsSummaryEn: 'Mbeya Rice (2 × 50KG Sacks) + Korie Oil (1 Carton)',
    expectedCashTzs: 250_000,
    expectedDriverPin: '7390',
    expectedOwnerPin: '4821',
    status: 'IN_TRANSIT',
  },
  {
    orderRef: 'SK-5190C3D2',
    dukaName: 'Kwa Mzee Juma Mini-Mart',
    dukaAddress: 'Barabara ya Shekilango, Kituo cha Mori',
    dukaWard: 'Sinza, Dar es Salaam',
    ownerPhone: '+255 755 903 412',
    itemsSummarySw: 'Sukari Kilombero (Gunia 1 · 50KG) + Unga Sembe (Balo 3)',
    itemsSummaryEn: 'Kilombero Sugar (1 × 50KG Sack) + Sembe Flour (3 Bales)',
    expectedCashTzs: 185_500,
    expectedDriverPin: '7390',
    expectedOwnerPin: '6194',
    status: 'IN_TRANSIT',
  },
];

// ============================================================================
// MobileDriverReceiptCard.tsx
// Zero-media, high-contrast CoD verification card engineered for budget Android
// screens (360px+) outdoors in Dar es Salaam.
// ============================================================================
export function MobileDriverReceiptCard({ locale = 'en' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [tasks, setTasks] = useState<DriverDeliveryTask[]>(INITIAL_DRIVER_TASKS);
  const [selectedRef, setSelectedRef] = useState<string>(INITIAL_DRIVER_TASKS[0].orderRef);
  const [driverPin, setDriverPin] = useState<string>('');
  const [ownerPin, setOwnerPin] = useState<string>('');
  const [collectedCash, setCollectedCash] = useState<string>('250000');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [driverViewMode, setDriverViewMode] = useState<'QR_TERMINAL' | 'PIN_SHEET'>('QR_TERMINAL');

  const activeTask = tasks.find((t) => t.orderRef === selectedRef) ?? tasks[0];

  const handleSelectTask = (task: DriverDeliveryTask) => {
    setSelectedRef(task.orderRef);
    setDriverPin('');
    setOwnerPin('');
    setCollectedCash(String(task.expectedCashTzs));
    setFeedback(null);
  };

  /**
   * Uhakiki wa Dual-PIN:
   * Lazima PIN ya Dereva na PIN ya Mmiliki wa Duka zilingane na thamani za mfumo,
   * na kiasi cha fedha taslimu kilichopokelewa kilingane na expectedCashTzs.
   */
  const handleConfirmHandover = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTask.status === 'DELIVERED') return;

    const declaredTzs = Number(collectedCash.replace(/[^0-9]/g, ''));
    const pinsValid =
      driverPin.trim() === activeTask.expectedDriverPin &&
      ownerPin.trim() === activeTask.expectedOwnerPin;

    if (!pinsValid) {
      setFeedback({
        type: 'error',
        text: isSw
          ? 'PIN za uhakiki hazilingani. Hakikisha Dereva na Mmiliki wa Duka wameingiza PIN sahihi.'
          : 'Dual-PIN mismatch. Both Driver and Duka Owner must enter valid 4-digit confirmation PINs.',
      });
      return;
    }

    if (declaredTzs !== activeTask.expectedCashTzs) {
      setTasks((prev) =>
        prev.map((t) => (t.orderRef === activeTask.orderRef ? { ...t, status: 'DISPUTED' } : t))
      );
      setFeedback({
        type: 'error',
        text: isSw
          ? `Upungufu wa taslimu: Unapaswa kupokea TZS ${activeTask.expectedCashTzs.toLocaleString('en-US')}. Leja imewekwa alama ya DISPUTED.`
          : `Cash discrepancy detected against TZS ${activeTask.expectedCashTzs.toLocaleString('en-US')}. Ledger flagged as DISPUTED.`,
      });
      return;
    }

    setTasks((prev) =>
      prev.map((t) => (t.orderRef === activeTask.orderRef ? { ...t, status: 'DELIVERED' } : t))
    );
    setFeedback({
      type: 'success',
      text: isSw
        ? `Makabidhiano ya ${activeTask.orderRef} yamekamilika (DELIVERED). Leja ya TZS imefungwa.`
        : `Handover ${activeTask.orderRef} verified via Dual-PIN. Order marked DELIVERED.`,
    });
  };

  return (
    <div className="space-y-5">
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

      {driverViewMode === 'QR_TERMINAL' ? (
        <IsolatedQrVerificationTerminal
          locale={locale}
          defaultDeviceOwner="DRIVER_PHONE"
          orderRef8={activeTask.orderRef}
          destinationLabel={`${activeTask.dukaName} · ${activeTask.dukaWard}`}
          expectedCashTzs={activeTask.expectedCashTzs}
          expectedBuyerPin={activeTask.expectedOwnerPin}
          expectedDriverPin={activeTask.expectedDriverPin}
          onVerifiedSuccess={() => {
            setTasks((prev) =>
              prev.map((t) =>
                t.orderRef === activeTask.orderRef ? { ...t, status: 'DELIVERED' } : t
              )
            );
          }}
        />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Queue Sheet: Active Bodaboda / Van Drops */}
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
        {/* Top High-Contrast Cash Collection Banner */}
        <div className="px-5 py-5 bg-slate-900 text-white space-y-2">
          <div className="flex items-center justify-between gap-4 text-xs font-mono text-slate-300">
            <span>ODA: {activeTask.orderRef}</span>
            <span className="font-sans font-semibold">{formatOrderStatusLabel(activeTask.status, locale)}</span>
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums tracking-tight text-white">
            POKEA CASH: TZS {activeTask.expectedCashTzs.toLocaleString('en-US')}
          </div>
          <p className="text-xs text-slate-300">
            {isSw ? activeTask.itemsSummarySw : activeTask.itemsSummaryEn}
          </p>
        </div>

        {/* Target Retail Duka Address & Contact */}
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

        {/* Adjacent Dual-PIN Input Grid + Cash Confirmation */}
        <form onSubmit={handleConfirmHandover} className="p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                <span>
                  {isSw ? 'PIN ya Dereva (Jaribio: 7390)' : 'Driver Verification Hash / PIN (Demo: 7390)'}
                </span>
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
                    ? `PIN ya Mmiliki wa Duka (Jaribio: ${activeTask.expectedOwnerPin})`
                    : `Duka Owner PIN / Hash (Demo: ${activeTask.expectedOwnerPin})`}
                </span>
              </span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                disabled={activeTask.status === 'DELIVERED'}
                value={ownerPin}
                onChange={(e) => setOwnerPin(e.target.value)}
                placeholder="••••"
                className="w-full min-h-[48px] px-3.5 text-lg font-mono tracking-widest tabular-nums bg-white border-2 border-slate-300 rounded-md text-slate-900 focus:border-emerald-700 focus:outline-none disabled:bg-slate-100"
              />
            </label>
          </div>

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
            disabled={activeTask.status === 'DELIVERED'}
            className="w-full min-h-[48px] px-5 py-3 text-sm font-semibold text-white bg-emerald-800 rounded-md hover:bg-emerald-900 disabled:bg-slate-300 disabled:text-slate-600 transition-colors cursor-pointer"
          >
            {activeTask.status === 'DELIVERED'
              ? isSw
                ? 'Malipo Yamethibitishwa (DELIVERED)'
                : 'Delivery Settled (DELIVERED)'
              : isSw
                ? 'Thibitisha PIN Mbili & Funga Malipo'
                : 'Verify Dual-PIN & Complete Handover'}
          </button>
        </form>
      </section>
      </div>
      )}
    </div>
  );
}
