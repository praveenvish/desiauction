-- TWO SERVICE CREDENTIALS COULD READ EVERY SESSION AND EVERY SIGN-IN CODE
-- (production readiness review, 2026-09-29).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- 1. THE ENGINE AND THE RUNNER READ WHAT THEY NEVER NEED — AGAIN.
--
-- 0083 closed this for personal CONTENT (messages, reports, reviews) and said
-- why: `ops/db/create-app-role.sql` gives `desiauction_engine` and
-- `desiauction_runner` SELECT on every table by default privilege, so each
-- table inherits the read without anybody deciding it should. The identity
-- tables were never on that list, and the two newest tables arrived after it:
--
--   sessions             the hash of every live session token
--   otp_codes            the keyed digest of every phone sign-in code
--   otp_inbox            the codes THEMSELVES, in environments that use it
--   passkey_credentials  every registered authenticator's public key and counter
--   email_verifications  the keyed digest of every email sign-in code
--   push_subscriptions   each browser's push endpoint and encryption keys (0097)
--   email_sends          who was mailed what kind of message, and when (0094)
--
-- Neither service reads any of them: nothing in apps/engine, apps/finops-runner
-- or the packages they import names these tables (checked 2026-09-29, by table
-- name and by schema export). Both credentials are BYPASSRLS, so a leaked
-- engine or runner password was a read of every session on the platform — and
-- the code digests are keyed with ENGINE_SECRET, which the engine holds.
--
-- `people`, `consent_records` and `notification_preferences` are deliberately
-- NOT here: the runner addresses receipts and asks the consent gate, and the
-- engine reads names for the snapshot.
--
-- GUARDED BY ROLE EXISTENCE, exactly as 0083 is and for the same reason: on a
-- fresh database the migrations run before the role recipe has created these
-- roles. The recipe carries the same revokes after its `grant select on all
-- tables`, and `grants:verify` pins the result (IDENTITY_TABLES).
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['desiauction_engine', 'desiauction_runner'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON sessions, otp_codes, otp_inbox, passkey_credentials, '
        'email_verifications, push_subscriptions, email_sends FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

-- 2. THE DEFAULT SIGN-IN PATH HAD NO INDEX IT COULD USE.
--
-- Email is the default way in (LOGIN_DEFAULT_METHOD), and every request and
-- every verification filters `email_verifications` by address: the hourly cap
-- counts by (email, purpose, created_at) and the verify reads the newest live
-- code for the address. The table had indexes by person, by request IP and by
-- time — not by email — so each sign-in was a sequential scan of a table that
-- gains a row per code sent and is only trimmed by retention.
--
-- NOT CONCURRENTLY, for the reason 0083 gives: the migrator runs the batch in
-- one transaction. The table is small at launch and the lock is milliseconds.
CREATE INDEX IF NOT EXISTS "email_verifications_email_idx"
  ON "email_verifications" ("email", "created_at");--> statement-breakpoint

-- 3. MONEY PROJECTIONS CANNOT HOLD A NEGATIVE AMOUNT.
--
-- `bids` and `lots` have carried non-negative CHECKs since 0029. The settlement
-- projections never did, and the app role holds full DML on them (they are
-- rebuilt from events by recovery, so they must stay writable). The writer
-- re-folds and diffs before every decision, which is what actually protects
-- the books; this is the database refusing the one class of value no fold
-- could ever produce, so a bug or a hand edit fails loudly at the write
-- instead of being discovered by the next reconciliation.
--
-- Non-negative only. Relations BETWEEN columns (refunded against captured,
-- discharged against amount) are the certified writer's rules and move with
-- it; pinning them here would make the schema a second, stale copy of them.
--
-- NOT VALID then VALIDATE, in the form 0085 and 0094 use. One thing that form
-- does NOT buy here, stated so nobody relies on it: the migrator applies the
-- whole batch in ONE transaction, so the ACCESS EXCLUSIVE lock each ADD
-- CONSTRAINT takes is held until that transaction commits, VALIDATE included.
-- These three tables are small (the money rows of one platform) and the
-- migrator runs with lock_timeout = 5s outside any live window, so the cost is
-- milliseconds and the failure mode is a refused deploy, never a stalled one.
-- A row that fails VALIDATE also refuses the deploy: no writer produces one
-- (the journal rejects a leg under zero, the commands an amount under zero),
-- so it would be a hand edit, and that is worth stopping for.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amounts_nonneg"
  CHECK ("amount" >= 0 AND "captured" >= 0 AND "refunded_total" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_amounts_nonneg";--> statement-breakpoint
ALTER TABLE "settlement_obligations"
  ADD CONSTRAINT "settlement_obligations_amounts_nonneg"
  CHECK (
    "amount" >= 0 AND "increased" >= 0 AND "reduced" >= 0
    AND "discharged" >= 0 AND "waived" >= 0 AND "reinstated" >= 0
  ) NOT VALID;--> statement-breakpoint
ALTER TABLE "settlement_obligations" VALIDATE CONSTRAINT "settlement_obligations_amounts_nonneg";--> statement-breakpoint
ALTER TABLE "journal_legs"
  ADD CONSTRAINT "journal_legs_amount_nonneg" CHECK ("amount" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "journal_legs" VALIDATE CONSTRAINT "journal_legs_amount_nonneg";
