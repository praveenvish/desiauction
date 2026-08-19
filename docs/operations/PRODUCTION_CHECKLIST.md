# Production Checklist (PRP-1 deliverable 5)

Single source of truth for go-live. Items marked ☐F need founder-held
accounts/credentials; ☐E are engineering actions executable once the ☐F
above them exist; ☑ are done and verified in-repo.

## 1 · Tenant isolation (PRP-1 §1)

- ☑ `withTenantDb` boundary (packages/db) — drizzle-typed, transaction-local GUCs
- ☑ Role recipe `ops/db/create-app-role.sql` (app = non-BYPASSRLS, system = least-privilege BYPASSRLS for invite-token paths)
- ☑ Runtime probe `pnpm rls:verify` (every RLS table fails closed; live-data counts match in-boundary; cross-tenant invisible). **37** tables carry `FORCE ROW LEVEL SECURITY` today, up from the 35 recorded here at RC-1 (`grep -c "force row level security" packages/db/migrations/*.sql`). The probe enumerates `pg_class.relrowsecurity` at runtime rather than checking a list, so the count is *descriptive of the schema on the day it ran* — it is not a gate and a changed number is not a failure. What gates is that every table it finds returns zero rows outside a tenant boundary.
- ☑ Runtime probe `pnpm --filter @desiauction/web grants:verify` — asserts a declared grant manifest against the real four roles and exits 1 on drift. Added 2026-08-19 after the recipe was found twelve migrations behind the code: the engine had no `UPDATE` on `registrations`, so the first sale of an auction deadlocked under the production roles, and the app role had no privileges at all on six post-RC-1 tables (audit `docs/audits/FINAL-PRR/REPORT.md` P0-1). Now a CI gate.
- ☑ Wired + certified under the app role: identity/auth (incl. security events), orgs (create/invite/accept/grants), sessions — 13/13 e2e green under `desiauction_app`
- ☑ Full wiring sweep (Go-Live 2026-07-16): competition, fixtures/venues,
  registration ops, auction foundation, owner-join tokens, live auction,
  conduct & ceremony — every `"use server"` action runs inside a
  withTenantDb boundary or on the documented system pool. FULL e2e suite
  certified with web under `desiauction_app`: zero RLS refusals, zero server
  errors across every journey.
- ☑ Writer roles: `desiauction_engine` + `desiauction_runner` (BYPASSRLS,
  non-superuser, least-privilege DML). Live auction + conduct/ceremony e2e
  green with the engine writing as `desiauction_engine`; runner boot-smoked
  under `desiauction_runner`. finops_events DML revoked from the app role —
  freeze §8.2 landed.
- ☐E Flip production `DATABASE_URL`s to the four-role recipe at first deploy
  (app/system/engine/runner) — the posture is now fully certified locally.
- ☐E (CTO approval required — needs a migration, currently frozen) the
  membership-gated `organizations` RLS policy folded into RC-4's conditions.

## 2 · Infrastructure (PRP-1 §2) — all ☐F then ☐E

- ☐F Fly.io account + `FLY_API_TOKEN` org secret; apps `desiauction-engine-{staging,production}`, `desiauction-finops-runner-{staging,production}`
- ☐F Vercel project + domains (`RP_ID`/`RP_ORIGINS` must match the public domain — passkeys break otherwise)
- ☐F Managed Postgres 17 (Mumbai, PITR + daily dumps to a separate credential/account)
- ☐F S3-compatible object storage + durable storage roots (freeze §8.4)
- ☐E Run the DB bootstrap (migrations → **all four** roles → `grants:verify` → `rls:verify`) per [DEPLOYMENT](DEPLOYMENT.md). The role command needs four passwords; the two-password form printed in the runbook until 2026-08-19 aborted before creating the engine and runner roles.
- ☑ Engine image builds (310 MB distroless) · ☑ Runner image builds + boot-smoked (244 MB)
- ☐E First staging deploy of all three + smoke

## 3 · Providers (PRP-1 §3)

- ☐F Razorpay production keys + webhook secret; one live staging transaction (order → webhook → capture → discharge). The ingress route now exists at `apps/web/src/app/api/webhooks/razorpay/route.ts` — until it landed there was nothing for Razorpay to POST to and this gate was unrunnable as written (audit P1-5). Env, all three **required only if taking payments**, all optional otherwise:
  - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` — gateway credentials.
  - `RAZORPAY_WEBHOOK_SECRET` (min 16 chars) — keys the HMAC. **Fail-closed: unset ⇒ the route 404s**, like the two SMS webhooks. Leave it unset and callbacks are refused rather than trusted; set it and payment capture can complete.
- ☐F SMS provider account (go-live-critical: login is OTP-first; only DevInboxSender exists) → ☐E implement the `OtpSender` port adapter + SMS-pumping circuit-breaker (RC-4 condition 2)
- ☐F Email provider · ☐F WhatsApp BSP → ☐E finops dispatch adapters (outbox + in-app are already first-class; SDKs are drop-ins per IP-6)
- ☐E Provider health monitoring (poll provider status into the finops supervisor's component list)

## 4 · Observability (PRP-1 §4)

- ☑ Sentry wired (web + engine) — ☐F production DSNs
- ☑ Structured pino logs everywhere; Fly/Vercel aggregate by default
- ☐E Dashboards + alerts on: engine `/healthz`, bid-ack p95, WS fan-out,
  runner tick age, finops supervisor status, settlement meters, DB
  connections/replication, backup success (docs/56 SLOs). Alert on SILENCE
  (missed backup, stale runner cursor), not just errors (C-2).
- ☐E Alert-validation drill: kill the staging runner, verify the page fires.

## 5 · Operational automation (PRP-1 §5)

- ☑ Nightly verification workflow (fresh migrations, integration, e2e, RLS probe, restore-verify). Its role-creation step passed two of the four required passwords and aborted under `ON_ERROR_STOP`, so the four-role recipe had never been exercised by it (audit P1-3); fixed 2026-08-19. The workflow also needs a git remote to run at all.
- ⚠ Snapshot-consistent restore-verify (`pnpm db:restore-verify`) — drilled under concurrent writes, 43/43 exact **on 2026-07-16**. That measurement predates migrations 0015–0026, so the table count has moved and it must be re-drilled. Note also what it proves: `pg_dump` → `pg_restore` into a scratch database is row-count-lossless. It never reads a stored backup, replays no audit chain, and pages nobody — backup *restorability* remains unproven (audit P2-8, docs/62).
- ☑ Secret rotation runbook + drilled ENGINE_SECRET cutover (1.29 s downtime, stale credentials refused)
- ☑ Deployment + disaster-recovery runbooks
- ☐E Settlement sweep scheduling (freeze §8.3) hosted beside settlement's writer once staging exists
- ☐E finops writer-role credential + `finops_events` grant narrowing (freeze §8.2)
- ☐E Quarterly PITR human drill #1 on staging, timed against RTO
- ☐F TLS/certificates: platform-managed (Fly/Vercel) — confirm auto-renewal on the custom domains

## 6 · Performance certification (PRP-1 §6)

- ☐E Staging perf run on production builds/hardware: 1000 players, 5000
  registrations, 100 bidders (PERF_BIDDERS=100), 500/1000/5000 spectators;
  record CPU/memory/latency/DB/recovery/network. Local baselines exist
  (PVP-1 §4) but do not substitute — "no local measurements" stands.

## 7 · PX-11 production hardening (2026-07-17)

Covers the PX-2…PX-10 web product this checklist predated. Full findings in
[PX-11_HARDENING_REPORT](../validation/PX-11_HARDENING_REPORT.md).

- ☑ Security F1 — open-redirect guard (`safeNext`) hardened against the
  `/\evil.com` backslash bypass; allowlist-based; regression suite
  `src/server/auth/redirect-safety.test.ts`.
- ☑ Security F2 — stored XSS via JSON-LD on the public `/c/[slug]` page fixed
  (`serializeJsonLd` escapes `<>&`+line separators); regression suite
  `src/server/seo/json-ld.test.ts`.
- ☑ HTTP headers hardened: added `Content-Security-Policy`
  (`base-uri`/`object-src`/`frame-ancestors`/`form-action`), `Referrer-Policy`,
  `Permissions-Policy` (apps/web/next.config.mjs). Verified emitted on the prod
  build.
- ☐E CSP `script-src`/`style-src` with per-request nonces (needs middleware) —
  the four nonce-free directives ship now; the nonce rollout is the remaining
  CSP work.
- ☑ Web readiness probe `/readyz` (DB `select 1` → 200/503), distinct from the
  liveness `/healthz`. Mirrors the engine's DB-checking health.
- ☐E Wire the orchestrator: liveness → `/healthz`, readiness → `/readyz` (web)
  and `/healthz` (engine, already DB-checked).
- ☑ Engine graceful shutdown on SIGTERM/SIGINT (drain + Sentry flush + exit 0);
  the snapshot-recovery model already tolerated hard kills.
- ☑ Architecture: `no-circular` dependency-cruiser gate added; the one cycle
  found (finops `deliveries ↔ views`, type-only) fixed. Zero orphan modules;
  frozen domain packages untouched.
- ☑ Observability: engine pino redaction extended (secrets, OTP codes,
  engine-secret header); Sentry has no `sendDefaultPii`.
- ⚠ Scale watch (measure before optimizing — NOT a blocker at beta scale):
  `audit_log` has no index on `actor` or on `scope_id` alone; the PX-9 audit
  explorer and admin org directory filter by these. Add indexes before
  large-tenant GA, after measuring on staging with a realistic log volume.
- ⚠ Scale watch: web pool `max: 10`; the admin health page fans out one
  snapshot set per finance-declared org in parallel. Fine at beta scale; size
  the pool against the staging perf run (§6).

## 8 · PX-12 release engineering (RC-1, 2026-07-17)

- ☑ Cross-service config gate `pnpm preflight:production` — fail-closed over the
  production-completeness rules (system pool distinct from app pool, engine
  secret strength, OTP provider configured, RP origins https, storage absolute,
  engine URL remote). **Run it with the production env before every deploy; a
  FAIL means do not deploy.**
- ☑ Local production rehearsal (all three services in prod posture): builds,
  health/readiness, engine graceful shutdown, runner boot-smoke — see
  [PX-12_RELEASE_CANDIDATE](../validation/PX-12_RELEASE_CANDIDATE.md) §2.
- ☑ Beta programme docs: [BETA_ONBOARDING](BETA_ONBOARDING.md),
  [KNOWN_LIMITATIONS](KNOWN_LIMITATIONS.md), [ISSUE_REPORTING](ISSUE_REPORTING.md).
- ☑ Rollback criteria + success metrics + risk register: RC report §6–8.
- ☐E At deploy: run `preflight:production` (pass), the production smoke, and
  re-issue the PRP-1 report with staging numbers for the final GO.

## 9 · Post-audit configuration (2026-08-19)

New environment variables introduced by the remediation of the 2026-08-18 audit.
Each app's `env.ts` is the authority for validation. **None of them has been
added to `.env.example` yet** (verified 2026-08-19), so an operator copying that
file will not discover them — ☐E add them. This list says which ones a
**production** deploy must set. Full rationale in
[DEPLOYMENT §Environment variables](DEPLOYMENT.md#environment-variables).

- ☐E `ENGINE_ALLOWED_ORIGINS` (engine) — **required in production.**
  Comma-separated browser origins allowed to open the spectate WebSocket
  (e.g. `https://desiauction.in,https://www.desiauction.in`). A ticket
  authorises an *auction*, not a *page*: unset means "do not check", so any
  origin can open a socket with a scraped ticket. Unset is correct for local dev
  and native clients only.
- ☐E `ENGINE_SECRET` (web + engine) — **must be ≥ 32 characters in production**,
  enforced at boot (`apps/engine/src/env.ts`). The repo's `dev-engine-secret`
  default is refused outside `development`/`test` — staging is on the internet
  too, and that default is published in this repository. 32 is the width of the
  HMAC these secrets key, so a shorter value weakens the spectate ticket as well
  as the header.
- ☐E `WS_MAX_SOCKETS_PER_ROOM` (engine) — optional, default 2000. Per-auction
  socket ceiling. A DoS bound, not a product limit; raise it only against a
  measured spectator count.
- ☐E `WS_MAX_SOCKETS_PER_IP` (engine) — optional, default 50. Per-client-address
  socket ceiling.
- ☑ Purse privacy is enforced server-side: the WS ticket binds a money scope and
  the engine redacts rival purses per socket. Previously every subscriber
  received `purseRemaining` for all teams and only the client filtered it, so a
  bidder could read rival war-chests from the Network tab (audit P1-6). Nothing
  to configure — recorded here because the operator-facing promise ("purses are
  private") is now true of the wire, not just the UI.

## Go-live gate

Every ☐ above closed, plus: production smoke (OTP login → auction → payment
→ receipt), one full founder scenario on production infra, and the PRP-1
report re-issued with measured staging numbers and a GO.

**Also blocking as of 2026-08-19:** the 2026-08-18 production-readiness audit
(`docs/audits/FINAL-PRR/REPORT.md`) returned **NO-GO** with three reproduced
blockers. Its §9 list is part of this gate; do not read the ☑ marks above as a
GO on their own, since several of them were measured before migrations
0015–0026 and before the audit re-tested the branch.
