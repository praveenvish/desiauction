CREATE TABLE "competitions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"season_id" char(26),
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"location" text,
	"starts_on" text,
	"ends_on" text,
	"created_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"competition_id" char(26) NOT NULL,
	"person_id" char(26) NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"base_price_band" text,
	"rejection_reason" text,
	"rejection_note" text,
	"reviewed_by" char(26),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"created_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"competition_id" char(26) NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"primary_color" text,
	"created_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "competitions_org_idx" ON "competitions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_competition_person_uq" ON "registrations" USING btree ("competition_id","person_id");--> statement-breakpoint
CREATE INDEX "registrations_competition_idx" ON "registrations" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "registrations_person_idx" ON "registrations" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "seasons_org_idx" ON "seasons" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_competition_name_uq" ON "teams" USING btree ("competition_id","name");--> statement-breakpoint
CREATE INDEX "teams_competition_idx" ON "teams" USING btree ("competition_id");--> statement-breakpoint

-- RLS for the Competition domain (IP-3 §4, D2). Every table is org-scoped;
-- read (USING) and write (WITH CHECK) policies are added together from day one,
-- applying the RC-4 lesson (a USING-only policy is a write-side self-escalation
-- hole). current_setting(..., true) -> NULL when unset -> policies fail CLOSED.
-- Registrations add a person-scoped READ disjunct so a player can see their own
-- status page (doc 42) across orgs, mirroring the grants policy; writes remain
-- constrained to the active org.

ALTER TABLE "seasons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seasons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY seasons_tenant ON "seasons"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "competitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "competitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY competitions_tenant ON "competitions"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY teams_tenant ON "teams"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registrations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY registrations_tenant ON "registrations"
  USING (
    org_id = current_setting('app.org_id', true)
    OR person_id = current_setting('app.person_id', true)
  )
  WITH CHECK (org_id = current_setting('app.org_id', true));