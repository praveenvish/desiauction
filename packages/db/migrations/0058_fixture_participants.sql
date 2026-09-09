-- A FIXTURE CAN BE A LOBBY (SP-1, battle royale).
--
-- Every sport here has assumed a fixture has exactly two sides: `fixtures`
-- carries `home_team_id` and `away_team_id`, both NOT NULL, and
-- `fixture_results` a scoreline for each. A BGMI or Free Fire match is one
-- LOBBY of up to twenty-five squads with no home, no away and no head-to-head,
-- scored on where each squad finished and how many kills it took. No
-- arrangement of score fields expresses that, because the problem is not the
-- score — it is the two columns.
--
-- The fold that turns a lobby into league points already landed (`foldLobby`,
-- c3efba4). This is the data it folds.
--
-- TWO PARTS, and they are one change: a lobby fixture names no home and no
-- away, so those columns must be nullable, and a CHECK keeps the two shapes
-- from blurring into a third. A fixture with a home and no away is not a lobby
-- and not a duel; it is a bug, and the database refuses it.
CREATE TABLE "fixture_participants" (
  "fixture_id" char(26) NOT NULL,
  "team_id" char(26) NOT NULL,
  -- Denormalized for the tenant policy below and the standings read's index.
  -- Every tenant-scoped table here carries its own org_id for exactly this.
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  -- NULL until the result is recorded: a lobby is scheduled with its squads
  -- long before anybody finishes anywhere. 1 is the win; two squads may share
  -- a placement, so this is not unique.
  "placement" integer,
  -- The squad's own numbers, in the shape the pack declares — `{ "kills": 7 }`.
  -- Same jsonb discipline as fixture_results.score since 0047.
  "score" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fixture_participants_pkey" PRIMARY KEY ("fixture_id", "team_id"),
  -- A placement is a finishing position, not a score. Nought and negatives are
  -- not positions, and a lobby past 100 squads is a typo rather than an event.
  CONSTRAINT "fixture_participants_placement_check"
    CHECK ("placement" IS NULL OR ("placement" >= 1 AND "placement" <= 100))
);--> statement-breakpoint

-- Deleting a fixture takes its lobby with it: the participants ARE the fixture
-- in this shape, and an orphan row would be a squad that played nothing.
-- Deleting a TEAM is refused while it has lobby history, the same rule
-- registrations follow — that history is the league table's evidence.
ALTER TABLE "fixture_participants" ADD CONSTRAINT "fixture_participants_fixture_fk"
  FOREIGN KEY ("fixture_id") REFERENCES "fixtures" ("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fixture_participants" ADD CONSTRAINT "fixture_participants_team_fk"
  FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE RESTRICT;--> statement-breakpoint

-- The standings read walks a whole competition's lobbies at once.
CREATE INDEX "fixture_participants_competition_idx"
  ON "fixture_participants" ("competition_id");--> statement-breakpoint

ALTER TABLE "fixture_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixture_participants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY fixture_participants_tenant ON "fixture_participants"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

-- No new GRANT: `desiauction_app` holds ALTER DEFAULT PRIVILEGES in schema
-- public (ops/db/create-app-role.sql), so a table created by the migration role
-- is reachable the moment it exists. The enumerated least-privilege roles do
-- not read fixtures at all.

-- A LOBBY NAMES NO HOME AND NO AWAY.
ALTER TABLE "fixtures" ALTER COLUMN "home_team_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fixtures" ALTER COLUMN "away_team_id" DROP NOT NULL;--> statement-breakpoint
-- BOTH OR NEITHER. A duel has two sides and a lobby has none; a fixture with a
-- home and no away is neither shape, and every existing row satisfies this
-- because both columns were NOT NULL until this statement ran.
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_sides_check"
  CHECK (("home_team_id" IS NULL) = ("away_team_id" IS NULL));
