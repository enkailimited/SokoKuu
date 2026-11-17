# NextSMS Gateway Contract — SokoKuu TZ

**Storage & Telemetry Cluster**: SokoKuu Cloud SQL Database Cluster  
**Timezone**: `Africa/Dar_es_Salaam`

---

## 1. Inbound Compact SMS Webhook (`POST /api/v1/callback/nextsms/incoming`)

- **Authentication**: Protected by `NextSmsGatewayTokenGuard` validating header `X-NextSMS-Gateway-Token` against `NEXTSMS_WEBHOOK_SHARED_TOKEN` via SHA-256 + `crypto.timingSafeEqual`.
- **MSISDN Normalization**: Accepts Tanzanian formats `06xxxxxxxx`, `07xxxxxxxx`, `2556xxxxxxxx`, `2557xxxxxxxx`, `+2556xxxxxxxx`, `+2557xxxxxxxx` and normalizes strictly to `^\+255[67][0-9]{8}$`.
- **Compact Grammar (<= 160 GSM-7 chars)**:
  1. **Order Placement**:
     `^SK#([A-Z0-9]{8})#([A-Z0-9]{2,10})#([A-Z0-9:,]{5,110})#([A-F0-9]{6})$`
     - Signed payload: `SK#${orderRef8}#${sellerShortCode}#${itemsExpr}`
     - Item tuple unit codes:
       - `Q` -> `QUARTER_KILO_LITRE` (1 Robo / 250g)
       - `H` -> `HALF_KILO_LITRE` (2 Robo / 500g)
       - `T` -> `THREE_QUARTER_KILO` (3 Robo / 750g)
       - `K` -> `SINGLE_KILO_LITRE` (4 Robo / 1KG/1L)
       - `U` -> `UNIT`
       - `P` -> `PACK`
       - `D` -> `DOZEN`
       - `C` -> `CARTON`
       - `S25` -> `SACK_25KG`
       - `S50` -> `SACK_50KG`
  2. **Doorstep Cancellation / Dispute**:
     `^SK#CANCEL#([A-Z0-9]{8})#([A-F0-9]{6})$`
     - Signed payload: `SK#CANCEL#${orderRef8}`
     - Sender must resolve to the assigned `DRIVER` (`orders.driver_user_id`) or owning `WHOLESALER` (`business_profiles.owner_user_id`).
- **HMAC Verification**:
  - `expectedSig6 = HMAC_SHA256(user.sms_hmac_secret, signedPayload).slice(0, 6).toUpperCase()`
  - Validated with `crypto.timingSafeEqual`. Failures return `401 Unauthorized` and write `nextsms_inbound_logs (REJECTED)` + `security_audit_logs`.
- **Replay & Idempotency**:
  - Deduplicated via `nextsms_inbound_logs.message_id` and `nextsms_inbound_logs (order_ref8, parsed_action, status = 'PROCESSED')`.

---

## 2. Outbound Single Text API (`POST {NEXTSMS_API_BASE_URL}/api/sms/v1/text/single`)

- **Authorization**: HTTP Basic Auth (`Authorization: Basic <base64(NEXTSMS_USERNAME:NEXTSMS_PASSWORD)>`). Credentials are read from environment config only and **never logged** in Pino or audit tables.
- **Request Payload**:
  ```json
  {
    "from": "SOKOKUU",
    "to": "255712345678",
    "text": "Karibu SokoKuu TZ! ..."
  }
  ```
- **Delivery Lifecycle, Retry Backoff & Dead-Lettering**:
  - Each dispatch creates a `sms_delivery_logs` record (`QUEUED` -> `SENT` | `FAILED` | `DEAD_LETTER`).
  - Transient provider failures schedule `next_retry_at = NOW() + (30s * 2^(attempt_count - 1))`.
  - Reaching `attempt_count >= max_attempts` transitions both `sms_delivery_logs.status` and linked `domain_outbox_events.status` to `DEAD_LETTER`.
