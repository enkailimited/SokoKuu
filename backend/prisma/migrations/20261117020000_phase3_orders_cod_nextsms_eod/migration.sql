-- ==============================================================================
-- SokoKuu TZ — Phase 3 Extensions Migration
-- Adds Order cancellation/payment metadata, Helpdesk trace status,
-- time-bounded/HMAC QR fields, EOD reconciliation batches, POS sale receipts,
-- NextSMS inbound/outbound tracking logs, DEAD_LETTER outbox status, and
-- immutable financial audit logs.
-- ==============================================================================

DO $$ BEGIN
  ALTER TYPE outbox_status ADD VALUE IF NOT EXISTS 'DEAD_LETTER';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE domain_outbox_events
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(24) NOT NULL DEFAULT 'CASH',
  ADD COLUMN IF NOT EXISTS paid_amount_tzs BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount_tzs >= 0);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS is_wholesale_tier_applied BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE order_dispatch_audit_traces
  ADD COLUMN IF NOT EXISTS helpdesk_status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS handled_by_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS handled_notes TEXT,
  ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS eod_settlement_batches (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_business_id      UUID NOT NULL REFERENCES business_profiles(id) ON DELETE RESTRICT,
  driver_user_id          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  settled_by_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  settled_orders_count    INTEGER NOT NULL DEFAULT 0,
  expected_total_tzs      BIGINT NOT NULL DEFAULT 0,
  collected_total_tzs     BIGINT NOT NULL DEFAULT 0,
  outstanding_balance_tzs BIGINT NOT NULL DEFAULT 0,
  variance_tzs            BIGINT NOT NULL DEFAULT 0,
  cash_total_tzs          BIGINT NOT NULL DEFAULT 0,
  mpesa_total_tzs         BIGINT NOT NULL DEFAULT 0,
  tigo_pesa_total_tzs     BIGINT NOT NULL DEFAULT 0,
  pos_sales_total_tzs     BIGINT NOT NULL DEFAULT 0,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eod_batches_seller_driver
  ON eod_settlement_batches (seller_business_id, driver_user_id, created_at DESC);

ALTER TABLE cash_delivery_ledgers
  ADD COLUMN IF NOT EXISTS qr_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qr_token_signature VARCHAR(128),
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(24) NOT NULL DEFAULT 'CASH',
  ADD COLUMN IF NOT EXISTS mobile_money_ref VARCHAR(64),
  ADD COLUMN IF NOT EXISTS mobile_money_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS eod_settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eod_settlement_batch_id UUID REFERENCES eod_settlement_batches(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS pos_sales_receipts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id              VARCHAR(48) NOT NULL UNIQUE,
  seller_business_id      UUID NOT NULL REFERENCES business_profiles(id) ON DELETE RESTRICT,
  product_id              UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quanta_sold             INTEGER NOT NULL CHECK (quanta_sold >= 1),
  payment_method          VARCHAR(24) NOT NULL,
  total_tzs               BIGINT NOT NULL CHECK (total_tzs >= 0),
  collected_amount_tzs    BIGINT NOT NULL CHECK (collected_amount_tzs >= 0),
  payment_verified        BOOLEAN NOT NULL DEFAULT TRUE,
  mobile_money_ref        VARCHAR(64),
  eod_settlement_batch_id UUID REFERENCES eod_settlement_batches(id) ON DELETE SET NULL,
  recorded_by_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_receipts_seller_time
  ON pos_sales_receipts (seller_business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS financial_audit_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  seller_business_id  UUID REFERENCES business_profiles(id) ON DELETE RESTRICT,
  order_id            UUID REFERENCES orders(id) ON DELETE RESTRICT,
  settlement_batch_id UUID REFERENCES eod_settlement_batches(id) ON DELETE RESTRICT,
  event_type          VARCHAR(64) NOT NULL,
  amount_tzs          BIGINT NOT NULL DEFAULT 0,
  previous_state      VARCHAR(64),
  new_state           VARCHAR(64),
  details             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_audit_seller_time
  ON financial_audit_logs (seller_business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nextsms_inbound_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        VARCHAR(128) UNIQUE,
  sender_phone_e164 VARCHAR(16) NOT NULL,
  raw_message       VARCHAR(160) NOT NULL,
  parsed_action     VARCHAR(24) NOT NULL,
  order_ref8        VARCHAR(16),
  is_valid_hmac     BOOLEAN NOT NULL DEFAULT FALSE,
  order_id          UUID REFERENCES orders(id) ON DELETE SET NULL,
  status            VARCHAR(24) NOT NULL,
  error_code        VARCHAR(64),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nextsms_inbound_order_ref
  ON nextsms_inbound_logs (order_ref8, created_at DESC);

CREATE TABLE IF NOT EXISTS sms_delivery_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_event_id     UUID REFERENCES domain_outbox_events(id) ON DELETE SET NULL,
  recipient_phone_e164 VARCHAR(16) NOT NULL,
  message_body        VARCHAR(160) NOT NULL,
  provider            VARCHAR(32) NOT NULL DEFAULT 'NEXTSMS',
  provider_message_id VARCHAR(128),
  status              VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  next_retry_at       TIMESTAMPTZ,
  last_error          TEXT,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_delivery_status_retry
  ON sms_delivery_logs (status, next_retry_at);
