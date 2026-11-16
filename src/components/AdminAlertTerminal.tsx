import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  Lock,
  PhoneCall,
  Radio,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  ADMIN_ALERT_CHANNEL_NAME,
  appendIncomingManagedOrder,
  formatRoutingLabel,
  loadDispatchAuditTraces,
  updateAdminManagedOrderStatus,
  type AdminManagedOrderStatus,
  type OrderDispatchAuditTrace,
} from '../lib/sokoManagedState';

type OrderFilterTab = 'ALL' | AdminManagedOrderStatus;

function getEffectiveStatus(order: OrderDispatchAuditTrace): AdminManagedOrderStatus {
  return order.adminStatus ?? 'PENDING';
}

// ============================================================================
// AdminAlertTerminal.tsx
// Kituo cha Oda za Moja kwa Moja (Super Admin Pekee)
// Huonyesha oda zinazoweza kupokelewa na kushughulikiwa na Admins pekee.
// ============================================================================
export function AdminAlertTerminal({
  locale = 'sw',
  stompEndpointUrl = '/ws-sokokuu',
}: {
  locale?: Locale;
  stompEndpointUrl?: string;
}) {
  const isSw = locale === 'sw';
  const [audioMuted, setAudioMuted] = useState<boolean>(false);
  const [stompStatus, setStompStatus] = useState<'SUBSCRIBED' | 'STANDBY_CHANNEL' | 'CONNECTING'>(
    'CONNECTING'
  );
  const [statusFilter, setStatusFilter] = useState<OrderFilterTab>('ALL');
  const [liveOrders, setLiveOrders] = useState<OrderDispatchAuditTrace[]>(() =>
    loadDispatchAuditTraces().filter((t) => t.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK')
  );

  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<number | null>(null);

  const refreshLiveOrders = useCallback(() => {
    setLiveOrders(
      loadDispatchAuditTraces().filter((t) => t.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK')
    );
  }, []);

  const playChimeOnce = useCallback(() => {
    if (audioMuted || typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }

      const now = ctx.currentTime;
      const tones = [880, 1174.66, 1318.51];

      tones.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startAt = now + idx * 0.14;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startAt);

        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.24, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.42);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + 0.45);
      });
    } catch {
      // Autoplay blocked until user interaction
    }
  }, [audioMuted]);

  const incomingAlertHandler = useCallback(
    (payload: OrderDispatchAuditTrace) => {
      if (payload.routingCode !== 'ROUTED_PLATFORM_MANAGED_HELPDESK') return;

      const updated = appendIncomingManagedOrder({
        ...payload,
        adminStatus: payload.adminStatus ?? 'PENDING',
      });
      setLiveOrders(
        updated.filter((t) => t.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK')
      );
      playChimeOnce();
    },
    [playChimeOnce]
  );

  const pendingCount = liveOrders.filter((o) => getEffectiveStatus(o) === 'PENDING').length;
  const receivedCount = liveOrders.filter((o) => getEffectiveStatus(o) === 'RECEIVED').length;
  const dispatchedCount = liveOrders.filter((o) => getEffectiveStatus(o) === 'DISPATCHED').length;

  useEffect(() => {
    if (pendingCount > 0 && !audioMuted) {
      if (ringIntervalRef.current === null) {
        ringIntervalRef.current = window.setInterval(() => {
          playChimeOnce();
        }, 4200);
      }
    } else if (ringIntervalRef.current !== null) {
      window.clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }

    return () => {
      if (ringIntervalRef.current !== null) {
        window.clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
    };
  }, [pendingCount, audioMuted, playChimeOnce]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let isDisposed = false;

    const handleCustomEvent = (evt: Event) => {
      const detail = (evt as CustomEvent<OrderDispatchAuditTrace>).detail;
      if (detail) incomingAlertHandler(detail);
    };

    window.addEventListener('sokokuu:managed-order-alert', handleCustomEvent);
    window.addEventListener('sokokuu:orders-updated', refreshLiveOrders);
    window.addEventListener('storage', refreshLiveOrders);

    let bc: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      try {
        bc = new BroadcastChannel(ADMIN_ALERT_CHANNEL_NAME);
        bc.onmessage = (msg) => {
          if (msg.data) {
            incomingAlertHandler(msg.data as OrderDispatchAuditTrace);
          }
        };
      } catch {
        bc = null;
      }
    }

    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const targetUrl = stompEndpointUrl.startsWith('ws')
        ? stompEndpointUrl
        : `${wsProtocol}//${window.location.host}${stompEndpointUrl}`;

      socket = new WebSocket(targetUrl);
      socket.onopen = () => {
        if (isDisposed || !socket) return;
        const connectFrame = `CONNECT\naccept-version:1.2\nhost:${window.location.host}\n\n\0`;
        socket.send(connectFrame);
      };

      socket.onmessage = (event) => {
        const frame = String(event.data || '');
        if (frame.startsWith('CONNECTED')) {
          setStompStatus('SUBSCRIBED');
          const subFrame =
            'SUBSCRIBE\nid:sub-admin-alerts\ndestination:/topic/admin/managed-alerts\nack:auto\n\n\0';
          socket?.send(subFrame);
          return;
        }
        if (frame.startsWith('MESSAGE')) {
          const bodyIndex = frame.indexOf('\n\n');
          if (bodyIndex !== -1) {
            const rawJson = frame.slice(bodyIndex + 2).replace(/\0/g, '').trim();
            try {
              const parsed = JSON.parse(rawJson) as OrderDispatchAuditTrace;
              incomingAlertHandler(parsed);
            } catch {
              // ignore malformed STOMP payload
            }
          }
        }
      };

      socket.onerror = () => {
        if (!isDisposed) setStompStatus('STANDBY_CHANNEL');
      };

      socket.onclose = () => {
        if (!isDisposed) setStompStatus('STANDBY_CHANNEL');
      };
    } catch {
      setStompStatus('STANDBY_CHANNEL');
    }

    return () => {
      isDisposed = true;
      window.removeEventListener('sokokuu:managed-order-alert', handleCustomEvent);
      window.removeEventListener('sokokuu:orders-updated', refreshLiveOrders);
      window.removeEventListener('storage', refreshLiveOrders);
      bc?.close();
      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send('DISCONNECT\n\n\0');
          socket.close();
        } catch {
          // ignore close errors
        }
      }
    };
  }, [stompEndpointUrl, incomingAlertHandler, refreshLiveOrders]);

  const handleUpdateOrderStatus = (traceId: string, nextStatus: AdminManagedOrderStatus) => {
    const updated = updateAdminManagedOrderStatus(traceId, nextStatus);
    setLiveOrders(
      updated.filter((t) => t.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK')
    );
  };

  const handleSimulateLiveOrder = () => {
    setAudioMuted(false);
    playChimeOnce();
    const demoAlert: OrderDispatchAuditTrace = {
      traceId: 'TRC-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
      orderRef8: 'SK' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      sellerBusinessId: '11111111-aaaa-4111-8111-000000000001',
      sellerBusinessName: 'Mo Wholesale Hub',
      isPlatformManagedAtSubmit: true,
      routingCode: 'ROUTED_PLATFORM_MANAGED_HELPDESK',
      targetPipeline: 'SUPER_ADMIN_HELPDESK_PIPELINE',
      isolationLevel: 'REPEATABLE_READ',
      totalCashDueTzs: 74500,
      itemsSummary: 'Unga wa Ngano Azania (24 Quanta) + Mafuta ya Korie (12 Quanta)',
      recordedAtEat: new Date().toLocaleTimeString(),
      adminStatus: 'PENDING',
    };
    incomingAlertHandler(demoAlert);
  };

  const visibleOrders = liveOrders.filter((order) => {
    if (statusFilter === 'ALL') return true;
    return getEffectiveStatus(order) === statusFilter;
  });

  return (
    <section
      className={`rounded-lg border p-5 space-y-4 transition-colors bg-white shadow-sm ${
        pendingCount > 0 ? 'border-amber-400 ring-1 ring-amber-200' : 'border-slate-100'
      }`}
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <BellRing
              className={`w-4 h-4 shrink-0 ${
                pendingCount > 0 ? 'text-amber-600 animate-bounce' : 'text-emerald-600'
              }`}
              aria-hidden="true"
            />
            <h2 className="text-sm font-bold text-slate-900">
              {isSw
                ? 'Oda za Moja kwa Moja (Zinapokelewa na Admins Pekee)'
                : 'Live Managed Orders (Admin Reception Only)'}
            </h2>
          </div>
          <p className="text-xs text-slate-600 flex items-center gap-1.5">
            <Lock className="w-3 h-3 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>
              {isSw
                ? 'Oda kutoka maduka yanayosimamiwa na jukwaa hupokelewa na kukamilishwa hapa na Super Admin pekee.'
                : 'Incoming orders for platform-managed shops are received and fulfilled strictly by Super Admins.'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded">
            <Radio className="w-3 h-3" aria-hidden="true" />
            <span>
              {stompStatus === 'SUBSCRIBED'
                ? 'STOMP Live Connected'
                : 'STOMP + Broadcast Ready'}
            </span>
          </span>

          <button
            type="button"
            onClick={() => setAudioMuted((prev) => !prev)}
            className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
          >
            {audioMuted ? (
              <>
                <VolumeX className="w-3.5 h-3.5 text-red-600" aria-hidden="true" />
                <span>{isSw ? 'Sauti Imezimwa' : 'Muted'}</span>
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span>{isSw ? 'Mlio Umewashwa' : 'Chime Armed'}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleSimulateLiveOrder}
            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Jaribu Oda Mpya' : 'Test Live Order'}</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { key: 'ALL', labelSw: `Zote (${liveOrders.length})`, labelEn: `All (${liveOrders.length})` },
              { key: 'PENDING', labelSw: `Zinazosubiri (${pendingCount})`, labelEn: `Pending (${pendingCount})` },
              { key: 'RECEIVED', labelSw: `Zimepokelewa (${receivedCount})`, labelEn: `Received (${receivedCount})` },
              { key: 'DISPATCHED', labelSw: `Zimekamilika (${dispatchedCount})`, labelEn: `Dispatched (${dispatchedCount})` },
            ] as const
          ).map((tab) => {
            const active = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {isSw ? tab.labelSw : tab.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Unreceived Order Alarm Banner */}
      {pendingCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3 text-xs font-semibold text-amber-950">
          <div className="flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
            <span>
              {isSw
                ? `TAHADHARI: Kuna oda ${pendingCount} mpya zinazosubiri kupokelewa na Admin!`
                : `URGENT: ${pendingCount} live order(s) awaiting Admin reception!`}
            </span>
          </div>
          <span className="font-mono text-[11px] text-amber-800">
            {isSw ? 'Kengele Inalia' : 'Alarm Active'}
          </span>
        </div>
      )}

      {/* Admin-Only Live Orders Queue */}
      <div className="space-y-2.5">
        {visibleOrders.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
            {isSw
              ? 'Hakuna oda za moja kwa moja katika kundi hili.'
              : 'No live admin-managed orders in this queue.'}
          </div>
        ) : (
          visibleOrders.map((order) => {
            const status = getEffectiveStatus(order);
            return (
              <div
                key={order.traceId}
                className={`border rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 text-xs transition-colors ${
                  status === 'PENDING'
                    ? 'bg-amber-50/80 border-amber-300 shadow-xs'
                    : status === 'RECEIVED'
                      ? 'bg-emerald-50/50 border-emerald-200'
                      : 'bg-slate-50/70 border-slate-200'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-mono font-bold text-slate-900">
                    <span>#{order.orderRef8}</span>
                    <span className="text-slate-400">·</span>
                    <span className="font-sans text-emerald-700">
                      {formatRoutingLabel(order.routingCode, locale)}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="font-sans text-[11px] text-slate-500 font-medium">
                      {isSw ? 'Admin Pekee' : 'Admin Only'}
                    </span>
                  </div>
                  <div className="text-slate-900 font-semibold text-xs sm:text-sm">
                    {order.sellerBusinessName} — {order.itemsSummary}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    TZS {order.totalCashDueTzs.toLocaleString('en-US')} · {order.recordedAtEat}
                    {order.adminHandledAtEat ? ` · ${order.adminHandledAtEat}` : ''}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {status === 'PENDING' && (
                    <button
                      type="button"
                      onClick={() => handleUpdateOrderStatus(order.traceId, 'RECEIVED')}
                      className="min-h-[38px] px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                      <span>{isSw ? 'Pokea Oda' : 'Receive Order'}</span>
                    </button>
                  )}

                  {status === 'RECEIVED' && (
                    <button
                      type="button"
                      onClick={() => handleUpdateOrderStatus(order.traceId, 'DISPATCHED')}
                      className="min-h-[38px] px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{isSw ? 'Kamilisha Simu' : 'Complete Dispatch'}</span>
                    </button>
                  )}

                  {status === 'DISPATCHED' && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                      <span>{isSw ? 'Imepokelewa & Kutumwa' : 'Dispatched'}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
