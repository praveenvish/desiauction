-- LS-1: rebuildable finalized delivery analytics projection (D14).
CREATE TABLE "ball_facts" (
 "fixture_id" char(26) NOT NULL, "seq" bigint NOT NULL,
 "org_id" char(26) NOT NULL, "competition_id" char(26) NOT NULL,
 "innings_no" smallint NOT NULL, "over_no" smallint NOT NULL, "ball_in_over" smallint NOT NULL,
 "legal" boolean NOT NULL, "phase" text NOT NULL,
 "batter_id" char(26) NOT NULL, "batter_hand" text,
 "bowler_id" char(26) NOT NULL, "bowler_style" text,
 "runs_bat" smallint NOT NULL, "extras" smallint NOT NULL, "extra_kind" text,
 "boundary" smallint, "zone" text, "angle" smallint,
 "wicket_kind" text, "player_out_id" char(26), "fielder_id" char(26), "wicket_x" real, "wicket_y" real,
 "time_of_day" text, "ball_type" text, "ground_type" text, "pitch" text,
 "trust_level" text NOT NULL, "format_key" text NOT NULL,
 CONSTRAINT "ball_facts_pkey" PRIMARY KEY ("fixture_id","seq")
);--> statement-breakpoint
CREATE INDEX "ball_facts_batter_idx" ON "ball_facts" ("batter_id");--> statement-breakpoint
CREATE INDEX "ball_facts_bowler_idx" ON "ball_facts" ("bowler_id");--> statement-breakpoint
CREATE INDEX "ball_facts_competition_idx" ON "ball_facts" ("competition_id");--> statement-breakpoint
ALTER TABLE "ball_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ball_facts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ball_facts_tenant" ON "ball_facts" FOR ALL
 USING (org_id = current_setting('app.org_id', true))
 WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "ball_facts_person_read" ON "ball_facts" FOR SELECT
 USING (batter_id IN (SELECT id FROM registrations WHERE person_id = current_setting('app.person_id', true))
 OR bowler_id IN (SELECT id FROM registrations WHERE person_id = current_setting('app.person_id', true)));--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['desiauction_engine','desiauction_runner'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON ball_facts FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
