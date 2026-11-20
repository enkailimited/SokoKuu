-- ==============================================================================
-- Standalone Pricing Templates (peer to Categories and System Units).
-- Reusable Admin-owned price objects attached to Global Catalog products.
-- Existing global_catalog_standard_prices / Merchant overrides are untouched.
-- ==============================================================================

DO $$ BEGIN
  CREATE TYPE pricing_channel AS ENUM ('RETAIL', 'WHOLESALE', 'REGIONAL', 'PROMOTIONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS standard_pricing_templates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name        VARCHAR(120) NOT NULL,
  system_unit_id       UUID NOT NULL REFERENCES system_units(id) ON DELETE RESTRICT,
  pack_item_count      INTEGER NOT NULL DEFAULT 1 CHECK (pack_item_count > 0),
  unit_measure_value   VARCHAR(24) NOT NULL,
  quarter_quanta_total INTEGER NOT NULL CHECK (quarter_quanta_total > 0),
  pricing_channel      pricing_channel NOT NULL,
  standard_price_tzs   BIGINT NOT NULL CHECK (standard_price_tzs > 0),
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_admin_id  UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_standard_pricing_templates_channel
  ON standard_pricing_templates (pricing_channel, is_active);

CREATE TABLE IF NOT EXISTS global_catalog_pricing_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_catalog_id  UUID NOT NULL REFERENCES soko_global_catalog(id) ON DELETE CASCADE,
  template_id        UUID NOT NULL REFERENCES standard_pricing_templates(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_global_catalog_pricing_template UNIQUE (global_catalog_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_gc_pricing_templates_catalog
  ON global_catalog_pricing_templates (global_catalog_id);
