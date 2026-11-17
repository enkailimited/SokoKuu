-- ==============================================================================
-- SokoKuu TZ — Phase 2 Extensions Migration
-- Adds global_catalog_id link, low_stock_threshold_quanta, merchant_custom_units,
-- and security_audit_logs for refresh reuse detection & brute-force tracking.
-- ==============================================================================

ALTER TABLE merchant_cloned_products
  ADD COLUMN IF NOT EXISTS low_stock_threshold_quanta INTEGER NOT NULL DEFAULT 20;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS global_catalog_id UUID REFERENCES soko_global_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_global_catalog
  ON products (seller_business_id, global_catalog_id)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS merchant_custom_units (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_code               VARCHAR(32) NOT NULL,
  unit_label              VARCHAR(64) NOT NULL,
  base_kg                 NUMERIC(8, 2) NOT NULL CHECK (base_kg > 0),
  quarter_quanta_per_unit INTEGER NOT NULL CHECK (quarter_quanta_per_unit >= 1),
  price_tzs               BIGINT NOT NULL CHECK (price_tzs > 0),
  is_wholesale_tier       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_product_custom_unit_code UNIQUE (product_id, unit_code)
);

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type  VARCHAR(64) NOT NULL,
  ip_address  VARCHAR(64),
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_user_time
  ON security_audit_logs (user_id, created_at DESC);
