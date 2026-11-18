import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  Lock,
  PhoneCall,
  Radio,
  RefreshCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  ADMIN_ALERT_CHANNEL_NAME,
  formatRoutingLabel,
  type AdminManagedOrderStatus,
  type OrderDispatchAuditTrace,
} from '../lib/sokoManagedState';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

type OrderFilterTab = 'ALL' | AdminManagedOrderStatus;

interface BackendManagedTrace {
  traceId: string;
  orderId: string;
  orderRef8: string;
  sellerBusinessId: string;
  merchantName: string;
  merchantShortCode?: string;
  isPlatformManagedSnapshot: boolean;
  routingOutputCode: 'ROUTED_PLATFORM_MANAGED_HELPDESK' | 'ROUTED_DIRECT_MERCHANT_DB';
  targetPipeline: string;
  txIsolationLevel?: string;
  helpdeskStatus: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'ESCALATED' | 'DIRECT_MERCHANT';
  handledNotes?: string | null;
  handledAt?: string | null;
  recordedAt: string;
  orderStatus?: string;
  expectedTotalTzs: number;
}

function mapHelpdeskStatusToUi(status: BackendManagedTrace['helpdeskStatus']): AdminManagedOrderStatus {
  if (status === 'IN_REVIEW') return 'RECEIVED';
  if (status === 'RESOLVED' || status === 'ESCALATED') return 'DISPATCHED';
  return 'PENDING';
}

function mapUiStatusToBackend(status: AdminManagedOrderStatus): 'OPEN' | 'IN_REVIEW' | 'RESOLVED' {
  if (status === 'RECEIVED') return 'IN_REVIEW';
  if (status === 'DISPATCHED') return 'RESOLVED';
  return 'OPEN';
}

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
  const [liveOrders, setLiveOrders] = useState<OrderDispatchAuditTrace[]>([]);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [busyTraceId, setBusyTraceId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<number | null>(null);

  const refreshLiveOrders = useCallback(async () => {
    setIsLoading(true);
    setErrorBanner(null);
    try {
      const res = await SokoApiClient.get<{
        count: number;
        traces: BackendManagedTrace[];
      }>('/admin/managed-orders?routingOutputCode=ROUTED_PLATFORM_MANAGED_HELPDESK');

      const mapped: OrderDispatchAuditTrace[] = (res.traces || []).map((t) => ({
        traceId: t.traceId,
        orderRef8: t.orderRef8,
        sellerBusinessId: t.sellerBusinessId,
        sellerBusinessName: t.merchantName,
        isPlatformManagedAtSubmit: t.isPlatformManagedSnapshot,
        routingCode: t.routingOutputCode,
        targetPipeline: 'SUPER_ADMIN_HELPDESK_PIPELINE',
        isolationLevel: 'REPEATABLE_READ',
        totalCashDueTzs: t.expectedTotalTzs,
        itemsSummary:
          t.handledNotes ||
          (isSw
            ? `Oda #${t.orderRef8} · Hali: ${t.orderStatus ?? t.helpdeskStatus}`
            : `Order #${t.orderRef8} · Status: ${t.orderStatus ?? t.helpdeskStatus}`),
        recordedAtEat: new Date(t.recordedAt).toLocaleTimeString(),
        adminStatus: mapHelpdeskStatusToUi(t.helpdeskStatus),
        adminHandledAtEat: t.handledAt ? new Date(t.handledAt).toLocaleTimeString() : undefined,
      }));
      setLiveOrders(mapped);
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setLiveOrders([]);
      } else {
        setErrorBanner(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : 'Failed to load managed orders queue.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [isSw]);

  useEffect(() => {
    void refreshLiveOrders();
  }, [refreshLiveOrders]);

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
      void refreshLiveOrders();
      playChimeOnce();
    },
    [playChimeOnce, refreshLiveOrders]
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
    const handleOrdersUpdated = () => {
      void refreshLiveOrders();
    };

    window.addEventListener('sokokuu:managed-order-alert', handleCustomEvent);
    window.addEventListener('sokokuu:orders-updated', handleOrdersUpdated);

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
      window.removeEventListener('sokokuu:orders-updated', handleOrdersUpdated);
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

  const handleUpdateOrderStatus = async (traceId: string, nextStatus: AdminManagedOrderStatus) => {
    setErrorBanner(null);
    setBusyTraceId(traceId);
    try {
      const backendStatus = mapUiStatusToBackend(nextStatus);
      await SokoApiClient.patch(`/admin/managed-orders/${traceId}/status`, {
        helpdeskStatus: backendStatus,
        notes:
          nextStatus === 'RECEIVED'
            ? isSw
              ? 'Imepokelewa na Admin Helpdesk'
              : 'Received by Super Admin Helpdesk'
            : isSw
              ? 'Imekamilishwa na kutumwa kwa uthibitisho'
              : 'Helpdesk dispatch completed',
      });
      await refreshLiveOrders();
      window.dispatchEvent(new CustomEvent('sokokuu:orders-updated'));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorBanner(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : 'Failed to update managed order status.'
        );
      }
    } finally {
      setBusyTraceId(null);
    }
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
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          onRetry={() => void refreshLiveOrders()}
          retrying={isLoading}
        />
      )}
      {errorBanner && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-semibold text-red-900"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-red-800 hover:text-red-950 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

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
                ? 'Oda kutoka wafanyabiashara wanaosimamiwa na jukwaa hupokelewa na kukamilishwa hapa na Super Admin pekee.'
                : 'Incoming orders for platform-managed Merchants are received and fulfilled strictly by Super Admins.'}
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
            onClick={() => void refreshLiveOrders()}
            disabled={isLoading}
            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isSw ? 'Sasisha Foleni' : 'Sync Queue'}</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { key: 'ALL', labelSw: `Zote (${liveOrders.length})`, labelEn: `All (${liveOrders.length})` },
              { key: 'PENDING', labelSw: `Zinazosubiri (${pendingCount})`, labelEn: `Open (${pendingCount})` },
              { key: 'RECEIVED', labelSw: `Zimepokelewa (${receivedCount})`, labelEn: `In Review (${receivedCount})` },
              { key: 'DISPATCHED', labelSw: `Zimekamilika (${dispatchedCount})`, labelEn: `Resolved (${dispatchedCount})` },
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
        {isLoading && liveOrders.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
            {isSw ? 'Inapakia oda za Helpdesk...' : 'Loading managed helpdesk orders...'}
          </div>
        ) : visibleOrders.length === 0 ? (
          <EmptyStateCard
            locale={locale}
            titleSw="Hakuna oda za msaada kwa sasa"
            titleEn="No live admin-managed orders"
            descriptionSw="Oda mpya zinazoelekezwa kwa Dawati la Admin zitaonekana hapa moja kwa moja."
            descriptionEn="Incoming managed Merchant orders from PostgreSQL will appear here in real time."
          />
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
                      disabled={busyTraceId === order.traceId}
                      onClick={() => void handleUpdateOrderStatus(order.traceId, 'RECEIVED')}
                      className="min-h-[38px] px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                      <span>{isSw ? 'Pokea Oda' : 'Receive Order'}</span>
                    </button>
                  )}

                  {status === 'RECEIVED' && (
                    <button
                      type="button"
                      disabled={busyTraceId === order.traceId}
                      onClick={() => void handleUpdateOrderStatus(order.traceId, 'DISPATCHED')}
                      className="min-h-[38px] px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{isSw ? 'Kamilisha Simu' : 'Complete Dispatch'}</span>
                    </button>
                  )}

                  {status === 'DISPATCHED' && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                      <span>{isSw ? 'Imepokelewa & Kutumwa' : 'Resolved'}</span>
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
