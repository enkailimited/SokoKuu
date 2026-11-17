-- ==============================================================================
-- SokoKuu TZ — Phase 3 Centralized Product Units, Versioned Standard Pricing,
-- Tenant-Isolated Merchant Overrides & Purchase-Driven Costing Engine
-- ==============================================================================

DO $$ BEGIN
  CREATE TYPE system_unit_category AS ENUM ('WEIGHT', 'VOLUME', 'PACKAGING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE standard_pricing_profile_type AS ENUM ('RETAIL', 'WHOLESALE', 'REGIONAL', 'PROMOTIONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS system_units (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_code           VARCHAR(32) NOT NULL UNIQUE,
  category            system_unit_category NOT NULL,
  name_sw             VARCHAR(80) NOT NULL,
  name_en             VARCHAR(80) NOT NULL,
  abbreviation        VARCHAR(16) NOT NULL,
  allow_fractional    BOOLEAN NOT NULL DEFAULT FALSE,
  base_reference_code VARCHAR(32),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_product_units (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_catalog_id       UUID NOT NULL REFERENCES soko_global_catalog(id) ON DELETE CASCADE,
  system_unit_id          UUID NOT NULL REFERENCES system_units(id) ON DELETE RESTRICT,
  quarter_quanta_per_unit INTEGER NOT NULL CHECK (quarter_quanta_per_unit > 0),
  display_label_sw        VARCHAR(100),
  display_label_en        VARCHAR(100),
  is_wholesale_unit       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_global_product_system_unit UNIQUE (global_catalog_id, system_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_global_product_units_catalog
  ON global_product_units (global_catalog_id, is_active);

CREATE TABLE IF NOT EXISTS standard_pricing_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_code        VARCHAR(48) NOT NULL UNIQUE,
  profile_type        standard_pricing_profile_type NOT NULL,
  name_sw             VARCHAR(120) NOT NULL,
  name_en             VARCHAR(120) NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  currency            VARCHAR(8) NOT NULL DEFAULT 'TZS',
  effective_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to        TIMESTAMPTZ,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_catalog_standard_prices (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_catalog_id      UUID NOT NULL REFERENCES soko_global_catalog(id) ON DELETE CASCADE,
  global_product_unit_id UUID NOT NULL REFERENCES global_product_units(id) ON DELETE CASCADE,
  pricing_profile_id     UUID NOT NULL REFERENCES standard_pricing_profiles(id) ON DELETE RESTRICT,
  profile_type           standard_pricing_profile_type NOT NULL,
  version                INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  min_qty                INTEGER NOT NULL DEFAULT 1 CHECK (min_qty >= 1),
  max_qty                INTEGER CHECK (max_qty IS NULL OR max_qty >= min_qty),
  standard_price_tzs     BIGINT NOT NULL CHECK (standard_price_tzs > 0),
  currency               VARCHAR(8) NOT NULL DEFAULT 'TZS',
  effective_from         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to           TIMESTAMPTZ,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_admin_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_standard_prices_lookup
  ON global_catalog_standard_prices (global_catalog_id, global_product_unit_id, profile_type, is_active, version);

ALTER TABLE merchant_cloned_products
  ADD COLUMN IF NOT EXISTS inventory_value_tzs BIGINT NOT NULL DEFAULT 0 CHECK (inventory_value_tzs >= 0),
  ADD COLUMN IF NOT EXISTS last_buying_price_per_quantum_tzs BIGINT NOT NULL DEFAULT 0 CHECK (last_buying_price_per_quantum_tzs >= 0),
  ADD COLUMN IF NOT EXISTS weighted_avg_buying_cost_per_quantum_tzs BIGINT NOT NULL DEFAULT 0 CHECK (weighted_avg_buying_cost_per_quantum_tzs >= 0),
  ADD COLUMN IF NOT EXISTS buying_price_established BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_agreed_purchase_price_tzs BIGINT CHECK (last_agreed_purchase_price_tzs IS NULL OR last_agreed_purchase_price_tzs >= 0);

CREATE TABLE IF NOT EXISTS merchant_unit_pricing_overrides (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cloned_product_id          UUID NOT NULL REFERENCES merchant_cloned_products(id) ON DELETE CASCADE,
  business_id                UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  global_product_unit_id     UUID NOT NULL REFERENCES global_product_units(id) ON DELETE RESTRICT,
  standard_price_id          UUID REFERENCES global_catalog_standard_prices(id) ON DELETE SET NULL,
  standard_price_version     INTEGER,
  selected_standard_price_tzs BIGINT CHECK (selected_standard_price_tzs IS NULL OR selected_standard_price_tzs > 0),
  amended_selling_price_tzs  BIGINT CHECK (amended_selling_price_tzs IS NULL OR amended_selling_price_tzs > 0),
  effective_selling_price_tzs BIGINT NOT NULL CHECK (effective_selling_price_tzs > 0),
  is_overridden              BOOLEAN NOT NULL DEFAULT FALSE,
  is_active                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_merchant_cloned_unit_override UNIQUE (cloned_product_id, global_product_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_merchant_unit_overrides_business
  ON merchant_unit_pricing_overrides (business_id, is_active);

CREATE TABLE IF NOT EXISTS merchant_price_audit_logs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  cloned_product_id      UUID NOT NULL REFERENCES merchant_cloned_products(id) ON DELETE CASCADE,
  global_product_unit_id UUID NOT NULL,
  actor_user_id          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action                 VARCHAR(32) NOT NULL,
  previous_price_tzs     BIGINT,
  new_price_tzs          BIGINT NOT NULL,
  standard_price_id      UUID,
  standard_price_version INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchant_price_audit_biz_time
  ON merchant_price_audit_logs (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS external_purchase_receipts (
  id                                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id                           UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  cloned_product_id                     UUID NOT NULL REFERENCES merchant_cloned_products(id) ON DELETE CASCADE,
  global_product_unit_id                UUID REFERENCES global_product_units(id) ON DELETE SET NULL,
  supplier_name                         VARCHAR(180) NOT NULL,
  supplier_reference                    VARCHAR(80),
  receipt_status                        VARCHAR(32) NOT NULL DEFAULT 'GOODS_RECEIVED',
  quantity_units                        INTEGER NOT NULL CHECK (quantity_units > 0),
  quarter_quanta_per_unit               INTEGER NOT NULL CHECK (quarter_quanta_per_unit > 0),
  received_quanta                       INTEGER NOT NULL CHECK (received_quanta > 0),
  agreed_total_cost_tzs                 BIGINT NOT NULL CHECK (agreed_total_cost_tzs > 0),
  cost_per_quantum_tzs                  BIGINT NOT NULL CHECK (cost_per_quantum_tzs >= 0),
  prev_weighted_avg_cost_per_quantum_tzs BIGINT NOT NULL DEFAULT 0,
  new_weighted_avg_cost_per_quantum_tzs  BIGINT NOT NULL DEFAULT 0,
  recorded_by_user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  received_at                           TIMESTAMPTZ,
  created_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_purchase_receipts_biz_time
  ON external_purchase_receipts (business_id, created_at DESC);
