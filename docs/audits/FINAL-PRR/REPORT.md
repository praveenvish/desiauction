# DesiAuction — Final Production Readiness Audit

**Date:** 2026-08-18 · **Branch:** `feat/ui-redesign` (105 commits ahead of `main`, 113 past `v1.0.0-rc.1`)
**Auditor posture:** combined architecture / QA / security / performance / SRE / DBA / product / a11y / release review
**Environment under test:** local production-posture stack — `next build` + `next start` (75 pages) on `:3050`, Fastify auction engine on `:4000`, Postgres 17 on `:5433` (27 migrations applied)

---

## EXECUTIVE VERDICT

# 🔴 NO-GO

**Overall readiness: 5.2 / 10**

DesiAuction is a genuinely well-engineered product. Its domain core is pure and heavily tested, its money arithmetic is integer paise end to end, its live auction engine is a properly serialized single writer with event sourcing, replay verification and tamper detection, and its role model held under every probe I threw at it. On the strength of the code alone this is above the median of systems that ship.

It is nonetheless **not deployable today**, for reasons that are specific, proven, and mostly cheap to fix. Three independent findings are each individually disqualifying:

1. **The documented production database role recipe cannot run the application.** Under the four-role recipe, the engine has no `UPDATE` on `registrations` — the table every sale writes — and the web app has no privileges at all on six tables shipped since RC-1. Verified by executing the actual statements under `SET ROLE`. Auction night fails on the first sale; messaging consent, notification preferences, email verification and match results fail on first use. This never surfaced locally because every local process connects as the database owner.
2. **The live auction timer can be frozen by any participant.** The engine's idempotency cache is keyed on a client-supplied `commandId` that shares a namespace with the engine's own internal timer commands, whose ids are derived from values published in every snapshot. Verified live: a non-conducting actor suppressed the gavel, the lot sat 25 s past its deadline unclosed, and a bid placed **57 seconds after the deadline was accepted and won the player**.
3. **A single unauthenticated packet kills the auction engine.** A malformed WebSocket upgrade target throws inside an `upgrade` listener, which the process turns into `process.exit(1)`. Verified: engine went from healthy to connection-refused in one request, no secret, no ticket, no session.

Beyond those, the release-engineering evidence base has decayed since RC-1: the rollback runbook is factually wrong (12 migrations have landed, one destructive, since the "zero migrations → schema-free rollback" claim), CI has never executed (no git remote) and does not gate the two proofs the release documents lean on, and CI's own dependency gate exits 1 today.

**None of this is a reason for despair.** The blockers are configuration, one namespacing bug, one missing `try/catch`, and honest documentation. My estimate is **1–2 focused engineering weeks** to a defensible GO, plus the founder-held externals that were already known.

---

## 1 · ARCHITECTURE MAP

| Layer | What | Notes |
|---|---|---|
| `apps/web` | Next.js 15 App Router — RSC pages + 22 `"use server"` action modules | 86k LOC; no REST API for the product surface (3 route handlers only) |
| `apps/engine` | Fastify + `ws` — the live auction runtime | single writer; per-auction FIFO command queue; 250 ms tick |
| `apps/finops-runner` | Poll loop over `finops_jobs` (`FOR UPDATE SKIP LOCKED`) | 15 s tick; no Redis anywhere by design |
| `packages/core` | Pure domain — money, clock, auction reducer, 35 invariants | lint-enforced purity (no `Date.now`/`process`/`fetch`) |
| `packages/auction` | Aggregate (DB writes) + read models | 1,847-line `aggregate.ts`; **zero tests in its own package** |
| `packages/{settlement,financial-operations}` | Certified writers over event streams | idempotent by command id at the DB |
| `packages/db` | Drizzle schema + 27 migrations + RLS policies | 37 tables carry `FORCE ROW LEVEL SECURITY` |

**Persistence:** event-sourced with same-transaction row projections. `auction_events(auction_id, seq)` unique is the total order and the concurrency backstop. Money is `bigint` paise; no floats, no rounding.

**Live bid path:** browser → server action (`liveGate` resolves session → competition → capability) → `POST /command` with `x-engine-secret` → per-auction FIFO queue → aggregate gauntlet → one transaction (bid row + event + audit row) → full event-log re-fold + projection diff → snapshot broadcast over WebSocket. Web never writes live auction state.

**Real-time:** engine WebSocket snapshots only (no SSE). **Caching:** none. **Background jobs:** Postgres-backed queue, no broker.

---

## 2 · WHAT WAS VERIFIED (evidence)

### Automated suites (executed this session)

| Gate | Result | Evidence |
|---|---|---|
| Production build | ✅ PASS | 75 pages, exit 0, ~13 s compile |
| `pnpm lint` / `typecheck` | ✅ PASS | `--max-warnings 0` across 11 packages; 0 `any`, 0 `@ts-ignore` |
| Unit tests | ✅ PASS | **523 passed / 523** (core 233, settlement 89, ui 107, finops 84, engine 8, contracts 2) |
| `pnpm depcruise` | ✅ PASS | 0 violations, 0 cycles, 1,641 modules |
| `pnpm format:check` | ✅ PASS | clean (the single reported file was my own audit helper — see §8) |
| Integration — engine | ✅ PASS | **66 / 66** (certification, live-engine, conduct-ceremony, healthz) |
| Integration — web | ⚠️ 598 / 600 | 2 failures in `consent.regression.test.ts`, time-of-day dependent (QA-3) |
| E2E (Playwright, precompiled) | ❌ **56 pass / 41 fail / 14 not run** | see §4 for classification |
| `pnpm audit --prod --audit-level high` | ❌ **exit 1** | 17 high + 6 moderate (SEC-6) |

### Live-system probes (executed against the running stack)

**Authorization matrix — measured**, 27 URLs × 5 real signed-in roles (stranger / viewer / bidder / organizer-staff / founder-owner). Results were correct in every cell:

| Surface | stranger | viewer | bidder | org staff | owner |
|---|---|---|---|---|---|
| `/org/{slug}` | 404 | 200 | 200 | 200 | 200 |
| `/org/{slug}/money`, `/settlement`, `/reconciliation` | 404 | 404 | 404 | 404 | 200 |
| `/seasons/{s}/registrations`, `/teams`, `/readiness` | 404 | 200 | 200 | 200 | 200 |
| `/seasons/{s}/money` | 404 | 404 | 404 | 404 | 200 |
| `/seasons/{s}/auction/cockpit`, `/engine`, `/ledger`, `/replay` | 404 | 404 | 404 | 404 | 200 |
| `/seasons/{s}/auction/live` | 404 | 404 | **200** | 404 | 200 |
| `/admin`, `/admin/users`, `/admin/audit`, `/admin/orgs/*` | 404 | 404 | 404 | 404 | 200 |

Non-membership is indistinguishable from non-existence (404, not 403) — correct. A viewer opening `/registrations` is told *"You don't have permission to review registrations for this season"* and receives **no player phone numbers** in the HTML; the organizer receives them. Data is gated, not just buttons.

**Authentication & session**
- Cookie `da_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, 32 random bytes, **SHA-256 hashed at rest**, 30-day sliding TTL, revocable per device. ✅
- OTP: 5/hour/phone, 20/hour/IP, 5 attempts, 5-min TTL, hashed at rest, replay-proof, lockout proven concurrent-safe. ✅
- Open-redirect: `safeNext` correctly folded `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:`, `%2F%5C`, `/%09/` → `/home`. ✅
- Dev-only surfaces structurally absent from the production build: `/dev/inbox` 404, `/gallery` 404. ✅

**Engine trust boundary** — `/command`, `/snapshot/:id`, `/diagnostics/:id`, `/admin/reset` all returned `401` without the secret (constant-time compare); `/admin/reset` 404s in production; WebSocket upgrade without a valid HMAC ticket is destroyed. ✅

**Media upload** — unauthenticated `401`; authenticated non-member `403`; path traversal, wrong extension and malformed keys `400` (regex-pinned key shape); 6 MB `400`. One gap: content is trusted on the declared `Content-Type` with **no magic-byte check** — a text file was stored as `.png` (SEC-8, low: the file is never served back by the production path).

**Webhooks** — `sms-inbound` and `delivery-status` return `404` when their secrets are unset. Fail-closed by design. ✅

**Injection** — SQLi, XSS, traversal and null-byte payloads through search and slug parameters: all correctly escaped (`&quot;&gt;&lt;img …`), no raw reflection, no stack traces, no database errors, no `X-Powered-By`. ✅

**Security headers** — CSP (`base-uri`/`object-src`/`frame-ancestors`/`form-action`), HSTS 2 y + subdomains, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. Deliberately no `script-src` (documented: needs a nonce + middleware). ✅ *with the noted gap*

**Concurrency & money invariants — live, through the real database path.** This is the area the test suite covers least (only in the pure reducer) and it held everywhere:

| Probe | Result |
|---|---|
| 10 simultaneous identical bids, 3 paddles | ✅ **exactly 1 accepted**, 9 rejected (`BELOW_CURRENT` ×6, `ALREADY_LEADING` ×3) |
| Same `commandId` submitted twice | ✅ identical ack returned, same `bidId`, no double write |
| Bid with another person's paddle | ✅ `NOT_AUTHORIZED` |
| ₹50 Cr bid on a ₹20 Cr purse | ✅ `BUDGET_EXCEEDED` |
| Negative / zero / float / 10²¹ amount | ✅ `INVALID_AMOUNT` (all four) |
| Off-ladder amount | ✅ `BELOW_BASE` |
| Bid while auction paused | ✅ `LOT_NOT_OPEN` |
| Bid after lot sold | ✅ `LOT_NOT_OPEN` |
| Close an already-sold lot | ✅ `illegal_transition` |
| Non-conducting actor issues `CompleteAuction` | ✅ `not_authorized` |

**Database integrity — 13 invariant queries over live data:** zero duplicate ownership, zero registrations sold in two lots, zero teams overspent, zero negative prices, zero orphaned bids/lots/registrations, zero teams with two captains, zero `auction_events` sequence gaps, zero accepted-bid/sold-price mismatches. The one apparent violation (840 sold lots whose `registrations.team_id` is null) is **pre-fix residue dated 2026-07-23/24**, before commit `8ff05b6`; across the 1,161 sales in the last 14 days the count is **0**. Correctly classified as residue, not a defect. ✅

**Performance (production build, warm):** TTFB 3–30 ms on every page probed, public and authenticated. `/` 27 ms, `/pricing` 6 ms, `/home` 28 ms, `/seasons/{s}/auction` 28 ms. Well inside budget. ✅

**Responsive & accessibility:** `responsive.spec` passed 9/9 across seven viewports (320→1920) asserting no horizontal overflow on public and console routes; `auth-onboarding` 10/10, `shell` 5/5, `public-experience` 5/5, `platform-administration` 5/5, `production-hardening` 4/4 — all carrying axe scans. ✅ *for the surfaces that ran*

---

## 3 · CRITICAL BLOCKERS (P0)

### P0-1 · Production database roles cannot run the application
**Risk:** Functional / Data Integrity / Operational · **Status:** Open · **Blocker: YES**

`ops/db/create-app-role.sql` enumerates the engine's writable tables and snapshots the app role's grants with `GRANT … ON ALL TABLES`. Neither has been updated for migrations 0015–0026. Proven by executing the real statements:

```
begin; set role desiauction_engine;
update registrations set team_id = team_id where id = (select id from registrations limit 1);
→ ERROR:  permission denied for table registrations

begin; set role desiauction_app; select count(*) from consent_records;
→ ERROR:  permission denied for table consent_records

begin; set role desiauction_app; select count(*) from fixture_results;
→ ERROR:  permission denied for table fixture_results
```

`packages/auction/src/aggregate.ts:623-634` updates `registrations.team_id` on **every sale**, requeue and withdrawal. The grant list at `ops/db/create-app-role.sql:83-85` does not include `registrations`, so **re-running the script does not fix the engine** — this is a code/ops defect, not only a process one.

Missing for `desiauction_app`: `consent_records`, `suppressions`, `notification_preferences`, `email_verifications`, `org_messaging_settings`, `fixture_results`.

**Actual production behaviour:** the first SOLD lot throws inside the close transaction; `enqueue` catches it and returns `engine_halted` *without caching the ack*, so the 250 ms tick re-enqueues the close **forever**. The lot never sells and the auction deadlocks. Separately, messaging consent, notification preferences, email verification and match results all fail on first use.

**Why nothing caught it:** every local process — web, engine, runner, seed, e2e — connects as the database owner (`scripts/setup-local.mjs`), which bypasses the entire grant model.

**Fix:** add `grant update on registrations to desiauction_engine;`; re-run the role script as part of the migration step; add a CI job that boots the app under `desiauction_app`/`desiauction_engine` and runs one sale. Make grants derived from the schema, not hand-enumerated.

---

### P0-2 · Any participant can freeze the auction timer and bid after the deadline
**Risk:** Data Integrity / Functional / Security · **Status:** Open · **Blocker: YES**

The engine's idempotency cache is keyed on `commandId` alone (`apps/engine/src/engine-core.ts:327-331`), and rejected commands are cached too. The engine's own timer commands use **predictable ids derived from public snapshot fields** (`engine-core.ts:666-686`):

```
timer-close-${lotId}-${endsAtMs}
closing-${lotId}-${endsAtMs}
```

`commandId` originates from the client and is never validated (`live-actions.ts:340`, `server.ts:181`). `ClaimPaddle` is not conduct-restricted, so any team owner in the room can pre-seed those ids.

**Reproduced live on a running auction:**

```
POST /command {commandId:"timer-close-01KYQ8214G1J6KWB86ZGCG7M2A-1787068480567",
               type:"ClaimPaddle", conduct:false, payload:{}}
→ {"accepted":false,"reason":"invalid_payload"}          ← now cached

… 40 s later …
lot status        on_block
ms past deadline  25097                                   ← gavel never fell

POST /command {type:"PlaceBid", conduct:false, amountRaw:1000000}   (57 s past deadline)
→ {"accepted":true,"bidId":"01M0ASB8MEDNGGTDFNXCN8CSFP","extended":true}
→ lastOutcome: {"kind":"sold","playerName":"Nikhil Joshi","teamName":"Demo Panthers"}
```

**The late bid won the player.** Each accepted bid publishes a new `endsAtMs`, which the attacker re-poisons — control is indefinite. A rival can hold a lot open until they win it, or stall one they are losing. There is also cross-actor ack leakage: a forged id returns another actor's cached ack (`bidId`, `amount`).

**Contributing weakness (P2-1):** `decideBid` never compares `now` to `endsAtMs` (`packages/core/src/auction.ts:455-507`), so expiry is enforced *only* by the tick — nothing independently refuses a late bid.

**Fix:** namespace internal commands unguessably and never route them through the ack cache; reject transport `commandId`s that are not UUID/ULID; key the cache by `(actor, commandId)`; add a `timer expired` guard to the bid gauntlet.

---

### P0-3 · Unauthenticated single-packet remote kill of the auction engine
**Risk:** Reliability / Security · **Status:** Open · **Blocker: YES**

`apps/engine/src/server.ts:254-255` constructs `new URL(request.url ?? "/", "http://localhost")` inside the `upgrade` listener. Node accepts request targets that `URL` rejects; the throw escapes the listener and `apps/engine/src/index.ts:28-30` converts any `uncaughtException` into `process.exit(1)`.

```
engine before: 200
printf 'GET //%zz/ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n…' | nc 127.0.0.1 4000
engine after:  000        ← process dead, connection refused
engine.log:    ERR_INVALID_URL  input: "//%zz/ws"
```

No secret, no ticket, no session, no rate limit. A loop keeps the live auction runtime down; on Fly it becomes a restart storm during the one hour the product exists for. Any internet scanner can trigger it accidentally.

**Fix:** wrap the handler in `try/catch` → `socket.destroy()`. Two lines. Also add `maxPayload`, per-IP connection caps and an `Origin` check while in there.

---

## 4 · CRITICAL FINDINGS (P1)

### P1-1 · The release branch has no green test run, and CI has never executed
**Risk:** Operational / QA · **Blocker: YES (process)**

- E2E: **41 of 111 failed.** Classified: **23 are harness artifacts** — the `/gallery` design-system routes are dev-only and 404 under a production build (`gallery`, `primitives`, `motion`, `identity` specs), so the suite *cannot* be green in the precompiled mode that exists specifically to stop the dev server OOM-restarting. The other **18 are stale journey tests**: an onboarding name-gate added 2026-07-30 (`onboarding-gate.ts`, applied via `onboarded-layout.tsx`) now intercepts newly-invited users, and no journey spec was updated. Verified in isolation — `orgs.spec` fails identically alone, landing on `/onboarding` after invite acceptance.
- `.github/workflows/ci.yml` runs lint/typecheck/unit/build/integration/audit/gitleaks — but **no e2e and no `rls:verify`**, the two proofs the release documents rest on. The nightly that does run them has never executed: the repository has **no git remote**.
- CI's own `pnpm audit --prod --audit-level high` **exits 1 today** (see P1-4).

**Net:** no configuration of this repository currently produces a green gate, and no gate has ever run in CI.

### P1-2 · Rollback documentation is factually wrong
**Risk:** Operational · **Blocker: YES (documentation)**

`docs/validation/PX-12_RELEASE_CANDIDATE.md:56,106,136,157,175`, `PX-11_HARDENING_REPORT.md`, `RELEASE_NOTES_v1.0.0-rc.1.md:58` and `docs/operations/BETA_ONBOARDING.md:57` all state that no migrations shipped after RC-1 and rollback is therefore a pure image swap with no schema step. **Twelve migrations (0015–0026) have landed since**, including `0019_tournaments.sql` which **renames a table and drops a column**. There are no down migrations. `docs/auction/RUNBOOKS.md:176` correctly says migrations are forward-only — the two documents contradict each other, and only `docs/parity/RELEASE_RISK_REGISTER.md:22` retracts the claim (while `:41` repeats it).

This is the plan an operator follows on the worst day of the product's life. It would not work.

### P1-3 · Documented role-creation command aborts halfway (compounds P0-1)
**Risk:** Operational / Security · **Blocker: YES**

`docs/operations/DEPLOYMENT.md:29` and `DISASTER_RECOVERY.md:31-32` invoke `create-app-role.sql` with two variables (`app_password`, `system_password`). The script also requires `:'engine_password'` and `:'runner_password'` and sets `\set ON_ERROR_STOP on`, so the documented command **aborts before creating the engine and runner roles** and before `revoke insert,update,delete on finops_events from desiauction_app`. `nightly-verify.yml:50-52` uses the same two-variable form — the four-role recipe has therefore never actually been verified. A disaster-recovery restore following the runbook would come back up without its writer roles.

### P1-4 · 17 high-severity dependency advisories; framework one patch behind
**Risk:** Security · **Blocker: YES (gate is red)**

`pnpm audit --prod` → 23 vulnerabilities (17 high, 6 moderate). Most notable:

| Package | Installed | Patched | Reachability |
|---|---|---|---|
| **next** | **15.5.20** | ≥ 15.5.21 | the web tier itself |
| find-my-way | ≤ 9.6.0 | ≥ 9.7.0 | Fastify router — **internet-facing engine** |
| fast-uri, js-yaml, nanoid, postcss, brace-expansion, sharp | various | various | transitive |

The root `package.json` pins `postcss@<8.5.10 → 8.5.10`; the advisory now requires ≥ 8.5.18. Each is a small bump — but the gate is currently failing, and per this audit's own rules an exploitable dependency in the deployed path is a blocker until triaged.

### P1-5 · Razorpay webhook has no ingress route
**Risk:** Functional / Compliance · **Blocker: YES if payments are in scope**

`handleRazorpayWebhook` exists (`apps/web/src/server/settlement/webhook.ts:33`) and is HMAC/freshness/replay tested — but it is **called only from tests**. `apps/web/src/app/api` contains exactly three route handlers: `media/upload`, `webhooks/sms-inbound`, `webhooks/delivery-status`. There is no endpoint for Razorpay to POST to, so the documented go-live gate ("one live order → webhook → capture → discharge") is unrunnable as written. Payment capture cannot complete in production.

### P1-6 · Every team's purse is broadcast to every WebSocket subscriber
**Risk:** Security (information disclosure) / Product · **Blocker: NO, but decide before launch**

The server deliberately withholds rival purses from bidders (`live-actions.ts:283-299`: *"private is the answer that cannot leak"*), and the client then filters (`live-panel.tsx:334-345`). But the engine snapshot carries `paddles[*].committed` and `paddles[*].purseRemaining` for **all** teams to every socket in the room — confirmed directly:

```
"paddles":[{"paddleNumber":"P01","committed":0,"purseRemaining":1995000000,"teamName":"Demo Falcons"},
           {"paddleNumber":"P02","committed":1000000,"purseRemaining":1999000000,"teamName":"Demo Panthers"}, …]
```

Any bidder reads rival war-chests from the Network tab. In a sealed-purse auction this is the whole strategic game. Either project per-viewer snapshots server-side, or drop the claim that purses are private — but the current state promises one thing and does another.

---

## 5 · MAJOR FINDINGS (P2)

| ID | Finding | Evidence | Impact |
|---|---|---|---|
| P2-1 | No `now < endsAtMs` check in the bid gauntlet | `packages/core/src/auction.ts:455-507` | Expiry enforced only by the 250 ms tick; late bids accepted inside the window and re-extend the lot. Amplifies P0-2 |
| P2-2 | No rate limiting anywhere on the command path; rejected bids are persisted and every command re-folds the whole event log | `engine-core.ts:337-339`, `aggregate.ts:815-830`, `live.ts:126` | O(n²) growth; one insider degrades the auction for everyone. Head-of-line blocking on the per-auction queue |
| P2-3 | `registrations.team_id` has a second writer with no auction-state lock | `registration-aggregate.ts:206-232`, `actions.ts:1131-1212` (cf. the guard at `:1243-1249`) | An organizer can reassign a player mid-auction; recovery never heals `team_id`; roster and ledger diverge silently |
| P2-4 | Settlement coordination / payment-expiry sweeps have no scheduler | `writer.ts:408,1278`, `recovery.ts:43` — zero non-test callers | A crash between case and journal commit leaves the ledger short with no alarm; payments stick in `created` forever |
| P2-5 | FinOps runner lacks the web tier's delivery adapters | `apps/finops-runner/src/env.ts` has no `EMAIL_*` | Runner-driven receipts land in a filesystem outbox nobody reads |
| P2-6 | Ledger tables are not append-only at the database | `create-app-role.sql:43,83` grants `UPDATE`/`DELETE` on `auction_events` | Invariants 10/24 ("no UPDATE/DELETE") are application discipline only. Cheap to fix by revoke |
| P2-7 | Nothing automates or verifies the production preflight | `grep -rn preflight .github/` → zero hits | `preflight:production` is asserted in the checklist, enforced nowhere |
| P2-8 | `restore-verify` does far less than `docs/62` claims | compares row counts only; never touches a stored backup, no PITR, no hash-chain replay, nothing pages | Backup *restorability* is unproven; the drill proves `pg_dump→pg_restore` is lossless locally |
| P2-9 | Drizzle snapshots stop at 0018 while migrations run to 0026 | `packages/db/migrations/meta/` | The next `db:generate` emits eight migrations of spurious DDL |
| P2-10 | Web→engine `fetch` has no timeout; engine has no `/readyz` | `engine-client.ts:20-27` | A stalled engine hangs server actions with no ceiling |
| P2-11 | WebSocket has no `maxPayload`, connection cap, `Origin` check or backpressure | `server.ts:253,93-97` | Memory exhaustion vector alongside P0-3 |

---

## 6 · MINOR FINDINGS (P3/P4)

| ID | Finding | Sev |
|---|---|---|
| P3-1 | Invite acceptance loses its destination: `onboarded-layout.tsx:20` calls `requireOnboarded()` with no `next`, so a newly-invited member is named and then dropped at `/home` instead of the org they just joined | P3 UX |
| P3-2 | 2 integration tests are time-of-day dependent (`consent.regression.test.ts:444` — `quiet_hours` returned where `no_consent` expected) | P3 QA |
| P3-3 | Media upload trusts the declared `Content-Type`; no magic-byte check (a text file stored as `.png`) | P3 Security |
| P3-4 | `paddleCount` counts released paddles and paddles-not-teams, so the "≥2 teams to go live" guard can be satisfied by one team claiming twice | P3 Functional |
| P3-5 | Spectator WS ticket is a shareable, non-revocable 48 h bearer in the URL, not bound to a person | P3 Security |
| P3-6 | `ENGINE_SECRET` accepts 8 characters; preflight only *warns* below 32; non-production deployments silently run the repo-public default | P3 Security |
| P3-7 | 74 bare `catch {}` sites discard the error object entirely — nothing reaches Sentry (`competition/actions.ts:944`, `engine-core.ts:171-178`) | P3 Observability |
| P3-8 | `safeNext("/./evil.com")` passes through as a relative path (same-origin, harmless, but inconsistent with the other folds) | P4 Security |
| P3-9 | Doc/code drift at scale: `README.md:9` says "Active phase: IP-0"; docs 51/52/53/54 describe pg-boss, Redis, SSE, a hash-chained ledger and OpenTelemetry — none of which exist | P3 Maintainability |
| P3-10 | Config the docs promise is inert: increment slabs, unsold policy and `roleQuotas` are not settable (`auction-setup.ts:159`); pre-assigned icons cost ₹0 against the purse | P3 Product |
| P4-1 | `packages/auction` (1,847-line `aggregate.ts` — the money write path), `packages/db` and `apps/finops-runner` have **zero tests in their own packages** | P4 QA |

---

## 7 · SCORECARD

| Category | Score | Status | Critical findings |
|---|---:|---|---|
| Functional correctness | 6/10 | ⚠️ PARTIAL | P0-1 breaks sales under prod roles; P0-2 breaks timer authority; P1-5 payments unreachable |
| Security | 5/10 | ❌ FAIL | P0-3 unauthenticated RCE-adjacent kill; P0-2 integrity bypass; P1-4 17 high advisories; P1-6 purse leak. *Authn/authz themselves are strong* |
| Data integrity | 7/10 | ⚠️ PARTIAL | Live invariants all held; but P0-2 corrupts outcomes, P2-3 splits roster truth, P2-6 ledgers mutable |
| Reliability | 4/10 | ❌ FAIL | P0-3 single-packet kill; P2-2 no rate limits; P2-4 unscheduled sweeps |
| Performance | 8/10 | ✅ PASS | TTFB 3–30 ms everywhere; O(n²) replay is the one structural risk (P2-2). Staging load test still owed |
| QA / test coverage | 5/10 | ❌ FAIL | 523 unit + 664 integration green and genuinely good; but 41/111 e2e red, CI never run, no e2e/RLS gate |
| UX / design | 8/10 | ✅ PASS | Responsive 9/9 across 7 viewports; consistent design system; P3-1 the notable rough edge |
| Accessibility | 8/10 | ✅ PASS | axe clean on every suite that ran; focus traps, live regions, 44 px targets, keyboard hold gates verified |
| Architecture / code quality | 8/10 | ✅ PASS | Pure core, enforced boundaries, 0 cycles, 0 `any`, event sourcing with replay verification. Deducted for doc drift and untested `aggregate.ts` |
| DevOps / operations | 3/10 | ❌ FAIL | P0-1, P1-2, P1-3, P2-7, P2-8 — the release-engineering layer has decayed since RC-1 |

**Weighted total: 5.2 / 10** — and per §39, a critical blocker overrides any score.

---

## 8 · WHAT COULD NOT BE VERIFIED

| Area | Why | What would close it |
|---|---|---|
| Production infrastructure (Fly, Vercel, managed Postgres, S3, CDN, TLS, domains) | No credentials exist on this machine — unchanged founder-held gap | Provision, then re-run this audit's §2 probes against staging |
| PITR, off-site backups, real restore | Nothing in the repo implements them; `docs/62` states them as configured fact | A real restore drill from a real backup |
| Live SMS (MSG91), email, Razorpay live keys | Adapters are forgery-tested; no accounts | One live send, one live order end-to-end |
| Cross-browser (Safari, Firefox, Edge) incl. WebAuthn | Chromium only in this run | Run the suite on WebKit/Firefox; real iOS device for passkeys |
| Load / soak at auction scale | Perf scripts exist but assert no budgets | 5 owners × sustained bidding for 30 min with p99 measurement |
| RLS as load-bearing at runtime | Local processes connect as the database owner | Boot the whole stack under `desiauction_app` — which today fails at P0-1 |
| Multi-instance engine safety | Single instance only | Two engines, one database, concurrent bids |
| Monitoring, alerting, dashboards, error tracking | No DSN, no OTel dependency in any package | Wire Sentry + alert-on-silence |

---

## 9 · REQUIRED BEFORE PRODUCTION

**Engineering (blocking):**
1. Fix P0-1 — `grant update on registrations to desiauction_engine`, add the six missing app-role tables, automate the role script in the migration step, and add a CI job that runs one full sale under the production roles.
2. Fix P0-2 — namespace internal command ids, validate transport `commandId` shape, key the ack cache by actor, and add a timer-expiry guard to the bid gauntlet.
3. Fix P0-3 — `try/catch` the `upgrade` handler; add `maxPayload`, connection caps and an `Origin` check.
4. Fix P1-3 — correct the role-creation invocation in `DEPLOYMENT.md`, `DISASTER_RECOVERY.md` and `nightly-verify.yml`.
5. Triage P1-4 — bump `next` to ≥ 15.5.21 and `find-my-way`; re-run the audit gate to green.
6. Land P1-5 — add the Razorpay ingress route (or explicitly descope payments from launch).
7. Rewrite P1-2 — the rollback runbook must describe forward-only migrations and a backup restore point.
8. Decide P1-6 — sealed purses or public purses, then make the code and the copy agree.

**Process (blocking):**
9. Push to a remote and obtain **one green CI run**; add `rls:verify` to the PR gate and an e2e job on `main`.
10. Repair the 18 stale journey specs against the onboarding gate, and give the `/gallery` family a mode that works under a production build.

**Then:** founder externals (SMS, S3, Razorpay, Sentry, PITR, staging perf sweep) — already tracked, unchanged by this audit.

## 10 · RECOMMENDED AFTER PRODUCTION

Rate limiting on the command path (P2-2) · scheduled settlement sweeps (P2-4) · revoke `UPDATE`/`DELETE` on ledger tables (P2-6) · fetch timeouts + engine `/readyz` (P2-10) · regenerate drizzle snapshots (P2-9) · error objects into Sentry (P3-7) · tests for `packages/auction` (P4-1) · reconcile the design docs with the built system (P3-9).

## 11 · RESIDUAL RISK AFTER REMEDIATION

Even with every blocker closed, three risks persist into the beta window: **(a)** production behaviour under the real role model will still be young — the first live auction is the first real exercise of it, so run one rehearsal on staging under production roles before opening signups; **(b)** the O(n²) event re-fold per command (P2-2) is untested at scale and is the most likely source of a bad night once auctions get long; **(c)** observability is thin — with `catch {}` swallowing errors and no metrics backend, the first production incident will be diagnosed from row counts, not dashboards. None of these is a launch blocker; all three are worth a named owner.

---

## 12 · SIGN-OFF GATES

### QA Manager — ❌ FAIL
E2E does not pass on the release branch (41/111 red); CI has never executed and omits both e2e and RLS verification; 2 integration tests are non-hermetic. Unit (523) and integration (664) coverage is genuinely strong and the engine certification suite is excellent — but there is no green gate to sign against.
*Evidence:* §2 suite table, §4 P1-1.

### Security Reviewer — ❌ FAIL
Authentication, session handling, the authorization matrix, tenant isolation, injection resistance and secret hygiene all passed live probing and are above industry norm. The failure is elsewhere: an unauthenticated single-packet engine kill (P0-3), a participant-triggerable auction-integrity bypass (P0-2), 17 high dependency advisories in the deployed path (P1-4), and rival purse disclosure (P1-6).
*Evidence:* §2 live probes, §3, §4.

### Product / Design — ✅ CONDITIONAL PASS
Responsive verified across seven viewports; axe clean on every suite that ran; the design system is consistent and the live-auction information hierarchy is well judged. Conditions: fix the invite→onboarding destination loss (P3-1) and settle the purse-visibility contradiction (P1-6), which is a product decision before it is a bug.
*Evidence:* §2, P3-1, P1-6.

### Architect — ⚠️ CONDITIONAL PASS
The architecture is sound and, in places, exemplary: a pure lint-enforced domain core, machine-enforced module boundaries with zero cycles, event sourcing with post-command replay verification and tamper detection, integer-paise money, and a single-writer engine proven correct under concurrent load. Conditions: the command-id namespace collision (P0-2) is an architectural defect in the idempotency design, not a typo; the second writer on `registrations` (P2-3) breaks single-writer discipline; and the documentation set no longer describes the system.
*Evidence:* §1, §3, §5.

### CTO — 🔴 **NO-GO**

**Decision: NO-GO.**

I want to be clear that this is not a verdict on the engineering. The team has built something with real craft — the invariant work, the replay verification, the capability partitions and the money handling are better than most systems I would sign off. The concurrency probe returning exactly one winner from ten simultaneous bids, and every one of thirteen data-integrity invariants coming back clean on live data, are not accidents.

The verdict is NO-GO because production readiness is not the same as product quality, and three things are true at once. First, the application **cannot run under its own documented production configuration** — the database roles have drifted twelve migrations behind the code, and the first sale of the first auction would deadlock. Second, the one hour this product exists for — auction night — has an integrity bypass that any invited team owner can trigger from the app, and I have watched a bid placed 57 seconds after the hammer should have fallen win the player. Third, the runtime that hosts that hour dies to a single malformed packet from anyone on the internet.

Compounding all three: there is no green test run on this branch, and CI has never run at all, so nothing would have caught any of it — and the rollback runbook we would reach for is describing a system that stopped existing twelve migrations ago.

The remediation is unusually tractable. Two of the three blockers are a few lines each. The third is a grant statement and a CI job. What takes the time is not the fixing but the *proving* — standing the stack up under the real production roles, getting one green pipeline, and running one rehearsal auction end to end. That is the work between here and a GO, and I would expect it to take **one to two focused weeks**.

**Conditions for reconsideration:** all items in §9 closed and evidenced; one green CI run including e2e and `rls:verify`; one complete rehearsal auction on staging under the production role recipe with no manual intervention.

**Accepted risks (post-remediation):** the founder-held externals unchanged from PX-12; the O(n²) replay at scale, to be measured in the beta window; thin observability, to be improved before general availability.

---

## 13 · APPENDIX — CHANGES MADE DURING THIS AUDIT

In the interest of full disclosure, this audit was not perfectly read-only:

- **`apps/web/e2e/_login-as.mts`** — a pre-existing *untracked* file of this name was **overwritten** by my session-login helper, and I have since moved my version out of the repository. Its original content is not recoverable from git (it was never committed). If it mattered, it will need rewriting.
- **Demo auction data** — I opened, bid on and closed four lots of the `demo-premier-league` demo auction (`01KYQ8213CCR20QKB7NG481EYX`) to exercise the timer, concurrency and money invariants, and paused/resumed it once. It was left in a consistent `live` state. Test bids are tagged `audit-*` in `auction_events`.
- **Demo media** — one 347-byte test upload was written and deleted.
- **Sessions** — six OTP sign-ins were performed as demo users plus one new account (`+919999000099`).
- **The engine process** was killed once by the P0-3 proof and restarted.

No production system was touched; no security control was weakened or bypassed to make any test pass; every authorization result reported was obtained by presenting a legitimately-issued session.
