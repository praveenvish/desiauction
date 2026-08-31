-- WHAT A SIGN-IN CODE MAY PROVE (PI-1, phase P1; wired in P2).
--
-- HAND-AUTHORED, like 0019-0036.
--
-- `otp_codes` served two flows with one namespace: sign-in, and the
-- phone-change confirmation to a NEW number. The reuse was deliberate and
-- commented (phone-change.ts) — but it means a code minted because somebody
-- tapped "send code" on the login page is structurally able to confirm a
-- number change, and vice versa, for the same phone. Two purposes, one proof.
--
-- This column ends that: a code is minted FOR a purpose and consumable for
-- that purpose alone. The default is 'login' because that is what every
-- existing row was in fact minted for — no backfill has anything to correct.
--
-- Purposes stay phone-shaped on purpose. Email codes live in
-- `email_verifications` (0025), whose own header explains why two small tables
-- that each say what they are beat one that does not.
--
-- THE VERIFY PATH GAINS ONE PREDICATE and nothing else changes: TTL, attempt
-- caps, cooldown, hourly ceilings and the no-enumeration response shape are
-- untouched, and the protecting suites (auth.integration, security.regression)
-- must pass UNMODIFIED over this change (PI-1 04 §1).

ALTER TABLE "otp_codes"
  ADD COLUMN "purpose" text NOT NULL DEFAULT 'login';--> statement-breakpoint

ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_purpose_check"
  CHECK ("purpose" IN ('login', 'phone_change'));--> statement-breakpoint

-- ADDITIVE AND BACKWARDS COMPATIBLE: the previous build's inserts take the
-- default and its verify path ignores the column entirely. No new GRANT —
-- adding a column changes no table-level privilege (the 0034 precedent).
COMMENT ON COLUMN "otp_codes"."purpose" IS
  'What this code may prove: login | phone_change. Minted for one purpose, consumable for that purpose alone (PI-1).';
