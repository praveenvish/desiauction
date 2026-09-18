-- PLATFORM-WIDE SEND CEILINGS (launch polish, security phase 0).
--
-- The per-phone, per-address and per-IP caps stop one target or one source.
-- Nothing stopped the platform as a whole: from rotating addresses, anyone
-- could make it text every Indian mobile ~120 times a day each (SMS pumping,
-- burned DLT sender reputation) and mail any address at the same rate. The
-- ceiling counts every code minted in the last hour, across every phone or
-- address — and both tables only ever grow (no purge), so without an index on
-- created_at that count is a sequential scan that slows with every login.
--
-- Plain CREATE INDEX, not CONCURRENTLY: migrations run in a transaction, and
-- at launch both tables are small. Deploy outside a live auction window.
CREATE INDEX IF NOT EXISTS "otp_codes_created_idx" ON "otp_codes" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_verifications_created_idx" ON "email_verifications" ("created_at");
