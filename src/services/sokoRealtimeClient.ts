import { io, Socket } from 'socket.io-client';

class SokoRealtimeClient {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  connect(token?: string) {
    if (this.socket?.connected) return;

    const authToken = token || localStorage.getItem('sokokuu_access_token');
    const configuredWsUrl =
      (import.meta.env.VITE_REALTIME_URL as string | undefined)?.trim() || '';
    // VITE_REALTIME_URL may be configured as either the server origin or the
    // full /realtime endpoint. Socket.IO expects the origin here because the
    // gateway path is passed separately below.
    const wsUrl = configuredWsUrl
      ? configuredWsUrl.replace(/\/realtime\/?$/i, '')
      : window.location.origin;

    this.socket = io(wsUrl, {
      path: '/realtime',
      auth: { token: authToken ? `Bearer ${authToken}` : undefined },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    this.socket.on('connect', () => {
      console.log('[SokoRealtime] Connected to NestJS /realtime gateway');
    });

    this.socket.on('admin:managed-alert', (payload) => {
      this.notifyListeners('admin:managed-alert', payload);
    });

    this.socket.on('driver:reconciliation-signal', (payload) => {
      this.notifyListeners('driver:reconciliation-signal', payload);
    });

    this.socket.on('notification:new', (payload) => {
      this.notifyListeners('notification:new', payload);
    });

    this.socket.on('disconnect', (reason) => {
      console.log(`[SokoRealtime] Disconnected: ${reason}`);
    });
  }

  subscribeAdminAlerts() {
    if (!this.socket) return;
    this.socket.emit('subscribe:admin-alerts', {}, (response: any) => {
      console.log('[SokoRealtime] Subscribed to admin-alerts:', response);
    });
  }

  subscribeDriverReconciliation(driverUserId?: string) {
    if (!this.socket) return;
    this.socket.emit('subscribe:driver-reconciliation', { driverUserId }, (response: any) => {
      console.log('[SokoRealtime] Subscribed to driver-reconciliation:', response);
    });
  }

  subscribeToReconciliation(driverUserId: string, callback: (payload: any) => void) {
    this.connect();
    this.subscribeDriverReconciliation(driverUserId);
    return this.on('driver:reconciliation-signal', (data) => {
      if (!driverUserId || data?.driverUserId === driverUserId || data?.topic?.includes(driverUserId)) {
        callback(data);
      }
    });
  }

  emitReconciliationSignal(driverUserId: string, payload: any) {
    if (!this.socket) {
      this.connect();
    }
    this.socket?.emit('driver:reconciliation-signal', { driverUserId, ...payload });
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private notifyListeners(event: string, data: any) {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((cb) => cb(data));
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const sokoRealtime = new SokoRealtimeClient();
