# SokoKuu TZ — NestJS Backend Architecture (Modular Monolith)

**Target Runtime**: Node.js 22 LTS, NestJS 10/11 (TypeScript `strict: true`), PostgreSQL 16 + PostGIS 3.4, Prisma ORM, Redis 7, RabbitMQ 3.13  
**Workspace Root**: `backend/` (isolated from root React/Vite PWA)

---

## 1. Modular Monolith Topology (16 Domain Modules)

Each domain module encapsulates its own `*.module.ts`, controllers/gateways, application services, DTOs (`class-validator` / `zod`), domain events, and Prisma/raw SQL repository adapters. Cross-module communication uses explicit exported NestJS service interfaces or RabbitMQ domain events (never reaching directly into another module's internal private helpers).

```text
backend/
├── src/
│   ├── common/                    # Structured Pino logger, RFC 7807 filter, ValidationPipe, decorators
│   ├── config/                    # Zod/Joi validated EnvConfig (@nestjs/config), TZ=Africa/Dar_es_Salaam
│   ├── database/                  # PrismaService, transaction/isolation helpers, PostGIS query helpers
│   ├── messaging/                 # RabbitMQ outbox relay, exchange/queue topology, DLQ handlers
│   ├── redis/                     # Redis client, rate limiter store, token blacklist, idempotency locks
│   └── modules/
│       ├── 01-identity/           # Identity & Authentication (JWT + rotating refresh tokens, Argon2id)
│       ├── 02-authorization/      # Authorization & RBAC (RolesGuard, PermissionsGuard, 5 platform roles)
│       ├── 03-tenancy/            # Multi-Tenant Business Management (business_profiles, tier, membership)
│       ├── 04-branches/           # Business Branch Management (PostGIS wards, GIST spatial queries, map gate)
│       ├── 05-catalog/            # Catalog Management (products, global catalog, ImageKit, base-zero clone)
│       ├── 06-inventory/          # Inventory Management (integer Quarter-Quanta, auto_break_bulk_package)
│       ├── 07-pricing/            # Pricing Engine (product_price_tiers, dynamic volume switching, tier triggers)
│       ├── 08-procurement/        # Procurement (smart reorder feed, smart grid, B2B replenishment)
│       ├── 09-orders/             # Order Management (store-isolated B2B/B2C, POS walk-in, order interceptor)
│       ├── 10-financials/         # Payment & Financial Operations (CoD expectations, hybrid daily split, EOD, CSV)
│       ├── 11-cod-verification/   # Cash-on-Delivery Verification (SKQR-* single-use QR, isolated Dual-PIN)
│       ├── 12-dispatch/           # Delivery & Dispatch (driver queue, PIN allocation, fleet tracking)
│       ├── 13-notifications/      # Notification Management (STOMP/WS gateway, VAPID Web Push, NextSMS outbound)
│       ├── 14-webhooks/           # Webhook Integration (NextSMS inbound callback, SIG6 HMAC-SHA256)
│       ├── 15-audit/              # Audit & Compliance (audit traces, deconstruction logs, 3-strike fraud, retention)
│       └── 16-platform-admin/     # Platform Administration (soko_leads CRM, map toggles, docs vault, telemetry)
└── prisma/
    ├── schema.prisma
    └── migrations/                # SQL-first migrations preserving PostGIS, ENUMs, triggers, & stored procs
```

### Detailed Responsibilities of All 16 Modules

| # | Module | Core Responsibilities & Rules Preserved |
| :-: | :--- | :--- |
| 1 | **Identity & Authentication** | Phone/email login, Argon2id password/PIN verification, short-lived JWT Access Tokens (`15m`), rotating opaque Refresh Tokens hashed in Redis/PostgreSQL with reuse-detection revocation, brute-force PIN lockout. |
| 2 | **Authorization & RBAC** | Guards for `SUPER_ADMIN`, `WHOLESALER`, `RETAILER`, `CONSUMER`, `DRIVER`; resource-ownership policies; `@Public()`, `@Roles()`, `@RequirePermissions()`. |
| 3 | **Multi-Tenant Business Management** | `business_profiles` lifecycle, `WHOLESALE_HUB` / `RETAIL_DUKA` / `HYBRID_STORE` tier management, `is_platform_managed` flag, server-derived `TenantContext` (`req.user.businessId`). |
| 4 | **Business Branch Management** | PostGIS `GEOGRAPHY(Point, 4326)` coordinates, `get_businesses_ordered_by_proximity()`, `geospatial_map_enabled` (default `FALSE`), Dar es Salaam ward routing. |
| 5 | **Catalog Management** | Store-isolated active SKU queries (`businessId`), `soko_global_catalog` & `soko_catalog_categories`, atomic Base-Zero cloning (`0` stock, `0` TZS + `cloned_by_stores_count` trigger), ImageKit URL validation. |
| 6 | **Inventory Management** | Integer Quarter-Quanta math (`1 Robo = 1`, `1 KG/L = 4`, `50 KG = 200`), `auto_break_bulk_package` (`FOR UPDATE` row lock), automated Retailer Stock-In hydration on `OrderDeliveredEvent`. |
| 7 | **Pricing Engine** | `product_price_tiers`, `trg_validate_tier_packaging_rules`, `trg_enforce_pure_store_pricing`, dynamic retail->wholesale crossover calculation, authoritative server price lookup. |
| 8 | **Procurement** | Retailer smart-reorder inference (`requiresUrgentReorder`), `/api/v1/sokoni/{wholesalerId}/smart-grid` filtering, store-isolated wholesale replenishment baskets. |
| 9 | **Order Management** | Store-locked B2B/B2C order intake (`/api/v1/orders/request`, `/api/v1/marketplace/orders/submit-request`), Retailer POS deduction (`/api/v1/retailer/pos/sales-receipt`), `ManagedOrderInterceptorService` routing. |
| 10 | **Payment & Financial Operations** | Zero-escrow Cash-on-Delivery ledger initialization (`expected_cash_amount`, `collected_cash_amount` in `BIGINT` TZS), Wholesaler EOD settlement gating, Hybrid B2B/B2C revenue split, UTF-8 Swahili CSV streaming with formula-injection neutralization. |
| 11 | **Cash-on-Delivery Verification** | Single-use `SKQR-*` generation & consumption (`is_qr_token_consumed`), device-isolated Buyer PIN + Driver PIN confirmation under `SERIALIZABLE` + `PESSIMISTIC_WRITE` (`FOR UPDATE`), instant STOMP modal trigger to driver. |
| 12 | **Delivery & Dispatch** | Driver delivery task queue (`IN_TRANSIT`, `DELIVERED`, `DISPUTED`), driver arrival QR minting, CSPRNG 4-digit PIN allocation on dispatch, fleet cash-on-street reconciliation. |
| 13 | **Notification Management** | Real-time WebSocket/STOMP broadcaster (`/topic/admin/managed-alerts`, `/topic/driver/reconciliation/{driverId}`, `/user/queue/alerts`), VAPID Web Push (`web-push` package + `web_push_subscriptions` + `410/404` cleanup), outbound NextSMS client (`<= 160` GSM-7 chars). |
| 14 | **Webhook Integration** | Isolated `POST /api/v1/callback/nextsms/incoming` guarded by `X-NextSMS-Gateway-Token`, parsing `SK#REF8#SELLER#ITEMS#SIG6` and `SK#CANCEL#REF8#SIG6`, constant-time HMAC-SHA256 verification, replay deduplication. |
| 15 | **Audit & Compliance** | Append-only `order_dispatch_audit_traces`, `inventory_deconstruction_logs`, 3-Strike `DeliveryDisputeEvent` 24-hour fraud monitor, retention/cold-archive `@Cron` scheduler, redacted Pino structured logging. |
| 16 | **Platform Administration** | Field sales `soko_leads` CRM with PostGIS GPS + optimistic `version` lock + NextSMS onboarding PIN, `geospatial_map_enabled` per-tenant toggle, `SUPER_ADMIN` Architecture Vault API, global telemetry. |

---

## 2. Hybrid Prisma + Raw PostgreSQL / PostGIS Persistence Strategy

Prisma ORM manages typed entity CRUD, migrations tracking (`_prisma_migrations`), and connection lifecycle, while **raw SQL within Prisma migrations and `$queryRaw` / `$executeRaw`** preserves exact PostgreSQL/PostGIS capabilities that Prisma schema DSL cannot natively express:

1. **PostGIS Spatial Types & Functions**: `GEOGRAPHY(Point, 4326)`, `GIST` spatial indexes, `ST_DWithin`, `ST_Distance`, and `get_businesses_ordered_by_proximity()`.
2. **PostgreSQL Triggers & PL/pgSQL Procedures**:
   - `trg_validate_tier_packaging_rules` & `trg_enforce_pure_store_pricing` (database-level Channel Harmony enforcement).
   - `auto_break_bulk_package()` (`FOR UPDATE` serialized sack deconstruction).
   - `trg_increment_global_catalog_adoption` (atomic `cloned_by_stores_count` increment).
3. **Explicit Transaction Isolation & Row Locks**:
   - Helper wrapper `PrismaService.runInTransaction({ isolationLevel: 'Serializable' | 'RepeatableRead' }, fn)` plus `SELECT ... FOR UPDATE` inside `cash_delivery_ledgers` and `products` mutations.
4. **Transactional Outbox Table (`domain_outbox_events`)**:
   - Guarantees strict **`AFTER_COMMIT`** parity with Spring's `@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)`. Domain events (e.g., `OrderRoutedToHelpdesk`, `BulkPackageBroken`, `OrderDelivered`, `LeadConverted`, `DisputeRecorded`) are written inside the same PostgreSQL ACID transaction as the business mutation and published to RabbitMQ only after commit.

---

## 3. RabbitMQ Event Exchange Topology

- **Exchange**: `sokokuu.domain.events` (`topic`, durable) + `sokokuu.dlx` (dead-letter exchange)
- **Routing Keys & Queues**:
  - `order.routed.helpdesk` -> `q.realtime.admin-alerts` (Broadcasts `ROUTED_PLATFORM_MANAGED_HELPDESK` over WS + Web Push to admins)
  - `order.b2b.created` -> `q.realtime.b2b-alerts` (Broadcasts `NEW_B2B_ORDER_REQUEST` triggering client audio chime + Web Push)
  - `order.delivered` -> `q.inventory.retailer-hydration` (Credits Retailer shelf quanta idempotently)
  - `cod.qr.scanned` -> `q.realtime.driver-pin-modal` (Dispatches `TRIGGER_DRIVER_PIN_MODAL_OPEN` to `/topic/driver/reconciliation/{driverId}`)
  - `cod.dispute.recorded` -> `q.audit.three-strike-fraud` (Evaluates 24h `>= 3` `DISPUTED` threshold -> NextSMS admin alert)
  - `inventory.bulk.broken` -> `q.sms.bulk-break-notify` (Outbound NextSMS Single Text API `<= 160` chars)
  - `lead.converted` -> `q.sms.lead-onboarding` (Outbound NextSMS 4-digit PIN onboarding SMS)

---

## 4. Real-Time Gateway Architecture (STOMP-Compatible + Socket.IO)

To ensure 100% compatibility with the existing React/Vite PWA (`BrandedAppBarWithAlerts.tsx`, `AdminAlertTerminal.tsx`, `IsolatedQrVerificationTerminal.tsx`) without modifying frontend transport code:
- **Raw WebSocket STOMP 1.2 Endpoint (`/ws-sokokuu` and `/ws/sokokuu`)**: Handles native `CONNECT`, `SUBSCRIBE`, `DISCONNECT` STOMP frames over `ws` adapter and emits `CONNECTED` + `MESSAGE` JSON frames identically to Spring's `SimpMessagingTemplate`.
- **Authenticated Subscriptions**: Validates JWT on WebSocket handshake / STOMP `CONNECT` headers; restricts `/topic/admin/managed-alerts` to `SUPER_ADMIN` and `/topic/driver/reconciliation/:driverId` to the matching `DRIVER` (`userId === driverId`) or `SUPER_ADMIN`.
- **Socket.IO Namespace Support (`/realtime`)**: Optional typed Socket.IO gateway sharing the same RabbitMQ/Redis pub-sub adapter for horizontal scaling across replicas.
