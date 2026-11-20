-- Governance & account controls (incremental, non-destructive).
-- Existing rows stay active; all removals are reversible soft deletes so that
-- historical orders, ledger entries and audit trails remain reproducible.

ALTER TABLE "soko_catalog_categories"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "merchant_cloned_products"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

CREATE INDEX "idx_merchant_clones_business_active"
  ON "merchant_cloned_products"("retailer_business_id", "is_active");
