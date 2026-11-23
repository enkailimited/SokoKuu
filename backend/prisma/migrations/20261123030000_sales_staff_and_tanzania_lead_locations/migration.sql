-- Sales workspace staff role, all four business tiers for leads, and the
-- official Tanzania region/district/ward/street selection captured on leads.

ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'SALES_STAFF';

-- The original lead table constraint predates the supplier tier and blocks
-- MANUFACTURER_SUPPLIER leads. Recreate it with every supported business tier.
ALTER TABLE "soko_leads" DROP CONSTRAINT IF EXISTS "chk_lead_tier";
ALTER TABLE "soko_leads"
  ADD CONSTRAINT "chk_lead_tier"
  CHECK (business_tier IN ('RETAIL_DUKA', 'WHOLESALE', 'HYBRID_STORE', 'MANUFACTURER_SUPPLIER'));

ALTER TABLE "soko_leads" ADD COLUMN IF NOT EXISTS "country_name" VARCHAR(64) DEFAULT 'Tanzania';
ALTER TABLE "soko_leads" ADD COLUMN IF NOT EXISTS "region_name" VARCHAR(120);
ALTER TABLE "soko_leads" ADD COLUMN IF NOT EXISTS "district_name" VARCHAR(120);
ALTER TABLE "soko_leads" ADD COLUMN IF NOT EXISTS "street_address" VARCHAR(200);
ALTER TABLE "soko_leads" ADD COLUMN IF NOT EXISTS "postcode" VARCHAR(16);

UPDATE "soko_leads" SET "country_name" = 'Tanzania' WHERE "country_name" IS NULL;
