-- Add publish visibility flags on merchant clones and stock source on external purchase receipts
-- Additive only; does not modify earlier migrations.

ALTER TABLE "merchant_cloned_products"
  ADD COLUMN IF NOT EXISTS "is_published_to_market" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_active_for_sale" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "external_purchase_receipts"
  ADD COLUMN IF NOT EXISTS "stock_source" VARCHAR(32) NOT NULL DEFAULT 'EXTERNAL_SUPPLIER';
