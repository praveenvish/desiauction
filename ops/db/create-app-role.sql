-- Runtime roles for the RLS-load-bearing deployment (PRP-1 §1).
--
-- Two roles, two pools:
--   desiauction_app    — the web tier's default pool. NOSUPERUSER NOBYPASSRLS:
--                        every FORCE'd RLS policy is load-bearing; queries
--                        outside a withTenant boundary fail closed.
--   desiauction_system — BYPASSRLS but NOT superuser. Serves ONLY the named
--                        pre-tenant token paths (invite preview/accept, RC-4
--                        reconciliation) via SYSTEM_DATABASE_URL. Least
--                        privilege: just the tables those paths touch.
--
-- The engine and finops-runner keep their own writer credentials (service
-- writers, BYPASSRLS-equivalent posture) — they derive tenancy from the
-- aggregate they own, never from a request.
--
-- Run as the database owner, once per environment. RE-RUN after any future
-- migration: grants are static by design (no ALTER DEFAULT PRIVILEGES —
-- migrations run as the owner and the schema is frozen).
--
-- ALL FOUR PASSWORDS, ALWAYS. The script sets ON_ERROR_STOP, so a two-variable
-- invocation ABORTS at the engine role and silently leaves the deployment with
-- no desiauction_engine, no desiauction_runner and none of the append-only
-- revokes. That is exactly what the docs and the nightly workflow did, which is
-- why the four-role recipe had never actually been verified (audit 2026-08-18).
--
-- Local drill:
--   docker compose exec -T db psql -U desiauction -d desiauction \
--     -v ON_ERROR_STOP=1 \
--     -v app_password='<app-pw>' -v system_password='<system-pw>' \
--     -v engine_password='<engine-pw>' -v runner_password='<runner-pw>' \
--     < ops/db/create-app-role.sql
--
-- Then prove it: pnpm --filter @desiauction/web grants:verify

\set ON_ERROR_STOP on

select format(
  'create role desiauction_app login password %L nosuperuser nobypassrls nocreatedb nocreaterole',
  :'app_password')
where not exists (select 1 from pg_roles where rolname = 'desiauction_app')
\gexec

select format(
  'create role desiauction_system login password %L nosuperuser bypassrls nocreatedb nocreaterole',
  :'system_password')
where not exists (select 1 from pg_roles where rolname = 'desiauction_system')
\gexec

grant usage on schema public to desiauction_app, desiauction_system;

-- App role: full DML — row visibility is the RLS policies' job. The finops
-- writer-role narrowing (freeze §8 item 2) further revokes finops_events DML
-- from this role once the finops writer gets its own credential.
grant select, insert, update, delete on all tables in schema public to desiauction_app;
grant usage, select on all sequences in schema public to desiauction_app;

-- ON ALL TABLES is a SNAPSHOT: it grants on the tables that exist the moment it
-- runs, and says nothing about the next migration's. That is precisely how this
-- file fell twelve migrations behind — consent_records, suppressions,
-- notification_preferences, email_verifications, org_messaging_settings and
-- fixture_results were all invisible to the app role in production while every
-- local suite passed as the owner.
--
-- DEFAULT PRIVILEGES close the gap for anything created LATER by the migration
-- role, so a new table is reachable the moment it exists. The header note above
-- ("re-run after any future migration") stays true for the least-privilege
-- writer roles below, whose grants are deliberately enumerated — but the app
-- role no longer depends on anyone remembering.
alter default privileges in schema public
  grant select, insert, update, delete on tables to desiauction_app;
alter default privileges in schema public
  grant usage, select on sequences to desiauction_app;

-- System role: exactly the named pre-tenant surfaces —
--   org invites (previewInvite/acceptInvite),
--   owner-join tokens (ownerJoinPreview/acceptOwnerJoin),
--   slug resolution + public registration landing (resolveCompetition,
--   competitionForRegistration) and the membership-joined cross-org listings
--   (competitionsForPerson, organizerSchedule).
grant select, update on invites to desiauction_system;
grant select on organizations to desiauction_system;
grant insert on org_members, grants, audit_log to desiauction_system;
-- acceptInvite/acceptOwnerJoin tolerate an existing membership (ON CONFLICT
-- DO NOTHING needs SELECT to detect the conflict target under postgres).
grant select on org_members to desiauction_system;
grant select on auction_owner_invites, auctions, competitions, teams to desiauction_system;
-- Tournaments join the cross-org listings: a competition renders under the
-- tournament it is an edition of, so the pre-tenant path reads the parent name.
grant select on tournaments to desiauction_system;
grant select on fixtures, grounds, venues to desiauction_system;

-- THE SYSTEM POOL IS A PLATFORM-READ ROLE. SAY SO.
--
-- The grants above were written when this role served exactly two pre-tenant
-- token paths. It now also backs the platform-admin explorer, the account
-- screen, the organization directory and the membership-joined cross-org
-- listings — and its grant list never followed, so under the real production
-- recipe /account, /orgs and /org/{slug} answered 500 while every local suite
-- passed as the owner (audit 2026-08-18, follow-up to P0-1).
--
-- Enumerating the shortfall was tried and it converged on "most of the schema",
-- one 500 at a time: the admin explorer reads auctions, lots, bids, payments,
-- settlement and finops aggregates by design. A curated list that grows to
-- everything is not least privilege, it is least privilege's paperwork — so
-- this grants platform READ honestly, and keeps the narrow thing narrow:
-- WRITES stay enumerated at three tables (org_members, grants, audit_log).
--
-- The tension is real and belongs in the open: this role is BYPASSRLS, so its
-- read surface crosses every tenant. What contains it is that only the admin
-- explorer and the named token paths use this pool, `admin-is-read-only` is
-- machine-enforced by depcruise, and grants:verify pins the write list. The
-- right long-term shape is those org-scoped reads moving to the tenant pool
-- inside a withTenantDb boundary, leaving this role the platform surface it
-- actually is. That is a ~130 call-site refactor and is tracked, not half-done.
grant select on all tables in schema public to desiauction_system;
alter default privileges in schema public grant select on tables to desiauction_system;

-- Service writer roles (Go-Live workstream 4): BYPASSRLS but NOT superuser.
-- Each derives tenancy from the aggregate it owns, never from a request.
select format(
  'create role desiauction_engine login password %L nosuperuser bypassrls nocreatedb nocreaterole',
  :'engine_password')
where not exists (select 1 from pg_roles where rolname = 'desiauction_engine')
\gexec

select format(
  'create role desiauction_runner login password %L nosuperuser bypassrls nocreatedb nocreaterole',
  :'runner_password')
where not exists (select 1 from pg_roles where rolname = 'desiauction_runner')
\gexec

grant usage on schema public to desiauction_engine, desiauction_runner;

-- Their default SELECT on future tables, HERE and not above: on a fresh database
-- the two roles do not exist until this point, and ON_ERROR_STOP aborted the
-- whole recipe at the earlier placement — leaving no engine role, no runner
-- role and none of the append-only revokes (the exact failure the header
-- warns about, reached by a different door). CI's fresh-database run found it.
alter default privileges in schema public grant select on tables to desiauction_engine;
alter default privileges in schema public grant select on tables to desiauction_runner;

-- Engine: the single writer of auction truth (+ its audit evidence); reads
-- whatever projections it folds.
grant select on all tables in schema public to desiauction_engine;
grant insert, update, delete on auctions, lots, bids, paddles,
  paddle_grants, auction_owner_invites to desiauction_engine;
-- The sale write path. `closeLot` stamps registrations.team_id on every SOLD
-- lot and clears it on requeue/withdraw/undo (packages/auction aggregate).
-- This grant was MISSING for twelve migrations: under the production recipe the
-- first sale of the first auction threw "permission denied for table
-- registrations" inside the close transaction, the engine returned
-- engine_halted without caching the ack, and the 250 ms tick re-enqueued the
-- close for ever — the auction deadlocked on its first sale. Nothing caught it
-- because every LOCAL process connects as the database owner, which bypasses
-- this file entirely (audit 2026-08-18, P0-1). `pnpm grants:verify` now fails
-- the build if a runtime write path outruns these grants again.
grant update on registrations to desiauction_engine;
-- Append-only: events and audit rows are evidence, so the writer may add to
-- them and may never rewrite or remove them.
grant insert on auction_events, audit_log to desiauction_engine;

-- Runner: the one FinOps writer (freeze §8.2) — every finops mutation goes
-- through it; reads the org streams the follower consumes.
grant select on all tables in schema public to desiauction_runner;
grant insert, update, delete on finops_documents,
  finops_dispatches, finops_exports, finops_jobs, finops_cursors,
  finops_periods, finops_period_days, finops_profiles, finops_series,
  finops_schedules to desiauction_runner;
-- Append-only, as above: the finops event stream and the audit trail are the
-- evidence the projections are rebuilt FROM.
grant insert on finops_events, audit_log to desiauction_runner;

-- Freeze §8.2 lands: the web tier cannot write finops truth. Web finops
-- surfaces are read-only projections; the runner is the writer.
revoke insert, update, delete on finops_events from desiauction_app;

-- APPEND-ONLY LEDGERS, ENFORCED BY THE DATABASE.
--
-- Invariants 10 and 24 say the event streams and the audit trail are never
-- updated or deleted. That was application discipline only: every runtime role
-- held UPDATE and DELETE on all four, so a bug — or anyone with the app
-- credential — could rewrite the evidence the projections are rebuilt from, and
-- the replay would happily agree with the tampered rows.
--
-- No runtime path writes them any other way than INSERT (verified across
-- packages/*/src and apps/*/src). The only UPDATE/DELETE sites are seeds and
-- perf scripts, which run as the OWNER and are unaffected. journal_postings and
-- journal_legs are deliberately NOT here: they are projections rebuilt from
-- events by settlement recovery, so they must stay deletable.
revoke update, delete on auction_events, settlement_events, finops_events, audit_log
  from desiauction_app, desiauction_engine, desiauction_runner, desiauction_system;

-- PRIVATE PER-TEAM PLANS (WR-1 "My plan", migration 0041).
--
-- The web tier is the only writer and the only intended reader of an owner's
-- plan. The engine and runner inherit SELECT on every new table from the
-- default privileges above and must not keep it here: nothing either service
-- folds reads a plan, and a service credential that can read every owner's
-- ceiling is a leak waiting for a bug. The system pool keeps its platform read
-- like the rest of the schema; what contains it is that no admin projection
-- imports these tables (machine-checked in the web suite).
revoke all on auction_team_targets, auction_team_target_revisions
  from desiauction_engine, desiauction_runner;
-- Revisions are evidence: appended by the app, rewritten by nobody.
revoke update, delete on auction_team_target_revisions
  from desiauction_app, desiauction_engine, desiauction_runner, desiauction_system;

\echo 'roles ready: desiauction_app (nobypassrls) · desiauction_system (bypassrls, least-privilege)'
