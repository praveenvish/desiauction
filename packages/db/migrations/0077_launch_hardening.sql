-- LAUNCH HARDENING (security review, launch Phase 5). Three fences, each
-- closing a gap the review found in the Phase 2–4 work.
--
-- 1. A PHOTO FOR A TYPED-NAME ENTRY LIVES ON THE ENTRY.
--    A player photo lands on `people`, platform-wide (D7). For an entry whose
--    name the organizer typed (0075), the phone may belong to an account the
--    club has never met: attesting a photo there replaced — or deleted — a
--    stranger's picture and consent everywhere. Refusing instead would tell
--    the organizer the phone has an account, the lookup 0075 closed. So the
--    club's photo, and the club's attestation, stay on the registration.
ALTER TABLE "registrations" ADD COLUMN "entered_photo_key" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "entered_photo_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "entered_photo_consent_via" text;--> statement-breakpoint

-- 2. A SEASON-SCOPED GRANT IS AN AUCTIONEER, NOTHING ELSE.
--    0076's policy admits any capability set on a 'tournament' scope, and
--    canCompetition honours whatever it finds there — one future code path
--    writing org:owner on a season would hand out competition.manage. The
--    auctioneer is the only thing that scope exists for today; say so where
--    no code path can forget it.
ALTER TABLE "grants" ADD CONSTRAINT "grants_tournament_scope_is_conductor"
  CHECK ("scope_type" <> 'tournament' OR "capability_set" = 'auction:conductor');--> statement-breakpoint

-- 3. ONE ACTIVE AUCTIONEER GRANT PER PERSON PER SEASON.
--    assignAuctioneer checks, then inserts: two quick clicks made two grants.
CREATE UNIQUE INDEX IF NOT EXISTS "grants_tournament_active_uq"
  ON "grants" ("person_id", "scope_id", "capability_set")
  WHERE "scope_type" = 'tournament' AND "revoked_at" IS NULL;
