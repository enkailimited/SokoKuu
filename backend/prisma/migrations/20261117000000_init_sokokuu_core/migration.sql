-- ==============================================================================
-- SokoKuu TZ — Initial Core Schema Migration (PostgreSQL 16 + PostGIS 3.4)
-- Faithful to V1–V10 architecture in src/data/blueprints.ts + Phase 1 foundation
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ------------------------------------------------------------------------------
-- 1. Domain Enums
-- ------------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'WHOLESALER', 'RETAILER', 'CONSUMER', 'DRIVER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE business_tier AS ENUM ('WHOLESALE', 'RETAIL_DUKA', 'HYBRID_STORE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE packaging_unit AS ENUM (
    'CARTON',
    'DOZEN',
    'PACK',
    'UNIT',
    'SACK_50KG',
    'SACK_25KG',
    'QUARTER_KILO_LITRE',
    'HALF_KILO_LITRE',
    'THREE_QUARTER_KILO',
    'SINGLE_KILO_LITRE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('PLACED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'DISPUTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_origin AS ENUM ('PWA_ONLINE', 'PWA_IDB_SYNC', 'NEXTSMS_INBOUND', 'POS_WALKIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_verification_status AS ENUM (
    'PENDING',
    'WAITING',
    'BUYER_CONFIRMED',
    'DRIVER_CONFIRMED',
    'SUCCESSFUL',
    'DISPUTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM ('PROSPECT', 'CONVERTED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE outbox_status AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------------------
-- 2. Users & Rotating Refresh Sessions
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164       VARCHAR(16) NOT NULL UNIQUE,
  full_name        VARCHAR(150) NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,
  role             user_role NOT NULL,
  preferred_locale VARCHAR(5) NOT NULL DEFAULT 'sw',
  sms_hmac_secret  VARCHAR(128) NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  version          BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_tz_phone CHECK (phone_e164 ~ '^\+255[67][0-9]{8}$'),
  CONSTRAINT chk_locale CHECK (preferred_locale IN ('sw', 'en'))
);

CREATE INDEX IF NOT EXISTS idx_users_role_active ON users (role, is_active);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   UUID NOT NULL,
  token_hash  VARCHAR(128) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user_family ON refresh_sessions (user_id, family_id);

-- ------------------------------------------------------------------------------
-- 3. Multi-Tenant Merchants (business_profiles) & Branches (PostGIS GIST)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS business_profiles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sms_short_code         VARCHAR(10) NOT NULL UNIQUE,
  business_name          VARCHAR(180) NOT NULL,
  tier                   business_tier NOT NULL,
  street_address         TEXT NOT NULL,
  ward                   VARCHAR(100) NOT NULL,
  district               VARCHAR(100) NOT NULL,
  latitude               NUMERIC(9, 6) NOT NULL,
  longitude              NUMERIC(9, 6) NOT NULL,
  location               GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
                           ST_SetSRID(ST_MakePoint(longitude::DOUBLE PRECISION, latitude::DOUBLE PRECISION), 4326)::GEOGRAPHY
                         ) STORED,
  logo_cdn_url           TEXT,
  is_open                BOOLEAN NOT NULL DEFAULT TRUE,
  is_platform_managed    BOOLEAN NOT NULL DEFAULT TRUE,
  geospatial_map_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  version                BIGINT NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_tz_lat CHECK (latitude BETWEEN -11.75 AND -0.95),
  CONSTRAINT chk_tz_lng CHECK (longitude BETWEEN 29.30 AND 40.50),
  CONSTRAINT chk_short_code_fmt CHECK (sms_short_code ~ '^[A-Z0-9]{2,10}$')
);

CREATE INDEX IF NOT EXISTS idx_business_location_gist ON business_profiles USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_business_open_location_gist ON business_profiles USING GIST (location) WHERE is_open = TRUE;
CREATE INDEX IF NOT EXISTS idx_business_lat_lng_bbox ON business_profiles (latitude, longitude) WHERE is_open = TRUE;
CREATE INDEX IF NOT EXISTS idx_business_platform_managed ON business_profiles (id, is_platform_managed) WHERE is_open = TRUE;

CREATE TABLE IF NOT EXISTS business_branches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  branch_code    VARCHAR(24) NOT NULL,
  branch_name    VARCHAR(160) NOT NULL,
  street_address TEXT NOT NULL,
  ward           VARCHAR(100) NOT NULL,
  district       VARCHAR(100) NOT NULL,
  latitude       NUMERIC(9, 6) NOT NULL,
  longitude      NUMERIC(9, 6) NOT NULL,
  location       GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
                   ST_SetSRID(ST_MakePoint(longitude::DOUBLE PRECISION, latitude::DOUBLE PRECISION), 4326)::GEOGRAPHY
                 ) STORED,
  is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  version        BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_business_branch_code UNIQUE (business_id, branch_code),
  CONSTRAINT chk_branch_tz_lat CHECK (latitude BETWEEN -11.75 AND -0.95),
  CONSTRAINT chk_branch_tz_lng CHECK (longitude BETWEEN 29.30 AND 40.50)
);

CREATE INDEX IF NOT EXISTS idx_business_branches_active ON business_branches (business_id, is_active);
CREATE INDEX IF NOT EXISTS idx_business_branches_location_gist ON business_branches USING GIST (location) WHERE is_active = TRUE;

-- ------------------------------------------------------------------------------
-- 4. Global Master Catalog, Categories & Merchant Shelf Clones (Base-Zero)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS soko_catalog_categories (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code        VARCHAR(64) NOT NULL UNIQUE,
  name_sw              VARCHAR(120) NOT NULL,
  name_en              VARCHAR(120) NOT NULL,
  imagekit_folder_path VARCHAR(200) NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS soko_global_catalog (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_sku          VARCHAR(32) NOT NULL UNIQUE,
  fixed_name_sw          VARCHAR(200) NOT NULL,
  fixed_name_en          VARCHAR(200) NOT NULL,
  category_code          VARCHAR(64) NOT NULL,
  static_image_url       TEXT NOT NULL,
  imagekit_cdn_url       TEXT NOT NULL,
  base_quantum_unit      VARCHAR(32) NOT NULL DEFAULT 'QUANTA_250G',
  cloned_by_stores_count BIGINT NOT NULL DEFAULT 0,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_static_image_url CHECK (static_image_url <> ''),
  CONSTRAINT chk_cloned_by_stores_non_negative CHECK (cloned_by_stores_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_global_catalog_active
  ON soko_global_catalog (category_code, is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_global_catalog_adoption_velocity
  ON soko_global_catalog (cloned_by_stores_count DESC, category_code) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS merchant_cloned_products (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_business_id   UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
  global_catalog_id      UUID NOT NULL REFERENCES soko_global_catalog(id) ON DELETE RESTRICT,
  available_quanta_stock INTEGER NOT NULL DEFAULT 0,
  unit_price_tzs         BIGINT NOT NULL DEFAULT 0,
  imagekit_cdn_url       TEXT NOT NULL DEFAULT '',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_merchant_global_clone UNIQUE (retailer_business_id, global_catalog_id),
  CONSTRAINT chk_cloned_non_negative_stock CHECK (available_quanta_stock >= 0),
  CONSTRAINT chk_cloned_non_negative_price CHECK (unit_price_tzs >= 0)
);

-- ------------------------------------------------------------------------------
-- 5. Products, Volume Price Tiers & Bulk Deconstruction Logs
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS products (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_business_id           UUID NOT NULL REFERENCES business_profiles(id) ON DELETE RESTRICT,
  sms_item_code                VARCHAR(8) NOT NULL,
  name_en                      VARCHAR(200) NOT NULL,
  name_sw                      VARCHAR(200) NOT NULL,
  carton_units                 INTEGER NOT NULL DEFAULT 24,
  carton_price_tzs             BIGINT NOT NULL,
  dozen_price_tzs              BIGINT NOT NULL,
  pack_price_tzs               BIGINT NOT NULL,
  unit_price_tzs               BIGINT NOT NULL,
  base_unit_stock              INTEGER NOT NULL DEFAULT 0,
  base_quarter_quanta_stock    INTEGER NOT NULL DEFAULT 0,
  sealed_bulk_packages_stock   INTEGER NOT NULL DEFAULT 0,
  sealed_parent_unit_type      packaging_unit NOT NULL DEFAULT 'SACK_50KG',
  quanta_per_sealed_package    INTEGER NOT NULL DEFAULT 200,
  wholesale_min_units_threshold INTEGER NOT NULL DEFAULT 1,
  wholesale_min_weight_kg      NUMERIC(8, 2) NOT NULL DEFAULT 1.00,
  wholesale_min_quarter_quanta INTEGER GENERATED ALWAYS AS (
                                 GREATEST(1, ROUND(wholesale_min_weight_kg * 4)::INTEGER)
                               ) STORED,
  low_stock_threshold_quanta   INTEGER NOT NULL DEFAULT 20,
  is_active                    BOOLEAN NOT NULL DEFAULT TRUE,
  version                      BIGINT NOT NULL DEFAULT 0,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_seller_sms_item UNIQUE (seller_business_id, sms_item_code),
  CONSTRAINT chk_stock_non_neg CHECK (base_unit_stock >= 0),
  CONSTRAINT chk_quarter_quanta_non_neg CHECK (base_quarter_quanta_stock >= 0),
  CONSTRAINT chk_sealed_bulk_non_neg CHECK (sealed_bulk_packages_stock >= 0),
  CONSTRAINT chk_quanta_per_pkg_pos CHECK (quanta_per_sealed_package >= 1),
  CONSTRAINT chk_wholesale_thresholds_pos CHECK (wholesale_min_units_threshold >= 1 AND wholesale_min_weight_kg > 0),
  CONSTRAINT chk_prices_pos CHECK (
    carton_price_tzs > 0 AND dozen_price_tzs > 0 AND pack_price_tzs > 0 AND unit_price_tzs > 0
  )
);

CREATE TABLE IF NOT EXISTS product_price_tiers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_type               packaging_unit NOT NULL,
  quarter_quanta_per_unit INTEGER NOT NULL,
  price_tzs               BIGINT NOT NULL,
  is_wholesale_tier       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_product_unit_wholesale_flag UNIQUE (product_id, unit_type, is_wholesale_tier),
  CONSTRAINT chk_tier_quanta_pos CHECK (quarter_quanta_per_unit >= 1),
  CONSTRAINT chk_tier_price_tzs_pos CHECK (price_tzs > 0)
);

CREATE INDEX IF NOT EXISTS idx_price_tiers_lookup
  ON product_price_tiers (product_id, unit_type, is_wholesale_tier) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS inventory_deconstruction_logs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  parent_unit_type        packaging_unit NOT NULL,
  bulk_packages_broken    INTEGER NOT NULL CHECK (bulk_packages_broken >= 1),
  credited_quarter_quanta INTEGER NOT NULL CHECK (credited_quarter_quanta >= 1),
  loose_quanta_before     INTEGER NOT NULL,
  loose_quanta_after      INTEGER NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deconstruction_product_time
  ON inventory_deconstruction_logs (product_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 6. Orders, Order Items, Cash Delivery Ledgers & Dispatch Audit Traces
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS orders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref               CHAR(8) NOT NULL UNIQUE,
  buyer_user_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_business_id      UUID NOT NULL REFERENCES business_profiles(id) ON DELETE RESTRICT,
  driver_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  status                  order_status NOT NULL DEFAULT 'PLACED',
  origin_channel          order_origin NOT NULL DEFAULT 'PWA_ONLINE',
  routing_target_pipeline VARCHAR(64) NOT NULL DEFAULT 'SUPER_ADMIN_HELPDESK_PIPELINE',
  raw_sms_payload         VARCHAR(160),
  expected_total_tzs      BIGINT NOT NULL,
  delivery_fee_tzs        BIGINT NOT NULL DEFAULT 0,
  version                 BIGINT NOT NULL DEFAULT 0,
  placed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at           TIMESTAMPTZ,
  delivered_at            TIMESTAMPTZ,
  CONSTRAINT chk_order_ref_fmt CHECK (order_ref ~ '^[A-Z0-9]{8}$'),
  CONSTRAINT chk_expected_total CHECK (expected_total_tzs >= 0 AND delivery_fee_tzs >= 0)
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer_status ON orders (buyer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_seller_status ON orders (seller_business_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_driver_active ON orders (driver_user_id, status) WHERE driver_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  unit_type        packaging_unit NOT NULL,
  quantity         INTEGER NOT NULL,
  base_units_total INTEGER NOT NULL,
  unit_price_tzs   BIGINT NOT NULL,
  line_total_tzs   BIGINT NOT NULL,
  CONSTRAINT chk_oi_qty CHECK (quantity >= 1 AND base_units_total >= quantity),
  CONSTRAINT chk_oi_total CHECK (line_total_tzs = quantity * unit_price_tzs)
);

CREATE TABLE IF NOT EXISTS cash_delivery_ledgers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  driver_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  one_time_qr_token       VARCHAR(255) UNIQUE,
  is_qr_token_consumed    BOOLEAN NOT NULL DEFAULT FALSE,
  buyer_confirmation_pin  VARCHAR(128) NOT NULL,
  driver_confirmation_pin VARCHAR(128) NOT NULL,
  is_buyer_confirmed      BOOLEAN NOT NULL DEFAULT FALSE,
  is_driver_confirmed     BOOLEAN NOT NULL DEFAULT FALSE,
  expected_cash_amount    BIGINT NOT NULL,
  collected_cash_amount   BIGINT NOT NULL DEFAULT 0,
  verification_status     ledger_verification_status NOT NULL DEFAULT 'WAITING',
  buyer_confirmed_at      TIMESTAMPTZ,
  driver_confirmed_at     TIMESTAMPTZ,
  reconciled_at           TIMESTAMPTZ,
  version                 BIGINT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ledger_amounts CHECK (expected_cash_amount >= 0 AND collected_cash_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_ledger_status ON cash_delivery_ledgers (verification_status);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_qr ON cash_delivery_ledgers (one_time_qr_token) WHERE is_qr_token_consumed = FALSE;

CREATE TABLE IF NOT EXISTS order_dispatch_audit_traces (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_ref8                   VARCHAR(16) NOT NULL,
  seller_business_id           UUID NOT NULL REFERENCES business_profiles(id) ON DELETE RESTRICT,
  is_platform_managed_snapshot BOOLEAN NOT NULL,
  routing_output_code          VARCHAR(64) NOT NULL,
  target_pipeline              VARCHAR(64) NOT NULL,
  tx_isolation_level           VARCHAR(32) NOT NULL DEFAULT 'REPEATABLE_READ',
  recorded_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_valid_routing_code CHECK (
    routing_output_code IN ('ROUTED_PLATFORM_MANAGED_HELPDESK', 'ROUTED_DIRECT_MERCHANT_DB')
  )
);

CREATE INDEX IF NOT EXISTS idx_audit_traces_seller_time ON order_dispatch_audit_traces (seller_business_id, recorded_at DESC);

-- ------------------------------------------------------------------------------
-- 7. Field Sales Leads, Web Push, Idempotency Keys & Transactional Outbox
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS soko_leads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name             VARCHAR(180) NOT NULL,
  owner_name            VARCHAR(150) NOT NULL,
  owner_phone_e164      VARCHAR(16) NOT NULL UNIQUE,
  ward_name             VARCHAR(140) NOT NULL,
  business_tier         business_tier NOT NULL,
  latitude              DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90.0 AND 90.0),
  longitude             DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180.0 AND 180.0),
  gps_accuracy_meters   INTEGER NOT NULL DEFAULT 10,
  location              GEOGRAPHY(Point, 4326) NOT NULL,
  status                lead_status NOT NULL DEFAULT 'PROSPECT',
  version               BIGINT NOT NULL DEFAULT 1,
  captured_by_agent_id  UUID NOT NULL,
  converted_business_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
  converted_by_admin_id UUID,
  converted_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_lead_tz_phone CHECK (owner_phone_e164 ~ '^\+255[67][0-9]{8}$'),
  CONSTRAINT chk_lead_tier CHECK (business_tier IN ('RETAIL_DUKA', 'WHOLESALE', 'HYBRID_STORE'))
);

CREATE INDEX IF NOT EXISTS idx_soko_leads_geo_gist ON soko_leads USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_soko_leads_status_version ON soko_leads (id, status, version);

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh_key  VARCHAR(255) NOT NULL,
  auth_secret VARCHAR(255) NOT NULL,
  device_type VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_push_user ON web_push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key     VARCHAR(180) NOT NULL UNIQUE,
  request_hash  VARCHAR(128) NOT NULL,
  response_code INTEGER,
  response_body JSONB,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_keys (expires_at);

CREATE TABLE IF NOT EXISTS domain_outbox_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_id   UUID NOT NULL,
  event_type     VARCHAR(96) NOT NULL,
  routing_key    VARCHAR(128) NOT NULL,
  payload        JSONB NOT NULL,
  correlation_id VARCHAR(64),
  status         outbox_status NOT NULL DEFAULT 'PENDING',
  retry_count    INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_outbox_pending ON domain_outbox_events (status, created_at);

-- ------------------------------------------------------------------------------
-- 8. PostGIS Proximity Function, Channel Harmony Triggers & Bulk-Break Proc
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_businesses_ordered_by_proximity(
  lat                 DOUBLE PRECISION,
  lng                 DOUBLE PRECISION,
  max_distance_meters DOUBLE PRECISION DEFAULT 15000
)
RETURNS TABLE (
  business_id     UUID,
  sms_short_code  VARCHAR(10),
  business_name   VARCHAR(180),
  tier            business_tier,
  ward            VARCHAR(100),
  district        VARCHAR(100),
  latitude        NUMERIC(9, 6),
  longitude       NUMERIC(9, 6),
  distance_meters DOUBLE PRECISION
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH origin AS (
    SELECT ST_SetSRID(ST_MakePoint(lng, lat), 4326)::GEOGRAPHY AS geog
  )
  SELECT
    bp.id AS business_id,
    bp.sms_short_code,
    bp.business_name,
    bp.tier,
    bp.ward,
    bp.district,
    bp.latitude,
    bp.longitude,
    ROUND(ST_Distance(bp.location, o.geog, false)::NUMERIC, 1)::DOUBLE PRECISION AS distance_meters
  FROM business_profiles bp
  CROSS JOIN origin o
  WHERE bp.is_open = TRUE
    AND ST_DWithin(bp.location, o.geog, max_distance_meters, false)
  ORDER BY bp.location <-> o.geog ASC;
$$;

CREATE OR REPLACE FUNCTION validate_tier_packaging_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_seller_tier business_tier;
BEGIN
  SELECT bp.tier
    INTO v_seller_tier
    FROM products p
    JOIN business_profiles bp ON bp.id = p.seller_business_id
   WHERE p.id = NEW.product_id;

  IF v_seller_tier IS NULL THEN
    RAISE EXCEPTION 'Product % lacks a valid merchant profile (business_profile).', NEW.product_id;
  END IF;

  IF v_seller_tier = 'WHOLESALE' AND NEW.unit_type IN (
    'QUARTER_KILO_LITRE',
    'HALF_KILO_LITRE',
    'THREE_QUARTER_KILO',
    'SINGLE_KILO_LITRE',
    'PACK',
    'UNIT'
  ) THEN
    RAISE EXCEPTION
      'CHANNEL_HARMONY_VIOLATION: WHOLESALE cannot price retail fraction (%). Use HYBRID_STORE.',
      NEW.unit_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_seller_tier = 'RETAIL_DUKA' AND NEW.unit_type IN ('SACK_50KG', 'SACK_25KG') THEN
    RAISE EXCEPTION
      'CHANNEL_HARMONY_VIOLATION: RETAIL_DUKA cannot price wholesale bulk unit (%).',
      NEW.unit_type
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_tier_packaging_rules ON product_price_tiers;
CREATE TRIGGER trg_validate_tier_packaging_rules
  BEFORE INSERT OR UPDATE ON product_price_tiers
  FOR EACH ROW
  EXECUTE FUNCTION validate_tier_packaging_rules();

CREATE OR REPLACE FUNCTION enforce_pure_store_pricing_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tier business_tier;
BEGIN
  SELECT bp.tier
    INTO v_tier
    FROM products p
    JOIN business_profiles bp ON bp.id = p.seller_business_id
   WHERE p.id = NEW.product_id;

  IF v_tier = 'WHOLESALE' AND NEW.is_wholesale_tier = FALSE THEN
    RAISE EXCEPTION 'WHOLESALE cannot define retail pricing tiers (is_wholesale_tier = FALSE).'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_tier = 'RETAIL_DUKA' AND NEW.is_wholesale_tier = TRUE THEN
    RAISE EXCEPTION 'RETAIL_DUKA cannot define wholesale pricing tiers (is_wholesale_tier = TRUE).'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_pure_store_pricing ON product_price_tiers;
CREATE TRIGGER trg_enforce_pure_store_pricing
  BEFORE INSERT OR UPDATE ON product_price_tiers
  FOR EACH ROW
  EXECUTE FUNCTION enforce_pure_store_pricing_rules();

CREATE OR REPLACE FUNCTION fn_increment_global_catalog_adoption()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE soko_global_catalog
     SET cloned_by_stores_count = cloned_by_stores_count + 1,
         updated_at = NOW()
   WHERE id = NEW.global_catalog_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_increment_global_catalog_adoption ON merchant_cloned_products;
CREATE TRIGGER trg_increment_global_catalog_adoption
  AFTER INSERT ON merchant_cloned_products
  FOR EACH ROW
  EXECUTE FUNCTION fn_increment_global_catalog_adoption();

CREATE OR REPLACE PROCEDURE auto_break_bulk_package(
  p_product_id      UUID,
  p_required_quanta INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_loose_quanta    INTEGER;
  v_sealed_packages INTEGER;
  v_quanta_per_pkg  INTEGER;
  v_parent_unit     packaging_unit;
  v_before_quanta   INTEGER;
BEGIN
  IF p_required_quanta <= 0 THEN
    RAISE EXCEPTION 'p_required_quanta must be greater than zero: %', p_required_quanta;
  END IF;

  SELECT base_quarter_quanta_stock,
         sealed_bulk_packages_stock,
         quanta_per_sealed_package,
         sealed_parent_unit_type
    INTO v_loose_quanta,
         v_sealed_packages,
         v_quanta_per_pkg,
         v_parent_unit
    FROM products
   WHERE id = p_product_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found.', p_product_id;
  END IF;

  IF v_loose_quanta >= p_required_quanta THEN
    RETURN;
  END IF;

  WHILE v_loose_quanta < p_required_quanta LOOP
    IF v_sealed_packages < 1 THEN
      RAISE EXCEPTION
        'INSUFFICIENT_SEALED_BULK: Loose quanta (%) and sealed bulk (0) insufficient for %.',
        v_loose_quanta, p_required_quanta
        USING ERRCODE = 'P0002';
    END IF;

    v_before_quanta := v_loose_quanta;
    v_sealed_packages := v_sealed_packages - 1;
    v_loose_quanta := v_loose_quanta + v_quanta_per_pkg;

    UPDATE products
       SET sealed_bulk_packages_stock = v_sealed_packages,
           base_quarter_quanta_stock  = v_loose_quanta,
           updated_at                 = NOW()
     WHERE id = p_product_id;

    INSERT INTO inventory_deconstruction_logs (
      product_id,
      parent_unit_type,
      bulk_packages_broken,
      credited_quarter_quanta,
      loose_quanta_before,
      loose_quanta_after
    ) VALUES (
      p_product_id,
      v_parent_unit,
      1,
      v_quanta_per_pkg,
      v_before_quanta,
      v_loose_quanta
    );
  END LOOP;
END;
$$;
