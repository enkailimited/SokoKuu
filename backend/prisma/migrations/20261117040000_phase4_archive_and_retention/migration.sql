-- ==============================================================================
-- SokoKuu TZ — Phase 4 Migration: Idempotency State & Cold Ledger Archival
-- Target: SokoKuu Cloud SQL Database Cluster (PostgreSQL 16 + PostGIS)
-- ==============================================================================

ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS state VARCHAR(24) NOT NULL DEFAULT 'COMPLETED';

CREATE INDEX IF NOT EXISTS idx_idempotency_state_created
  ON idempotency_keys (state, created_at);

CREATE TABLE IF NOT EXISTS cash_delivery_ledgers_archive (
  id                      UUID PRIMARY KEY,
  order_id                UUID NOT NULL UNIQUE,
  driver_user_id          UUID,
  one_time_qr_token       VARCHAR(255),
  qr_token_expires_at     TIMESTAMPTZ(6),
  qr_token_signature      VARCHAR(128),
  is_qr_token_consumed    BOOLEAN NOT NULL DEFAULT FALSE,
  buyer_confirmation_pin  VARCHAR(128) NOT NULL,
  driver_confirmation_pin VARCHAR(128) NOT NULL,
  is_buyer_confirmed      BOOLEAN NOT NULL DEFAULT FALSE,
  is_driver_confirmed     BOOLEAN NOT NULL DEFAULT FALSE,
  expected_cash_amount    BIGINT NOT NULL,
  collected_cash_amount   BIGINT NOT NULL DEFAULT 0,
  payment_method          VARCHAR(24) NOT NULL DEFAULT 'CASH',
  mobile_money_ref        VARCHAR(64),
  mobile_money_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status     ledger_verification_status NOT NULL,
  buyer_confirmed_at      TIMESTAMPTZ(6),
  driver_confirmed_at     TIMESTAMPTZ(6),
  reconciled_at           TIMESTAMPTZ(6),
  eod_settled_at          TIMESTAMPTZ(6),
  eod_settlement_batch_id UUID,
  version                 BIGINT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ(6) NOT NULL,
  updated_at              TIMESTAMPTZ(6) NOT NULL,
  archived_at             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_archive_driver_reconciled
  ON cash_delivery_ledgers_archive (driver_user_id, reconciled_at);
