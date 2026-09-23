-- TWO SERVICE CREDENTIALS COULD READ EVERY PERSONAL MESSAGE (go-live gate P2),
-- AND THE OUTBOX'S PREFIX LOOKUPS HAD NO INDEX THEY COULD USE (P3).
--
-- 1. THE ENGINE AND THE RUNNER READ WHAT THEY NEVER NEED.
--
-- `ops/db/create-app-role.sql` gives `desiauction_engine` and
-- `desiauction_runner` SELECT on every table by default privilege, so each
-- table created since inherited it without anybody deciding it should. For
-- seven of them that is a disclosure with no use behind it:
--
--   message_outbox              the rendered body of every email/SMS/WhatsApp
--   problem_reports             free text, a reply address, a request IP
--   problem_report_screenshots  pictures of somebody's screen
--   review_requests / reviews   who was asked, and what they wrote
--   review_reports              a reader's note and IP
--   erasure_requests            who asked to be forgotten, and why
--
-- Neither service reads any of them: nothing in apps/engine, apps/finops-runner
-- or the packages they import (auction, settlement, financial-operations, core,
-- contracts, db) names these tables, checked 2026-09-23. So the grant buys no
-- behaviour and costs the blast radius of two BYPASSRLS credentials: a leaked
-- engine password was a read of every personal message on the platform. WR-1's
-- private plans (0041) were closed the same way, for the same reason.
--
-- GUARDED BY ROLE EXISTENCE. Migrations run as the owner, and on a fresh
-- database — CI's integration job, a new environment — they run BEFORE the role
-- recipe has created these roles; an unconditional REVOKE would abort the
-- batch. The recipe carries the same revokes after its `grant select on all
-- tables` for exactly that ordering, and `grants:verify` pins the result both
-- ways round.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['desiauction_engine', 'desiauction_runner'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON message_outbox, problem_reports, problem_report_screenshots, '
        'review_requests, reviews, review_reports, erasure_requests FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

-- 2. PREFIX LOOKUPS ON THE OUTBOX'S DEDUPE KEY.
--
-- Squad sheets, lineup announcements and appointment notices each ask "which of
-- this batch already went out?" as `dedupe_key LIKE '<kind>:<id>:%'`. The
-- unique index from 0079 cannot serve that: under a non-C collation (the
-- postgres image defaults to en_US.utf8) a btree only answers LIKE when it is
-- built with the pattern operator class. Without one each lookup is a
-- sequential scan of a table that only grows.
--
-- NOT CONCURRENTLY, deliberately: the drizzle migrator runs the batch in one
-- transaction, where CREATE INDEX CONCURRENTLY is refused, and the outbox is
-- small at launch, so the brief write lock is milliseconds. If this ever has to
-- run against a large outbox, build it by hand CONCURRENTLY first — the
-- IF NOT EXISTS then makes this statement a no-op.
CREATE INDEX IF NOT EXISTS "message_outbox_dedupe_prefix_idx"
  ON "message_outbox" ("dedupe_key" text_pattern_ops);
