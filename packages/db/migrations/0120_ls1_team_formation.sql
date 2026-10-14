-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
-- LS-1 D13; captain access is SELECT-only under the recorded C41 amendment.
ALTER TABLE "competitions" ADD COLUMN "team_formation" text NOT NULL DEFAULT 'auction';
--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_team_formation_check" CHECK ("team_formation" IN ('auction','organizer','team_entry'));
--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "entry_code" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "competitions_entry_code_uq" ON "competitions" ("entry_code") WHERE "entry_code" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "team_entries" (
 "id" char(26) PRIMARY KEY, "org_id" char(26) NOT NULL,
 "competition_id" char(26) NOT NULL, "team_name" text NOT NULL,
 "captain_person_id" char(26) NOT NULL, "players" jsonb NOT NULL,
 "status" text NOT NULL DEFAULT 'submitted', "reviewed_by" char(26),
 "reviewed_at" timestamptz, "created_at" timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT "team_entries_status_check" CHECK ("status" IN ('submitted','approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "team_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "team_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "team_entries_tenant" ON "team_entries" FOR ALL
 USING (org_id = current_setting('app.org_id', true))
 WITH CHECK (org_id = current_setting('app.org_id', true));
--> statement-breakpoint
CREATE POLICY "team_entries_captain_read" ON "team_entries" FOR SELECT
 USING (captain_person_id = current_setting('app.person_id', true));
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['desiauction_engine','desiauction_runner'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON team_entries FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
