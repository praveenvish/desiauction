# DesiAuction — Final Product Readiness Audit

**Date:** 2026-09-18 · **Branch:** `ui/premium-foundation` @ `68f42fb` plus the uncommitted premium-UI work in the tree
**Posture:** CTO · architecture · product · security · QA · SRE · UX · business, reviewed as one
**Method:** read the schema, domain core, auction engine, transport, auth/authz, every API route and all ~220 server actions; ran every gate the repository has; fixed what was safely fixable; re-ran every gate.

Nothing below is taken from a README or an earlier audit without being re-checked against the code or a test run. Where an earlier audit's claim is repeated, it was re-verified.

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
| Authorization / tenant isolation | **READY WITH CONDITIONS** | RLS + FORCE + boot assertion; 8 modules still read on the RLS-bypass pool (tracked debt) |
| Real-time | **READY** | Receive-only, ticketed, heartbeated, backpressured; reconnect jitter added this audit |
| Multi-sport | **READY WITH CONDITIONS** | Now genuinely pack-driven through registration; standings/fixtures already were |
| Registration & onboarding | **READY** | Consent captured server-side; minors gated; duplicates held by DB index |
| Live-auction UX | **READY** | Stale-feed watchdog, frozen clock on disconnect, drift correction, axe-clean |
| Accessibility | **READY WITH CONDITIONS** | axe-clean on visited pages; jsx-a11y now enforced repo-wide; compiler-era hook rules deferred |
| Security | **READY WITH CONDITIONS** | No critical findings; CSP has no `script-src` (needs nonce middleware) |
| Privacy / DPDP | **NOT READY** | Erasure is a manual email with no tooling; legal docs are unratified beta drafts |
| Observability | **READY WITH CONDITIONS** | pino + redaction + Sentry wired; DSN unset; no dashboards/alerts provisioned |
| DevOps / DR | **NOT READY** | Backups/PITR/restore not provisioned on production; single host |
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
| **FR-09** | Security (defence-in-depth) | `ops/posture-allowlist.json` — 8 `debt` entries | 8 modules read tenant data on the RLS-exempt system pool after app-layer membership checks | A filter bug in one of those reads leaks across tenants with no DB backstop | **OPEN** — tracked as PA-1R Phase 3.4 |
| **FR-10** | Security | `apps/web/next.config.mjs` | CSP carries `frame-ancestors/base-uri/object-src/form-action` only — no `script-src`/`default-src`/`connect-src` | No CSP backstop if an XSS sink appears (React escaping + the one escaped JSON-LD sink are the only defence) | **OPEN** — needs nonce middleware (checklist §7) |
| **FR-11** | Privacy / DPDP | `apps/web/src/app/account/page.tsx` "Your data" | Erasure is "email privacy@"; no anonymization routine, no admin action, no export; only a test-only `purge-org.ts` exists | Each request is hand-written SQL across 11 person FKs — slow and error-prone at any volume | **OPEN** — needs product/legal decision on scope, then tooling |
| **FR-12** | Testing | `.github/workflows/ci.yml` | The player-photo upload journey skips itself under the precompiled server and ran in **no CI job** | The upload route's authz already broke once unnoticed (see comment in `api/media/upload/route.ts`) | **FIXED** — dev-server CI step selecting that test by title |
| **FR-13** | Privacy / Abuse | `server/marketing/actions.ts` | Newsletter subscribe was the one unauthenticated public write with no throttle; the table is **write-only** (no reader, no send path, no retention sweep) | Unbounded growth; personal data collected for a purpose the product cannot fulfil | **PARTIAL** — per-IP throttle added; purpose/retention **OPEN** (founder) |
| **P2-H** | DR / SRE | `ops/deploy/docker-compose.production.yml` | Web, engine, runner, Postgres, MinIO and Caddy on one VPS; engine `replicas: 1` by design | One host failure is total outage including the database | **OPEN** — deliberate beta trade-off; acceptable only once P0-2 exists |
| **P2-R** | Payments | `KNOWN_LIMITATIONS.md` | Razorpay adapter forgery-tested but never run against the live gateway | Gateway collection unproven; manual capture is the working path | **OPEN** — one live staging transaction |

## 7 · P3 / P4 improvements

| ID | Sev | Item | Status |
|---|---|---|---|
| FR-14 | P3 | `pnpm verify` aborted locally: depcruise cruised `.next`, `.next-e2e`, `dist` **and the 1.1 GB gitignored `apps/web/.local`** (996 of 1,999 modules) → heap crash. CI never saw it (no `.local`). | **FIXED** — excluded; 987 modules, seconds, `apps/web/src` coverage unchanged at 532; negative control proves the gate still fires |
| FR-15 | P3 | `KNOWN_LIMITATIONS.md` said Email "not implemented" and object storage "not wired" — both exist | **FIXED** |
| FR-16 | P3 | Daily-ops schedule fan-out is O(finance orgs): **12.8 s at 74 orgs**; its test timed out (5 s) on any long-lived local DB | Test **FIXED** (explicit timeout + reason); scale watch **documented** |
| FR-17 | P3 | `bookSlotAction` takes a raw `requestId` with no token and no throttle | OPEN |
| FR-18 | P3 | Server actions (the bulk of the product) carry no request-id; only the 5 API routes do | OPEN |
| FR-19 | P3 | `react-hooks` v7 compiler rules (~20 sites) not adopted | OPEN — documented design decision |
| FR-20 | P3 | `packages/auction` (2,044-line `aggregate.ts`) has no `test` script; covered only by DB-bound integration suites | OPEN |
| FR-21 | P4 | `prototypes/va1` tracked prototype HTML/JS | OPEN |
| FR-22 | P4 | `/features` marketing page shows cricket-only sample players on a multi-sport product | OPEN |

---

## 8 · Architecture findings

- **Shape is right and not over-built.** Three services (web, a single-writer engine, a finops runner), one Postgres, no Redis, no queue broker — work queues are `FOR UPDATE SKIP LOCKED` tables. That is proportionate to the load.
- **Boundaries are enforced, not documented.** dependency-cruiser gates `core-is-pure` and friends. I proved the gate still fires after this audit's exclusion change by planting an `fs` import in core.
- **Grants, not roles.** `hasCapability` is a pure function over (person, scope, capability-set), and unknown sets expand to nothing. Four capability partitions (org, competition, platform admin/billing/demo) each have their own gate that returns `notFound`, not 403.
- **Debt worth naming:** the 8 system-pool reads (FR-09), and the absence of middleware — deliberate, since it removes the CVE-2025-29927 class, but it is also why CSP has no nonce (FR-10).
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

**Open:** FR-09 (RLS debt), FR-10 (CSP), FR-17 (booking throttle).

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

**Core platform, sport configuration and sport-specific rules are cleanly separated.** The auction, purse, settlement and lifecycle know nothing about a sport. Packs (`packages/core/src/sports/*`) carry vocabulary, attributes, score fields, points and tiebreakers, and the `sports` table is only an on/off flag. Lobby formats (battle royale) extended the contract rather than forking it. The one leak left was the registration form's optional detail, fixed in FR-02. The remaining cricket wording is a sample card on `/features` (FR-22) and the dev-only `/gallery`.

## 12 · UI/UX findings

- **Fixed:** FR-01 (demo funnel), FR-02 (cricket questions for every sport), FR-05 (full-reload anchors), FR-08 (type-scale).
- **Honest by construction:** the new landing's interactive auction is labelled "INTERACTIVE DEMO · Fictional players & teams. No real bids or payments", and every illustrative visual carries `aria-label="Illustrative …"`. No fabricated statistics were found. Every help link on the new landing resolves to a real article.
- **Live auction UX** answers the brief's seven questions. The status ribbon shows where you are; the lot hero shows who is on the block, the current bid, who holds it and the countdown; paddle control shows what you can do; and the stale-feed watchdog freezes the clock and says "Reconnecting…" rather than letting a number run on a dead socket.
- **Remaining:** `AuctionLab` renders sport buttons `disabled` until hydration (acceptable given the `<noscript>` note).

## 13 · Performance findings

- The countdown hook re-renders consumers once per second, not 10 Hz (quantised) — already done.
- FR-04 removed per-render listener churn in the cockpit.
- The import path does per-row inserts inside one transaction: fine at hundreds of rows, O(n) round trips beyond that.
- Targets I would hold to, with the current measurement status:

  | Metric | Target | Status |
  |---|---|---|
  | Bid ack p95 | < 150 ms same region | measured locally only |
  | Snapshot propagation p95 | < 250 ms | measured locally only |
  | Public page LCP | < 2.5 s on 4G | not measured on production hardware |
  | Server action p95 | < 400 ms | measured locally only |

  **Production perf certification has not been run.**

## 14 · Scalability findings

At 1,000 concurrent auction participants, what breaks first is **the single engine process and single host**. Engine rooms are capped at 2,000 sockets per room and 50 per IP. Fan-out computes one redaction per distinct audience, not per socket. A snapshot is a few KB. So one room of 1,000 is within reach. A dozen simultaneous big auctions on one 4 vCPU box is not proven.

The second limit is the **finops daily-ops fan-out** (FR-16, 12.8 s at 74 orgs), then the admin health page's per-org fan-out on a `max: 10` pool. No Redis is needed at this scale, and adding it would be over-building.

## 15 · Database findings

The schema is the strongest part of the system. Money is integer paise. Every status enum is also a CHECK constraint (0030). Referential integrity for all 11 `person_id` columns encodes the DPDP anonymize-versus-delete promise (0040). Uniqueness is enforced where races matter: one registration per person per season, captains, fixtures, bookings, paddles, grants and document numbering.

Open: about 35 `*_by` columns carry no FK. `audit_log` has no index on `actor` or `scope_id` alone (already on the team's scale watch). `registrations.attributes` now has a writer and readers.

## 16 · DevOps / SRE findings

- Images are built in CI and pinned (Postgres by tag, MinIO by digest). Logs are capped. Caddy terminates TLS.
- `/healthz` means liveness and never touches the DB; `/readyz` means readiness.
- The deploy refuses during a live window. `preflight:production` refuses the rehearsal escape hatch and localhost URLs.
- The web tier refuses to boot on a BYPASSRLS role.
- **Open:** P0-1..3, P2-H (single host), dashboards and alerts not provisioned.

## 17 · Testing gaps

| Area | Coverage | Gap |
|---|---|---|
| Unit | 962 tests, pure core heavily covered | `packages/auction` has no unit script (FR-20) |
| Integration / DB | 1,055 tests, incl. RLS posture under production roles | — |
| E2E | 139 specs, axe on every surface | photo journey now in CI (FR-12); Firefox/WebKit opt-in only |
| Concurrency | 10-way bid races | multi-auction load on one engine unproven |
| Load | local perf scripts | **no production-hardware run** |
| Security | forgery, replay, IDOR regression suites | no DAST/pen-test |
| Mobile | 320–360 px geometry assertions | real-device pass pending |

## 18 · Business / product gaps

- **No price exists** for Pro or Association. Launching Free-only is legitimate; launching with an undecided price is not.
- **Payments:** manual capture (cash, UPI, bank) works. Gateway collection needs Razorpay Route onboarding per organizer (KYC).
- **Assumption (labelled):** the beta monetizes nothing and the demo-booking funnel is the primary acquisition channel. That assumption is why FR-01 is rated P1.

## 19 · Legal / compliance items requiring professional review

These are not legal conclusions. They are items for counsel:

- ratification of the Terms, Privacy and Retention drafts;
- the minors' consent mechanism (DPDP §9);
- the erasure turnaround ("seven days") against a process with no tooling;
- newsletter consent without double opt-in, for a list nothing reads;
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
| Verification | quarterly timed restore drill | `restore:drill` exists; production drill **not run** |
| RPO / RTO targets (proposed) | RPO ≤ 5 min (PITR); RTO ≤ 2 h for full host loss, ≤ 2 min for engine restart (replay from log) | unmeasured on production |
| Object storage | MinIO volume on the same host | **must be backed up off-host too** |
| Secrets | held outside the host | `SECRET_ROTATION.md` exists |
| Single points of failure | the host; the engine process (by design) | accepted for beta once backups exist |

## 22 · Top 20 risks

1. No SMS provider, so no user can log in (P0-1).
2. No provisioned backups or PITR (P0-2).
3. Production env and roles not bootstrapped (P0-3).
4. Legal drafts unratified (P1-L).
5. Single host holds the app, the DB and object storage (P2-H).
6. 8 modules read on the RLS-bypass pool (FR-09).
7. No CSP `script-src` (FR-10).
8. Erasure has no mechanism (FR-11).
9. Razorpay never run live (P2-R).
10. No price for paid tiers.
11. Production perf never measured.
12. Engine is a single process, so a crash pauses every live auction until restart and replay.
13. Firefox and WebKit live-auction flakiness is not understood.
14. Newsletter data has no purpose or retention (FR-13).
15. Daily-ops fan-out is O(orgs) (FR-16).
16. DMARC is at `p=none`.
17. Server actions are uncorrelated in logs (FR-18).
18. No dashboards or alerts are provisioned.
19. `packages/auction` has only DB-bound tests (FR-20).
20. Demo booking has no throttle (FR-17).

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
- [ ] This branch: commit the fixes, CI green (all four jobs)

## 24 · Post-launch 30 / 60 / 90

- **30 days:** close FR-09 (RLS debt, PA-1R 3.4). Nonce CSP (FR-10). Erasure tooling behind a platform-admin action (FR-11). Request-id for server actions (FR-18). Throttle demo booking (FR-17). Production perf run.
- **60 days:** Razorpay live, with Route onboarding. Batch the daily-ops fan-out (FR-16). Firefox and WebKit back in the nightly. Add a `packages/auction` unit layer (FR-20). Newsletter: either build the send path with double opt-in, or delete the table (FR-13).
- **90 days:** Evaluate a hot-standby engine versus a single-process recovery SLO. Separate the DB from the app host. Adopt the React Compiler rules deliberately (FR-19). Pen-test.

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

---

## Validation — before and after, every gate actually run

| Gate | Before this audit | After |
|---|---|---|
| `pnpm lint` (now incl. react-hooks, jsx-a11y, @next/next) | pass, but those rules never ran | **pass** — 11/11 packages |
| `pnpm typecheck` | pass | **pass** — 11/11 |
| `pnpm test` (unit) | 949 pass | **962 pass** (+13) |
| `pnpm format:check` | pass | **pass** |
| `pnpm depcruise` | **crashed** (heap) on this machine | **pass** — 987 modules, 0 violations; negative control fires |
| `pnpm check:motion` / `check:posture` | pass | **pass** (posture: 0 defect, 8 debt) |
| `pnpm build` | pass | **pass** (4/4) |
| `pnpm test:integration` | not run before changes; first full run **2 failed** of 1,055 — both proven pre-existing (type-scale red from the uncommitted UI work; a finops test that times out on any long-lived local DB, 12.8 s against a 5 s default) | **1,055 / 1,055 pass** (983 web + 72 engine) |
| e2e, precompiled, Chromium | **102 pass · 1 FAIL · 29 skip · 7 did not run** | **110 pass · 0 fail · 29 skip** (the 29 are the documented dev-only skips, now all covered by CI dev-server steps) |
| `pnpm audit --prod` | 0 vulnerabilities | 0 vulnerabilities |
| Secret scan (tracked files) | clean | clean |

Reproduce with `pnpm verify`, `pnpm build`, `pnpm test:integration`, and
`NEXT_DIST_DIR=.next-e2e next build` then `PLAYWRIGHT_PRECOMPILED=1 pnpm exec playwright test`.

**Not run, and therefore not claimed:** Firefox/WebKit e2e, production-hardware
performance, a live SMS/Razorpay/S3 round trip, a restore drill on production
infrastructure, and a penetration test.
