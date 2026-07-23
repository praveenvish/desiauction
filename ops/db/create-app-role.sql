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
-- Local drill:
--   docker exec -i desiauction-next-db-1 psql -U desiauction -d desiauction \
--     -v app_password='<app-pw>' -v system_password='<system-pw>' \
--     < ops/db/create-app-role.sql

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

-- Engine: the single writer of auction truth (+ its audit evidence); reads
-- whatever projections it folds.
grant select on all tables in schema public to desiauction_engine;
grant insert, update, delete on auction_events, auctions, lots, bids, paddles,
  paddle_grants, auction_owner_invites to desiauction_engine;
grant insert on audit_log to desiauction_engine;

-- Runner: the one FinOps writer (freeze §8.2) — every finops mutation goes
-- through it; reads the org streams the follower consumes.
grant select on all tables in schema public to desiauction_runner;
grant insert, update, delete on finops_events, finops_documents,
  finops_dispatches, finops_exports, finops_jobs, finops_cursors,
  finops_periods, finops_period_days, finops_profiles, finops_series,
  finops_schedules to desiauction_runner;
grant insert on audit_log to desiauction_runner;

-- Freeze §8.2 lands: the web tier cannot write finops truth. Web finops
-- surfaces are read-only projections; the runner is the writer.
revoke insert, update, delete on finops_events from desiauction_app;

\echo 'roles ready: desiauction_app (nobypassrls) · desiauction_system (bypassrls, least-privilege)'
