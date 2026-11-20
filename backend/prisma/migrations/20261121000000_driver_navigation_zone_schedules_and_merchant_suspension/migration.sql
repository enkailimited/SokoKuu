-- Driver navigation, zone/date schedules, merchant map pinning & suspension governance
-- Incremental migration only; preserves existing schema and historical migrations.

ALTER TABLE "business_profiles"
  ADD COLUMN IF NOT EXISTS "ward_name" VARCHAR(140),
  ADD COLUMN IF NOT EXISTS "street_landmark" VARCHAR(240),
  ADD COLUMN IF NOT EXISTS "route_waypoints" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "account_status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "suspension_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "suspended_by_admin_id" UUID;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "scheduled_delivery_date" DATE,
  ADD COLUMN IF NOT EXISTS "delivery_zone_ward" VARCHAR(140);

CREATE INDEX IF NOT EXISTS "idx_orders_seller_schedule_zone"
  ON "orders" ("seller_business_id", "scheduled_delivery_date", "delivery_zone_ward");

CREATE INDEX IF NOT EXISTS "idx_business_profiles_account_status"
  ON "business_profiles" ("account_status");
