# PRP-1 — Production Readiness Report

Run date: 2026-07-16 · Follows [PVP-1_REPORT](PVP-1_REPORT.md). Everything
below was implemented and drilled on the local stack; items requiring
founder-held accounts are called out explicitly, never simulated.

## 1 · Infrastructure completed

**Runtime tenant isolation (PRP-1 §1) — the flagship, implemented and proven.**

- `withTenantDb` (packages/db): the serving-path tenant boundary —
  drizzle-typed transaction with `set_config(..., is_local=true)` GUCs. The
  frozen `withTenant` remains for raw-SQL consumers; no existing symbol
  changed shape.
- Two-role recipe (`ops/db/create-app-role.sql`): `desiauction_app`
  (NOSUPERUSER NOBYPASSRLS — policies load-bearing) and `desiauction_system`
  (BYPASSRLS, least-privilege) for the two RC-4-documented pre-tenant token
  paths (invite preview/accept), selected by `SYSTEM_DATABASE_URL` (unset =
  single pool, dev unchanged).
- Runtime probe (`pnpm rls:verify`): asserts the connected role cannot bypass
  RLS, every RLS table fails closed outside a boundary, in-boundary counts
  match owner truth exactly, cross-tenant stays invisible.
- Wired domains: identity/auth (incl. person-scoped security events — found
  live when the drill surfaced RLS-refused audit writes) and orgs
  (create/invite/accept/grants/views).

**Deployment artifacts (PRP-1 §2).** finops-runner gains its missing
Dockerfile (distroless non-root, 244 MB), fly.toml (no http_service — the
supervisor is its health truth), and a credential-gated deploy workflow
mirroring the engine's. Engine image (310 MB) built for the first time —
both images verified locally.

**Operational automation (PRP-1 §5).** `pnpm db:restore-verify`
(snapshot-consistent backup drill), `nightly-verify.yml` (fresh migrations →
integration → RLS probe → restore-verify → full e2e, 03:00 IST), and runbooks:
[DEPLOYMENT](../operations/DEPLOYMENT.md) ·
[SECRET_ROTATION](../operations/SECRET_ROTATION.md) ·
[DISASTER_RECOVERY](../operations/DISASTER_RECOVERY.md) ·
[PRODUCTION_CHECKLIST](../operations/PRODUCTION_CHECKLIST.md).

## 2 · Operational validation (all executed, none simulated)

| Quality gate | Result |
|--------------|--------|
| RLS verification | **PASS** — probe under `desiauction_app`: 35/35 tables fail closed, 33/33 org-scoped tables exact-match in-boundary, cross-tenant invisible |
| Production-role smoke | **PASS** — web tier booted under the non-BYPASSRLS app role + system pool; OTP login, org create → invite → accept → grant → isolate, session management: 13/13 e2e green with RLS load-bearing |
| Behavior-neutrality re-certification | **PASS** — owner-role full suites unchanged: 384 unit, 261 web-integration, 64 engine-integration, e2e exit 0 (45 passed + 3 retry-passed jitter) |
| Fresh deployment (image level) | **PASS** — both Docker images build; runner boots, connects, ticks, exits clean on SIGTERM |
| Backup restore | **PASS** — snapshot-consistent drill run DURING live suite writes: 43/43 tables exact (the naive compare was proven wrong by that same load and replaced) |
| Secret rotation drill | **PASS** — live engine: pre-rotation old-secret 404/wrong-secret 401/old-ticket accepted; post-rotation old-secret 401, stale ticket refused at upgrade, new ticket accepted; 1.29 s restart downtime |
| Alert validation, provider failover, production smoke on real infra | **NOT RUN** — no provisioned environment/providers exist (see §4) |

One defect found during PRP-1 (validation-caught, fixed, re-certified):
person-scoped security-event writes/reads ran outside any boundary and were
RLS-refused under the app role — `security-events.ts` now owns its person
boundary; login/lockout/passkey/session e2e re-certified under the app role.

## 3 · Performance measurements

None new — PRP-1 §6 requires the production deployment ("no local
measurements"), which does not exist yet. Local baselines stand in
[PVP-1_REPORT §4](PVP-1_REPORT.md). The staging certification run (1000
players, 5000 registrations, 100 bidders via `PERF_BIDDERS`, 500/1000/5000
spectators, CPU/memory/DB/recovery/network) is checklist item §6.

## 4 · Remaining blockers

All remaining work is gated on founder externals or sequenced rollout — no
open engineering unknowns:

1. **Founder externals**: Fly + Vercel accounts, managed Postgres 17, S3
   storage, domains/TLS, Razorpay production keys, SMS/email/WhatsApp
   provider accounts, production Sentry DSNs.
2. **Domain wiring sweep**: competition, registration, auction, settlement,
   finops web actions through `withTenantDb` (pattern certified on orgs;
   each domain certifies by running its suite under the app role). The
   production role flip happens only after the sweep completes.
3. **SMS adapter** — the one real implementation gap (OtpSender port +
   pumping circuit-breaker) once a provider account exists.
4. **Post-provisioning drills**: staging perf certification, alert
   validation, provider failover, quarterly PITR drill #1, live Razorpay
   staging transaction.
5. **CTO decision needed**: the RC-4 membership-gated `organizations` policy
   requires a migration — currently barred by the freeze and by PRP-1's
   no-migrations constraint. Approve as a scoped exception or defer
   (app-layer 404 covers it, per the RC-4 reviewer's acceptance).

## 5 · Production checklist

Maintained as the living gate: [PRODUCTION_CHECKLIST](../operations/PRODUCTION_CHECKLIST.md)
(☑ done/verified · ☐F founder externals · ☐E engineering-once-unblocked).

## 6 · Go / No-Go recommendation

**NO-GO for production today — GO for provisioning.** The platform is now
deployable (all three artifacts build and boot), operable (runbooks +
automation exist and were drilled), recoverable (restore and rotation drills
passed with measured numbers), observable at the transport level (Sentry +
structured logs; dashboards await infra), and secure in depth on the wired
paths (RLS proven load-bearing end-to-end through the real UI). What stands
between here and GO is exactly the checklist: accounts and credentials only a
founder can create, the mechanical domain-wiring sweep, and the staging
drills that need real infrastructure. No further engineering program is
required before provisioning begins — PRP-1's remaining items burn down
against the checklist, and the go-live gate is a production smoke plus a
re-issued report with measured staging numbers.
