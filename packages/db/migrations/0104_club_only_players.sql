-- CLUB-ONLY PLAYERS (2026-10-04). A player a club knows by name alone.
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- A club's master sheet is often a list of names: BPL4's had 156, and 106 of
-- them carried a made-up number (9000000001…) only because the import refused a
-- row without one. A phone here is an IDENTITY, not a contact detail — every
-- imported number became a platform-wide person that whoever really owns it
-- could sign in as, that another club's filler would merge with, and that the
-- SMS outbox would text. So a player with no real number is now a person with
-- no phone and no email, owned by the club that added them:
--
--   * nobody can sign in as them (no phone, no email to prove),
--   * nothing is ever sent to them (the outbox already suppresses a null phone),
--   * no other club's file or account can ever match them.
--
-- `club_org_id` is that ownership, and the reachability rule from 0062/0066
-- admits it as one more state. The converse CHECK is what keeps the marker
-- honest: a club-only row holds no credential, so giving one a real number
-- must clear the marker in the same write — it is then an ordinary person.
--
-- CASCADE: the club's own players go with the club. Anything else pointing at
-- the row (a registration, a sale) is RESTRICT, as for every other person.
ALTER TABLE "people" ADD COLUMN "club_org_id" char(26) REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "people" DROP CONSTRAINT "people_reachable_check";
--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_reachable_check"
  CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL OR "erased_at" IS NOT NULL OR "club_org_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_club_only_uncontactable_check"
  CHECK ("club_org_id" IS NULL OR ("phone" IS NULL AND "email" IS NULL));
--> statement-breakpoint
CREATE INDEX "people_club_org_idx" ON "people" ("club_org_id") WHERE "club_org_id" IS NOT NULL;
