-- BATTLE ROYALE ON THE DEMAND FORM.
--
-- `demo_requests.sport` is CHECK-constrained to the list the form offers, so a
-- new sport is two edits or none: the constraint here, and `DEMO_SPORTS` in
-- apps/web. A test holds every RUNNABLE sport to being sayable on the form, and
-- battle_royale became runnable in 0059.
ALTER TABLE "demo_requests" DROP CONSTRAINT "demo_requests_sport_check";
--> statement-breakpoint
ALTER TABLE "demo_requests" ADD CONSTRAINT "demo_requests_sport_check"
  CHECK ("sport" IS NULL OR "sport" IN (
    'cricket', 'box_cricket', 'football', 'kabaddi', 'volleyball', 'badminton',
    'basketball', 'hockey', 'table_tennis', 'pickleball', 'esports',
    'battle_royale', 'other'
  ));
