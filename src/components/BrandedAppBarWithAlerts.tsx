import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellRing,
  CheckCheck,
  ChevronDown,
  Languages,
  LogOut,
  Menu,
  Radio,
  Settings,
  UserCog,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  ADMIN_ALERT_CHANNEL_NAME,
  formatAlertPacketLabel,
  loadDispatchAuditTraces,
  type OrderDispatchAuditTrace,
} from '../lib/sokoManagedState';
import {
  MODE_LABELS,
  ROLE_LABELS,
  type UserProfile,
} from '../types/auth';
import { BrandLogo } from './BrandLogo';
import { PWAInstallButton } from './PWAInstallButton';
import {
  initializeWebPushRegistration,
  triggerLocalServiceWorkerPushTest,
} from '../services/webPushRegistrationService';

export type StompPacketType =
  | 'NEW_B2B_ORDER_REQUEST'
  | 'ROUTED_PLATFORM_MANAGED_HELPDESK'
  | 'STANDARD_UPDATE';

export interface StompAlertPacket {
  id: string;
  packetType: StompPacketType;
  title: string;
  message: string;
  orderRef?: string;
  amountTzs?: number;
  receivedAt: string;
  acknowledged: boolean;
}

export type RetailerNavTab =
  | 'pos_register'
  | 'inventory_shelf'
  | 'core_engine'
  | 'proximity_map';

export interface BrandedAppBarWithAlertsProps {
  locale: Locale;
  onToggleLocale: () => void;
  activeProfile: UserProfile;
  activePage: 'DASHBOARD' | 'PROFILE' | 'SETTINGS';
  onSelectPage: (page: 'DASHBOARD' | 'PROFILE' | 'SETTINGS') => void;
  retailerTab: RetailerNavTab;
  onSelectRetailerTab: (tab: RetailerNavTab) => void;
  retailerMapEnabled: boolean;
  onLogout: () => void;
  mobileMenuOpen: boolean;
  onToggleMobileMenu: () => void;
  adminMobileSidebarOpen: boolean;
  onToggleAdminMobileSidebar: () => void;
  stompEndpointUrl?: string;
  compactContainer?: boolean;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'SK';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function isHighPriorityPacket(packetType: StompPacketType): boolean {
  return (
    packetType === 'NEW_B2B_ORDER_REQUEST' ||
    packetType === 'ROUTED_PLATFORM_MANAGED_HELPDESK'
  );
}

/**
 * Browser-native Web Audio API Synthesizer (Zero external media stream dependencies).
 * - playSoftNotificationChime: Gentle dual-tone sine chime for STANDARD_UPDATE packets.
 * - playDukaAlarmChime: High-priority repetitive store chime ("Mlio wa Kengele ya Duka")
 *   for NEW_B2B_ORDER_REQUEST and ROUTED_PLATFORM_MANAGED_HELPDESK packets.
 */
function resolveAudioContext(ref: { current: AudioContext | null }): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  try {
    if (!ref.current) {
      ref.current = new AudioCtx();
    }
    if (ref.current.state === 'suspended') {
      void ref.current.resume();
    }
    return ref.current;
  } catch {
    return null;
  }
}

export function playSoftNotificationChime(ctxRef: { current: AudioContext | null }): void {
  const ctx = resolveAudioContext(ctxRef);
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const notes = [523.25, 659.25];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startAt = now + idx * 0.12;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startAt);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.11, startAt + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.34);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.36);
    });
  } catch {
    // Autoplay blocked prior to user gesture
  }
}

export function playDukaAlarmChime(ctxRef: { current: AudioContext | null }): void {
  const ctx = resolveAudioContext(ctxRef);
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const alarmTones = [880, 1174.66, 1318.51, 1567.98];

    alarmTones.forEach((freq, idx) => {
      const primaryOsc = ctx.createOscillator();
      const harmonicOsc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startAt = now + idx * 0.13;

      primaryOsc.type = 'triangle';
      primaryOsc.frequency.setValueAtTime(freq, startAt);

      harmonicOsc.type = 'sine';
      harmonicOsc.frequency.setValueAtTime(freq * 1.5, startAt);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.26, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.42);

      primaryOsc.connect(gain);
      harmonicOsc.connect(gain);
      gain.connect(ctx.destination);

      primaryOsc.start(startAt);
      harmonicOsc.start(startAt);
      primaryOsc.stop(startAt + 0.45);
      harmonicOsc.stop(startAt + 0.45);
    });
  } catch {
    // Autoplay blocked prior to user gesture
  }
}

export function BrandedAppBarWithAlerts({
  locale,
  onToggleLocale,
  activeProfile,
  activePage,
  onSelectPage,
  retailerTab,
  onSelectRetailerTab,
  retailerMapEnabled,
  onLogout,
  mobileMenuOpen,
  onToggleMobileMenu,
  adminMobileSidebarOpen,
  onToggleAdminMobileSidebar,
  stompEndpointUrl = '/ws-sokokuu',
  compactContainer = false,
}: BrandedAppBarWithAlertsProps) {
  const isSw = locale === 'sw';

  const [profileMenuOpen, setProfileMenuOpen] = useState<boolean>(false);
  const [bellOpen, setBellOpen] = useState<boolean>(false);
  const [audioMuted, setAudioMuted] = useState<boolean>(false);
  const [stompStatus, setStompStatus] = useState<'SUBSCRIBED' | 'STANDBY_CHANNEL' | 'CONNECTING'>(
    'CONNECTING'
  );
  const [alerts, setAlerts] = useState<StompAlertPacket[]>(() => {
    const pendingTraces = loadDispatchAuditTraces().filter(
      (t) =>
        t.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK' &&
        (t.adminStatus ?? 'PENDING') === 'PENDING'
    );
    return pendingTraces.slice(0, 8).map((t) => ({
      id: t.traceId,
      packetType: 'ROUTED_PLATFORM_MANAGED_HELPDESK',
      title: t.sellerBusinessName,
      message: t.itemsSummary,
      orderRef: t.orderRef8,
      amountTzs: t.totalCashDueTzs,
      receivedAt: t.recordedAtEat,
      acknowledged: false,
    }));
  });

  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const bellContainerRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const alarmIntervalRef = useRef<number | null>(null);
  const [pushBanner, setPushBanner] = useState<string | null>(null);

  const unreadCount = alerts.filter((a) => !a.acknowledged).length;
  const activeHighPriorityCount = alerts.filter(
    (a) => !a.acknowledged && isHighPriorityPacket(a.packetType)
  ).length;

  const ingestPacket = useCallback(
    (packet: StompAlertPacket) => {
      setAlerts((prev) => {
        if (prev.some((existing) => existing.id === packet.id)) return prev;
        return [packet, ...prev].slice(0, 20);
      });

      if (!audioMuted) {
        if (isHighPriorityPacket(packet.packetType)) {
          playDukaAlarmChime(audioCtxRef);
        } else {
          playSoftNotificationChime(audioCtxRef);
        }
      }
    },
    [audioMuted]
  );

  // Repetitive high-priority duka alarm loop while unacknowledged B2B / Managed orders exist
  useEffect(() => {
    if (activeHighPriorityCount > 0 && !audioMuted) {
      if (alarmIntervalRef.current === null) {
        alarmIntervalRef.current = window.setInterval(() => {
          playDukaAlarmChime(audioCtxRef);
        }, 4500);
      }
    } else if (alarmIntervalRef.current !== null) {
      window.clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }

    return () => {
      if (alarmIntervalRef.current !== null) {
        window.clearInterval(alarmIntervalRef.current);
        alarmIntervalRef.current = null;
      }
    };
  }, [activeHighPriorityCount, audioMuted]);

  // Outside click & Escape handling for AppBar popovers
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuContainerRef.current && !menuContainerRef.current.contains(target)) {
        setProfileMenuOpen(false);
      }
      if (bellContainerRef.current && !bellContainerRef.current.contains(target)) {
        setBellOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false);
        setBellOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Asynchronous STOMP WebSocket + BroadcastChannel + In-App Event Subscription
  useEffect(() => {
    let socket: WebSocket | null = null;
    let isDisposed = false;

    const mapTraceToPacket = (trace: OrderDispatchAuditTrace): StompAlertPacket => ({
      id: trace.traceId,
      packetType:
        trace.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK'
          ? 'ROUTED_PLATFORM_MANAGED_HELPDESK'
          : 'NEW_B2B_ORDER_REQUEST',
      title: trace.sellerBusinessName,
      message: trace.itemsSummary,
      orderRef: trace.orderRef8,
      amountTzs: trace.totalCashDueTzs,
      receivedAt: trace.recordedAtEat,
      acknowledged: false,
    });

    const handleManagedAlert = (evt: Event) => {
      const detail = (evt as CustomEvent<OrderDispatchAuditTrace>).detail;
      if (detail) ingestPacket(mapTraceToPacket(detail));
    };

    const handleStompAlert = (evt: Event) => {
      const detail = (evt as CustomEvent<StompAlertPacket>).detail;
      if (detail) ingestPacket(detail);
    };

    window.addEventListener('sokokuu:managed-order-alert', handleManagedAlert);
    window.addEventListener('sokokuu:stomp-alert', handleStompAlert);

    let bc: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      try {
        bc = new BroadcastChannel(ADMIN_ALERT_CHANNEL_NAME);
        bc.onmessage = (msg) => {
          const data = msg.data as (OrderDispatchAuditTrace & Partial<StompAlertPacket>) | undefined;
          if (!data) return;
          if ('packetType' in data && data.packetType) {
            ingestPacket(data as StompAlertPacket);
          } else if ('traceId' in data && data.traceId) {
            ingestPacket(mapTraceToPacket(data as OrderDispatchAuditTrace));
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
          socket?.send(
            'SUBSCRIBE\nid:sub-appbar-b2b\ndestination:/topic/admin/managed-alerts\nack:auto\n\n\0'
          );
          socket?.send(
            'SUBSCRIBE\nid:sub-appbar-user\ndestination:/user/queue/alerts\nack:auto\n\n\0'
          );
          return;
        }
        if (frame.startsWith('MESSAGE')) {
          const bodyIndex = frame.indexOf('\n\n');
          if (bodyIndex !== -1) {
            const rawJson = frame.slice(bodyIndex + 2).replace(/\0/g, '').trim();
            try {
              const parsed = JSON.parse(rawJson) as Record<string, unknown>;
              const packetType =
                (parsed.packetType as StompPacketType | undefined) ??
                (parsed.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK'
                  ? 'ROUTED_PLATFORM_MANAGED_HELPDESK'
                  : 'STANDARD_UPDATE');

              ingestPacket({
                id: String(parsed.id ?? parsed.traceId ?? `STOMP-${Date.now()}`),
                packetType,
                title: String(parsed.title ?? parsed.sellerBusinessName ?? 'SokoKuu STOMP Alert'),
                message: String(parsed.message ?? parsed.itemsSummary ?? 'Real-time order event'),
                orderRef: parsed.orderRef ? String(parsed.orderRef) : (parsed.orderRef8 ? String(parsed.orderRef8) : undefined),
                amountTzs:
                  typeof parsed.amountTzs === 'number'
                    ? parsed.amountTzs
                    : typeof parsed.totalCashDueTzs === 'number'
                      ? parsed.totalCashDueTzs
                      : undefined,
                receivedAt: String(
                  parsed.receivedAt ?? parsed.recordedAtEat ?? new Date().toLocaleTimeString()
                ),
                acknowledged: false,
              });
            } catch {
              // ignore malformed STOMP frames
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
      window.removeEventListener('sokokuu:managed-order-alert', handleManagedAlert);
      window.removeEventListener('sokokuu:stomp-alert', handleStompAlert);
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
  }, [stompEndpointUrl, ingestPacket]);

  const triggerTestPacket = (packetType: StompPacketType) => {
    setAudioMuted(false);
    const ref = 'SK' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const packet: StompAlertPacket =
      packetType === 'NEW_B2B_ORDER_REQUEST'
        ? {
            id: `PKT-${Date.now()}`,
            packetType: 'NEW_B2B_ORDER_REQUEST',
            title: isSw ? 'Oda Mpya ya B2B (Kengele ya Duka)' : 'New B2B Order Request',
            message: 'Azania Unga 25kg (x10) + Korie Mafuta 20L (x4)',
            orderRef: ref,
            amountTzs: 486000,
            receivedAt: new Date().toLocaleTimeString(),
            acknowledged: false,
          }
        : {
            id: `PKT-${Date.now()}`,
            packetType: 'STANDARD_UPDATE',
            title: isSw ? 'Taarifa ya Mfumo (STOMP)' : 'Standard Platform Update',
            message: isSw
              ? `Oda #${ref} imepakiwa kwenye gari la usambazaji.`
              : `Order #${ref} has been loaded onto dispatch fleet.`,
            orderRef: ref,
            receivedAt: new Date().toLocaleTimeString(),
            acknowledged: false,
          };

    if (packetType === 'NEW_B2B_ORDER_REQUEST') {
      playDukaAlarmChime(audioCtxRef);
    } else {
      playSoftNotificationChime(audioCtxRef);
    }
    setAlerts((prev) => [packet, ...prev].slice(0, 20));
  };

  const acknowledgeAlert = (id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a))
    );
  };

  const acknowledgeAllAlerts = () => {
    setAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })));
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-100">
      <div
        className={`${
          compactContainer ? 'max-w-2xl' : 'max-w-6xl'
        } mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-4`}
      >
        <div className="flex items-center gap-3 md:gap-4 lg:gap-8 min-w-0 flex-1">
          {/* Mobile Menu Icon in AppBar (Brand hidden on mobile; also opens Admin sidebar on < lg) */}
          <button
            type="button"
            onClick={() => {
              setProfileMenuOpen(false);
              setBellOpen(false);
              if (activeProfile.role === 'SUPER_ADMIN' && activePage === 'DASHBOARD') {
                onToggleAdminMobileSidebar();
              } else {
                onToggleMobileMenu();
              }
            }}
            aria-label={isSw ? 'Fungua Menyu' : 'Open menu'}
            aria-expanded={
              activeProfile.role === 'SUPER_ADMIN' && activePage === 'DASHBOARD'
                ? adminMobileSidebarOpen
                : mobileMenuOpen
            }
            className={`${
              activeProfile.role === 'SUPER_ADMIN' && activePage === 'DASHBOARD'
                ? 'lg:hidden'
                : 'md:hidden'
            } min-h-[40px] min-w-[40px] p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 inline-flex items-center justify-center shrink-0 cursor-pointer transition-colors`}
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>

          {/* Brand Logo hidden on mobile view, visible on md+ */}
          <button
            type="button"
            onClick={() => {
              onSelectPage('DASHBOARD');
              setProfileMenuOpen(false);
              setBellOpen(false);
            }}
            className="hidden md:inline-flex whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity cursor-pointer"
          >
            <BrandLogo size="md" />
          </button>

          {/* Desktop Top AppBar Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-5 lg:gap-6 text-xs sm:text-sm font-medium text-slate-600 overflow-x-auto no-scrollbar py-2 min-w-0">
            {activeProfile.role === 'RETAILER' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onSelectRetailerTab('pos_register');
                    onSelectPage('DASHBOARD');
                  }}
                  className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    activePage === 'DASHBOARD' && retailerTab === 'pos_register'
                      ? 'text-slate-950 underline underline-offset-8 decoration-2 decoration-emerald-600 font-semibold'
                      : 'hover:text-slate-900'
                  }`}
                >
                  {isSw ? 'POS Mauzo' : 'POS Sales'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectRetailerTab('inventory_shelf');
                    onSelectPage('DASHBOARD');
                  }}
                  className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    activePage === 'DASHBOARD' && retailerTab === 'inventory_shelf'
                      ? 'text-slate-950 underline underline-offset-8 decoration-2 decoration-emerald-600 font-semibold'
                      : 'hover:text-slate-900'
                  }`}
                >
                  {isSw ? 'Hifadhi & Bidhaa' : 'Inventory & Catalogs'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectRetailerTab('core_engine');
                    onSelectPage('DASHBOARD');
                  }}
                  className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    activePage === 'DASHBOARD' && retailerTab === 'core_engine'
                      ? 'text-slate-950 underline underline-offset-8 decoration-2 decoration-emerald-600 font-semibold'
                      : 'hover:text-slate-900'
                  }`}
                >
                  {isSw ? 'Sokoni & Oda' : 'Sokoni Marketplace'}
                </button>

                {retailerMapEnabled && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectRetailerTab('proximity_map');
                      onSelectPage('DASHBOARD');
                    }}
                    className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      activePage === 'DASHBOARD' && retailerTab === 'proximity_map'
                        ? 'text-slate-950 underline underline-offset-8 decoration-2 decoration-emerald-600 font-semibold'
                        : 'hover:text-slate-900'
                    }`}
                  >
                    {isSw ? 'Ramani (GIS)' : 'Proximity Map'}
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => onSelectPage('DASHBOARD')}
                className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  activePage === 'DASHBOARD'
                    ? 'text-slate-950 underline underline-offset-8 decoration-2 decoration-emerald-600 font-semibold'
                    : 'hover:text-slate-900'
                }`}
              >
                {isSw ? 'Dashibodi' : 'Dashboard'}
              </button>
            )}

            <button
              type="button"
              onClick={() => onSelectPage('PROFILE')}
              className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activePage === 'PROFILE'
                  ? 'text-slate-950 underline underline-offset-8 decoration-2 decoration-emerald-600 font-semibold'
                  : 'hover:text-slate-900'
              }`}
            >
              {isSw ? 'Wasifu' : 'Profile'}
            </button>
            <button
              type="button"
              onClick={() => onSelectPage('SETTINGS')}
              className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activePage === 'SETTINGS'
                  ? 'text-slate-950 underline underline-offset-8 decoration-2 decoration-emerald-600 font-semibold'
                  : 'hover:text-slate-900'
              }`}
            >
              {isSw ? 'Mipangilio' : 'Settings'}
            </button>
          </nav>
        </div>

        {/* Top-Right Telemetry Bell + PWA Install + Language Switcher + Always-Visible Profile Matrix */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <PWAInstallButton locale={locale} />

          {/* Interactive White-Labeled STOMP Notification Bell */}
          <div className="relative shrink-0" ref={bellContainerRef}>
            <button
              type="button"
              onClick={() => {
                setProfileMenuOpen(false);
                setBellOpen((prev) => !prev);
                // Unlock Web AudioContext on user gesture
                resolveAudioContext(audioCtxRef);
              }}
              aria-expanded={bellOpen}
              aria-haspopup="dialog"
              aria-label={
                isSw
                  ? `Arifa za STOMP (${unreadCount})`
                  : `STOMP Notifications (${unreadCount})`
              }
              className={`relative min-h-[40px] min-w-[40px] p-2 rounded-lg border transition-colors cursor-pointer inline-flex items-center justify-center ${
                activeHighPriorityCount > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {activeHighPriorityCount > 0 ? (
                <BellRing className="w-4 h-4 text-amber-600 animate-bounce" aria-hidden="true" />
              ) : (
                <Bell className="w-4 h-4 text-slate-700" aria-hidden="true" />
              )}

              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center">
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${
                      activeHighPriorityCount > 0 ? 'bg-red-500' : 'bg-emerald-500'
                    }`}
                  />
                  <span
                    className={`relative inline-flex items-center justify-center rounded-full px-1 h-5 min-w-[20px] text-[10px] font-mono font-bold text-white tabular-nums ${
                      activeHighPriorityCount > 0 ? 'bg-red-600' : 'bg-emerald-600'
                    }`}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                </span>
              )}
            </button>

            {bellOpen && (
              <div
                role="dialog"
                aria-label={isSw ? 'Kituo cha Arifa za Wakati Halisi' : 'Real-Time STOMP Alerts'}
                className="fixed sm:absolute right-3 sm:right-0 top-[68px] sm:top-auto sm:mt-2 w-[calc(100vw-1.5rem)] sm:w-96 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50"
              >
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {isSw ? 'Arifa za STOMP & Kengele ya Duka' : 'STOMP Live Alert Telemetry'}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      {stompStatus === 'SUBSCRIBED'
                        ? '/topic/admin/managed-alerts · LIVE'
                        : 'WebSocket STOMP + Broadcast Channel'}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setAudioMuted((prev) => !prev)}
                      title={isSw ? 'Washa / Zima Mlio' : 'Toggle Alarm Audio'}
                      className={`p-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                        audioMuted
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {audioMuted ? (
                        <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </button>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={acknowledgeAllAlerts}
                        title={isSw ? 'Nyamazisha Zote' : 'Acknowledge All'}
                        className="px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                        <span>{isSw ? 'Pokea' : 'Ack'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Native Web Audio Simulator Controls */}
                <div className="px-3 py-2 bg-slate-50/40 border-b border-slate-100 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => triggerTestPacket('NEW_B2B_ORDER_REQUEST')}
                    className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <BellRing className="w-3 h-3 text-amber-400 shrink-0" aria-hidden="true" />
                    <span>{isSw ? 'Jaribu Kengele (B2B)' : 'Test B2B Alarm'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerTestPacket('STANDARD_UPDATE')}
                    className="flex-1 min-w-[130px] px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Volume2 className="w-3 h-3 text-emerald-600 shrink-0" aria-hidden="true" />
                    <span>{isSw ? 'Jaribu Mlio Laini' : 'Test Soft Chime'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const reg = await initializeWebPushRegistration(activeProfile.userId);
                      if (reg.status === 'SUBSCRIBED') {
                        await triggerLocalServiceWorkerPushTest({
                          title: isSw ? 'SokoKuu TZ — Arifa ya Push' : 'SokoKuu TZ — Web Push Ready',
                          body: isSw
                            ? 'Kifaa kimesajiliwa kupokea kengele hata kivinjari kikifungwa.'
                            : 'Device subscribed for background order alerts.',
                          deepLinkUrl: '/dashboard/retailer',
                        });
                        setPushBanner(isSw ? 'Web Push imeamilishwa.' : 'Web Push active.');
                      } else {
                        setPushBanner(reg.message);
                      }
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Radio className="w-3 h-3 text-emerald-600 shrink-0" aria-hidden="true" />
                    <span>
                      {isSw
                        ? 'Washa Web Push (Kivinjari Kikifungwa)'
                        : 'Enable Background Web Push (VAPID)'}
                    </span>
                  </button>
                  {pushBanner && (
                    <div className="w-full text-[10px] font-mono text-slate-600 px-1">
                      {pushBanner}
                    </div>
                  )}
                </div>

                {/* Live Alert Stream */}
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                  {alerts.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-slate-500">
                      {isSw
                        ? 'Hakuna arifa mpya kwa sasa.'
                        : 'No asynchronous alerts received yet.'}
                    </div>
                  ) : (
                    alerts.map((alert) => {
                      const urgent = isHighPriorityPacket(alert.packetType);
                      return (
                        <div
                          key={alert.id}
                          className={`px-4 py-3 text-xs space-y-1 transition-colors ${
                            !alert.acknowledged && urgent
                              ? 'bg-amber-50/80'
                              : !alert.acknowledged
                                ? 'bg-emerald-50/40'
                                : 'bg-white opacity-75'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                urgent
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {formatAlertPacketLabel(alert.packetType, locale)}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500">
                              {alert.receivedAt}
                            </span>
                          </div>
                          <div className="font-semibold text-slate-900">
                            {alert.orderRef ? `#${alert.orderRef} · ` : ''}
                            {alert.title}
                          </div>
                          <div className="text-[11px] text-slate-600 line-clamp-2">
                            {alert.message}
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            {alert.amountTzs !== undefined ? (
                              <span className="font-mono text-[11px] font-semibold text-emerald-700 tabular-nums">
                                TZS {alert.amountTzs.toLocaleString('en-US')}
                              </span>
                            ) : (
                              <span />
                            )}
                            {!alert.acknowledged && (
                              <button
                                type="button"
                                onClick={() => acknowledgeAlert(alert.id)}
                                className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 underline cursor-pointer"
                              >
                                {isSw ? 'Pokea & Nyamazisha' : 'Acknowledge'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onToggleLocale}
            title={isSw ? 'Switch to English' : 'Badili kwenda Kiswahili'}
            className="min-h-[40px] px-2 sm:px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center gap-1 text-xs font-semibold text-slate-700 cursor-pointer transition-colors"
          >
            <Languages className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{isSw ? 'SW' : 'EN'}</span>
          </button>

          <div className="relative shrink-0" ref={menuContainerRef}>
            <button
              type="button"
              onClick={() => {
                setBellOpen(false);
                setProfileMenuOpen((prev) => !prev);
              }}
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              aria-label={isSw ? 'Menyu ya Wasifu na Ondoka' : 'Profile and Logout menu'}
              className="min-h-[40px] px-2 sm:px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center gap-2 cursor-pointer transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-emerald-600 text-white font-mono text-xs font-bold flex items-center justify-center shrink-0">
                {getInitials(activeProfile.fullName)}
              </div>
              <div className="text-left sm:hidden max-w-[64px]">
                <div className="text-[11px] font-semibold text-slate-900 truncate">
                  {activeProfile.fullName.split(' ')[0] || (isSw ? 'Wasifu' : 'Profile')}
                </div>
                <div className="text-[9px] text-emerald-700 font-medium leading-none">
                  {isSw ? 'Wasifu' : 'Profile'}
                </div>
              </div>
              <div className="text-left hidden sm:block max-w-[140px]">
                <div className="text-xs font-semibold text-slate-900 truncate">
                  {activeProfile.fullName}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {isSw ? ROLE_LABELS[activeProfile.role].sw : ROLE_LABELS[activeProfile.role].en}
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
            </button>

            {profileMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-50"
              >
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70 space-y-0.5">
                  <div className="text-sm font-bold text-slate-900 truncate">
                    {activeProfile.fullName}
                  </div>
                  <div className="text-xs text-slate-600 truncate">
                    {activeProfile.businessLabel}
                  </div>
                  <div className="text-[11px] font-mono text-emerald-700 truncate">
                    {isSw ? ROLE_LABELS[activeProfile.role].sw : ROLE_LABELS[activeProfile.role].en} ·{' '}
                    {isSw ? MODE_LABELS[activeProfile.mode].sw : MODE_LABELS[activeProfile.mode].en}
                  </div>
                </div>

                <div className="p-1.5 space-y-0.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSelectPage('PROFILE');
                      setProfileMenuOpen(false);
                    }}
                    className="w-full min-h-[42px] px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 rounded-md flex items-center gap-2.5 cursor-pointer"
                  >
                    <UserCog className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                    <span>
                      {isSw
                        ? 'Wasifu (Sasisha Taarifa Zako)'
                        : 'Profile (Update Information)'}
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSelectPage('SETTINGS');
                      setProfileMenuOpen(false);
                    }}
                    className="w-full min-h-[42px] px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 rounded-md flex items-center gap-2.5 cursor-pointer"
                  >
                    <Settings className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                    <span>{isSw ? 'Mipangilio (Settings)' : 'Settings'}</span>
                  </button>

                  <div className="my-1 border-t border-slate-100" />

                  <button
                    type="button"
                    role="menuitem"
                    onClick={onLogout}
                    className="w-full min-h-[42px] px-3 py-2 text-left text-xs font-semibold text-red-700 hover:bg-red-50 rounded-md flex items-center gap-2.5 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
                    <span>{isSw ? 'Ondoka (Logout)' : 'Logout'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Slide-Over Navigation Drawer (opened via AppBar Menu icon) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={onToggleMobileMenu}
          />
          <aside
            aria-label={isSw ? 'Menyu ya Simu' : 'Mobile navigation'}
            className="relative w-72 max-w-[85vw] bg-white min-h-screen border-r border-slate-200 z-10 flex flex-col shadow-xl"
          >
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <BrandLogo size="sm" />
                <div className="text-xs font-bold text-slate-900 truncate">
                  {activeProfile.fullName}
                </div>
                <div className="text-[11px] font-mono text-emerald-700 truncate">
                  {isSw ? ROLE_LABELS[activeProfile.role].sw : ROLE_LABELS[activeProfile.role].en}
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleMobileMenu}
                aria-label={isSw ? 'Funga Menyu' : 'Close menu'}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {activeProfile.role === 'RETAILER' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectRetailerTab('pos_register');
                      onSelectPage('DASHBOARD');
                      onToggleMobileMenu();
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      activePage === 'DASHBOARD' && retailerTab === 'pos_register'
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {isSw ? 'POS Mauzo' : 'POS Sales'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectRetailerTab('inventory_shelf');
                      onSelectPage('DASHBOARD');
                      onToggleMobileMenu();
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      activePage === 'DASHBOARD' && retailerTab === 'inventory_shelf'
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {isSw ? 'Hifadhi & Bidhaa' : 'Inventory & Catalogs'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectRetailerTab('core_engine');
                      onSelectPage('DASHBOARD');
                      onToggleMobileMenu();
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      activePage === 'DASHBOARD' && retailerTab === 'core_engine'
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {isSw ? 'Sokoni & Oda' : 'Sokoni Marketplace'}
                  </button>
                  {retailerMapEnabled && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectRetailerTab('proximity_map');
                        onSelectPage('DASHBOARD');
                        onToggleMobileMenu();
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        activePage === 'DASHBOARD' && retailerTab === 'proximity_map'
                          ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {isSw ? 'Ramani (GIS)' : 'Proximity Map'}
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onSelectPage('DASHBOARD');
                    onToggleMobileMenu();
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    activePage === 'DASHBOARD'
                      ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {isSw ? 'Dashibodi' : 'Dashboard'}
                </button>
              )}

              <div className="my-2 border-t border-slate-100" />

              <button
                type="button"
                onClick={() => {
                  onSelectPage('PROFILE');
                  onToggleMobileMenu();
                }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                  activePage === 'PROFILE'
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <UserCog className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>{isSw ? 'Wasifu' : 'Profile'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onSelectPage('SETTINGS');
                  onToggleMobileMenu();
                }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer ${
                  activePage === 'SETTINGS'
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Settings className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                <span>{isSw ? 'Mipangilio' : 'Settings'}</span>
              </button>
            </nav>

            <div className="p-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onLogout}
                className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
                <span>{isSw ? 'Ondoka (Logout)' : 'Logout'}</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </header>
  );
}
