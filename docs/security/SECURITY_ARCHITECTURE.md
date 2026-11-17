# SokoKuu TZ — NestJS Security Architecture Specification

**Scope**: Backend API (`backend/`), PostgreSQL 16 + PostGIS, Redis, RabbitMQ, WebSocket/STOMP, NextSMS Webhooks, and Financial CSV Exports.

---

## 1. Identity, Token Lifecycle & Password/PIN Hashing

1. **Argon2id Hashing (`argon2` library)**:
   - Used universally for user passwords, 4-digit Buyer/Driver confirmation PINs, and rotated refresh token digests.
   - Baseline parameters: `type: argon2.argon2id`, `memoryCost: 65536` (64 MiB), `timeCost: 3`, `parallelism: 1`.
   - Verification uses constant-time `argon2.verify(hash, rawInput)`.
2. **JWT Access Tokens + Rotating Refresh Tokens**:
   - **Access Token**: Short-lived (`15m`), signed with `HS256` or `EdDSA`/`RS256` (`JWT_ACCESS_SECRET`), carrying strictly minimal claims: `{ sub: userId, role, jti }`.
   - **Refresh Token**: Long-lived (`7d` / `30d`), cryptographically random (`crypto.randomBytes(48).toString('base64url')`), stored hashed in `refresh_sessions` (PostgreSQL + Redis active family cache).
   - **Refresh Rotation & Reuse Detection**: Every `/api/v1/auth/refresh` call invalidates the presented token and mints a child token inside the same `familyId`. Presentation of an already-rotated refresh token triggers immediate revocation of the entire token family + security audit event.
   - **Revocation**: Logout writes access token `jti` with remaining TTL to Redis (`revoked:jti:<jti>`) and marks the refresh family revoked.

---

## 2. Authorization (RBAC) & Server-Derived Tenant Context

1. **Five Platform Roles**:
   - `SUPER_ADMIN` | `WHOLESALER` | `RETAILER` | `CONSUMER` | `DRIVER`
2. **Defense-in-Depth Guards**:
   - Global `JwtAuthGuard` (opt-out only via `@Public()`, e.g., `/health`, `/auth/login`, `/callback/nextsms/incoming`).
   - `RolesGuard` & `PermissionsGuard` evaluating `@Roles(...)` and resource policy checks.
3. **Zero Trust on Client-Supplied `businessId` or `userId`**:
   - For all mutating endpoints (POS sales, inventory deconstruction, catalog cloning, EOD settlement, Web Push subscription, QR/PIN submission):
     - `userId` is extracted **exclusively** from `req.user.userId` (verified JWT `sub`), ignoring spoofable headers such as `X-User-ID`.
     - `businessId` is resolved **server-side** by querying `business_memberships` / `business_profiles` for `req.user.userId` (or validating explicit membership when an operator owns multiple branches). A client cannot pass another merchant's `businessId` in the JSON body to deduct their stock or clone into their shelf.

---

## 3. Input Validation, Rate Limiting & Brute-Force Protection

1. **Global `ValidationPipe`**:
   - `whitelist: true` (strips unknown properties)
   - `forbidNonWhitelisted: true` (rejects unexpected payload keys with HTTP `400`)
   - `transform: true` (DTO coercion + strict regex validation e.g. 4-digit PIN `^\d{4}$`, UUID v4 params).
2. **Global Exception Filter & Redacted Logging**:
   - Normalized RFC 7807 JSON errors (`statusCode`, `errorCode`, `message`, `correlationId`, `timestamp`). Zero PostgreSQL table names, stack traces, or Prisma errors leak to HTTP clients in production.
   - Structured Pino logger with `redact: ['req.headers.authorization', 'req.headers["x-nextsms-gateway-token"]', '*.password', '*.pin', '*.pinCode', '*.authSecret', '*.p256dh', '*.hmacSecret', '*.token']`.
3. **Redis-Backed Rate Limiting (`@nestjs/throttler`) & Account Lockout**:
   - Global baseline: `120 req/min` per IP.
   - Strict endpoints: Login (`5 req/min`), PIN verification (`/buyer-pin`, `/driver-pin`, `/verify-doorstep-qr`: `5 attempts / 15 min` per `orderId + userId`, triggering temporary lockout + audit alert on failure bursts).

---

## 4. Domain-Specific Security Controls

### 4.1 NextSMS Webhook Isolation & Anti-Replay
- Route `/api/v1/callback/nextsms/incoming` bypasses standard user JWT and enforces `NextSmsTokenGuard`, verifying `X-NextSMS-Gateway-Token` using `crypto.timingSafeEqual` against `NEXTSMS_WEBHOOK_SHARED_TOKEN`.
- Compact payloads (`SK#REF8#SELLER#ITEMS#SIG6` and `SK#CANCEL#REF8#SIG6`) are verified by computing `HMAC-SHA256(user.smsHmacSecret, canonicalBody)` truncated to 6 uppercase hex chars and comparing via `crypto.timingSafeEqual`.
- `orderRef8` uniqueness (`orders.order_ref_8 UNIQUE`) and idempotency checks in Redis + DB guarantee repeated carrier webhook retries cannot create duplicate orders or double-restock cancelled inventory.

### 4.2 Financial Integrity & Anti-Price-Tampering
- Checkout endpoints (`POST /api/v1/orders/request`, `POST /api/v1/marketplace/orders/submit-request`) reject or ignore any client-submitted `unitPriceTzs`, `totalCashDueTzs`, or `expectedCashAmount`.
- Totals are computed purely inside NestJS from `products` and `product_price_tiers` using exact integer arithmetic (`bigint` / safe integer TZS).
- Dual-PIN & QR ledger mutations run inside `IsolationLevel.Serializable` with `SELECT ... FOR UPDATE` (`cash_delivery_ledgers`) and optimistic `version` checks, ensuring a `SKQR-*` token can be consumed at most once.

### 4.3 CSV Formula-Injection Protection
- In `SwahiliCsvExportController` (`/api/v1/hybrid/analytics/export-csv`), every string cell starting with `=`, `+`, `-`, `@`, `\t`, or `\r` is prefixed with a single quote (`'`) before RFC 4180 quoting so Excel/LibreOffice cannot execute embedded formulas.

### 4.4 White-Label & Infrastructure Hygiene
- TLS required for PostgreSQL (`SokoKuu Cloud SQL Database Cluster`), Redis, and RabbitMQ in production.
- CORS restricted to explicit allowlisted origins (`ALLOWED_ORIGINS` env), never `*` with `credentials: true`.
- VAPID private key (`SOKOKUU_VAPID_PRIVATE_KEY`) and NextSMS credentials are strictly server-side environment secrets validated at boot.
