-- THE SECOND SPORT (SP-1 Phase 2).
--
-- Phase 1 gave a competition a sport. This removes the four places the schema
-- still assumed that sport was cricket, and switches football on.
--
-- Every change here is one the second pack FORCED. None of it was designed in
-- advance against a hypothetical sport, which is the entire reason Phase 2 was
-- gated behind naming one.

-- 1 · A ROLE IS NO LONGER FOUR CRICKET VALUES ------------------------------
--
-- `registrations.role` was NOT NULL with a four-value check. Football's roles
-- are different values, so the check has to go; the column is validated against
-- the competition's PACK now, which is the only thing that can know whether
-- "goalkeeper" is a legal answer for this season.
--
-- NULLABLE, because `required` is a per-sport fact the pack declares. Cricket
-- and football both say true and nothing changes for either; pickleball and
-- table tennis have no meaningful playing role, and a column that cannot say
-- "none" would force those sports to invent one. Cheaper to allow the absence
-- now than to migrate a live table later.
ALTER TABLE "registrations" DROP CONSTRAINT IF EXISTS "registrations_role_check";--> statement-breakpoint
ALTER TABLE "registrations" ALTER COLUMN "role" DROP NOT NULL;--> statement-breakpoint

-- 2 · WHERE A SPORT'S OWN PLAYER DETAIL LIVES -------------------------------
--
-- Cricket's `batting_style` and `bowling_style` KEEP their columns. They predate
-- the registry, they have ten consumers plus an import mapper plus a share card,
-- and moving them would spend a data migration on the only sport with real
-- players in it. The pack records that in `AttributeStorage`, so no surface has
-- to care which shape a value came from.
--
-- Everything from here on lands in this bag — football's preferred foot is the
-- first — and adding a sport never again costs a migration.
--
-- NOT NULL DEFAULT '{}': an absent bag and an empty bag are the same fact, and
-- allowing both would make every reader check twice.
ALTER TABLE "registrations" ADD COLUMN "attributes" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint

-- 3 · A SCORELINE IS NOT THREE CRICKET INTEGERS -----------------------------
--
-- `home_runs`, `home_wickets`, `home_balls` and their away triplet can only
-- describe cricket. Football needs one number a side; volleyball needs sets.
-- The shape belongs to the pack, so the column becomes the pack's own keys.
--
-- `outcome`, `winner_team_id`, `method` and `note` are UNTOUCHED — all four were
-- already sport-neutral, which is why this migration is small.
ALTER TABLE "fixture_results" ADD COLUMN "score" jsonb;--> statement-breakpoint

-- Backfill, then drop. `jsonb_strip_nulls` matters: a cricket result that
-- recorded runs but no balls must come out as a scoreline missing `balls`, not
-- as one claiming zero — zero balls is a real number that would corrupt a run
-- rate, and "not recorded" is what the null actually meant.
UPDATE "fixture_results" SET "score" = jsonb_build_object(
  'home', jsonb_strip_nulls(jsonb_build_object(
    'runs', "home_runs", 'wickets', "home_wickets", 'balls', "home_balls")),
  'away', jsonb_strip_nulls(jsonb_build_object(
    'runs', "away_runs", 'wickets', "away_wickets", 'balls', "away_balls"))
);--> statement-breakpoint

-- Dropped rather than left behind. A column nothing writes any more is a column
-- that disagrees with the truth beside it the first time somebody amends a
-- scorecard, and then two screens read different numbers. The data is not lost:
-- it is in `score`, and the reverse SQL is in docs/product/SP-1/PHASE-2_REPORT.md.
ALTER TABLE "fixture_results"
  DROP COLUMN "home_runs",
  DROP COLUMN "home_wickets",
  DROP COLUMN "home_balls",
  DROP COLUMN "away_runs",
  DROP COLUMN "away_wickets",
  DROP COLUMN "away_balls";--> statement-breakpoint

-- 4 · SWITCH FOOTBALL ON ----------------------------------------------------
--
-- The pack ships in packages/core/src/sports/football.ts; this is the flag that
-- makes it selectable. Second in the picker, behind cricket, because sort order
-- is expected volume and not alphabet.
INSERT INTO "sports" ("key", "label", "enabled", "sort_order")
VALUES ('football', 'Football', true, 1);--> statement-breakpoint

-- 5 · THE DEFAULT BECOMES A LIE ---------------------------------------------
--
-- 0046 said this out loud: `DEFAULT 'cricket'` was true while cricket was the
-- only sport, and gets dropped on the day a second one exists. It is that day.
-- A season created without stating its sport is now a NOT NULL violation rather
-- than a silent cricket season — which is exactly what a football organizer
-- would otherwise have got if a form ever failed to post the field.
ALTER TABLE "competitions" ALTER COLUMN "sport" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tournaments" ALTER COLUMN "sport" DROP DEFAULT;
