-- THE TEAM THAT COMES BACK (PI-1, phase P6).
--
-- HAND-AUTHORED, like 0019-0038.
--
-- Teams are per-competition by design, and "run it again" clones them by
-- name into the new season — so "Career Strikers, 2023 to now" exists only
-- as a string coincidence. This is the tournaments pattern (0019) applied to
-- teams: a durable org-scoped name, with editions' team rows pointing at it.
--
-- Nullable, deliberately: a team with no franchise is a one-off and stays
-- valid. The clone path links clone and original to one franchise (creating
-- it on first clone); nothing else writes the column, and no lifecycle rule
-- changes. The auction, rosters and money never read it — it is a grouping
-- fact for career surfaces, not a new authority.

CREATE TABLE "franchises" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "org_id" char(26) NOT NULL,
  "name" text NOT NULL,
  "created_by" char(26) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "franchises_org_idx" ON "franchises" ("org_id");--> statement-breakpoint

-- Tenant lock, same shape as every org-scoped table (0003/0005 pattern).
ALTER TABLE "franchises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "franchises" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "franchises_tenant" ON "franchises"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "teams" ADD COLUMN "franchise_id" char(26);--> statement-breakpoint
CREATE INDEX "teams_franchise_idx" ON "teams" ("franchise_id");--> statement-breakpoint

-- ADDITIVE AND BACKWARDS COMPATIBLE: nullable column, no row rewritten, no
-- lifecycle change. The app role reaches the new table via default privileges;
-- system role via its default SELECT; engine/runner never touch it (re-run of
-- ops/db/create-app-role.sql per its header refreshes their snapshot SELECT).
COMMENT ON TABLE "franchises" IS
  'Durable team identity across seasons (PI-1): the 0019 tournaments pattern for teams. Grouping only — never an authority.';
