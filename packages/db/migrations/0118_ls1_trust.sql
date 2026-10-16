CREATE TABLE "match_confirmations" (
 "id" char(26) PRIMARY KEY,
 "fixture_id" char(26) NOT NULL,
 "org_id" char(26) NOT NULL,
 "competition_id" char(26) NOT NULL,
 "team_id" char(26) NOT NULL,
 "person_id" char(26) NOT NULL,
 "verdict" text NOT NULL,
 "note" text,
 "created_at" timestamptz DEFAULT now() NOT NULL,
 CONSTRAINT "match_confirmations_verdict_check" CHECK ("verdict" IN ('confirmed','disputed'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "match_confirmations_one_uq" ON "match_confirmations" ("fixture_id","team_id");--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "trust_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "match_confirmations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "match_confirmations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "match_confirmations_tenant" ON "match_confirmations" FOR ALL
 USING (org_id = current_setting('app.org_id', true))
 WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['desiauction_engine','desiauction_runner'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON match_confirmations FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
