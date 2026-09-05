-- STATUS COLUMNS BECOME CLOSED SETS, AND THE INDEX HYGIENE THAT GOES WITH IT.
--
-- HAND-AUTHORED, like 0019-0043.
--
-- PART 1 — enums that were only enums in TypeScript.
--
-- `packages/db/src/schema.ts` declares these columns with `text(..., { enum: [...] })`,
-- which is a COMPILE-TIME fact and nothing more: the column is plain `text` in
-- Postgres, and any string at all satisfies it. Audit PA-1 §7 counted ~15 such
-- columns and this migration found 33. Every write path is typed, so nothing
-- illegal is being written today — but nothing except discipline was stopping a
-- migration, a psql session, a future adapter or a mistyped literal in a raw
-- query from parking `"Sold"` or `"CAPTURED"` in a status column, after which
-- every fold and every filter quietly disagrees about that row.
--
-- The sets below are generated FROM the schema's own declarations rather than
-- from the data, so the constraint can never be narrower than the code: a CHECK
-- built from "what exists today" would refuse a legal value the moment a state
-- was first used. Every column was verified to conform before this was written.
--
-- NOT VALID then VALIDATE throughout, per 0043.


--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_source_check"
  CHECK ("source" IN ('registration','account','sms_stop','sms_start','import','support','login')) NOT VALID;--> statement-breakpoint
ALTER TABLE "consent_records" VALIDATE CONSTRAINT "consent_records_source_check";
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_channel_check"
  CHECK ("channel" IN ('sms','email','in-app')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notification_preferences" VALIDATE CONSTRAINT "notification_preferences_channel_check";
--> statement-breakpoint
ALTER TABLE "org_messaging_settings" ADD CONSTRAINT "org_messaging_settings_channel_check"
  CHECK ("channel" IN ('sms','email','in-app')) NOT VALID;--> statement-breakpoint
ALTER TABLE "org_messaging_settings" VALIDATE CONSTRAINT "org_messaging_settings_channel_check";
--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_channel_check"
  CHECK ("channel" IN ('sms','email')) NOT VALID;--> statement-breakpoint
ALTER TABLE "suppressions" VALIDATE CONSTRAINT "suppressions_channel_check";
--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_reason_check"
  CHECK ("reason" IN ('stop','bounce','complaint','manual','unreachable')) NOT VALID;--> statement-breakpoint
ALTER TABLE "suppressions" VALIDATE CONSTRAINT "suppressions_reason_check";
--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_scope_type_check"
  CHECK ("scope_type" IN ('org','tournament','team','platform')) NOT VALID;--> statement-breakpoint
ALTER TABLE "grants" VALIDATE CONSTRAINT "grants_scope_type_check";
--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_status_check"
  CHECK ("status" IN ('draft','setup','registration_open','registration_closed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "competitions" VALIDATE CONSTRAINT "competitions_status_check";
--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_visibility_check"
  CHECK ("visibility" IN ('private','public')) NOT VALID;--> statement-breakpoint
ALTER TABLE "competitions" VALIDATE CONSTRAINT "competitions_visibility_check";
--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_role_check"
  CHECK ("role" IN ('batter','bowler','all_rounder','wicket_keeper')) NOT VALID;--> statement-breakpoint
ALTER TABLE "registrations" VALIDATE CONSTRAINT "registrations_role_check";
--> statement-breakpoint
ALTER TABLE "grounds" ADD CONSTRAINT "grounds_surface_check"
  CHECK ("surface" IN ('turf','matting','astroturf','concrete','other')) NOT VALID;--> statement-breakpoint
ALTER TABLE "grounds" VALIDATE CONSTRAINT "grounds_surface_check";
--> statement-breakpoint
ALTER TABLE "grounds" ADD CONSTRAINT "grounds_status_check"
  CHECK ("status" IN ('active','unavailable')) NOT VALID;--> statement-breakpoint
ALTER TABLE "grounds" VALIDATE CONSTRAINT "grounds_status_check";
--> statement-breakpoint
ALTER TABLE "fixture_results" ADD CONSTRAINT "fixture_results_outcome_check"
  CHECK ("outcome" IN ('home_win','away_win','tie','no_result','abandoned')) NOT VALID;--> statement-breakpoint
ALTER TABLE "fixture_results" VALIDATE CONSTRAINT "fixture_results_outcome_check";
--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_status_check"
  CHECK ("status" IN ('draft','scheduled','published','in_progress','completed','cancelled')) NOT VALID;--> statement-breakpoint
ALTER TABLE "fixtures" VALIDATE CONSTRAINT "fixtures_status_check";
--> statement-breakpoint
ALTER TABLE "settlement_events" ADD CONSTRAINT "settlement_events_stream_type_check"
  CHECK ("stream_type" IN ('case','journal','payment')) NOT VALID;--> statement-breakpoint
ALTER TABLE "settlement_events" VALIDATE CONSTRAINT "settlement_events_stream_type_check";
--> statement-breakpoint
ALTER TABLE "settlement_cases" ADD CONSTRAINT "settlement_cases_status_check"
  CHECK ("status" IN ('opened','verified','discrepant','settling','settled','closed','voided')) NOT VALID;--> statement-breakpoint
ALTER TABLE "settlement_cases" VALIDATE CONSTRAINT "settlement_cases_status_check";
--> statement-breakpoint
ALTER TABLE "settlement_cases" ADD CONSTRAINT "settlement_cases_basis_check"
  CHECK ("basis" IN ('committed','fixed','none')) NOT VALID;--> statement-breakpoint
ALTER TABLE "settlement_cases" VALIDATE CONSTRAINT "settlement_cases_basis_check";
--> statement-breakpoint
ALTER TABLE "journal_postings" ADD CONSTRAINT "journal_postings_template_check"
  CHECK ("template" IN ('obligation','collection','overpaid-collection','waiver','refund')) NOT VALID;--> statement-breakpoint
ALTER TABLE "journal_postings" VALIDATE CONSTRAINT "journal_postings_template_check";
--> statement-breakpoint
ALTER TABLE "journal_legs" ADD CONSTRAINT "journal_legs_direction_check"
  CHECK ("direction" IN ('debit','credit')) NOT VALID;--> statement-breakpoint
ALTER TABLE "journal_legs" VALIDATE CONSTRAINT "journal_legs_direction_check";
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_check"
  CHECK ("method" IN ('gateway:razorpay','manual:cash','manual:upi-direct','manual:bank')) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_method_check";
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_check"
  CHECK ("status" IN ('created','authorized','captured','refunded','failed','disputed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_status_check";
--> statement-breakpoint
ALTER TABLE "finops_events" ADD CONSTRAINT "finops_events_stream_type_check"
  CHECK ("stream_type" IN ('profile','series','dispatch','export','period')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_events" VALIDATE CONSTRAINT "finops_events_stream_type_check";
--> statement-breakpoint
ALTER TABLE "finops_profiles" ADD CONSTRAINT "finops_profiles_posture_check"
  CHECK ("posture" IN ('none','gst-registered')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_profiles" VALIDATE CONSTRAINT "finops_profiles_posture_check";
--> statement-breakpoint
ALTER TABLE "finops_series" ADD CONSTRAINT "finops_series_kind_check"
  CHECK ("kind" IN ('receipt','tax-invoice','correction')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_series" VALIDATE CONSTRAINT "finops_series_kind_check";
--> statement-breakpoint
ALTER TABLE "finops_series" ADD CONSTRAINT "finops_series_status_check"
  CHECK ("status" IN ('open','closed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_series" VALIDATE CONSTRAINT "finops_series_status_check";
--> statement-breakpoint
ALTER TABLE "finops_documents" ADD CONSTRAINT "finops_documents_kind_check"
  CHECK ("kind" IN ('receipt','tax-invoice','correction')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_documents" VALIDATE CONSTRAINT "finops_documents_kind_check";
--> statement-breakpoint
ALTER TABLE "finops_dispatches" ADD CONSTRAINT "finops_dispatches_status_check"
  CHECK ("status" IN ('requested','sent','confirmed','failed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_dispatches" VALIDATE CONSTRAINT "finops_dispatches_status_check";
--> statement-breakpoint
ALTER TABLE "finops_dispatches" ADD CONSTRAINT "finops_dispatches_channel_check"
  CHECK ("channel" IN ('in-app','email','whatsapp','org-webhook')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_dispatches" VALIDATE CONSTRAINT "finops_dispatches_channel_check";
--> statement-breakpoint
ALTER TABLE "finops_exports" ADD CONSTRAINT "finops_exports_status_check"
  CHECK ("status" IN ('requested','completed','failed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_exports" VALIDATE CONSTRAINT "finops_exports_status_check";
--> statement-breakpoint
ALTER TABLE "finops_exports" ADD CONSTRAINT "finops_exports_kind_check"
  CHECK ("kind" IN ('tally-xml','journal-csv','gstr1-json','audit-bundle','archive-bundle')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_exports" VALIDATE CONSTRAINT "finops_exports_kind_check";
--> statement-breakpoint
ALTER TABLE "finops_periods" ADD CONSTRAINT "finops_periods_status_check"
  CHECK ("status" IN ('open','closed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_periods" VALIDATE CONSTRAINT "finops_periods_status_check";
--> statement-breakpoint
ALTER TABLE "finops_period_days" ADD CONSTRAINT "finops_period_days_attestor_kind_check"
  CHECK ("attestor_kind" IN ('system','human')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_period_days" VALIDATE CONSTRAINT "finops_period_days_attestor_kind_check";
--> statement-breakpoint
ALTER TABLE "finops_jobs" ADD CONSTRAINT "finops_jobs_state_check"
  CHECK ("state" IN ('queued','leased','done','dead')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_jobs" VALIDATE CONSTRAINT "finops_jobs_state_check";
--> statement-breakpoint
ALTER TABLE "finops_schedules" ADD CONSTRAINT "finops_schedules_slot_check"
  CHECK ("slot" IN ('daily-ops','year-end')) NOT VALID;--> statement-breakpoint
ALTER TABLE "finops_schedules" VALIDATE CONSTRAINT "finops_schedules_slot_check";
--> statement-breakpoint

-- PART 2 — index hygiene (PA-1 §7).
--
-- A duplicate index costs a write on every insert and buys nothing: the
-- non-unique `demo_bookings_slot_idx` is a strict subset of the unique index
-- beside it, same columns and same predicate.
DROP INDEX IF EXISTS "demo_bookings_slot_idx";--> statement-breakpoint

-- Foreign keys added in 0032/0041 whose referencing columns were never indexed.
-- Postgres does NOT index the child side of a foreign key automatically, so
-- every delete of a parent takes a sequential scan of the child to prove the
-- constraint — cheap on today's rows, and exactly the sort of thing that is
-- discovered under load instead of in review.
CREATE INDEX IF NOT EXISTS "auction_team_targets_registration_idx"
  ON "auction_team_targets" ("registration_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auction_team_targets_team_idx"
  ON "auction_team_targets" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auction_team_targets_fallback_idx"
  ON "auction_team_targets" ("fallback_registration_id");--> statement-breakpoint

-- The platform-admin audit explorer filters by actor, and `audit_log` is indexed
-- on (scope_type, scope_id, at) only — so "what did this person do" was a scan.
CREATE INDEX IF NOT EXISTS "audit_log_actor_at_idx" ON "audit_log" ("actor", "at");--> statement-breakpoint

-- Migration 0041's plan policies run three correlated EXISTS per row; two arms
-- had a covering index and the owner-invite arm did not.
CREATE INDEX IF NOT EXISTS "owner_invites_team_person_idx"
  ON "auction_owner_invites" ("auction_id", "team_id", "accepted_by");

