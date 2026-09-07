-- SPLIT THE PERSON FROM THE PLAYER (SP-1 Phase 3).
--
-- `player_profiles` has been carrying two different kinds of fact in one row:
--
--   about a PERSON  — gender, date of birth, location, preferred jersey
--   about a PLAYER  — default role, batting style, bowling style
--
-- The first set is true of somebody whatever they play. The second is true of
-- them IN A SPORT, and the table could only ever hold one answer — so a person
-- who is an all-rounder at cricket and a goalkeeper at football had no way to
-- say so. That was invisible while the platform ran one sport. Phase 2 shipped
-- football, and it stopped being invisible.
--
-- KEYED BY (person_id, sport), WITH NO SURROGATE ID. The row IS that pair:
-- there is exactly one profile per person per sport, the natural key says so,
-- and a generated id would add a second way to name the same thing. It also
-- keeps the backfill below honest — a ULID cannot be minted in SQL, and a
-- 26-character string that merely LOOKS like one is worse than no id at all.

CREATE TABLE "player_sport_profiles" (
  "person_id" char(26) NOT NULL REFERENCES "people"("id") ON DELETE CASCADE,
  "sport" text NOT NULL REFERENCES "sports"("key"),
  /**
   * Validated against the SPORT'S pack, never a column-level list — the legal
   * values are football's or cricket's depending on which row this is.
   */
  "default_role" text,
  /** The pack's own attribute keys: batting_style, bowling_style, preferred_foot. */
  "attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("person_id", "sport")
);--> statement-breakpoint

-- Every player fact that exists today is a CRICKET fact — there has never been
-- another sport to state one in. Only people who actually said something get a
-- row: a profile that never named a role, a batting style or a bowling style is
-- a person who has not told us how they play, and inventing an empty cricket
-- profile for them would turn "never asked" into "plays cricket, said nothing".
INSERT INTO "player_sport_profiles" ("person_id", "sport", "default_role", "attributes")
SELECT
  "person_id",
  'cricket',
  "default_role",
  jsonb_strip_nulls(jsonb_build_object(
    'batting_style', "default_batting_style",
    'bowling_style', "default_bowling_style"
  ))
FROM "player_profiles"
WHERE "default_role" IS NOT NULL
   OR "default_batting_style" IS NOT NULL
   OR "default_bowling_style" IS NOT NULL;--> statement-breakpoint

-- Dropped, not deprecated. A column nothing writes disagrees with the truth
-- beside it the first time somebody edits their profile, and then two screens
-- show different roles for the same person. The data is above; the reverse SQL
-- is in docs/product/SP-1/PHASE-3_REPORT.md.
ALTER TABLE "player_profiles"
  DROP COLUMN "default_role",
  DROP COLUMN "default_batting_style",
  DROP COLUMN "default_bowling_style";
