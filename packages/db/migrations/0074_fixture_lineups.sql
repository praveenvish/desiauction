-- WHO PLAYED EACH MATCH (launch polish, Phase 3).
--
-- Results were recorded per TEAM (fixture_results, fixture_participants), so a
-- player's profile could say which seasons they entered but never which
-- matches they played. The founder asked for exactly that: every tournament,
-- every match, every sport. This is the missing fact — the playing lineup.
--
-- Semantics, fixed here so no reader has to guess:
--   · a row          = this registration took the field in this fixture;
--   · team recorded, registration absent = in the squad, didn't play;
--   · team not recorded at all          = unknown, shown as "not recorded".
--
-- Tenant-scoped like every fixture table (org_id + FORCE RLS). The app role's
-- privileges arrive through create-app-role.sql's DEFAULT PRIVILEGES.
CREATE TABLE "fixture_lineups" (
  "fixture_id" char(26) NOT NULL,
  "registration_id" char(26) NOT NULL,
  "team_id" char(26) NOT NULL,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "recorded_by" char(26) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fixture_lineups_pkey" PRIMARY KEY ("fixture_id", "registration_id")
);--> statement-breakpoint

ALTER TABLE "fixture_lineups" ADD CONSTRAINT "fixture_lineups_fixture_fk"
  FOREIGN KEY ("fixture_id") REFERENCES "fixtures" ("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fixture_lineups" ADD CONSTRAINT "fixture_lineups_registration_fk"
  FOREIGN KEY ("registration_id") REFERENCES "registrations" ("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fixture_lineups" ADD CONSTRAINT "fixture_lineups_team_fk"
  FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "fixture_lineups" ADD CONSTRAINT "fixture_lineups_recorded_by_people_id_fk"
  FOREIGN KEY ("recorded_by") REFERENCES "people" ("id") ON DELETE RESTRICT;--> statement-breakpoint

CREATE INDEX "fixture_lineups_registration_idx" ON "fixture_lineups" ("registration_id");--> statement-breakpoint
CREATE INDEX "fixture_lineups_competition_idx" ON "fixture_lineups" ("competition_id");--> statement-breakpoint

ALTER TABLE "fixture_lineups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixture_lineups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY fixture_lineups_tenant ON "fixture_lineups"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));
