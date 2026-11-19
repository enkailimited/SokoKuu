-- Merchant-controlled free delivery flag surfaced on the marketplace.
ALTER TABLE business_profiles
    ADD COLUMN IF NOT EXISTS offers_free_delivery BOOLEAN NOT NULL DEFAULT FALSE;
