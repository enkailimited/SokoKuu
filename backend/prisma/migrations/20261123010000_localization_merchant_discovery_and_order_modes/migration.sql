-- Incremental migration: backend-persisted localization, market publication flags, and INSTANT/SCHEDULED order modes

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_mode') THEN
    CREATE TYPE "order_mode" AS ENUM ('INSTANT', 'SCHEDULED');
  END IF;
END
$$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "preferred_language" VARCHAR(5) NOT NULL DEFAULT 'sw';

UPDATE "users"
   SET "preferred_language" = COALESCE(NULLIF("preferred_locale", ''), 'sw')
 WHERE "preferred_language" IS DISTINCT FROM COALESCE(NULLIF("preferred_locale", ''), 'sw');

ALTER TABLE "business_profiles"
  ADD COLUMN IF NOT EXISTS "account_status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "merchant_cloned_products"
  ADD COLUMN IF NOT EXISTS "is_published_to_market" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "is_published_to_market" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "order_mode" "order_mode" NOT NULL DEFAULT 'INSTANT',
  ADD COLUMN IF NOT EXISTS "scheduled_delivery_date" DATE;

CREATE INDEX IF NOT EXISTS "idx_products_market_catalog"
  ON "products" ("is_active", "is_published_to_market", "global_catalog_id");

CREATE INDEX IF NOT EXISTS "idx_clones_market_catalog"
  ON "merchant_cloned_products" ("is_active", "is_published_to_market", "global_catalog_id");

CREATE INDEX IF NOT EXISTS "idx_business_account_status_open"
  ON "business_profiles" ("account_status", "is_open", "tier");
