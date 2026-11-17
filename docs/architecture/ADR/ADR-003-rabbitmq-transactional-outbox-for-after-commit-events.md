# ADR-003: RabbitMQ with Transactional Outbox for AFTER_COMMIT Domain Events

- **Status**: Accepted
- **Date**: 2026-11-17
- **Deciders**: SokoKuu TZ Principal Architecture Team
- **Scope**: Eventing & Messaging (`backend/src/messaging/`, `domain_outbox_events`)

---

## 1. Context

In `src/data/blueprints.ts`, critical downstream operations rely on Spring's `@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)` semantics:
- **Order Routing Alarms**: Dispatching `ROUTED_PLATFORM_MANAGED_HELPDESK` WebSocket + Web Push alerts only after the order transaction commits.
- **Retailer Shelf Hydration**: Automatically crediting a retailer's store inventory quanta (`OrderDeliveredEvent`) only after Dual-PIN CoD verification commits.
- **Driver PIN Modal Trigger**: Emitting `TRIGGER_DRIVER_PIN_MODAL_OPEN` over `/topic/driver/reconciliation/{driverId}` only after single-use `SKQR-*` verification persists.
- **3-Strike Fraud Escalation**: Evaluating 24-hour `DISPUTED` delivery counts and dispatching NextSMS admin alerts after a dispute commits.
- **NextSMS Outbound Notifications**: Sending `<= 160`-char GSM-7 SMS messages on bulk sack breaks or `soko_leads` conversion after DB persistence.

Publishing directly to RabbitMQ or WebSockets inside a service method before `COMMIT` causes phantom alerts if the transaction rolls back; publishing after `COMMIT` without durability loses events on process crashes.

---

## 2. Decision

Implement a **Transactional Outbox Pattern (`domain_outbox_events` table)** backed by **RabbitMQ 3.13** (`sokokuu.domain.events` topic exchange + `sokokuu.dlx` dead-letter exchange).

- **Same-Transaction Write**: Domain services insert an outbox row (`id`, `aggregateType`, `aggregateId`, `eventType`, `routingKey`, `payload`, `correlationId`, `status = 'PENDING'`) inside the same Prisma `$transaction` as the business state change.
- **After-Commit Relay**:
  - An in-process low-latency `OutboxDispatcherService` wakes immediately on post-commit notification (and polls on a 1s fallback interval using `SELECT ... FOR UPDATE SKIP LOCKED`) to publish pending rows to RabbitMQ with `persistent: true` and `messageId = outbox.id`.
- **Idempotent Consumers & DLQ**:
  - Every RabbitMQ consumer records processed `messageId`s (in Redis/PostgreSQL consumer log) to guarantee at-least-once delivery remains idempotent (critical for Retailer Stock-In hydration and NextSMS billing).
  - Unrecoverable failures route after bounded retries to `sokokuu.dlx` for inspection without blocking primary queues.

---

## 3. Consequences

### Positive
- Guarantees strict `AFTER_COMMIT` parity with Spring's `@TransactionalEventListener`: zero phantom WebSocket alarms, zero phantom SMS notifications, and zero lost Stock-In hydrations on crash.
- Decouples core HTTP request latency (e.g., `POST /api/v1/orders/request`) from external NextSMS HTTP round-trips and VAPID push fan-out.
- Enables clean horizontal scaling across multiple NestJS backend instances via `SKIP LOCKED`.

### Trade-offs & Mitigations
- **Slight Relay Overhead (~5–50ms)**: Mitigated by triggering immediate post-commit flush right after `$transaction` resolves, keeping real-time STOMP and SMS latency sub-100ms while preserving crash recovery via fallback polling.
- **Outbox Table Growth**: Mitigated by a scheduled cleanup job (`15-audit` retention worker) that prunes `PUBLISHED` rows older than 14 days while retaining critical traces in `order_dispatch_audit_traces`.

---

## 4. Alternatives Considered

1. **NestJS `EventEmitter2` Only (In-Memory)**: Rejected because events fire before/outside durable guarantees, can be lost on pod restarts, and fail multi-instance scaling.
2. **Direct RabbitMQ Publish Inside Service Methods**: Rejected due to dual-write inconsistency if DB commit fails after broker publish (or vice versa).
