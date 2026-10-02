-- FOUNDING 25 APPLICATIONS ON THE DEMAND FORM (2026-10-02).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- The Founding 25 (docs/operations/agent-charters/growth-operator.md) is the
-- launch cohort: organisers who run a real auction with us and, with written
-- permission, let us film the night. They apply on /founding-25, which is the
-- demo-request form with its own source — the same row, the same desk, the
-- same throttles and retention. A table of their own would be a second queue
-- for one person to watch.
--
-- `source` is CHECK-constrained to the list the form may send, so a new source
-- is two edits: the constraint here, and `DEMO_SOURCES` in apps/web.
ALTER TABLE "demo_requests" DROP CONSTRAINT "demo_requests_source_check";
--> statement-breakpoint
ALTER TABLE "demo_requests" ADD CONSTRAINT "demo_requests_source_check"
  CHECK ("source" IN ('schedule-demo', 'pricing', 'landing', 'help', 'founding-25', 'other'));
