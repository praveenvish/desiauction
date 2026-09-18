# DesiAuction — Final Product Readiness Audit

**Date:** 2026-09-18 · **Branch:** `ui/premium-foundation` — audited @ `68f42fb` plus the uncommitted premium-UI work; **remediated through `7f94c48` and the closing commit** (12 commits, none pushed)
**Posture:** CTO · architecture · product · security · QA · SRE · UX · business, reviewed as one
**Method:** read the schema, domain core, auction engine, transport, auth/authz, every API route and all ~220 server actions; ran every gate the repository has; fixed what was safely fixable; re-ran every gate.

Nothing below is taken from a README or an earlier audit without being re-checked against the code or a test run. Where an earlier audit's claim is repeated, it was re-verified.

---

## 0 · Remediation outcome (added after the audit)

The audit below was followed by a planned remediation programme
([REMEDIATION_PLAN](REMEDIATION_PLAN.md)): every finding, down to the P4s, was
either fixed with a test that fails on the old code, or closed with the
evidence for why it should not change. Each phase was committed only after
lint, typecheck, unit, integration, the role-posture probes and the full e2e
suite were green.

**Every engineering finding is closed.** What remains open is exactly what the
audit said would remain: the three infrastructure P0s, legal ratification, the
single-host trade-off and a live Razorpay transaction. None is a code change,
and each is now an ordered step with a proof in
[GO_LIVE_RUNBOOK](../../operations/GO_LIVE_RUNBOOK.md).

| Commit | Phase | What it closed |
|---|---|---|
| `0718774` · `16980db` | 0 | the audit's own fixes (FR-01…08, 12, 14, 15), committed |
| `1feb508` | 1 | **FR-09**: RLS-bypass debt 8 → 0; **new P1**: registration consent was silently never recorded under the production roles |
| `028ac87` | 2 | **new P2**: the anti-snipe "time extended" announcement was overwritten 250 ms later by the next snapshot |
| `dd23306` | 3–4 | **FR-11** erasure (request → privacy desk → one-transaction anonymization), **FR-13** an honest newsletter list (unsubscribe, retention sweep, export, disclosure), **FR-17** signed booking handles |
| `59c4200` | 5 | **FR-10** nonce `script-src` CSP (Report-Only, one env var to enforce), **FR-18** request ids on every page and server action, authz refusals logged |
| `72775ea` | 6 | e2e harness: a killed run could stop the next run's finops runner |
| `842a6dc` | 7 | **FR-19** the full React Compiler rule set, as errors; 58 findings fixed, including a RollingNumber that cut its own roll short |
| `2df8c58` | 8 | **FR-20** `packages/auction` has a unit suite (the live watchdog, 21 cases); owner workflow pinned against Postgres |
| `dde24e3` | 9 | **S-2** audit_log scope index (seq scan → index, 1,910 → 5 buffers); **S-3** 29 attribution FKs to `people`; **S-4** batched import |
| `7f94c48` | 10 | **FR-16**, **FR-21**, **FR-22**, **S-1** |
| closing commit | 8, 11, 12 | CSP `frame-ancestors` (a WebKit finding), four rotted perf harnesses repaired, measurements, the go-live runbook; the three-engine stability check left open (§17) |

Found **during** the remediation and fixed there: the consent P1 above; the
extension-announcement clobber (almost certainly the Firefox `conduct-ceremony`
flake the team had recorded as "not understood"); teardown leaks the new keys
exposed (`purgeOrg` never deleted `fixture_results`, 185 orphans locally);
four perf harnesses that no longer ran and one that silently measured nothing;
a report-only CSP directive browsers ignore. One regression was introduced and
caught before commit: `useEffectEvent` typechecks and unit-tests fine but does
not exist in Next 15.5's vendored React. Lint now bans the import.

---

## 1 · Executive CTO summary

**The engineering is strong enough to launch on. The launch is not ready, and the reasons are not engineering.**

This is the eleventh audit this codebase has been through, and it shows. The auction engine is a serialized single writer with an event log, replay verification, a Postgres-enforced single-writer lease and a unique `(auction_id, seq)` total order. Its bid gauntlet re-derives every input server-side, and its concurrency is covered by passing integration tests that fire ten identical bids at the same instant and get exactly one winner. Money is integer paise end to end. Tenant isolation is RLS with `FORCE`, backed by a boot-time refusal to run as a `BYPASSRLS` role. The WebSocket transport is receive-only, HMAC-ticketed, origin-checked, backpressured and capped. There are no known dependency vulnerabilities and no secrets in the tree. I found no P0 or P1 defect in auction correctness, money, authentication or authorization.

What I did find is concentrated in two places the previous audits had not reached.

**The uncommitted premium-UI work had broken two release gates.** The landing redesign removed the only homepage path into the demo-booking funnel, so the end-to-end journey gate was red (102 passed, 1 failed). The design-system type-scale guard was red too, with three violations. Both are fixed.

**The multi-sport claim stopped at the registration form.** The landing page says "Your sport belongs here" across twelve formats. Yet the public registration form asked every registrant, including footballers, kabaddi raiders and badminton players, for cricket's batting and bowling style. Six of the twelve sport packs declare player attributes that no surface ever collected or displayed. `registrations.attributes`, the column the schema names as the home of every sport after cricket, had no writer and no reader anywhere in the product. This is fixed end to end: the form, the writer, the organizer's view and the public player card.

Three linters that had never run were switched on (React hooks, JSX accessibility, Next.js). Four real bugs they surfaced were fixed. The most important was in the live-auction cockpit, which tore down and re-registered two window keyboard listeners on every render, once a second, for the whole auction.

**Launch is NO-GO**, for the three reasons the team's own checklist already names as hard stops. All three are founder-held infrastructure:

1. **Nobody can sign in.** Login is SMS-OTP-first, production refuses the dev provider, and no SMS account is provisioned.
2. **Data cannot be recovered.** No backup, PITR or tested restore exists on production infrastructure, and migrations are forward-only.
3. **Production is not configured.** The production environment, secrets, Sentry DSN and four-role database have not been set.

None of these is a code change. With them closed, the conditions in §3 are what stand between this repository and a defensible GO.

---

## 2 · Product readiness scorecard

| Area | Status | Basis |
|---|---|---|
| Auction engine & bidding | **READY** | Single writer, event log, replay proof, 72 engine integration tests incl. 10-way concurrent-bid races — all green |
| Money / settlement / finops | **READY** | Integer paise, idempotent-by-command-id writers, certified suites green (89 + 91 unit, regression suites green) |
| Authentication | **READY WITH CONDITIONS** | Code is sound; **SMS provider unprovisioned → nobody can log in** |
| Authorization / tenant isolation | **READY** | RLS + FORCE + boot assertion; RLS-bypass debt **0** (was 8); consent now recorded under the production roles |
| Real-time | **READY** | Receive-only, ticketed, heartbeated, backpressured; reconnect jitter added this audit |
| Multi-sport | **READY** | Pack-driven through registration, display and marketing samples |
| Registration & onboarding | **READY** | Consent captured server-side; minors gated; duplicates held by DB index |
| Live-auction UX | **READY** | Stale-feed watchdog, frozen clock on disconnect, drift correction, axe-clean |
| Accessibility | **READY** | axe-clean on visited pages in three engines; jsx-a11y and the full react-hooks v7 set enforced; live regions announce in the same commit they change |
| Security | **READY WITH CONDITIONS** | No critical findings; nonce `script-src` CSP shipped Report-Only with zero violations on every surface in three engines. Enforce after one production week (`CSP_ENFORCE=1`) |
| Privacy / DPDP | **READY WITH CONDITIONS** | Erasure request + privacy desk + anonymization; honest newsletter with retention; consent recorded. Legal docs still unratified drafts (P1-L) |
| Observability | **READY WITH CONDITIONS** | pino + redaction + Sentry wired; DSN unset; no dashboards/alerts provisioned |
| DevOps / DR | **NOT READY** | Procedure proven locally (restore drill 6.0 s at 108 MB incl. a night on the copy; engine restart ≈ 1.1 s); backups/PITR not provisioned on production; single host |
| CI / release safety | **READY** | Lint/type/unit/integration/e2e/role-posture/RLS/secrets/audit all gated |
| Commercial | **NOT READY** | Paid tiers have no price; Razorpay never run live (manual capture works) |

---

## 3 · GO / NO-GO decision

# 🔴 NO-GO for public production launch

**Engineering: READY WITH CONDITIONS. Launch: NOT READY.**

The decision rests on §40 of the brief. An unresolved issue that can cause *critical data loss* (no backups), *inability to recover* (no restore, forward-only migrations) or *catastrophic production instability* (the front door shut: no SMS, no login) makes the launch NO-GO. Every one of those is open, and every one is infrastructure.

No code defect found in this audit meets the NO-GO bar: no unauthorized access, tenant leak, incorrect financial state, incorrect auction outcome, bid manipulation or corrupting defect was found.

---

## 4 · P0 blockers (open)

All three are founder-held infrastructure, pre-existing, and already named in `PRODUCTION_CHECKLIST.md` "Go-live gate". They are re-verified here, not newly discovered.

| ID | Category | Evidence | Problem | Fix | Blocker |
|---|---|---|---|---|---|
| **P0-1** | Infra / Auth | `apps/web/src/env.ts` refuses `OTP_PROVIDER=dev` when serving; `KNOWN_LIMITATIONS.md` "SMS (OTP)" | Login is OTP-first; with no SMS account every user is stopped at the phone step | Provision MSG91 (DLT template); set `OTP_PROVIDER=msg91` + creds; `preflight:production` enforces | **YES** |
| **P0-2** | Infra / DR | `backup-production.yml` no-ops without `BACKUP_*` secrets; migrations forward-only (`0019` dropped a column) | No backup, PITR or tested restore on production; a bad release or disk loss is unrecoverable | Enable host/managed backups + PITR; run `restore:drill` against staging; record RTO | **YES** |
| **P0-3** | Infra / Config | `PRODUCTION_CHECKLIST.md` §2/§4/§9 ☐ items | Production env, secrets (≥32-char `ENGINE_SECRET`, `DEMO_TOKEN_SECRET`), `SENTRY_DSN`, four-role DB bootstrap not done | Run the DB bootstrap → `grants:verify` → `rls:verify`; `preflight:production` must pass | **YES** |

## 5 · P1 critical issues

| ID | Category | File | Evidence | Problem | Status |
|---|---|---|---|---|---|
| **FR-01** | UX / Commercial / Release | `apps/web/src/app/page.tsx` | e2e baseline **1 failed**: `demo-booking.spec.ts:158` — no link "Watch it run with us" on `/` | The redesign deleted the closing band that rendered `LANDING.beta.ctaSecondary`, the ONLY homepage entry to `/schedule-demo` (booking calendar, ICS invites, reminder sweeps, admin demo desk). Journey gate red. | **FIXED** — restored as a second door beside "Create your tournament", sourced from `LANDING.beta` |
| **P1-L** | Legal | `KNOWN_LIMITATIONS.md` "Legal documents are beta drafts" | Terms/Privacy/Retention are unratified drafts on a product that takes money and registers minors | Legal review + ratification before public launch | **OPEN** (not engineering) |

## 6 · P2 important issues

| ID | Category | File | Problem | Impact | Status |
|---|---|---|---|---|---|
| **FR-02** | Multi-sport | `register-flow.tsx`, `register/page.tsx`, `registrations.ts`, `actions.ts`, `public.ts`, `showcase-grid.tsx`, `p/[number]/page.tsx`, `dashboard-panel.tsx` | Public registration asked every sport cricket's batting/bowling; 6 of 12 packs' attributes never collected; `registrations.attributes` had no writer or reader | Core value proposition ("every sport") contradicted on the most-used public form | **FIXED** end to end + 16 unit + 3 DB tests |
| **FR-03** | Code quality | `packages/config/eslint.config.mjs` | `react-hooks`, `jsx-a11y`, `@next/next` never ran over ~800 React files; `next build` warned every run | Runtime hook bugs and a11y regressions invisible to `tsc` | **FIXED** — enabled; 4 real bugs + 5 real anchors fixed; 6 false-positive classes turned down with reasons |
| **FR-04** | Auction UX / Perf | `auction/cockpit/cockpit-panel.tsx` | `send` and `queue` were new every render, so the keyboard effect removed and re-added two `window` listeners on every render (≥1/s from the countdown) | Wasted work for hours on auction night; comment claimed behaviour that did not happen | **FIXED** — `useCallback`/`useMemo` |
| **FR-05** | UX / Perf | 5 files incl. new `guest-home.tsx` | Raw `<a href="/internal">` forced full reloads instead of client navigation | Slower navigation, lost client state | **FIXED** → `next/link` |
| **FR-06** | Correctness | `org-tabs.tsx`, `teams-panel.tsx` | Stale closure over first-render ids; roster memo recomputed every render | Latent bug / wasted work | **FIXED** |
| **FR-07** | Realtime / Scale | `auction/use-auction-socket.ts` | Pure exponential reconnect, no jitter — every client in a room reconnects in lockstep when the engine restarts | Reconnect storm against an engine still replaying; per-room/IP caps then refuse the overflow | **FIXED** — full jitter, 100 ms floor |
| **FR-08** | Design system / Release | `guest-home.module.css`, `public-shell.module.css` | `type-scale.test.ts` red: display face at 23–25 px in 3 rules (floor is 30 px) | Integration suite red on the branch | **FIXED** → text face; founder may instead add named exceptions (noted inline) |
| **FR-09** | Security (defence-in-depth) | `ops/posture-allowlist.json` — 8 `debt` entries | 8 modules read tenant data on the RLS-exempt system pool after app-layer membership checks | A filter bug in one of those reads leaks across tenants with no DB backstop | **FIXED** `1feb508` — debt 8 → 0; new posture suite as `desiauction_app` |
| **FR-10** | Security | `apps/web/next.config.mjs` | CSP carries `frame-ancestors/base-uri/object-src/form-action` only — no `script-src`/`default-src`/`connect-src` | No CSP backstop if an XSS sink appears (React escaping + the one escaped JSON-LD sink are the only defence) | **FIXED** `59c4200` — nonce `script-src` Report-Only + `/api/csp-report`; enforcement is `CSP_ENFORCE=1` |
| **FR-11** | Privacy / DPDP | `apps/web/src/app/account/page.tsx` "Your data" | Erasure is "email privacy@"; no anonymization routine, no admin action, no export; only a test-only `purge-org.ts` exists | Each request is hand-written SQL across 11 person FKs — slow and error-prone at any volume | **FIXED** `dd23306` — request on /account, `platform:privacy` desk, one-transaction anonymization with refusals (sole owner, live auction, platform grant) |
| **FR-12** | Testing | `.github/workflows/ci.yml` | The player-photo upload journey skips itself under the precompiled server and ran in **no CI job** | The upload route's authz already broke once unnoticed (see comment in `api/media/upload/route.ts`) | **FIXED** — dev-server CI step selecting that test by title |
| **FR-13** | Privacy / Abuse | `server/marketing/actions.ts` | Newsletter subscribe was the one unauthenticated public write with no throttle; the table is **write-only** (no reader, no send path, no retention sweep) | Unbounded growth; personal data collected for a purpose the product cannot fulfil | **FIXED** `dd23306` — DB-backed throttle, unsubscribe, 24-month / IP 90-day retention sweep, admin view + export, privacy-policy disclosure |
| **P2-H** | DR / SRE | `ops/deploy/docker-compose.production.yml` | Web, engine, runner, Postgres, MinIO and Caddy on one VPS; engine `replicas: 1` by design | One host failure is total outage including the database | **OPEN** — deliberate beta trade-off; acceptable only once P0-2 exists |
| **P2-R** | Payments | `KNOWN_LIMITATIONS.md` | Razorpay adapter forgery-tested but never run against the live gateway | Gateway collection unproven; manual capture is the working path | **OPEN** — one live staging transaction |

## 7 · P3 / P4 improvements

| ID | Sev | Item | Status |
|---|---|---|---|
| FR-14 | P3 | `pnpm verify` aborted locally: depcruise cruised `.next`, `.next-e2e`, `dist` **and the 1.1 GB gitignored `apps/web/.local`** (996 of 1,999 modules) → heap crash. CI never saw it (no `.local`). | **FIXED** — excluded; 987 modules, seconds, `apps/web/src` coverage unchanged at 532; negative control proves the gate still fires |
| FR-15 | P3 | `KNOWN_LIMITATIONS.md` said Email "not implemented" and object storage "not wired" — both exist | **FIXED** |
| FR-16 | P3 | Daily-ops schedule fan-out is O(finance orgs): **12.8 s at 74 orgs**; its test timed out (5 s) on any long-lived local DB | Test **FIXED**; **CLOSED, by design** — O(orgs) is IP-6 ADR-3 (the freeze ledger left it alone on purpose); doc corrected `7f94c48` |
| FR-17 | P3 | `bookSlotAction` takes a raw `requestId` with no token and no throttle | **FIXED** `dd23306` — HMAC-signed handle; a bare id 404s. A throttle adds nothing once ids cannot be enumerated |
| FR-18 | P3 | Server actions (the bulk of the product) carry no request-id; only the 5 API routes do | **FIXED** `59c4200` — middleware stamps `x-request-id`; `requestLogger()`; every authz refusal logged |
| FR-19 | P3 | `react-hooks` v7 compiler rules (~20 sites) not adopted | **FIXED** `842a6dc` — all rules, as errors; 58 findings fixed, 2 scoped disables with reasons |
| FR-20 | P3 | `packages/auction` (2,044-line `aggregate.ts`) has no `test` script; covered only by DB-bound integration suites | **FIXED** `2df8c58` — 21-case watchdog unit suite in `pnpm test`; owner workflow regression |
| FR-21 | P4 | `prototypes/va1` tracked prototype HTML/JS | **CLOSED, kept** `7f94c48` — it is the checksummed Phase 0B evidence, frozen by IP-0_DESIGN; `prototypes/README.md` says why |
| FR-22 | P4 | `/features` marketing page shows cricket-only sample players on a multi-sport product | **FIXED** `7f94c48` |
| S-1 | P3 | `AuctionLab` buttons disabled until hydration | **FIXED** `842a6dc` (React 19 replays pre-hydration clicks) |
| S-2 | P3 | `audit_log` scope_id-only reads seq-scan | **FIXED** `dde24e3` (0068) |
| S-3 | P3 | ~35 `*_by` columns without FK | **FIXED** `dde24e3` (0069: 29 keyed; system-actor ledgers documented as deliberately unkeyed) |
| S-4 | P3 | Import inserts new people row by row | **FIXED** `dde24e3` |
| S-5 | P3 | Firefox/WebKit live-auction flakiness not understood | **Root causes fixed; the stability check was NOT completed** — see §17 |
| S-6 | P3 | Performance and engine RTO never measured | **MEASURED locally** — §13, §21 |

---

## 8 · Architecture findings

- **Shape is right and not over-built.** Three services (web, a single-writer engine, a finops runner), one Postgres, no Redis, no queue broker — work queues are `FOR UPDATE SKIP LOCKED` tables. That is proportionate to the load.
- **Boundaries are enforced, not documented.** dependency-cruiser gates `core-is-pure` and friends. I proved the gate still fires after this audit's exclusion change by planting an `fs` import in core.
- **Grants, not roles.** `hasCapability` is a pure function over (person, scope, capability-set), and unknown sets expand to nothing. Four capability partitions (org, competition, platform admin/billing/demo) each have their own gate that returns `notFound`, not 403.
- **Debt worth naming:** the 8 system-pool reads (FR-09), and the absence of middleware — deliberate, since it removes the CVE-2025-29927 class, but it is also why CSP has no nonce (FR-10). *Both closed in remediation:* the reads moved into tenant boundaries; middleware now exists for the nonce and request id only. It makes no authorization decision, so the CVE-2025-29927 class (skipping middleware to skip auth) has nothing to bypass.
- **No circular dependencies** (depcruise), **no god services** worth splitting; `competition/actions.ts` (2,228 lines) is large but cohesive.

## 9 · Security findings

Every API route was read. Each has a hardened ingress order.

| Route | Authn | Authz | Validation | Rate limit | Safe error |
|---|---|---|---|---|---|
| `POST /api/webhooks/razorpay` | HMAC signature | tenant from verified envelope | freshness + envelope | provider-side | stable tokens, 404 if unconfigured |
| `POST /api/webhooks/sms-inbound` | shared secret, constant-time | n/a (platform-scoped) | field allowlist | — | 404 unconfigured, never 500 |
| `POST /api/webhooks/delivery-status` | shared secret | org resolved from adapter-verified id | adapter verify | — | 200 on permanent refusal |
| `POST /api/jobs/*` | shared secret | n/a | — | idempotent | 404 on any failure |
| `PUT /api/media/upload` | session | own-player key **or** org membership | key shape (no `..`), size, **magic-byte** sniff | — | 4xx only |
| poster/OG routes | session | capability in `posters.ts` | query parse | — | refusal helper |

Server actions: all 220 exports were scanned. The 120 the heuristic flagged "ungated" were checked by hand. Every one either delegates to a named gate (`liveGate`, `settlementGate`, `financeGate`, `platformAdminGate`, `requireCompetitionCapability`) or is a deliberately public pre-session action (OTP request/verify, email login, passkey login, demo booking by token, newsletter). No bypass was found.

Also verified: parameterized SQL everywhere (drizzle `sql` templates, no `sql.raw` in app code); JSON-LD escaped for the `<script>` context; sessions store only SHA-256 hashes, rotate on login, slide with a 90-day absolute ceiling, and revoke the replaced token; OTP throttled per phone and per IP, with spoof-resistant client-IP resolution; logger redacts phone/email/code/token/secret/signature and the webhook headers; `pnpm audit --prod` finds **0 vulnerabilities**; gitleaks runs in CI; no secrets in tracked files.

**Runtime-probed against the built server** (`next start` :3050, engine :4000), not only read:

| Probe | Result |
|---|---|
| Response headers on `/` | HSTS 2y + subdomains, `X-Frame-Options: DENY`, `nosniff`, strict referrer, restrictive Permissions-Policy, CSP present; **no `X-Powered-By`** |
| CSP contents | `base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'` — **confirms FR-10: no `script-src`** |
| `GET /admin` anonymous | **404**, not 403 — the console does not announce itself |
| Malformed WS upgrade `//%zz/ws` (the 2026-08-18 engine-kill packet) | socket destroyed, engine `/healthz` still **200** — the fix holds |
| `POST /command` with no engine secret | **401** |

**Open at audit:** FR-09 (RLS debt), FR-10 (CSP), FR-17 (booking throttle). **All three fixed in remediation** (§0). The e2e CSP spec loads public, console, admin and live-room surfaces and fails on any report. It passes in Chromium, Firefox and WebKit. WebKit's first run turned up the one policy defect: `frame-ancestors` in a Report-Only policy is ignored by browsers, so it moved to where it is always enforced (the static header, beside `X-Frame-Options`).

## 10 · Auction engine findings

The server is authoritative on every input the brief lists. Client bid amount, timer, purse and lot state are all re-derived:

- **Bid authorization** is resolved in the engine from `paddles.person_id === actor` (`engine-core.ts` `PlaceBid`), never from the client. Conduct-only commands are refused in the web gateway and again in the engine. Undo needs `auction.override`.
- **The gauntlet** (`core/auction.ts decideBid`) checks, in order: lot open, lot not expired (judged on receipt time), paddle authorized and not released, no self-outbid, safe positive integer, ≥ base, > current, on the increment ladder, within purse, reserve for `squadMin`, squad not full, and role quota. That is the complete list.
- **Concurrency:** a per-auction FIFO in one process, a session-level advisory-lock lease across processes, and unique `(auction_id, seq)` as the final arbiter, so a second writer's transaction rolls back rather than interleaving. Integration tests fire 2, 5 and 10 simultaneous bids and assert exactly one winner. **All green in this run.**
- **Idempotency:** `commandId` must match the transport namespace (`isTransportCommandId`), which keeps clients out of the engine's timer ids. That fixed the earlier gavel-freeze exploit, and the fix is still in place.
- **Anti-snipe:** expiry is judged on arrival time, extension on apply time, and both favour the bidder. The reasoning is documented at the call site.
- **Invariants that must never break**, and what holds each one:

  | Invariant | Held by |
  |---|---|
  | one live auction per competition | partial unique index |
  | a sold lot has a winner and a price; an unsold lot has neither | `lots_sold_state_consistent` CHECK |
  | one active paddle per team | partial unique index |
  | an owner owns one team per auction | `paddle_grants_auction_person_active_uq` |
  | total order of events | unique `(auction_id, seq)` |
  | a bid cites its evidence | unique `(auction_id, event_seq)` |

- **Deploy during an auction** is refused by `check:live-window` in the deploy workflow, and `paused` counts as live.

No defect found in the engine. The cockpit (the engine's UI) had FR-04.

## 11 · Multi-sport extensibility findings

Test run against Cricket, Football, Kabaddi, Basketball, Volleyball and Badminton, with actual pack data:

| Sport | Roles | Attributes | Before this audit | After |
|---|---|---|---|---|
| cricket, box cricket | pack | batting/bowling (columns) | ✓ | ✓ unchanged |
| football | pack | preferred foot (json) | asked batting/bowling; foot never asked | ✓ |
| volleyball | pack | spiking hand | asked batting/bowling | ✓ |
| badminton / pickleball | pack | playing hand | asked batting/bowling | ✓ |
| table tennis | pack | grip | asked batting/bowling | ✓ |
| kabaddi, hockey, basketball, esports, battle royale | pack | none | asked batting/bowling | ✓ none asked |

**Core platform, sport configuration and sport-specific rules are cleanly separated.** The auction, purse, settlement and lifecycle know nothing about a sport. Packs (`packages/core/src/sports/*`) carry vocabulary, attributes, score fields, points and tiebreakers, and the `sports` table is only an on/off flag. Lobby formats (battle royale) extended the contract rather than forking it. The one leak left was the registration form's optional detail, fixed in FR-02. The `/features` sample desk is now a football season (FR-22). Only the dev-only `/gallery` still uses cricket examples, and production builds do not serve it.

## 12 · UI/UX findings

- **Fixed:** FR-01 (demo funnel), FR-02 (cricket questions for every sport), FR-05 (full-reload anchors), FR-08 (type-scale).
- **Honest by construction:** the new landing's interactive auction is labelled "INTERACTIVE DEMO · Fictional players & teams. No real bids or payments", and every illustrative visual carries `aria-label="Illustrative …"`. No fabricated statistics were found. Every help link on the new landing resolves to a real article.
- **Live auction UX** answers the brief's seven questions. The status ribbon shows where you are; the lot hero shows who is on the block, the current bid, who holds it and the countdown; paddle control shows what you can do; and the stale-feed watchdog freezes the clock and says "Reconnecting…" rather than letting a number run on a dead socket.
- **Remaining at audit:** `AuctionLab` rendered sport buttons `disabled` until hydration. **Fixed** (S-1); React 19 replays clicks made before hydration.
- **Found in remediation:** the "time extended" announcement vanished 250 ms after it appeared (`028ac87`), and every live moment was committed silently and then announced one render later (`842a6dc`). Both are fixed, and screen readers now hear a change in the same commit that shows it.

## 13 · Performance findings

- The countdown hook re-renders consumers once per second, not 10 Hz (quantised) — already done.
- FR-04 removed per-render listener churn in the cockpit.
- The import path inserted new people one row at a time; it is now one multi-row insert per 500 (S-4).

**Measured in remediation (Phase 11)** on a developer laptop against local Postgres 17, not production hardware. Four of the five harnesses no longer ran because product guards had been added after they were written (a soft squad minimum, the per-IP socket cap), and the fifth measured nothing without failing (gateway payments refuse with no Route linked account, and it skipped the refusals). All five are repaired.

| Path | median | p95 |
|---|---|---|
| PlaceBid command, accepted, incl. rebuild | 13.2 ms | 22.0 ms |
| 10 concurrent bids → exactly 1 winner (burst wall time) | 180 ms | 308 ms |
| bid → 200 spectators all converged over real WebSockets | 14.6 ms | 17.5 ms |
| spectator join (connect → full snapshot) | 0.5 ms | 2.7 ms |
| engine recovery in-process (restart → replay → snapshot, 243 events) | 3.9 ms | 7.3 ms |
| engine restart as a process (`kill -9` → `/healthz` 200, 97 in-flight auctions) | ≈ 1.1 s | 1.7 s (worst of 5) |
| fixture list, deep page 21 of 21 (520 fixtures) | 16.2 ms | 39.0 ms |
| registration search page 1 (300 registrations) | 5.2 ms | 9.6 ms |
| payment capture webhook ingress | 24.3 ms | 65.3 ms |
| journal posting (manual capture + discharge) | 24.2 ms | 108 ms |
| settlement closure (verify + seal) | 10.3 ms | 44.9 ms |
| finops receipt issue (register 1 → 30) | 13.5 ms | 43.4 ms |
| finops `superviseOperations` (7 components) | 882 ms | 1.18 s |
| finops `certifyOperations` (double-derived replay) | 1.84 s | 1.97 s |

Everything on the auction-night path is two orders of magnitude inside the budgets below. The slowest paths are the finops supervisor and certifier. They run on the runner's schedule rather than on a request, so they matter for a tick's length, not a user's wait.

  | Metric | Target | Status |
  |---|---|---|
  | Bid ack p95 | < 150 ms same region | 22 ms locally |
  | Snapshot propagation p95 | < 250 ms | 17.5 ms to 200 sockets locally |
  | Public page LCP | < 2.5 s on 4G | not measured on production hardware |
  | Server action p95 | < 400 ms | the server-side paths above: 1–108 ms p95, locally |

  **Production-hardware certification has still not been run** (GO_LIVE_RUNBOOK §F, PRODUCTION_CHECKLIST §6).

## 14 · Scalability findings

At 1,000 concurrent auction participants, what breaks first is **the single engine process and single host**. Engine rooms are capped at 2,000 sockets per room and 50 per IP. Fan-out computes one redaction per distinct audience, not per socket. A snapshot is a few KB. So one room of 1,000 is within reach. A dozen simultaneous big auctions on one 4 vCPU box is not proven.

The second limit is the **finops daily-ops fan-out** (FR-16, 12.8 s at 74 orgs; O(orgs) by design, idempotent, and a freeze amendment if it ever matters), then the admin health page's per-org fan-out on a `max: 10` pool. No Redis is needed at this scale, and adding it would be over-building.

## 15 · Database findings

The schema is the strongest part of the system. Money is integer paise. Every status enum is also a CHECK constraint (0030). Referential integrity for all 11 `person_id` columns encodes the DPDP anonymize-versus-delete promise (0040). Uniqueness is enforced where races matter: one registration per person per season, captains, fixtures, bookings, paddles, grants and document numbering.

Open at audit: about 35 `*_by` columns carried no FK, and `audit_log` had no index for `scope_id`-only reads. **Both closed** (`dde24e3`). 0068 indexes `(scope_id, at)`: the account security feed, the home dashboard and the admin org directory were sequential scans of the whole log. 0069 keys 29 attribution columns to `people` with `ON DELETE RESTRICT` (`NOT VALID`, so new writes and person deletes are checked without refusing to run over development residue). The columns that may name the system actor are documented as deliberately unkeyed. The keys immediately exposed teardown leaks in the test harness, which are fixed. `registrations.attributes` now has a writer and readers.

## 16 · DevOps / SRE findings

- Images are built in CI and pinned (Postgres by tag, MinIO by digest). Logs are capped. Caddy terminates TLS.
- `/healthz` means liveness and never touches the DB; `/readyz` means readiness.
- The deploy refuses during a live window. `preflight:production` refuses the rehearsal escape hatch and localhost URLs.
- The web tier refuses to boot on a BYPASSRLS role.
- **Open:** P0-1..3, P2-H (single host), dashboards and alerts not provisioned. All are sequenced with proofs in GO_LIVE_RUNBOOK.

## 17 · Testing gaps

| Area | Coverage (after remediation) | Gap |
|---|---|---|
| Unit | 987 tests; `packages/auction` now has its own suite (FR-20) | — |
| Integration / DB | 1,094 tests (1,022 web + 72 engine); posture 26 as `desiauction_app`; grants 312 expectations; RLS probe | — |
| E2E | 147 specs × 3 engines: one full run on the final code, **351 passed, 0 failed, 0 flaky** (Chromium 118 · Firefox 117 · WebKit 116; 90 skipped by design) | three consecutive clean three-engine runs **not completed** (below) |
| Concurrency | 10-way bid races; 200-socket fan-out measured | multi-auction load on one engine unproven |
| Load | five local harnesses, all running again | **no production-hardware run** |
| Security | forgery, replay, IDOR regression suites; CSP violation spec in three engines | no DAST/pen-test |
| Mobile | 320–360 px geometry assertions | real-device pass pending |

**S-5, the Firefox/WebKit live-auction flakiness, is resolved.** The history was "different failures each full run, all in the live-auction path": `conduct-ceremony` on Firefox and `financial-issuance` on WebKit. Each now has a root cause fixed in this programme:
- `conduct-ceremony` waits for the ceremony's `extension` phase, which the engine's closing-soon snapshot overwrote 250 ms after it appeared (`028ac87`). A slower engine's polling could miss that window.
- `financial-issuance` fails with "not certified yet" when the finops runner is not running. The e2e teardown could kill the next run's runner (`72775ea`).

Evidence, all of it, including the runs that did not go well:

| Run | Build | Result |
|---|---|---|
| live-auction specs ×3 per engine, retries off | before the CSP fix | Firefox 12/12, WebKit 12/12 |
| full, Firefox + WebKit | before the CSP fix | 231 passed · **2 failed**: both WebKit CSP specs, both one message ("`frame-ancestors` is ignored in a report-only policy"), which is a real policy defect, fixed in the closing commit. No live-auction failure |
| **full, all three engines** | **final** | **351 passed · 0 failed · 0 flaky** · 28.5 min |
| full, all three engines | final | 347 passed · 2 failed · 2 flaky · **59 min**: run while another project's containers held ~5 CPU cores of the shared Docker VM (load average 30–38). Every failure was a timeout: WebKit `financial-issuance` waited 90 s for a first certification behind a runner tick that walks ~2,400 residue orgs on this local database (ticks measured at 7–150 s); WebKit `live-auction` waited 20 s for a grant to render; the two flakes passed on retry. Treated as contaminated, not as evidence either way |
| full, all three engines | final | **stopped at 138 passed · 0 failed** on the founder's instruction |

**The gap, stated plainly:** the plan's bar for returning Firefox and WebKit to the nightly was three consecutive clean full runs. One clean full run exists; the three-in-a-row check was not completed. So the nightly is **unchanged** (Chromium only) and both engines remain opt-in (`E2E_FIREFOX=1 E2E_WEBKIT=1`). To close it: on a quiet machine, run the three-engine suite three times in a row; if all three are clean, add both flags to `nightly-verify.yml` and raise its `timeout-minutes` from 30 to 90 (three engines took 28.5 min on their own).


## 18 · Business / product gaps

- **No price exists** for Pro or Association. Launching Free-only is legitimate; launching with an undecided price is not.
- **Payments:** manual capture (cash, UPI, bank) works. Gateway collection needs Razorpay Route onboarding per organizer (KYC).
- **Assumption (labelled):** the beta monetizes nothing and the demo-booking funnel is the primary acquisition channel. That assumption is why FR-01 is rated P1.

## 19 · Legal / compliance items requiring professional review

These are not legal conclusions. They are items for counsel:

- ratification of the Terms, Privacy and Retention drafts;
- the minors' consent mechanism (DPDP §9);
- the erasure turnaround ("seven days"): tooling now exists (request → privacy desk → anonymization), so the question for counsel is whether the refusals it applies (sole owner of an organization, a live auction, a platform grant) and what it retains are right;
- newsletter consent without double opt-in: the list now has an unsubscribe, a retention sweep and a privacy-policy disclosure, but still no send path;
- organizer versus platform liability for auction outcomes and money collected off-platform;
- player image rights on public cards and posters;
- team logo and IP uploads;
- refund and cancellation terms once a price exists;
- Razorpay Route and marketplace obligations;
- the grievance officer's mailbox deliverability (checklist §10).

## 20 · Observability requirements

**Minimum production dashboard:**

- **Engine:** `/healthz` and watchdog age; bid-ack p50/p95; BidRejected rate by code; WS connections per room; heartbeat age; slow-consumer terminations; lease holder.
- **Web:** 5xx rate; server-action p95; OTP sends and lockouts per hour; RLS refusals.
- **DB:** connections against `max_connections`; replication/backup age.
- **Money:** settlement sweep unhealable count (already paged via Sentry).
- **Runner:** dead-letter count, with alert-on-silence.

**Must never log:** secrets, tokens, OTPs, phones or emails. The redaction list already covers them.

## 21 · Disaster recovery requirements

| Item | Requirement | Status |
|---|---|---|
| Backup | nightly off-host dump **and** PITR | workflow exists, **not provisioned** |
| Verification | quarterly timed restore drill | local drill **6.0 s** at 108 MB / 68 tables, incl. a full night on the restored copy under the four roles (2026-09-18); production drill **not run** |
| RPO / RTO targets (proposed) | RPO ≤ 5 min (PITR); RTO ≤ 2 h for full host loss, ≤ 2 min for engine restart (replay from log) | engine restart measured locally at ≈ 1.1 s (5 runs, 97 in-flight auctions); host loss unmeasured on production |
| Object storage | MinIO volume on the same host | **must be backed up off-host too** |
| Secrets | held outside the host | `SECRET_ROTATION.md` exists |
| Single points of failure | the host; the engine process (by design) | accepted for beta once backups exist |

## 22 · Top 20 risks

Re-ranked after remediation. Struck items are closed; the evidence is in §0.

1. No SMS provider, so no user can log in (P0-1).
2. No provisioned backups or PITR (P0-2).
3. Production env and roles not bootstrapped (P0-3).
4. Legal drafts unratified (P1-L).
5. Single host holds the app, the DB and object storage (P2-H).
6. Razorpay never run live (P2-R).
7. No price for paid tiers.
8. Production perf never measured on production hardware.
9. Engine is a single process: a crash pauses every live auction until restart (measured ≈ 1.1 s locally, plus client reconnect).
10. No dashboards or alerts are provisioned.
11. DMARC is at `p=none`.
12. CSP is Report-Only until someone sets `CSP_ENFORCE=1`.
13. Multi-auction load on one engine unproven.
14. No DAST / pen-test.
15. ~~8 modules read on the RLS-bypass pool (FR-09)~~
16. ~~No CSP `script-src` (FR-10)~~ · ~~Erasure has no mechanism (FR-11)~~
17. ~~Firefox and WebKit live-auction flakiness not understood (S-5)~~
18. ~~Newsletter data has no purpose or retention (FR-13)~~ · ~~Demo booking has no throttle (FR-17)~~
19. ~~Server actions are uncorrelated in logs (FR-18)~~
20. ~~`packages/auction` has only DB-bound tests (FR-20)~~ · ~~Daily-ops fan-out (FR-16, by design)~~

## 23 · Production launch checklist

- [ ] SMS provider live, and an OTP login smoke passes on production (P0-1)
- [ ] Backups + PITR on; timed restore drill passes on staging; RTO recorded (P0-2)
- [ ] DB bootstrap: migrations → four roles → `grants:verify` → `rls:verify` (P0-3)
- [ ] `preflight:production` passes with no escape hatches (P0-3)
- [ ] `SENTRY_DSN` set in web and engine, and a test error is received
- [ ] `MEDIA_STORAGE=bucket`, and the MinIO volume is included in the off-host backup
- [ ] Legal drafts ratified (P1-L)
- [ ] One founder scenario end to end on production infra: login → season → register → auction → settle → receipt
- [ ] Dashboards and alerts from §20 wired; one alert-drill fired
- [ ] Decide Free-only or published prices
- [x] This branch: the fixes are committed (12 commits, gates green locally before each)
- [ ] Push, and CI green on all four jobs
- [ ] Follow [GO_LIVE_RUNBOOK](../../operations/GO_LIVE_RUNBOOK.md) A–K; each section ends in a proof

## 24 · Post-launch 30 / 60 / 90

Revised after remediation: most of the original 30/60/90 is already done (§0).

- **30 days:** enforce CSP after a clean production week. Wire the §20 dashboards and alerts and fire one drill. Run the production-hardware perf certification. Promote the 0069 keys with `VALIDATE CONSTRAINT` once production data is confirmed clean.
- **60 days:** Razorpay live with Route onboarding per organizer. Firefox and WebKit in the nightly, once the three-consecutive-clean-runs check in §17 has been done. Newsletter: build a double-opt-in send path, or retire the list.
- **90 days:** evaluate a hot-standby engine against the measured single-process recovery. Separate the DB from the app host. Pen-test.

## 25 · File-by-file fix plan (what this audit changed)

| File | Change |
|---|---|
| `apps/web/src/app/page.tsx`, `guest-home.module.css` | FR-01 restore demo CTA; FR-08 type-scale |
| `packages/ui/src/shell/public-shell.module.css` | FR-08 type-scale ×2 |
| `packages/core/src/sports/index.ts`, `packages/core/src/index.ts` | FR-02 `attributeOptions`, `splitAttributeWrite`, `describeAttributes` |
| `packages/core/src/sports/attribute-write.test.ts` (new) | FR-02 13 tests |
| `apps/web/src/app/seasons/[slug]/register/register-flow.tsx`, `page.tsx` | FR-02 pack-driven form, back-compatible draft |
| `apps/web/src/server/competition/registrations.ts`, `actions.ts`, `public.ts` | FR-02 writer routes by storage; readers label by pack |
| `.../registrations/dashboard-panel.tsx`, `c/[slug]/showcase-grid.tsx`, `c/[slug]/p/[number]/page.tsx` | FR-02 display |
| `apps/web/src/server/competition/sport-registration.regression.test.ts` | FR-02 3 DB tests |
| `packages/config/eslint.config.mjs`, `package.json` | FR-03 react-hooks, jsx-a11y, @next/next |
| `.../cockpit/cockpit-panel.tsx`, `org-tabs.tsx`, `teams-panel.tsx`, `login-form.tsx` | FR-04 / FR-06 |
| `packages/ui/src/primitives/dialog.tsx`, `tabs.tsx`, `shell/drawer.tsx` | FR-03 reasoned suppressions (native Escape; APG tablist) |
| 5 files (`security-panels`, `join`, `owner-join`, `spectate-panel`, `guest-home`) | FR-05 → `next/link` |
| `apps/web/src/app/seasons/[slug]/auction/use-auction-socket.ts` | FR-07 jitter |
| `apps/web/src/server/marketing/actions.ts` | FR-13 throttle |
| `.dependency-cruiser.cjs` | FR-14 exclude build output and `.local` |
| `.github/workflows/ci.yml` | FR-12 photo journey |
| `.../financial-operations-foundation.regression.test.ts` | FR-16 honest timeout |
| `docs/operations/KNOWN_LIMITATIONS.md` | FR-15, FR-16, FR-19 |

**Remediation programme** (the per-file detail is in each commit message; this is the map):

| Area | Files |
|---|---|
| Tenancy (FR-09, consent P1) | `server/tenant.ts`, `server/competition/resolve.ts`, 8 modules moved into boundaries, `posture/tenant-boundaries.posture.test.ts`, `scripts/verify-grants.ts` |
| Auction UX | `packages/core/src/auction-ceremony.ts`, `use-auction-socket.ts`, `auction-announcer.tsx`, `live-experience.tsx`, `spectate-panel.tsx`, `packages/ui/src/theatre/rolling-number.tsx` |
| Privacy (FR-11, FR-13) | migrations 0066/0067, `server/privacy/*`, `server/admin/erasure-actions.ts`, `app/admin/erasure`, `app/admin/newsletter`, `app/newsletter/unsubscribe`, `server/marketing/newsletter.ts`, `content/legal.ts` |
| Security (FR-10, FR-17, FR-18) | `src/middleware.ts`, `lib/csp.ts`, `app/api/csp-report`, `server/logger.ts`, demo pick handles |
| React Compiler rules (FR-19) | `packages/config/eslint.config.mjs`, `lib/use-hydrated.ts`, 30+ components |
| Tests (FR-20) | `packages/auction/src/diff-projection.test.ts`, `server/auction/owner-board.regression.test.ts` |
| Database (S-2..S-4) | migrations 0068/0069, `schema.ts`, `registration-import.ts`, `test-support/purge-org.ts` |
| Measurement | `apps/web/scripts/perf-{collections,closure,finops}.ts`, `apps/engine/scripts/perf-live.ts` |
| Operations | `docs/operations/GO_LIVE_RUNBOOK.md` (new), `PRODUCTION_CHECKLIST.md`, `RESTORE_RUNBOOK.md`, `DISASTER_RECOVERY.md`, `KNOWN_LIMITATIONS.md`, `packages/db/README.md`, `prototypes/README.md` |

---

## Validation — before and after, every gate actually run

| Gate | Before this audit | After the audit's own fixes | After remediation (final) |
|---|---|---|---|
| `pnpm lint` | pass, but react-hooks/jsx-a11y/@next never ran | pass — 11/11 | **pass** — now incl. the full react-hooks v7 set as errors and the `useEffectEvent` ban |
| `pnpm typecheck` | pass | pass — 11/11 | **pass** |
| `pnpm test` (unit) | 949 | 962 | **987** (+ `packages/auction` in the run) |
| `pnpm format:check` | pass | pass | **pass** |
| `pnpm depcruise` | **crashed** (heap) | pass — 987 modules | **pass** — 1,021 modules, 0 violations |
| `pnpm check:posture` | 0 defect, 8 debt | 0 defect, 8 debt | **0 defect, 0 debt** |
| `pnpm test:integration` | first full run 2 failed of 1,055 (both pre-existing) | 1,055 / 1,055 | **1,094 / 1,094** (1,022 web + 72 engine) |
| `posture:verify` (as `desiauction_app`) | — | — | **26 / 26** |
| `grants:verify` / `rls:verify` | — | — | **312 expectations, no drift / PASSED** |
| e2e, precompiled, Chromium | 102 pass · 1 FAIL · 7 did not run | 110 pass · 0 fail | **118 pass · 0 fail · 0 flaky** (final code) |
| e2e, Firefox + WebKit | never run in this audit | not run | **117 + 116 pass · 0 fail · 0 flaky** in one full run on the final code; three-run stability check **not completed** (§17) |
| restore drill (`--rehearse`) | — | — | **PASS**, 6.0 s at 108 MB / 68 tables |
| perf harnesses | — | not run | **5 / 5 run** (4 repaired, 1 made loud) |
| `pnpm audit --prod` | 0 vulnerabilities | 0 | **0 vulnerabilities** |
| Secret scan (tracked files) | clean | clean | **clean** (pattern scan; the one hit is a fake key in the scrubber's own test. gitleaks is not installed locally; CI runs it) |

Reproduce with `pnpm verify`, `pnpm test:integration`, the three role probes, `pnpm restore:drill --rehearse`, and
`NEXT_DIST_DIR=.next-e2e next build` then `PLAYWRIGHT_PRECOMPILED=1 pnpm exec playwright test` (add `E2E_FIREFOX=1 E2E_WEBKIT=1` for three engines).

**Not run, and therefore not claimed:** production-hardware performance, a live SMS/Razorpay/S3 round trip, a restore drill on production infrastructure, real-device and Edge testing, and a penetration test.

---

DESIAUCTION — FINAL PRODUCT READINESS

Overall Status:
NOT READY

P0:
3 (open, all infrastructure: SMS provider, production backups/PITR, production environment and database roles). No code P0 was ever found.

P1:
1 open (legal ratification of Terms, Privacy and Retention). 2 found and fixed: the landing page's lost demo-booking link, and registration consent that was never recorded under the production roles.

P2:
2 open (single host; Razorpay never run live), both founder-owned. Every engineering P2 is fixed: RLS-bypass debt, CSP, erasure tooling, newsletter purpose and retention, and the anti-snipe announcement that vanished after 250 ms.

Critical Security Issues:
0

Critical Auction Issues:
0

Critical Data Integrity Issues:
0

Critical UX Issues:
0

Critical Infrastructure Issues:
3

Tests Passing:
Unit 987/987 · Integration 1,094/1,094 (1,022 web + 72 engine) · role posture 26/26 as desiauction_app · grants 312 expectations, no drift · RLS probe passed · E2E on the final code, one full three-engine run: 351 passed, 0 failed, 0 flaky, 90 skipped by design (Chromium 118 · Firefox 117 · WebKit 116). NOT completed: three consecutive clean three-engine runs (one clean; one invalidated by another project's CPU load, with timeout-only failures; one stopped on instruction). Not run at all: production-hardware performance, live SMS/Razorpay/S3, a production restore drill, real devices and Edge, a penetration test.

Build:
PASS: the web production build of the final code (the e2e build) and the engine bundle. pnpm verify (lint, typecheck, unit, format, depcruise, motion) PASS.

Recommended Launch Gate:
Go live only when GO_LIVE_RUNBOOK sections A–K each have their proof: an OTP login on production over MSG91 with DLT templates; PITR archiving with failed_count 0, an off-host dump plus a MinIO mirror, and a timed restore drill on the production stanza; the four-role bootstrap with grants:verify, rls:verify and the rehearsal passing; preflight:production with zero FAIL lines; Sentry receiving a test error; outside uptime checks and alert-on-silence with one drill fired; legal documents ratified, the legal identity published, and a decision on TERMS_NOTICE_VERSION; a price decision; and the smoke scenario done by real people on real devices. Push this branch and see all four CI jobs green first.

Top 10 Actions Before Production:
1. MSG91 account + DLT registration; set the OTP and decision-template variables; prove a first-time SMS login (Runbook C).
2. Turn on WAL archiving, schedule the off-host `pnpm backup` + MinIO mirror, and time a restore on the production stanza (Runbook B).
3. Bootstrap the four database roles and pass grants:verify, rls:verify and the rehearsal (Runbook A).
4. Fill web/engine/runner env and pass `pnpm preflight:production` (Runbook D).
5. Set SENTRY_DSN; wire uptime checks and alert-on-silence; fire one alert drill (Runbook E–F).
6. Counsel ratifies Terms, Privacy and Retention; publish the legal identity; decide whether to bump TERMS_NOTICE_VERSION (Runbook J).
7. Decide the paid-tier prices, or launch Free-only on purpose (Runbook I).
8. Push the branch, get CI green on all four jobs, then run the three-engine e2e three times in a row on a quiet machine and, if clean, return Firefox and WebKit to the nightly.
9. After one clean production week, set CSP_ENFORCE=1; promote the 0069 foreign keys with VALIDATE CONSTRAINT once production data is confirmed clean.
10. Run the smoke scenario on production with real phones (Runbook K); optionally, one live Razorpay staging transaction with a Route linked account (Runbook H).
