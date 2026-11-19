-- Phase 7 follow-up: supplier warehouse products start at zero stock and zero
-- price until the supplier publishes a listing with an explicit bulk price.
-- Relax the positive-price check to non-negative, matching the existing
-- merchant_cloned_products invariant (chk_cloned_non_negative_price).
-- Constraint-only change; no existing rows are rewritten.

ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "chk_prices_pos";

ALTER TABLE "products"
  ADD CONSTRAINT "chk_prices_pos" CHECK (
    carton_price_tzs >= 0
    AND dozen_price_tzs >= 0
    AND pack_price_tzs >= 0
    AND unit_price_tzs >= 0
  );
