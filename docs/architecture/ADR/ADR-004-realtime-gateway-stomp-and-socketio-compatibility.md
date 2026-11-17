# ADR-004: Dual-Protocol Real-Time Gateway (STOMP 1.2 Compatibility + Socket.IO)

- **Status**: Accepted
- **Date**: 2026-11-17
- **Deciders**: SokoKuu TZ Principal Architecture Team
- **Scope**: Real-Time Transport (`backend/src/modules/13-notifications/`)

---

## 1. Context

The existing React/Vite PWA (`BrandedAppBarWithAlerts.tsx`, `AdminAlertTerminal.tsx`, `IsolatedQrVerificationTerminal.tsx`) and the blueprints in `src/data/blueprints.ts` expect Spring WebSocket / STOMP 1.2 topics and payloads:
- Endpoints: `/ws-sokokuu` and `/ws/sokokuu`
- Topics:
  - `/topic/admin/managed-alerts` (`ROUTED_PLATFORM_MANAGED_HELPDESK` alarms)
  - `/topic/driver/reconciliation/{driverId}` (`TRIGGER_DRIVER_PIN_MODAL_OPEN` and Cash-on-Delivery Dual-PIN state transitions)
  - `/user/queue/alerts` (`NEW_B2B_ORDER_REQUEST` and per-user alerts)
- Additionally, future mobile or multi-node consumers benefit from Socket.IO namespaces and Redis-backed pub/sub fan-out.

Because the root PWA must remain completely unmodified in Phase 0–1, any backend that breaks STOMP wire framing or changes topic names would break real-time frontend integration.

---

## 2. Decision

Implement a **Dual-Protocol Real-Time Gateway** in `13-notifications` backed by **Redis Pub/Sub** for multi-instance broadcasting:

1. **STOMP 1.2 Over Raw WebSocket Adapter (`/ws-sokokuu` and `/ws/sokokuu`)**:
   - Implemented using `ws` mounted on the NestJS HTTP server, handling `CONNECT`/`STOMP`, `SUBSCRIBE`, `UNSUBSCRIBE`, `DISCONNECT`, and heartbeats, and emitting standard STOMP `CONNECTED`, `MESSAGE`, and `ERROR` frames (`\0`-terminated).
   - Preserves exact topic strings (`/topic/admin/managed-alerts`, `/topic/driver/reconciliation/:driverId`, `/user/queue/alerts`) and JSON payload structures.
2. **Socket.IO Namespace (`/realtime`)**:
   - Exposes typed Socket.IO rooms mirroring the exact same event payloads for rich mobile/web clients.
3. **Handshake & Frame-Level RBAC Enforcement**:
   - JWT validation occurs on WebSocket upgrade (`Authorization: Bearer ...` or handshake token) and STOMP `CONNECT` passcode/header.
   - Subscriptions to `/topic/admin/managed-alerts` are denied unless `role === 'SUPER_ADMIN'`.
   - Subscriptions to `/topic/driver/reconciliation/:driverId` are denied unless `userId === driverId` or `role === 'SUPER_ADMIN'`.

---

## 3. Consequences

### Positive
- Drop-in compatibility with Spring STOMP 1.2 clients (`@stomp/stompjs`) and existing PWA topic contracts without touching frontend code.
- Redis Pub/Sub bridge ensures a RabbitMQ-triggered alert consumed by replica A reaches a WebSocket client connected to replica B.
- Enforces strict tenant/role isolation on WebSocket subscriptions (closing unauthenticated topic snooping).

### Trade-offs & Mitigations
- **Custom STOMP Frame Codec Maintenance**: Mitigated by keeping the STOMP server codec minimal (implementing only the subset used: `CONNECT`, `SUBSCRIBE`, `UNSUBSCRIBE`, `DISCONNECT`, `HEARTBEAT`, `MESSAGE`, `ERROR`) and thoroughly testing it with `@stomp/stompjs` in automated E2E tests.

---

## 4. Alternatives Considered

1. **Socket.IO Only**: Rejected because STOMP clients targeting `/ws-sokokuu` and `/topic/...` cannot handshake with a Socket.IO-only server without modifying frontend code.
2. **HTTP Short Polling**: Rejected because `IsolatedQrVerificationTerminal` Dual-PIN modal pops and `AdminAlertTerminal` live sirens require sub-second push latency.
