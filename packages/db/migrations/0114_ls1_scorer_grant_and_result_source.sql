-- LS-1: scorer appointment, typed/scored result separation and pinned season rules.
ALTER TABLE "grants" DROP CONSTRAINT "grants_tournament_scope_is_conductor";--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_tournament_scope_capability_check"
  CHECK ("scope_type" <> 'tournament' OR "capability_set" IN ('auction:conductor','fixture:scorer'));--> statement-breakpoint
ALTER TABLE "fixture_results" ADD COLUMN "source" text NOT NULL DEFAULT 'typed';--> statement-breakpoint
ALTER TABLE "fixture_results" ADD CONSTRAINT "fixture_results_source_check" CHECK ("source" IN ('typed','scored'));--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "scoring_rules" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
UPDATE competitions SET scoring_rules = '{"allOutUsesQuota":false,"excludeNoResultFromNrr":false}';
