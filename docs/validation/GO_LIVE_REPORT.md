# Go-Live Program — Executive Readiness Report

Run date: 2026-07-16 · Follows [PVP-1](PVP-1_REPORT.md) and [PRP-1](PRP-1_REPORT.md).
Everything marked done was executed and measured on this machine; nothing was
simulated. Cloud provisioning was verified impossible from here (no Fly CLI,
Vercel logged out, AWS token invalid) — those items are founder actions.

## 1 · Infrastructure status

**BLOCKED ON FOUNDER EXTERNALS — by verification, not assumption.** No
provisioning credential exists on this machine. What software can carry is
carried: three deployable artifacts (web platform-build; engine and runner
distroless images built and boot-verified), credential-gated deploy workflows
for both Fly apps, the four-role database recipe as one idempotent psql
script, environment validation that refuses to boot on bad config, and a
deployment runbook that takes a fresh environment from zero to verified.
Required founder actions (also in [PRODUCTION_CHECKLIST](../operations/PRODUCTION_CHECKLIST.md)):
Fly + Vercel accounts, managed Postgres 17 (Mumbai, PITR), S3-compatible
storage, domains/TLS, and provider credentials (Razorpay production, SMS,
email, WhatsApp BSP, Sentry DSNs).

## 2 · Deployment status

Artifacts and automation are done and locally certified: engine image 310 MB
and runner image 244 MB (distroless, non-root; runner boots, ticks, exits
clean on SIGTERM under its own writer role), health endpoints on web and
engine, auto-restart policies in fly.toml, structured pino logs + Sentry
wiring, and the nightly-verify workflow (fresh migrations → integration →
RLS probe → restore-verify → full e2e). First actual deploy awaits §1.

## 3 · Security status — the program's core, now COMPLETE at code level

Workstream 4 is fully landed:

- **Runtime RLS is wired everywhere.** Every `"use server"` action across
  identity, orgs, competition, fixtures/venues, registration, auction
  foundation, live auction, and conduct/ceremony runs inside a `withTenantDb`
  boundary, or on the documented least-privilege system pool for the named
  pre-tenant reads (invite tokens, owner-join tokens, slug resolution, public
  registration landing, membership-joined cross-org listings).
- **Four-role recipe** (`ops/db/create-app-role.sql`, idempotent):
  `desiauction_app` (non-BYPASSRLS — every policy load-bearing),
  `desiauction_system` (BYPASSRLS, least-privilege token paths),
  `desiauction_engine` and `desiauction_runner` (service writers,
  least-privilege DML). `finops_events` DML is revoked from the app role —
  the freeze §8 writer-role restriction has landed.
- **Certified empirically, not asserted.** The ENTIRE journey suite ran with
  web under `desiauction_app` and the engine under `desiauction_engine`:
  zero RLS refusals, zero server errors, all journeys green (§4 caveat on
  one dev-harness race, fixed). The `rls:verify` probe passes: 35/35 tables
  fail closed outside a boundary, in-boundary counts exactly match owner
  truth, cross-tenant rows invisible. *(2026-08-19: **37** tables carry
  `FORCE ROW LEVEL SECURITY` today — the probe enumerates
  `pg_class.relrowsecurity` at runtime, so the count describes the schema on the
  day it ran and is not itself a gate. What gates is that every table found
  returns zero rows outside a boundary.)*

  The recipe this certification ran against later drifted: by 2026-08-18 the
  engine had lost `UPDATE` on `registrations` and the app role had no privileges
  on six post-RC-1 tables (audit P0-1). `pnpm --filter @desiauction/web
  grants:verify` now gates that drift in CI. Read the certification below as
  "the four-role model was proven sound", not "the four-role script is
  currently correct" — those are different claims, and only the second one
  needed the new probe.
- Rotation policy + drilled procedure (PRP-1: 1.29 s hard cutover), secret
  management via platform stores, backup encryption = provider-managed
  at-rest (checklist), audit immutability proven by regression suite.

## 4 · Operational readiness

Runbooks: [DEPLOYMENT](../operations/DEPLOYMENT.md) ·
[SECRET_ROTATION](../operations/SECRET_ROTATION.md) ·
[DISASTER_RECOVERY](../operations/DISASTER_RECOVERY.md). Drilled this
program: snapshot-consistent restore-verify (43/43 tables exact, run under
concurrent write load — *a 2026-07-16 measurement that predates migrations
0015–0026; the table count has moved and it must be re-drilled. It proves
`pg_dump`→`pg_restore` is row-count-lossless, not that a stored backup is
restorable*), engine kill/restart mid-auction with browser
reconvergence (conduct spec, 45.5 s clean under production posture), runner
kill-safety (SIGTERM smoke). Dashboards/alerts/synthetic monitoring are
provisioning-time items (checklist §4) — alert validation cannot run without
an alerting provider.

One defect found and fixed during this program (validation-infra class,
consistent with PVP-1's findings): eight e2e helpers read the dev OTP inbox
without awaiting the send action's commit — a check-once race that produced
false reds under load/HMR. Fixed with the repo's own login.spec idiom (await
`data-step="code"` before reading); live-auction went from double-timeout to
a 36.2 s first-attempt pass. No product code was involved.

## 5 · Performance status

Unchanged from PVP-1's measured local baselines (bid-ack p95 20.2 ms @1000
lots; 1000-spectator fan-out 104 ms; recovery 29 ms @2500 lots; 50-bidder
burst 418 ms). Workstream 7's load matrix (100 bidders, 5000 spectators, 100
orgs, 10 concurrent auctions, runner/dispatch/export throughput, failover)
requires the production deployment — "measure, do not estimate" stands, so
these run as the staging certification once §1 closes.

## 6 · Remaining blockers

1. **Founder externals** (§1 list) — the only category blocking deployment.
2. **SMS OtpSender adapter** — the one code gap, gated on a provider account
   (login is OTP-first; includes the RC-4 pumping circuit-breaker).
3. **Staging certification + load test** (workstreams 6–7) — infra-gated.
4. **CTO decision**: membership-gated `organizations` policy (migration,
   frozen) — approve as scoped exception or defer per RC-4's acceptance.

## 7 · CTO Go / No-Go recommendation

**NO-GO for launch — GO for provisioning, with the software side closed.**
Every workstream item executable without cloud accounts is done and
certified: the platform now runs its complete journey suite under the exact
database posture production will use, with row-level security load-bearing
on every request path. The gap between here and launch is provisioning,
provider credentials, and the staging re-certification those enable — no
open engineering, no known defects, no architecture questions. Launch
sequence: founder provisions §1 → deploy staging per runbook → workstream
6/7 staging certification + load test → re-issue this report with measured
staging evidence → founder + CTO signoff → production.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| SMS provider delays (KYC/DLT registration in India) | Medium | Launch date | Start registration first; dev-inbox keeps staging testable |
| Razorpay live-mode behavior differs from documented HMAC scheme | Low | Settlement | One live staging transaction is a hard gate before launch |
| Staging load test misses local baselines | Low | Launch quality | Budgets have 5–25× headroom locally; scale the Fly machine before revisiting code |
| Transaction-per-boundary overhead under production concurrency | Low | Latency | ~5% suite-level overhead measured; pool sizing is config; monitor bid-ack p95 SLO |
| Single-region (bom) topology | Accepted | Availability | DR runbook covers region loss; multi-region deferred post-launch |
| Dev-DB residue class flakes (time-derived stamps) | Medium (CI only) | Signal noise | Sweep chip already flagged; nightly runs on fresh DB |

## Rollback plan

Web: platform instant rollback (immutable builds). Engine/runner:
`flyctl releases rollback` — machines are stateless; all state in Postgres.
Database: PITR restore per DR runbook (restore-is-a-prefix rule; roles
re-applied from the recipe; `rls:verify` gates re-entry). Role posture:
reverting `DATABASE_URL` to the owner credential instantly restores the
pre-RLS posture (app-layer scoping) if a wiring gap surfaces in production —
one env var, no deploy.
