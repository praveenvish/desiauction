-- LS-1: match snapshots, immutable scoring events and public live projections.
CREATE TABLE "matches" (
  "fixture_id" char(26) PRIMARY KEY,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "attempt" integer NOT NULL DEFAULT 1,
  "format" jsonb NOT NULL,
  "conditions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "award_version" text NOT NULL,
  "phase" text NOT NULL DEFAULT 'not_started',
  "scorer_person_id" char(26),
  "scorer_claimed_at" timestamp with time zone,
  "scorer_device_id" text,
  "trust_level" text NOT NULL DEFAULT 'self_scored',
  "share_token" text NOT NULL,
  "last_seq" bigint NOT NULL DEFAULT 0,
  "viewer_peak" integer NOT NULL DEFAULT 0,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "finalized_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matches_phase_check" CHECK ("phase" IN ('not_started','toss','live','innings_break','interrupted','result_reached','finished','final','stalled','no_result','abandoned','walkover','void')),
  CONSTRAINT "matches_trust_check" CHECK ("trust_level" IN ('verified','confirmed','self_scored','flagged')),
  CONSTRAINT "matches_attempt_check" CHECK ("attempt" >= 1),
  CONSTRAINT "matches_fixture_fk" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE CASCADE,
  CONSTRAINT "matches_scorer_fk" FOREIGN KEY ("scorer_person_id") REFERENCES "people"("id") ON DELETE SET NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "matches_share_token_uq" ON "matches" ("share_token");--> statement-breakpoint
CREATE INDEX "matches_competition_idx" ON "matches" ("competition_id");--> statement-breakpoint
ALTER TABLE "matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "matches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "matches_tenant" ON "matches"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE TABLE "match_events" (
  "fixture_id" char(26) NOT NULL,
  "seq" bigint NOT NULL,
  "event_id" char(26) NOT NULL,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "attempt" integer NOT NULL,
  "type" text NOT NULL,
  "v" smallint NOT NULL DEFAULT 1,
  "payload" jsonb NOT NULL,
  "target_event_id" char(26),
  "actor_person_id" char(26) NOT NULL,
  "client_seq" integer NOT NULL,
  "client_recorded_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "match_events_pkey" PRIMARY KEY ("fixture_id", "seq"),
  CONSTRAINT "match_events_fixture_fk" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE CASCADE,
  CONSTRAINT "match_events_actor_fk" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id") ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX "match_events_event_uq" ON "match_events" ("fixture_id", "event_id");--> statement-breakpoint
CREATE INDEX "match_events_competition_idx" ON "match_events" ("competition_id");--> statement-breakpoint
ALTER TABLE "match_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "match_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "match_events_tenant" ON "match_events"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE TABLE "match_live_state" (
  "fixture_id" char(26) PRIMARY KEY,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "seq" bigint NOT NULL,
  "state" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "match_live_state_fixture_fk" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE CASCADE
);--> statement-breakpoint
ALTER TABLE "match_live_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "match_live_state" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "match_live_state_tenant" ON "match_live_state"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['desiauction_app', 'desiauction_engine', 'desiauction_runner', 'desiauction_system'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE UPDATE, DELETE ON match_events FROM %I', role_name);
    END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['desiauction_engine', 'desiauction_runner'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON matches, match_events, match_live_state FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
