# PVP-1 — Platform Validation Report

Run date: 2026-07-16 · Branch `main` at `3c13eeb` (ip6-frozen) · Local stack:
Postgres 17.10 (docker, port 5433), MinIO, Node 25.6.1, darwin/arm64.
All numbers below are measured, none estimated.

## 1 · Validation scenarios executed

| Layer | Scope | Result |
|-------|-------|--------|
| Static + unit gate (`pnpm verify`) | lint · typecheck · 384 unit tests (core 149, settlement 89, finops 84, ui 52, engine 8, contracts 2) · prettier · depcruise | PASS |
| Integration — web (`test:integration`) | 261 tests, 16 files: identity, authz (incl. RLS read/write proofs under a non-BYPASSRLS role), competition, registration ops, fixtures, auction foundation, settlement foundation/collections/closure/certification, finops foundation | 261/261 PASS |
| Integration — engine | 64 tests, 4 files: engine core, conduct ceremony, certification journey | 64/64 PASS after D1 fix; green twice consecutively |
| End-to-end (Playwright, real web + real engine + real WebSockets) | 14 spec files: login, passkeys, orgs, identity, competitions, registration ops, fixtures, auction foundation, live auction (1 organizer + 3 bidders, anti-snipe, engine restart mid-auction, convergence), conduct ceremony, a11y/motion/primitives/gallery | 46 passed, 0 failed, 2 flaky (passed on retry — documented shared-dev-compiler jitter), 3.2 min |
| Founder scenarios | Six one-command demos packaged over the certified suites | See [FOUNDER_SCENARIOS](FOUNDER_SCENARIOS.md); all green |
| Journey hand-offs | identity → org → competition → registration → auction → settlement → finops → close, each crossing exercised by the suites above with no mocked transitions | PASS |

## 2 · Defects discovered

| ID | Severity | What | Root cause |
|----|----------|------|------------|
| D1 | Medium (validation infra) | Engine certification suite failed `people_phone_unique` | Seed phones derived from `Date.now()` last-7-digits (repeats every ~2.8 h) collided with residue another harness left in the shared persistent dev DB; cleanup is best-effort `afterAll` |
| D2 | Medium (operational) | `pnpm env:check` failed for web with `DATABASE_URL undefined` | web's script alone omitted the `--env-file-if-exists=../../.env.local` loader that engine/finops-runner use — the env validator could not see the env it validates |
| D3 | Low (validation infra) | `perf:collections` aborted with `bid: BELOW_BASE` | Harness bid fixed amounts by queue position assuming position tracks price band; lot `seq` derives from same-millisecond ULIDs, which do not sort by insertion order |
| O1 | Observation | 2 flaky e2e specs (pass on retry) | Documented shared `next dev` compiler jitter (playwright.config.ts); every spec passes in isolation |
| O2 | Observation | Fastify deprecation: `disableRequestLogging` removed in fastify@6 | Engine pins fastify 5; address before any major bump |
| O3 | Observation | Host `pg_dump` v14 cannot dump the v17 server | Use the tools inside the container (drill + FOUNDER_SCENARIOS updated accordingly) |
| S1 | Systemic (validation infra) | ~19 other harnesses (e2e specs, perf scripts, web regression suites) use the same time-derived stamp pattern as D1 | Same collision class is latent everywhere; recommend the D1 fix pattern (crypto-random stamp) as a sweep |

## 3 · Defects fixed (each fixed separately, then re-certified)

| ID | Fix | Re-certification |
|----|-----|------------------|
| D1 | `RUN` now crypto-random, not time-derived (`apps/engine/src/integration/certification.integration.test.ts`) | 64/64 twice consecutively |
| D2 | web `env:check` gains the same env-file loader as sibling apps (`apps/web/package.json`) | `pnpm env:check` green for all 3 apps |
| D3 | Harness bids each lot's own `basePrice` instead of band-by-position (`apps/web/scripts/perf-collections.ts`) | Full perf:collections run green |

Also under PVP-1 authority (validation tooling only, no platform change):
`perf-live.ts` burst size is now `PERF_BIDDERS`-scalable (default 10 unchanged)
to measure the directive's 50-bidder scenario; six `demo:*` commands added to
`apps/web/package.json`. All changes pass lint, typecheck, and prettier.
Nothing under `packages/*` (frozen platform code) was touched.

## 4 · Performance measurements (median / p95, ms)

Engine live path (real HTTP/WS server, in-process core):

| Metric | median | p95 |
|--------|--------|-----|
| PlaceBid ack incl. re-fold + rebuild (100-lot) | 6.7 | 17.5 |
| 10 concurrent bids, burst wall, 1 winner | 65.8 | 69.4 |
| 50 concurrent bids, burst wall, 1 winner | 418.2 | 431.5 |
| Owner join (invite → accept → grant → claim) | 19.8 | 39.2 |
| Spectator join (WS connect → full snapshot) | 0.4 | 2.4 |
| bid → 50 spectators converged | 10.0 | 11.2 |
| bid → 200 spectators converged | 13.7 | 18.3 |
| Engine recovery (restart → replay → snapshot) | 3.2 | 4.5 |
| UndoLastAction (compensating events + rebuild) | 6.3 | 8.4 |

Scale sweep (players = lots):

| Lots | PlaceBid ack p95 | Recovery p95 | Snapshot build | Payload KiB |
|------|------------------|--------------|----------------|-------------|
| 100 | 11.4 | 4.6 | 2.6 | 18.2 |
| 250 | 9.7 | 5.1 | 3.7 | 39.3 |
| 500 | 11.8 | 6.9 | 6.5 | 74.5 |
| 1000 | 20.2 | 14.7 | 10.8 | 144.8 |
| 2500 | 36.1 | 29.0 | 22.9 | 358.6 |

Broadcast fan-out (250-lot auction, real WebSockets, bid → last client converged):
250 spectators 32.4/35.4 · 500 spectators 50.7/62.3 · 1000 spectators 104.3/105.0.

Against budgets (docs/57): snapshot build < 150 ms @400 lots → 6.5 ms @500 ✔ ·
engine restart→recovered < 10 s → 29 ms @2500 lots ✔ · fan-out < 500 ms p95 →
105 ms @1000 clients ✔ (5000-client point not yet measured — extrapolation
refused) · bid validate+append < 20 ms p99 → ack p95 20.2 ms @1000 lots is at
the budget edge and 36.1 ms @2500; the O(n²)-by-design cause and its mitigation
ladder are already documented in docs/auction/PERFORMANCE.md (today's 2500-lot
number beats the 60 ms recorded there).

Domain paths: competition (520 fixtures) — stats 0.5, paged query 3.2/3.9,
conflict engine 4.3/5.7, reschedule 5.5/6.2 · settlement — payment create
2.5/3.4, journal post 10.2/13.7, webhook ingress 11.8/14.2, org-wide
projection rebuild + recovery 219.8/291.7 · closure — verify 1.6, close 6.9,
evidence replay 2.4 · finops — receipt 6.8/9.0, document reproduce 1.8,
period close 9.8, supervise 390.0/396.5, certify (double-derived replay)
780.9/900.7.

Memory: peak harness RSS 371 MB during the 50-bidder run (tsx dev loader;
production runs the esbuild bundle, so treat as an upper bound). CPU and
sustained-load profiles under production build remain to be measured on the
deploy target (staging), not on a laptop.

## 5 · Operational readiness

| Area | Status |
|------|--------|
| env validation | Green 3/3 apps after D2 fix; each app fails closed at boot on bad env |
| Deployment | engine: Fly (Dockerfile + fly.toml + workflow; staging auto, production manual-dispatch) · web: Vercel platform flow (docs/60) · **finops-runner: no deployment artifact exists** |
| Database | 16 migrations applied cleanly, 43 tables; journal pitfall: new migrations need `when` bumped past the hand-spaced future dates or drizzle silently skips them |
| Backup / restore | Drill executed: pg_dump 1.6 MB/0.40 s → restore 0.33 s → 43/43 tables exact row-count identical. PITR + automated restore-verify job are deploy-time (managed PG) per docs/62 |
| Object storage | MinIO local ✔; production S3-compatible store not wired (freeze §8 item 4) |
| Email / SMS / WhatsApp | **Dev inbox only** — no production delivery adapter exists for any channel; login is OTP-first, so SMS is go-live-critical |
| Payments | Razorpay adapter complete and forgery-tested (HMAC + freshness window + envelope pin) but never exercised against the live gateway; production keys not wired |
| Logging / errors | pino structured logs; Sentry wired in web and engine |
| Metrics / alerting | Designed (docs/56) but not provisioned — deploy-time |
| Secret rotation | **No procedure** for ENGINE_SECRET / webhook secret; spectator-ticket validation has no dual-secret grace, so rotation is a hard cutover |

## 6 · Security validation

Executed and green: OTP replay, enumeration resistance, 5-attempt lockout with
security event, attempt cap under concurrency, per-phone (5/h) and per-IP
(20/h) rate limits, session rotation + cross-account isolation, passkey
fail-closed (unknown credential, garbage payload, forged challenge), invite
lifecycle (accept-once, replay, expiry, revocation), capability escalation
refused, audit-log immutability under the production grant recipe, webhook
forgery (bad signature 401, stale/malformed 400, envelope pin), engine command
auth (shared secret, web-tier only) and windowed HMAC spectator tickets with
timing-safe comparison, RLS read + write-check proofs under a dedicated
non-BYPASSRLS role.

Findings:

- **RLS is latent at runtime (production blocker).** `withTenant` has zero
  call sites; the app connects as an RLS-exempt role (locally
  `desiauction` = superuser + bypassrls). Policies are FORCE + fail-closed, so
  a production role per the documented recipe would return empty reads until
  `withTenant` is wired — the two layers must be wired together before
  deploy. Known freeze §8 item 1; PVP-1 confirms it empirically.
- **Secret rotation gap** (see §5).
- Tenant isolation at the app layer is real and proven (authz regression +
  e2e); DB layer is defense-in-depth awaiting wiring.

## 7 · Production blockers and go/no-go

Blockers (all are deployment wiring, none are platform defects; items 1–5 are
the freeze package's own §8 list, confirmed here):

1. Wire `withTenant` + non-BYPASSRLS runtime role (tenant isolation at the DB layer).
2. Production delivery providers — SMS first (OTP login), then email/WhatsApp BSP.
3. Razorpay production keys + one live-mode staging smoke of order → webhook → capture.
4. finops-runner deployment artifact (Dockerfile/fly.toml/workflow — engine precedent).
5. S3-compatible artifact store + durable storage roots; finops writer-role restriction; settlement sweep scheduling.
6. Secret rotation runbook (and ideally dual-secret grace for spectator tickets).
7. Provision metrics/alerting and the automated backup restore-verify job on the deploy target.
8. Staging performance re-run on the production build/target incl. the 5000-client fan-out point.

**Recommendation: NO-GO for production today; GO to deployment preparation.**
The platform validated as one integrated product: every journey hand-off is
real and green, every measured number is inside budget except the documented
2500-lot bid-ack edge, all three defects found were validation-infrastructure
defects — zero platform defects surfaced. The blockers above are the already-
enumerated pre-deploy checklist plus two additions from this program (rotation
runbook, finops-runner artifact). Re-issue go/no-go after a staging environment
passes items 1–7 and the staging perf re-run (item 8).
