# PX-12 — Release Candidate & Public-Beta Readiness

Release candidate: **1.0.0-rc.1** · Date: 2026-07-17 · Branch `main`
(post-PX-11). Concludes the engineering programme. Everything marked verified
was executed and measured on this machine; nothing was simulated. Real
cloud provisioning was **verified impossible from here** (no Fly/Vercel/cloud
credentials) and is a founder action — the same honest posture as
[GO_LIVE_REPORT](GO_LIVE_REPORT.md), [PVP-1](PVP-1_REPORT.md),
[PRP-1](PRP-1_REPORT.md).

PX-12 is release engineering, not product engineering: no features, no workflow
changes, no business logic. It changed exactly two things at the repo level —
the production **preflight validator** (`pnpm preflight:production`) and this
release-engineering documentation set.

---

## 1 · Production environment

Provisioning is founder-held (☐F) and unchanged from the checklist. What
software carries is complete and locally certified:

| Component | Artifact | State |
|-----------|----------|-------|
| Web | Next production build (57 pages), Vercel flow | ✔ builds; `/healthz`+`/readyz`; security headers |
| Engine | esbuild bundle (132 KB) + Dockerfile + fly.toml + deploy workflow | ✔ builds; boots in prod posture; `/healthz` DB+watchdog |
| Runner | esbuild bundle (200 KB) + Dockerfile + fly.toml + deploy workflow | ✔ builds; boots + ticks + clean SIGTERM |
| Database | 15 migrations, four-role recipe (`ops/db/create-app-role.sql`), `pnpm rls:verify` gate | ✔ applied; RLS proven under the app role |
| Config | `pnpm preflight:production` — cross-service fail-closed gate | ✔ 12 blockers on empty env, 15/15 on a complete env |

**Founder externals (☐F, roadmap PX-12a):** Fly + Vercel accounts, managed
Postgres 17 (Mumbai, PITR), S3-compatible storage, SMS (MSG91), Razorpay live
keys, domains/TLS, Sentry DSNs, metrics/alerting. Redis is **not required** —
the platform uses Postgres-backed queues and polling by design (ADR-3); there is
no Redis dependency to provision.

## 2 · Deployment validation

Rehearsed against a local production-posture stack (prod builds, prod
`NODE_ENV`, four-role Postgres):

| Step | Result | Timing |
|------|--------|--------|
| Web prod build | ✔ 57 static pages | ~4 s compile |
| Engine prod build (esbuild) | ✔ 132 KB bundle | ~1 s |
| Runner prod build (esbuild) | ✔ 200 KB bundle | <1 s |
| Migrations | ✔ 15/15 applied; re-run is a no-op (journal-tracked) | — |
| Config preflight | ✔ fails closed on incomplete; passes on complete | <1 s |
| Web health | ✔ `/healthz` 200 (liveness), `/readyz` 200 `db:ok` (readiness) | ready <10 s |
| Engine health | ✔ `/healthz` `{db:ok, watchdog:ok}` under prod `NODE_ENV` | ready ~2 s |
| Engine authz | ✔ unauthorized `/command` → 401 | — |
| Engine graceful shutdown | ✔ SIGTERM → "draining connections" → clean exit | <1 s drain |
| Runner boot-smoke | ✔ started + ticking + clean SIGTERM | — |
| Security headers | ✔ CSP/Referrer-Policy/Permissions-Policy/HSTS/X-Frame/X-Content-Type emitted | — |

**Rollback**: PX-2…PX-11 added **zero migrations** — rollback is a pure
app-image swap with **no schema step and no data migration to reverse**. This is
the strongest possible rollback posture: zero data loss, zero manual DB
intervention, by construction.

**Blue/green / rolling**: Fly rolling deploys (fly.toml auto-restart) + Vercel
atomic deploys are the platform-native mechanisms; no custom orchestration.

## 3 · External service validation

Adapters exist and are behaviour/forgery-tested; **live-account validation is a
founder action** (the accounts don't exist here):

| Provider | Adapter state | Live validation (☐F) |
|----------|---------------|----------------------|
| SMS OTP | MSG91 adapter + circuit-breaker; dev sender for local | Send a real code; measure delivery latency. **Go-live-critical.** |
| Object storage | Filesystem adapter; S3 port ready | Upload a document, download it, verify bytes. |
| Payments | Razorpay adapter, HMAC + freshness + envelope-pin forgery-tested | One live order → webhook → capture → discharge. |
| Webhook delivery/retry | Ingress route + idempotent handler; retry/dead-letter in the finops runner | Confirm retry + provider-failure handling against the live gateway. |
| Credential rotation | ENGINE_SECRET rotation drilled (1.29 s downtime, stale creds refused) | Rotate provider keys per [SECRET_ROTATION](../operations/SECRET_ROTATION.md). |

## 4 · Operational readiness

| Area | State |
|------|-------|
| Background workers (follower, dispatch, certification, schedules) | ✔ idempotent + recover after restart (IP-6 certified; runner boot-smoked in prod posture) |
| Recovery after restart / deploy | ✔ engine replays to snapshot (restart-mid-auction e2e); finops jobs/follower idempotent; engine now drains on SIGTERM |
| Audit integrity | ✔ append-only, correlation IDs throughout; platform-admin audit explorer surfaces it read-only |
| Log aggregation | ✔ structured pino JSON, PII-redacted; ☐F aggregation dashboards on Fly/Vercel |
| Metrics / alerting / dashboards | ☐F provision at deploy; wire alert-on-silence (docs/56 SLOs) |
| Backup / restore | ✔ `db:restore-verify` drilled 43/43 exact under concurrent writes; ☐F PITR on managed PG |
| Config validation | ✔ `preflight:production` + per-app fail-closed boot env |

## 5 · Founder demonstration

The demonstration provisions real cloud infra (founder-held). PX-12 executed the
code/ops side against a local production-posture stack; the full user lifecycle
is certified by the e2e suites (real web + real engine + real WebSockets):

- Provision / deploy / migrate / validate health — ✔ rehearsed (§2).
- Authenticate via OTP — ✔ certified in dev (the prod SMS path needs the live
  MSG91 account; the dev inbox is structurally absent in production).
- Create competition → register → live auction → settlement → financial
  documents → administration — ✔ green across the auction/settlement/finance/
  admin e2e suites; the same server code serves the prod build.
- Upload/retrieve documents — ✔ via the finops document flow (filesystem
  adapter locally; S3 in production).
- Observe monitoring — ✔ structured logs + health; ☐F dashboards.
- Restart services / verify recovery — ✔ engine + runner restart clean; recovery
  certified.
- Rollback rehearsal — ✔ schema-free app-image swap.
- Restore backups — ✔ restore-verify drilled 43/43.

**Honest gap:** a single unbroken run on real production infra with live SMS,
S3, and payments requires the founder externals and is the PX-12a cutover, not a
repo deliverable.

## 6 · Risk register

| # | Risk | Likelihood | Impact | Mitigation / owner |
|---|------|-----------|--------|--------------------|
| RK-1 | SMS not provisioned → nobody can log in | High until closed | Critical | Preflight blocks deploy without `OTP_PROVIDER=msg91`+creds; founder provisions (☐F). |
| RK-2 | Prod DB role has BYPASSRLS → tenant isolation off | Low | Critical | `rls:verify` gate + preflight `SYSTEM_DATABASE_URL-distinct`; refuse deploy otherwise. |
| RK-3 | Production perf unmeasured on real hardware | Medium | High | Local baselines pass budgets; run the staging perf sweep before opening signups (PRP-1 §6). |
| RK-4 | S3 not wired → artifacts on ephemeral disk | Medium | High | Preflight requires absolute/S3 `FINOPS_STORAGE_DIR`; founder provisions. |
| RK-5 | Cross-browser/Safari WebAuthn unverified | Medium | Medium | Chromium green; run other engines + real devices at staging; RP_ID/origins preflight-checked. |
| RK-6 | `audit_log` scan at large tenant scale | Low (beta) | Medium | Documented; add `actor`/`scope_id` indexes after measuring. |
| RK-7 | Missing Sentry DSN → errors invisible | Medium | Medium | Preflight warns; founder sets DSNs. |
| RK-8 | Legal wording not ratified | High | Low | Pages marked beta drafts with versions; ratify before GA. |

## 7 · Rollback criteria

Roll back (previous app image; **no DB step**) if, after a deploy:

- `/readyz` or engine `/healthz` does not go green within the deploy window;
- a smoke-test step (OTP login → auction → settle → receipt) fails;
- an **S1** issue (money integrity, data loss, auth broken, live auction blocked
  platform-wide) is confirmed and not resolvable in place;
- error rate or latency breaches the SLO envelope (docs/56) sustained.

Because no migration ships across PX-2…PX-11, rollback is always safe: swap the
image, no schema or data reversal. If a future change ever ships a migration,
gate it as expand/contract and re-assess this criterion.

## 8 · Success metrics (first beta window)

- **Availability**: web `/readyz` and engine `/healthz` green ≥ 99% of probes.
- **Auth**: OTP delivery success ≥ 98%; median delivery < 15 s.
- **Lifecycle**: ≥ 1 tournament completes register → auction → settle → receipt
  with zero money-integrity issues (the immutable ledger reconciles).
- **Recovery**: any worker/engine restart recovers with zero data loss and no
  manual DB intervention.
- **Support**: zero unresolved S1; S2 median resolution within the beta day.

## 9 · Go / No-Go recommendation

**Engineering: GO.** The programme is complete and every engineering gate is
green (typecheck, lint, prettier, dependency boundaries incl. no-circular,
architecture/security/reliability/observability audits, unit, integration, e2e,
accessibility, security headers, production build). The two PX-11 security
defects are fixed with permanent coverage; rollback is schema-free; the preflight
refuses a misconfigured deploy.

**Launch: conditional GO — NO-GO until the founder-externals gate closes.**
Blocking items are provisioning and measurement, not engineering: (1) SMS live
account [RK-1], (2) app-role DB posture confirmed by `rls:verify` on the managed
DB [RK-2], (3) S3 storage [RK-4], (4) the staging perf sweep [RK-3], plus Sentry
DSNs and domains/TLS. When these close, run `preflight:production` (must pass),
the production smoke, and re-issue this report with staging numbers for the final
GO. Razorpay live keys and email/WhatsApp are **not** launch-blocking — manual
capture and the in-app inbox cover beta.

## 10 · Release Candidate summary

- **Version**: `1.0.0-rc.1`.
- **Scope**: the complete platform — identity, orgs/grants, competitions,
  registration, live auction, settlement, financial operations, platform
  administration, and the public help/legal/marketing surfaces — hardened
  (PX-11) and release-packaged (PX-12).
- **Migrations**: 15 (0000–0014); none added since IP-6 — rollback-safe.
- **Verification**: fresh full gate green (see the milestone reports).
- **Docs**: [BETA_ONBOARDING](../operations/BETA_ONBOARDING.md),
  [KNOWN_LIMITATIONS](../operations/KNOWN_LIMITATIONS.md),
  [ISSUE_REPORTING](../operations/ISSUE_REPORTING.md),
  [PRODUCTION_CHECKLIST](../operations/PRODUCTION_CHECKLIST.md) (§7 PX-11 + this
  RC), [DEPLOYMENT](../operations/DEPLOYMENT.md),
  [DISASTER_RECOVERY](../operations/DISASTER_RECOVERY.md).
- **Change log**: the in-product [Release Notes](/releases) (PX-10) carry the
  user-facing history; the milestone reports (PX-2…PX-12) are the engineering
  record.

Engineering stops here.
