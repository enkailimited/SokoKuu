-- Public quote / registration requests can include a free-text note.
ALTER TABLE "soko_leads" ADD COLUMN IF NOT EXISTS "quote_request" TEXT;
