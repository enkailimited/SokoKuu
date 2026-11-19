-- Phase 6: Supplier (Manufacturer / Distributor) module, B2B order channel,
-- supplier delivery policy and append-only warehouse stock ledger.

DO $$
BEGIN
  CREATE TYPE "user_role" AS ENUM (
    'SUPER_ADMIN', 'WHOLESALER', 'RETAILER', 'CONSUMER', 'DRIVER', 'SUPPLIER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'SUPPLIER';

DO $$
BEGIN
  CREATE TYPE "business_tier" AS ENUM (
    'WHOLESALE', 'RETAIL_DUKA', 'HYBRID_STORE', 'MANUFACTURER_SUPPLIER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "business_tier" ADD VALUE IF NOT EXISTS 'MANUFACTURER_SUPPLIER';

DO $$
BEGIN
  CREATE TYPE "order_channel" AS ENUM (
    'RETAIL_MARKETPLACE', 'SUPPLIER_TO_WHOLESALER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "supplier_stock_movement_type" AS ENUM (
    'FACTORY_PRODUCTION', 'WAREHOUSE_STOCK_IN', 'ORDER_RESERVED',
    'ORDER_FINALIZED', 'STOCK_ADJUSTMENT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "business_profiles"
  ADD COLUMN IF NOT EXISTS "is_free_delivery_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "free_delivery_min_order_tzs" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "standard_delivery_fee_tzs" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "delivery_coverage_regions" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "order_channel" "order_channel" NOT NULL DEFAULT 'RETAIL_MARKETPLACE';

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "order_channel" "order_channel" NOT NULL DEFAULT 'RETAIL_MARKETPLACE';

ALTER TABLE "cash_delivery_ledgers"
  ADD COLUMN IF NOT EXISTS "order_channel" "order_channel" NOT NULL DEFAULT 'RETAIL_MARKETPLACE';

CREATE TABLE IF NOT EXISTS "supplier_catalog_listings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplier_business_id" UUID NOT NULL,
  "global_catalog_id" UUID NOT NULL,
  "system_unit_id" UUID NOT NULL,
  "supplier_bulk_price_tzs" BIGINT NOT NULL,
  "min_order_quantity" INTEGER NOT NULL DEFAULT 1,
  "is_published_to_market" BOOLEAN NOT NULL DEFAULT TRUE,
  "imagekit_cdn_url" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_supplier_catalog_listings" PRIMARY KEY ("id"),
  CONSTRAINT "fk_supplier_listings_supplier"
    FOREIGN KEY ("supplier_business_id") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_supplier_listings_catalog"
    FOREIGN KEY ("global_catalog_id") REFERENCES "soko_global_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_supplier_listings_unit"
    FOREIGN KEY ("system_unit_id") REFERENCES "system_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "uq_supplier_listing_unit"
    UNIQUE ("supplier_business_id", "global_catalog_id", "system_unit_id")
);

CREATE INDEX IF NOT EXISTS "idx_supplier_listing_market"
  ON "supplier_catalog_listings" ("is_published_to_market", "global_catalog_id");

CREATE TABLE IF NOT EXISTS "supplier_stock_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplier_business_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "global_catalog_id" UUID NOT NULL,
  "movement_type" "supplier_stock_movement_type" NOT NULL,
  "quantity_quanta" INTEGER NOT NULL,
  "reference_type" VARCHAR(32) NOT NULL,
  "reference_id" VARCHAR(80),
  "recorded_by_user_id" UUID,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "pk_supplier_stock_movements" PRIMARY KEY ("id"),
  CONSTRAINT "fk_supplier_stock_movements_supplier"
    FOREIGN KEY ("supplier_business_id") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_supplier_stock_movements_product"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_supplier_stock_movements_catalog"
    FOREIGN KEY ("global_catalog_id") REFERENCES "soko_global_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_supplier_stock_movement_biz_time"
  ON "supplier_stock_movements" ("supplier_business_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_supplier_stock_movement_product_time"
  ON "supplier_stock_movements" ("product_id", "created_at" DESC);

CREATE OR REPLACE FUNCTION "reject_supplier_stock_movement_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'supplier_stock_movements is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_supplier_stock_movements_immutable" ON "supplier_stock_movements";
CREATE TRIGGER "trg_supplier_stock_movements_immutable"
  BEFORE UPDATE OR DELETE ON "supplier_stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "reject_supplier_stock_movement_mutation"();
