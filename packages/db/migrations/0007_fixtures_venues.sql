CREATE TABLE "fixtures" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"competition_id" char(26) NOT NULL,
	"fixture_number" text NOT NULL,
	"seq" integer NOT NULL,
	"round" integer,
	"home_team_id" char(26) NOT NULL,
	"away_team_id" char(26) NOT NULL,
	"ground_id" char(26),
	"kickoff_at" text,
	"duration_minutes" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"cancel_reason" text,
	"published_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grounds" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"venue_id" char(26) NOT NULL,
	"name" text NOT NULL,
	"surface" text DEFAULT 'turf' NOT NULL,
	"capacity" integer,
	"floodlights" boolean DEFAULT false NOT NULL,
	"indoor" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"created_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fixtures_competition_seq_uq" ON "fixtures" USING btree ("competition_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "fixtures_competition_number_uq" ON "fixtures" USING btree ("competition_id","fixture_number");--> statement-breakpoint
CREATE INDEX "fixtures_competition_kickoff_idx" ON "fixtures" USING btree ("competition_id","kickoff_at");--> statement-breakpoint
CREATE INDEX "fixtures_ground_kickoff_idx" ON "fixtures" USING btree ("ground_id","kickoff_at");--> statement-breakpoint
CREATE INDEX "fixtures_org_kickoff_idx" ON "fixtures" USING btree ("org_id","kickoff_at");--> statement-breakpoint
CREATE UNIQUE INDEX "grounds_venue_name_uq" ON "grounds" USING btree ("venue_id","name");--> statement-breakpoint
CREATE INDEX "grounds_org_idx" ON "grounds" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "grounds_venue_idx" ON "grounds" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_org_name_uq" ON "venues" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "venues_org_idx" ON "venues" USING btree ("org_id");--> statement-breakpoint

-- RLS for Fixtures & Venues (M-IP3-3, IP-3_DESIGN D2). Every table is org-scoped;
-- read (USING) and write (WITH CHECK) ship together from day one (the RC-4
-- standing rule). current_setting(..., true) -> NULL when unset -> fail CLOSED.

ALTER TABLE "venues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "venues" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY venues_tenant ON "venues"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "grounds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "grounds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY grounds_tenant ON "grounds"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "fixtures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixtures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY fixtures_tenant ON "fixtures"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));
