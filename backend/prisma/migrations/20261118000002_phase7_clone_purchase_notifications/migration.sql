-- Phase 7: supplier manual purchasing, supplier admin-receive consent, and
-- durable per-user notification inbox. Additive only; no existing data is rewritten.

ALTER TABLE "business_profiles"
  ADD COLUMN IF NOT EXISTS "allow_admin_receive" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "supplier_purchase_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplier_business_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "global_catalog_id" UUID NOT NULL,
  "global_product_unit_id" UUID,
  "supplier_name" VARCHAR(180) NOT NULL,
  "supplier_reference" VARCHAR(80),
  "receipt_status" VARCHAR(32) NOT NULL DEFAULT 'GOODS_RECEIVED',
  "quantity_units" INTEGER NOT NULL,
  "quarter_quanta_per_unit" INTEGER NOT NULL,
  "received_quanta" INTEGER NOT NULL,
  "agreed_total_cost_tzs" BIGINT NOT NULL,
  "cost_per_quantum_tzs" BIGINT NOT NULL,
  "previous_weighted_avg_cost_per_quantum_tzs" BIGINT NOT NULL DEFAULT 0,
  "new_weighted_avg_cost_per_quantum_tzs" BIGINT NOT NULL DEFAULT 0,
  "recorded_by_user_id" UUID NOT NULL,
  "received_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "supplier_purchase_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_supplier_purchase_receipts_biz_time"
  ON "supplier_purchase_receipts" ("supplier_business_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_supplier_purchase_receipts_product_time"
  ON "supplier_purchase_receipts" ("product_id", "created_at" DESC);

ALTER TABLE "supplier_purchase_receipts"
  ADD CONSTRAINT "supplier_purchase_receipts_supplier_business_id_fkey"
  FOREIGN KEY ("supplier_business_id") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_purchase_receipts"
  ADD CONSTRAINT "supplier_purchase_receipts_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_purchase_receipts"
  ADD CONSTRAINT "supplier_purchase_receipts_global_catalog_id_fkey"
  FOREIGN KEY ("global_catalog_id") REFERENCES "soko_global_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_purchase_receipts"
  ADD CONSTRAINT "supplier_purchase_receipts_global_product_unit_id_fkey"
  FOREIGN KEY ("global_product_unit_id") REFERENCES "global_product_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_purchase_receipts"
  ADD CONSTRAINT "supplier_purchase_receipts_recorded_by_user_id_fkey"
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "business_id" UUID,
  "role" "user_role" NOT NULL,
  "event_type" VARCHAR(100) NOT NULL,
  "category" VARCHAR(64) NOT NULL DEFAULT 'STANDARD_UPDATE',
  "title" VARCHAR(180) NOT NULL,
  "body" VARCHAR(600) NOT NULL,
  "deep_link" VARCHAR(255),
  "metadata" JSONB,
  "dedupe_key" VARCHAR(180),
  "is_read" BOOLEAN NOT NULL DEFAULT false,
  "read_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_notification_dedupe"
  ON "user_notifications" ("user_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "idx_user_notification_inbox"
  ON "user_notifications" ("user_id", "is_read", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_user_notification_role_time"
  ON "user_notifications" ("role", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_user_notification_business_time"
  ON "user_notifications" ("business_id", "created_at" DESC);

ALTER TABLE "user_notifications"
  ADD CONSTRAINT "user_notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_notifications"
  ADD CONSTRAINT "user_notifications_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
