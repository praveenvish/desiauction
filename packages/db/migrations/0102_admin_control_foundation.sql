-- AC-1.1 ADMIN CONTROL FOUNDATION (2026-10-02). docs/product/AC-1_ADMIN_CONTROL.md
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- 1. STEP-UP. A risky admin act needs proof of presence from the last ten
--    minutes: a fresh code, recorded on the SESSION that entered it — a second,
--    stolen session does not inherit it. NULL on every existing session, which
--    simply means "confirm before your first risky act".
ALTER TABLE "sessions" ADD COLUMN "stepped_up_at" timestamptz;
--> statement-breakpoint
-- The code itself is a third purpose beside sign-in and the two changes. It
-- proves presence and nothing else: no sign-in path consumes it.
ALTER TABLE "otp_codes" DROP CONSTRAINT "otp_codes_purpose_check";
--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_purpose_check"
  CHECK ("purpose" IN ('login', 'phone_change', 'step_up'));
--> statement-breakpoint
ALTER TABLE "email_verifications" DROP CONSTRAINT "email_verifications_purpose_check";
--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_purpose_check"
  CHECK ("purpose" IN ('email_change', 'login', 'step_up'));
--> statement-breakpoint
-- 2. JOB RUNS. The scheduler has no database; each job route records its own
--    run here so /admin can say what ran, when, and whether it worked.
--    Platform-level, ZERO tenant data (the finops_schedules posture): no
--    org_id, no RLS. Pruned after ninety days by AC-1.5.
CREATE TABLE "job_runs" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "job" text NOT NULL,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "ok" boolean,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX "job_runs_job_started_idx" ON "job_runs" ("job", "started_at" DESC);
--> statement-breakpoint
CREATE INDEX "job_runs_started_idx" ON "job_runs" ("started_at");
