-- LS-1: who manages a team and who officiates a fixture.
CREATE TABLE "team_managers" (
  "id" char(26) PRIMARY KEY,
  "team_id" char(26) NOT NULL,
  "person_id" char(26) NOT NULL,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "role" text NOT NULL,
  "source" text NOT NULL,
  "created_by" char(26) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "team_managers_role_check" CHECK ("role" IN ('captain','manager')),
  CONSTRAINT "team_managers_source_check" CHECK ("source" IN ('auction_owner','organizer','team_entry')),
  CONSTRAINT "team_managers_team_fk" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE,
  CONSTRAINT "team_managers_person_fk" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT,
  CONSTRAINT "team_managers_creator_fk" FOREIGN KEY ("created_by") REFERENCES "people"("id") ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX "team_managers_active_uq" ON "team_managers" ("team_id", "person_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "team_managers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_managers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "team_managers_tenant" ON "team_managers"
  USING (org_id = current_setting('app.org_id', true) OR person_id = current_setting('app.person_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE TABLE "fixture_officials" (
  "id" char(26) PRIMARY KEY,
  "fixture_id" char(26) NOT NULL,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "role" text NOT NULL,
  "person_id" char(26),
  "display_name" text NOT NULL,
  "created_by" char(26) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "removed_at" timestamp with time zone,
  CONSTRAINT "fixture_officials_role_check" CHECK ("role" IN ('scorer','umpire','referee','commentator')),
  CONSTRAINT "fixture_officials_fixture_fk" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE CASCADE,
  CONSTRAINT "fixture_officials_person_fk" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT,
  CONSTRAINT "fixture_officials_creator_fk" FOREIGN KEY ("created_by") REFERENCES "people"("id") ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX "fixture_officials_fixture_idx" ON "fixture_officials" ("fixture_id");--> statement-breakpoint
ALTER TABLE "fixture_officials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixture_officials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "fixture_officials_tenant" ON "fixture_officials"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));
