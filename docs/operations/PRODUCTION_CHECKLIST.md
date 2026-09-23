# Production Checklist (PRP-1 deliverable 5)

Single source of truth for go-live. Items marked ☐F need founder-held
accounts/credentials; ☐E are engineering actions executable once the ☐F
above them exist; ☑ are done and verified in-repo.

This is the ledger. The ORDER to do it in, with a proof for each step, is
[GO_LIVE_RUNBOOK](GO_LIVE_RUNBOOK.md).

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
- ☑ **The rehearsal** `pnpm --filter @desiauction/web rehearsal` (PA-1R 8.3) — one
  whole auction night under all four roles at once: the app tier signs four
  people in, builds the season and creates the auction; the *engine* role issues
  paddles, queues, opens, bids and hammers; the app tier settles and declares;
  the *runner* role's follower auto-issues the receipts. The owner touches only
  fixtures and teardown. It refuses to run if the app role turns out to be
  BYPASSRLS — a rehearsal run as the owner passes and proves nothing. This is
  the gate the other three probes leave open: `rls:verify`, `grants:verify` and
  `posture:verify` each check a property, and none of them runs a night.
- ☐E Flip production `DATABASE_URL`s to the four-role recipe at first deploy
  (app/system/engine/runner) — the posture is now fully certified locally.
- ☐E (CTO approval required — needs a migration, currently frozen) the
  membership-gated `organizations` RLS policy folded into RC-4's conditions.

## 2 · Infrastructure (PRP-1 §2) — all ☐F then ☐E

- ☐F **Contabo Cloud VPS 10, Navi Mumbai** — 4 vCPU / 8GB / 100GB NVMe,
  ~EUR 7.90/mo. Everything runs on it: web, engine, runner, Postgres, MinIO,
  Caddy and the log stack. 4GB would OOM under an auction; 2 vCPU is where the
  engine's timers and WebSocket fan-out start competing with Postgres.

  IN INDIA, and that is the reason rather than the price. The product's
  defining moment is forty people in a hall watching a countdown: ~20ms from
  Mumbai against ~140ms from Europe. Latency is what a club judges in the
  first ten minutes of a demo. There is also a live question — confirm it with
  counsel — about whether RBI's payment-data circular obliges Indian storage
  once Razorpay is handling collections.

  NOTHING HERE IS PROVIDER-SPECIFIC. The stack is one compose file; moving is
  three DNS records and an env file. Contabo bills monthly with no commitment,
  so a month of real use is the cheapest way to test its one known weakness —
  CPU oversubscription, which shows up as jitter and is the wrong failure mode
  for a gavel. Watch steal during a rehearsal auction before trusting it.
- ☐F **Contabo Auto Backup ON** (~EUR 1.15/mo): daily, stored OFF the server,
  10 days retained — a whole-machine image, the coarse last resort under the
  two off-box copies below.
- ☐F **An off-box S3 bucket for pgBackRest** (different account/provider —
  B2, R2, S3), keys in `pgbackrest.env` (ops/deploy/README "Backups"). ☑ The
  sidecar is automated: WAL archive, nightly full/diff, `BACKUP_OK`/`FAILED`
  lines, and it **refuses** an on-box repo unless `PGBACKREST_ALLOW_ONBOX_REPO=1`
  records the interim in writing.
- ☐F **An off-box S3 bucket for object storage**, keys in `mirror.env`. ☑ The
  `minio-mirror` sidecar copies the media and finops buckets hourly and refuses
  to run unconfigured.
- ☐F **`DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY`** in the `production`
  GitHub environment. `backup-production.yml` FAILS nightly until they exist
  (it used to report green with no backup taken), and `deploy-host.yml` cannot
  run without them.
- ☐F **Branch protection on `main`** with the required checks listed in
  [DEPLOYMENT](DEPLOYMENT.md) "Required status checks". Needs a repository admin;
  nothing in the repo can set it.
- ☐F Domain + three DNS records at the host: `PUBLIC_DOMAIN`, `ENGINE_DOMAIN`,
  `S3_DOMAIN` (`RP_ID`/`RP_ORIGINS` must match the public domain — passkeys
  break otherwise)
- ⚠ **`desiauction.in` is REGISTERED but PARKED, and cannot receive mail.**
  Checked 2026-08-27: `NS ns1/ns2.dns-parking.com`, `A 2.57.91.91`, **`MX` none**.
  Three separate things are waiting on this one piece of DNS:
  - the published Grievance Officer and privacy addresses (§10) currently
    **bounce** — and publishing them started a statutory clock;
  - `RP_ID`/`RP_ORIGINS` for passkeys must match this domain;
  - `PUBLIC_BASE_URL`, which the web tier refuses to boot without in production.
  Needs MX **plus SPF/DKIM/DMARC** — mail that arrives without them lands in
  spam, which for a grievance address is the same as not arriving.
- ~~☐F Managed Postgres 17~~ — superseded 2026-09-10 by the self-hosted `db`
  service; PITR is pgBackRest to the off-box bucket above.
- ☐E **TCP keepalives on the production database** (`tcp_keepalives_idle=30`,
  `tcp_keepalives_interval=10`, `tcp_keepalives_count=3`). Not tuning — the engine's
  single-writer lease is a session lock, and a connection severed without a close (host
  or VM restart, sleep, NAT expiry, partition) leaves a backend holding it indefinitely
  without these. A plain `kill -9` is fine — the kernel closes the socket. Observed
  locally 2026-08-31 after a Docker restart: four hours held, every replacement refused
  to boot. If the managed provider does not expose them, the
  manual recovery in [DEPLOYMENT](DEPLOYMENT.md) is the only way out of a wedged engine.
- ☐F S3-compatible object storage + durable storage roots (freeze §8.4)
- ☐E Run the DB bootstrap (migrations → **all four** roles → `grants:verify` → `rls:verify`) per [DEPLOYMENT](DEPLOYMENT.md). The role command needs four passwords; the two-password form printed in the runbook until 2026-08-19 aborted before creating the engine and runner roles.
- ☑ Engine image builds (310 MB distroless) · ☑ Runner image builds + boot-smoked (244 MB)
- ☐E First staging deploy of all three + smoke

## 3 · Providers (PRP-1 §3)

- ☐F Razorpay production keys + webhook secret; one live staging transaction (order → webhook → capture → discharge). The ingress route now exists at `apps/web/src/app/api/webhooks/razorpay/route.ts` — until it landed there was nothing for Razorpay to POST to and this gate was unrunnable as written (audit P1-5). Env, all three **required only if taking payments**, all optional otherwise:
  - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` — gateway credentials.
  - `RAZORPAY_WEBHOOK_SECRET` (min 16 chars) — keys the HMAC. **Fail-closed: unset ⇒ the route 404s**, like the two SMS webhooks. Leave it unset and callbacks are refused rather than trusted; set it and payment capture can complete.
- ☐F **Razorpay Route: a linked account per ORGANIZER — keys alone are no longer
  enough to take a payment (2026-08-27).** The platform holds one set of gateway
  credentials, so an order with no destination collects the organizer's dues into
  **Eventztree's** account, to be owed onward. That is money held for third
  parties — a different regulated business, and the opposite of what the Terms
  say ("we do not run your tournament or handle your money for you"). Founder
  decision: **split settlement**, funds go to the organizer.
  This is now enforced in code, not by convention: `settlementAccountRef` is a
  required field on `GatewayOrderInput`, the adapter emits Route `transfers[]`
  for the full amount, and `deps.settlementAccount()` defaults to **null**, which
  refuses every gateway payment with `no_settlement_account`. The platform's own
  account is not available even as a fallback.
  **What is still ☐F:** onboarding each organizer to a KYC'd linked account, and
  the ☐E that follows — persisting the account ref and wiring
  `settlementAccount()` to it. Until both exist, gateway payments refuse by
  design. Manual methods (cash/UPI/bank) are unaffected and remain the only money
  path this product has actually run.
  Ask a CA and whoever advises on the gateway BEFORE the keys go in: collecting
  on behalf of others is what drives compulsory GST registration for an operator
  and the RBI payment-aggregator question, and neither waits for a turnover
  threshold.
- ☐F Text channel for sign-in codes and personal messages: **WhatsApp (Meta Cloud API, direct) replaces SMS for launch** (founder decision 2026-09-23). ☑ The code exists: `WhatsAppCloudOtpSender` (authentication template, circuit breaker), `WhatsAppCloudSender` for utility templates, and the callback URL `/api/webhooks/whatsapp` (HMAC-verified; forward-only delivery status on `message_outbox`; STOP/START as `whatsapp.updates` consent rows, handled once per message id). `env.ts` refuses a production boot that sends on WhatsApp with `WHATSAPP_APP_SECRET` / `WHATSAPP_WEBHOOK_VERIFY_TOKEN` unset. What remains is founder-held: Meta Business verification, the number and display name, the System User token, template approval and the webhook subscription — [WHATSAPP_SETUP](../messaging/WHATSAPP_SETUP.md), [GO_LIVE_RUNBOOK](GO_LIVE_RUNBOOK.md) §C.
- ☐F _Deferred, not launch-critical:_ SMS provider account (MSG91) + DLT registration. `Msg91OtpSender` and the per-shape DLT template variables exist and stay dormant; nothing requires them while `OTP_PROVIDER=whatsapp`. Keep `LOGIN_DEFAULT_METHOD=email` until SMS is live.
- ☑ Email provider (2026-08-30). Two systems on two domains on purpose: Zoho
  mailboxes on the root, Resend sending on `mail.desiauction.in`, so a bounce
  storm from registration mail cannot degrade the reputation `privacy@` and
  `navrangi@` depend on. SPF/DKIM/DMARC pass on both; a real booking
  confirmation was delivered with its ICS attachment intact and Reply-To
  resolving to `support@`. Runbook: `docs/operations/EMAIL_SETUP.md`.
  Deployment env: `EMAIL_API_ENDPOINT`, `EMAIL_API_KEY`, `EMAIL_FROM` — **all
  three together or `transactionalMailer()` returns `UnconfiguredMailer`**,
  which reports rather than silently drops — plus `EMAIL_REPLY_TO`, which is
  deliberately outside that check because a missing Reply-To degrades the mail
  without disabling the provider.
  **Scope is transactional mail only.** This closes the founder-held account,
  not the dispatch wiring below.
  Still ☐F: **DMARC is at `p=none`** (report-only) on both domains. Tighten to
  `p=quarantine` ~2026-09-13, after reading the aggregate reports and
  confirming alignment — earlier and our own mail disappears. EDIT the existing
  `_dmarc` record; a second one invalidates both.
- ☑E finops dispatch adapters — email + in-app. The HTTP email adapter and the
  person-scoped in-app adapter live in `packages/messaging` (with the
  notification gate they pass) and are injected by BOTH `webFinopsDeps` and the
  finops runner, which is the process that actually drains `dispatch.send`.
  Until 2026-09-23 the runner injected nothing and ran the package defaults, so
  every production document was "delivered" to a no-op and a file on the
  runner's disk. `runner.env` now needs `EMAIL_API_ENDPOINT`, `EMAIL_API_KEY`,
  `EMAIL_FROM` (same values as `web.env`); the runner refuses to boot in
  production without them. ☐E WhatsApp remains.
- ☐E Provider health monitoring (poll provider status into the finops supervisor's component list)

## 4 · Observability (PRP-1 §4)

- ☑ Sentry wired (web + engine) — ☐F production DSNs
- ☑ Structured pino logs everywhere, collected into Loki and read through
  Grafana over an SSH tunnel (`ops/deploy/observability/`). Container logs are
  size-capped, so they can no longer fill the disk; Loki holds 30 days.
  ☐E ship them off-box — on-box logs are least available exactly when the
  machine is gone, which is the same limitation the backups carry.
- ☑ Alert rules provisioned from `ops/deploy/observability/grafana-alerting.yml`
  (2026-09-23): service/engine unhealthy (via `autoheal`), error rate, fatal,
  runner crash loop, webhook 5xx/4xx, backup + mirror failure AND silence,
  scheduled jobs failing or silent — [ALERTS](ALERTS.md) has the map and the gaps.
  ☐F `ALERT_WEBHOOK_URL` in `.env` (compose refuses to start without it).
  ☐F External uptime check on `/readyz` + engine `/healthz` + TLS expiry
  ([ALERTS](ALERTS.md) "Outside the box"). ☐F Sentry alert rules on the DSNs.
- ☐E Metrics-backed alerts still absent: bid-ack p95, WS fan-out, runner tick
  age / queue age, settlement meters, DB connections (docs/56 SLOs) — nothing
  measures them yet.
- ☐E Alert-validation drill: kill the staging runner, verify the page fires.

## 5 · Operational automation (PRP-1 §5)

- ☑ Nightly verification workflow (fresh migrations, integration, e2e, RLS probe, restore-verify). Its role-creation step passed two of the four required passwords and aborted under `ON_ERROR_STOP`, so the four-role recipe had never been exercised by it (audit P1-3); fixed 2026-08-19. The workflow also needs a git remote to run at all.
- ⚠ Snapshot-consistent restore-verify (`pnpm db:restore-verify`) — drilled under concurrent writes, 43/43 exact **on 2026-07-16**. That measurement predates migrations 0015–0026, so the table count has moved and it must be re-drilled. Note also what it proves: `pg_dump` → `pg_restore` into a scratch database is row-count-lossless. It never reads a stored backup, replays no audit chain, and pages nobody — backup *restorability* remains unproven (audit P2-8, docs/62).
- ☑ Secret rotation runbook + drilled ENGINE_SECRET cutover (1.29 s downtime, stale credentials refused)
- ☑ Deployment + disaster-recovery runbooks
- ☑ Settlement sweep scheduling (freeze §8.3): the compose `scheduler` calls
  `/api/jobs/settlement-coordination` every 5 min, beside the outbox drain,
  demo reminders and the feedback/retention sweep (2026-09-23). ☐F the three job
  secrets in `web.env`.
- ☐E finops writer-role credential + `finops_events` grant narrowing (freeze §8.2)
- ☐E PITR drill against the OFF-BOX repo on the production stanza, timed and
  recorded ([RESTORE_RUNBOOK](RESTORE_RUNBOOK.md) "Point-in-time restore"), then
  quarterly on staging
- ☑ TLS/certificates: Caddy provisions and renews Let's Encrypt automatically
  for all three hostnames — ☐E confirm renewal once in production

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
- ☑ CSP `script-src` with per-request nonces (2026-09-18): `src/middleware.ts`
  sends the full policy from `src/lib/csp.ts` as **Report-Only**, violations POST
  to `/api/csp-report`, and `e2e/content-security-policy.spec.ts` fails on any
  violation across public, console, admin and live-room surfaces.
  ☐E **Enforce it:** after one production deploy with no `csp.violation` lines in
  the logs, set `CSP_ENFORCE=1`. Unsetting it backs out without a deploy.
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
- ⚠ Scale watch: web pool defaults to `max: 10`, and is now settable —
  `DB_POOL_MAX` (web `env.ts`) feeds both the app and system pools, since both
  spend the same `max_connections` budget. It was hardcoded, which is right for
  a long-lived process and wrong for a fleet: on serverless it is ten per WARM
  INSTANCE, twice over, so enough instances exhaust a perfectly healthy managed
  Postgres and every request 500s while the database's own metrics look fine.
  The admin health page also fans out one snapshot set per finance-declared org
  in parallel. Size it against the staging perf run (§6), and provision a pooler
  before the fleet grows.

## 8 · PX-12 release engineering (RC-1, 2026-07-17)

- ☑ Cross-service config gate `pnpm preflight:production` — fail-closed over the
  production-completeness rules (system pool distinct from app pool, engine
  secret strength, OTP provider configured, RP origins https, storage absolute,
  engine URL remote). **Run it with the production env before every deploy; a
  FAIL means do not deploy.**
- ☑ Local production rehearsal (all three services in prod posture): builds,
  health/readiness, engine graceful shutdown, runner boot-smoke — see
  [PX-12_RELEASE_CANDIDATE](../validation/PX-12_RELEASE_CANDIDATE.md) §2.
- ☑ **Boot-time enforcement of the same rules (2026-08-22).** `preflight:production`
  is a script a human has to remember; `apps/web/src/env.ts` now refuses to
  START in production — as `apps/engine/src/env.ts` already did — on any of
  `OTP_PROVIDER=dev`, `MEDIA_STORAGE=local`, the default `ENGINE_SECRET`, a
  localhost `PUBLIC_BASE_URL`, or localhost `RP_ID`/`RP_ORIGINS`. Each of those
  defaults previously let a production web tier boot, report healthy and be
  silently broken (no SMS could be sent, no photo survived a redeploy, every
  canonical URL pointed at localhost). The checks are gated on
  `NEXT_PHASE !== "phase-production-build"`, so `next build` — which runs with
  `NODE_ENV=production` and none of the deployment's variables — is unaffected.
  **Consequence for this checklist item:** a local production rehearsal must now
  supply real-shaped values for those five variables, which is what "prod
  posture" always meant.
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

- ☐E `ENGINE_ALLOWED_ORIGINS` (engine) — **required in production, and now
  ENFORCED rather than merely documented (2026-08-26).** Comma-separated browser
  origins allowed to open the spectate WebSocket
  (e.g. `https://desiauction.in,https://www.desiauction.in`). A ticket
  authorises an *auction*, not a *page*: unset means "do not check", so any
  origin can open a socket with a scraped ticket. Unset is correct for local dev
  and native clients only.
  Two guards close it, because this line used to be the only thing standing
  between production and an open door — and the audit found the runbook claiming
  the preflight checked it when it did not: `apps/engine/src/env.ts` now REFUSES
  TO BOOT in production without it, and `preflight:production` FAILS on it
  (https origins only). Setting it is still an operator action; forgetting it is
  no longer a silent one.
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

## 10 · Legal identity & commercial posture (2026-08-27)

The Legal Centre shipped eight drafted documents that never said WHO was offering
them. `apps/web/src/content/company.ts` held every field `null` on purpose —
inventing a company name or an address is the worst line in this product to
fabricate — and `preflight:production` failed on it by design.

- ☑ **Operator published.** Eventztree Private Limited, CIN
  `U92419RJ2022PTC082398`, registered office Jaipur, Rajasthan 302019.
  Trading as DesiAuction. `legal-identity-published` now PASSES in
  `preflight:production`.
- ☑ **Grievance Officer** (IT Rules 2021, Rule 3(2)) and **data-protection
  contact** (DPDP s.13): Navrangi Vishnoi — `navrangi@desiauction.in`,
  +91 97849 84135. The Act permits one person to hold both at this size.
- ☑ **Jurisdiction reconciled.** The Terms named Mumbai while the company is
  registered in Jaipur; a forum clause that disagrees with the operator's own
  published address is the first thing a defendant attacks. Now Jaipur in both.
- ☐F **Confirm the registry fields against the certificate of incorporation.**
  They were read from an aggregator (Tofler), not the register. Registered
  offices in particular change without aggregators noticing. Check the
  capitalisation too — the registry renders it "Eventztree", not "EventzTree".
- ☐F **Confirm the registered office is also the PRINCIPAL place of business.**
  Consumer Protection (E-Commerce) Rules 4(3) asks for the latter, and they are
  not always the same address.
- ☐F **Make the grievance mailbox deliverable — see the DNS item in §2.**
  Publishing a named officer starts a clock: acknowledge in 24 hours, resolve in
  15 days. An address that bounces is not a gap, it is a statutory duty visibly
  not being performed, with a person's name attached to it.
- ☑ **GSTIN is `null` by decision** — Eventztree is not GST-registered. The
  surfaces correctly omit the row. ☐F **revisit before enabling payments**: an
  operator collecting consideration on behalf of suppliers faces compulsory
  registration regardless of turnover, which is why the Route item in §3 and this
  one have to be answered together.

## 11 · Second-audit remediation (2026-08-26, merged 2026-08-27)

A second production-readiness audit found defects the first one missed, all of
them in code and all now **on the deployable line** — this section previously
warned that they were stranded on an unmerged snapshot branch, which is no
longer true. Verified after the merge: `pnpm verify` green, web integration
**660/660**, engine integration **66/66**, all **31** migrations apply from an
empty database.

- ☑ **Engine split-brain closed.** The single-writer guarantee was platform
  configuration plus discipline; a scale-to-2, a bluegreen strategy or an
  orchestrator overlap put two timer authorities on one gavel. The engine now claims a
  Postgres session-level advisory lock at boot and a second instance **refuses
  to start** (exit 1), re-asserting every 10s and dying if it loses the lease.
  Proven by booting two real engines. **Operational consequence: scaling the
  engine past one machine will crash-loop the second, by design** — scale the
  web tier for capacity (see DEPLOYMENT §"The engine is ONE process").
  **Amended 2026-08-31:** a hard kill does release the lease (the kernel closes
  the socket), but a connection severed WITHOUT a close does not — the session
  outlives it until the database probes, so the lock CAN wedge a replacement; the refusal now names the holder and
  distinguishes a live second instance from an orphaned backend. See the
  keepalives item above — it is a prerequisite, not a nicety.
- ☑ **A refund was booked twice.** Razorpay emits both `refund.created` and
  `refund.processed` for one refund; the idempotency key used the event type, so
  a partial refund doubled `refundedTotal` and reinstated the obligation twice.
  Keyed on the kind now.
- ☑ **A payment intent could buy two gateway orders.** The command id was minted
  per invocation, so a double-submit or a retried action created two payments.
  Both halves now derive from one fingerprint of the intent.
- ☑ **Database invariants the application only assumed** (migrations 0029/0030):
  a partial unique index closing the two-live-auctions/double-sell race,
  non-negative money CHECKs, sold-state consistency, and the status enums
  promoted from TypeScript — `text(..., {enum})` emits plain `text`, so any
  string was a valid status as far as Postgres was concerned.
- ☑ **Four authorization holes**, including two `"use server"` exports that
  trusted a caller-supplied identity, plus an absolute session lifetime cap.
- ☑ **The public landing page**: the header went fully transparent for
  reduced-motion users and every non-Chromium browser (~1.07:1 contrast, and
  invisible to the axe run, which scans at scroll 0 over a dark hero), and every
  card's hover was inert because a filled scroll-timeline animation outranked it.
- ☐E **Still open from that audit, deliberately:** the settlement expiry sweep
  and coordination catch-up still have no scheduler (§5). It needs a new store
  query **and a product decision on the expiry window** — `expirePayment` moves
  real payments to a terminal failed state, so a wrong threshold destroys valid
  records. Not shipped blind.

## Go-live gate

Every ☐ above closed, plus: production smoke (OTP login → auction → payment
→ receipt), one full founder scenario on production infra, and the PRP-1
report re-issued with measured staging numbers and a GO.

**Also blocking as of 2026-08-19:** the 2026-08-18 production-readiness audit
(`docs/audits/FINAL-PRR/REPORT.md`) returned **NO-GO** with three reproduced
blockers. Its §9 list is part of this gate; do not read the ☑ marks above as a
GO on their own, since several of them were measured before migrations
0015–0026 and before the audit re-tested the branch.

**And as of 2026-08-27 — the three hard stops, in the order they bite:**

1. **Nobody can sign in.** Login is OTP-first and production refuses
   `OTP_PROVIDER=dev`, so without the text channel in §3 (WhatsApp for launch
   since 2026-09-23; SMS deferred) the phone door is shut for every user. This is the single largest gap between "deployable" and
   "usable".
2. **Nothing can be charged.** Both paid tiers read "Published at GA" — no price
   exists, and the upgrade path is a request a human grants out-of-band. Launching
   Free-only is a legitimate answer; launching with an undecided price is not.
3. **No rollback exists.** Migrations are forward-only, `0019_tournaments.sql`
   already dropped a column, and there is no restored backup (§5). The PITR
   machinery is in the stack as of 2026-09-23, but its off-box repo is
   founder-held (§2) and no restore from it has been drilled. A bad release
   cannot be undone until both are.

> **Read the ☑ marks against the branch you are deploying**, and note that
> §1–§9 above still contain their own open items. Code readiness is not
> deployment readiness: the three hard stops below are all infrastructure or
> commercial, and none of them is closed by the work in this section.
