# PA-1 — Principal Architect Audit

**Date:** 2026-09-04 · **Commit:** `e6712df` · **Branch:** `feat/my-plan-1-5`
**Scope:** architecture, domain correctness, concurrency, database, API/authz, security, frontend, UX, performance, reliability, workers, integrations, supply chain, deployment, observability, testing, documentation.
**Method:** the repository was read, not summarised from its own documents. Every toolchain command below was executed and its output inspected. Documentation was treated as a claim to verify, never as evidence.

---

# 1. Executive Summary

DesiAuction is a genuinely well-built system with a small number of defects that are lethal in exactly the places that matter, and an operational layer that does not yet exist.

**What is strong.** The auction engine is the best part of the codebase and is close to exemplary: a pure deterministic reducer, an append-only per-auction event log with a monotonic `seq` and a DB-enforced unique index, a single-writer advisory lease, post-command replay verification that halts on divergence, integer-paise money throughout, anti-snipe timers that provably never shrink, and a bid gauntlet whose eleven checks are all server-side. Module boundaries are machine-enforced (`pnpm depcruise`: 1599 modules, 7616 dependencies, zero violations). Authentication (OTP + passkeys), session handling, invite tokens, `safeNext`, CSV export escaping and the capability partitions are above industry norm. `pnpm verify` is green end to end.

**What is broken.** Three defects share one root cause — *code paths that skip the tenant boundary, in a repository where every local process connects as the database superuser, so nothing local can see them*:

- The **Razorpay webhook runs outside `withTenantDb`** and loads the payment by id alone. Under the documented production role recipe (`desiauction_app` is `NOBYPASSRLS`, `payments` carries `FORCE ROW LEVEL SECURITY`), every gateway callback returns zero rows and answers **404**. Gateway capture cannot complete in production. The go-live gate "one live order → webhook → capture → discharge" cannot pass.
- The **delivery-status and SMS-inbound webhooks write through `desiauction_system`**, whose write grants are exactly four tables — and `suppressions`, `finops_events` and `finops_dispatches` are not among them. STOP requests and bounces would fail with a permission error in production.
- **133 tenant-scoped reads run on the RLS-exempt `system` pool**, including `/home` and the organizer conduct screen. Their tenant safety is entirely hand-written `where` clauses.

Alongside these: the **fiscal-period lifecycle is unreachable** (no product surface calls `openPeriod`, so daily attestation short-circuits and no period can ever close); **invariant 18 — "an owner never owns two teams" — is enforced nowhere**, and the local database already holds 26 violating pairs; the **auction spine has no foreign keys** (133 unconstrained id columns; 220 lots point at no registration, 214 sold lots at no paddle); the **finops worker's 60-second lease is never extended** while it runs a batch of ten jobs sequentially; and the **web tier has no logger at all** — five `console.*` calls in 109,000 lines.

**What does not exist.** No backups run. No restore has ever been rehearsed. No PITR. No metrics, no dashboards, no alerts. `pnpm preflight:production` refuses with **16 blockers**. `desiauction.in` is parked with no MX, which blocks passkeys, canonical URLs and a statutory grievance address simultaneously.

**Verdict: NO-GO.** Not because the engineering is weak — it is not — but because the money path does not work under its own production configuration, a constitutional invariant is unenforced with live violations, and there is no operational layer to run on. The engineering remediation is unusually tractable: the P0 list is roughly a week of focused work. The infrastructure list is founder provisioning and is the longer pole.

---

# 2. What DesiAuction Currently Is

A multi-tenant SaaS for running community cricket auctions in India: organizers create tournaments and seasons, players register (public link or CSV/Google-Form import), teams are formed, owners are invited, and on auction night a conductor runs a live event where team owners bid for players in real time under purse and squad constraints. After the hammer, the platform settles money owed between teams and the organizer, and a financial-operations layer issues receipts and invoices.

**Personas → surfaces** (85 pages, 11 route handlers, one shell with four modes):

| Persona | Entry | Surfaces |
|---|---|---|
| Guest / spectator | `/`, `/c/[slug]` | directory, public season page, spectate, board, overlay, poster/share cards |
| Player | `/login` → `/onboarding` → `/home` | registration, own profile (`/me/cricket`), inbox, account |
| Team owner | `/owner-join/[token]` → live room | claim paddle, bid, "My plan" (WR-1 private plan), own receipts (`/money`) |
| Organizer / conductor | `/home` ladder | org, tournament, season, teams, registrations, readiness, fixtures, standings, auction desk, cockpit |
| Finance | `/org/[slug]/settlement`, `/money` | settlement console, case review, collections, finops ops board |
| Platform admin | avatar → `/admin` | 11 read-only projections |

**Lifecycles.** Auction: `scheduled → live ⇄ paused → completed → reconciled` (or `abandoned`). Lot: `prepared → queued → on_block → closing_soon → sold | unsold(→requeue) | frozen | withdrawn`. Registration: submitted → triage → approved/waitlisted/rejected/withdrawn → pooled → sold. Settlement: case open → verify → compute obligations → collect → settle → close. FinOps: declare profile → open series → issue documents → attest days → close period → year end.

**Scale reality.** Community sports auctions: tens of teams, hundreds of players, tens of concurrent bidders per event, a handful of concurrent events. Free tier caps at 4 teams / 40 players. The architecture is sized well above this; the risks are correctness and operations, not throughput.

---

# 3. Current Architecture

```
                    ┌──────────────────────────────────────────────┐
  browser ─────────►│ apps/web (Next.js 15 App Router, RSC)         │
   (RSC + actions)  │  · 85 pages, 30 "use server" modules          │
                    │  · server actions ARE the API (no REST)       │
                    │  · 6 route handlers: media, 2 jobs, 3 webhooks│
                    └───┬──────────────────────┬───────────────────┘
                        │ withTenantDb         │ HTTP + x-engine-secret
                        │ (set_config app.*)   │ (2s timeout)
                        ▼                      ▼
                 ┌──────────────┐      ┌────────────────────────────┐
  browser ◄──WS──┤  PostgreSQL  │◄─────┤ apps/engine (Fastify + ws) │
   (snapshots)   │   17, 61 tbl │      │  · single writer per DB    │
                 │   46 FORCE   │      │    (session advisory lock) │
                 │   RLS tables │      │  · pure reducer + replay   │
                 └──────┬───────┘      │  · 250ms timer tick        │
                        │              └────────────────────────────┘
                        │ poll 15s
                 ┌──────┴────────────────────┐
                 │ apps/finops-runner        │
                 │  · finops_jobs, SKIP LOCKED│
                 └───────────────────────────┘

packages/  core (pure domain, 13.5k lines) · auction (aggregate/views, 2.5k)
           settlement (7.1k) · financial-operations (12k) · db (drizzle schema
           + 42 migrations) · ui (FLOODLIGHT, 5.4k) · contracts (82 lines)
```

**Traced end to end — placing a bid:**

`live-panel.tsx:145` (client, computes affordability with core's own functions) → `submitAuctionCommand` (`server/auction/live-actions.ts:419`; `liveGate` proves session + participation, sets `conduct`/`override` from capabilities, validates command id shape) → `engine-client.ts:20` (`POST /command`, `x-engine-secret`, 2s abort) → `server.ts:323` (constant-time secret compare, envelope type-check, `receivedAtMs` stamped server-side) → `engine-core.ts:424` (per-actor token bucket, ack cache keyed `(actor, commandId)`, FIFO queue) → `aggregate.ts:789` (loads rows, runs `decideBid`'s eleven-check gauntlet from `packages/core/src/auction.ts:472`) → one transaction: bid row + `auction_events` append at `max(seq)+1` (unique index) + `audit_log` → re-fold the entire event log and compare to the projection, halt on divergence → broadcast full snapshot to the room with purses redacted per ticket scope.

That path is sound. The equivalent trace for a **payment webhook** is not: `route.ts:38` → `handleRazorpayWebhook(settlementDeps(dbHandle.db))` — the plain pool, no `withTenantDb`, no `set_config` — → `store.ts:456` `select ... from payments where id = ?`. The file's own comment marks the missing step: *"this is the point at which a withTenant boundary would wrap the work"*.

---

# 4. Architecture Assessment

**Verdict: B — production-ready with fixes.** The shape is right; specific paths are wrong.

**What the architecture gets right.**
- *Dependency direction is real, not aspirational.* `packages/core` imports nothing from the workspace; `packages/ui` never imports core; `spikes/` is quarantined by rule. Machine-checked on every PR (`.dependency-cruiser.cjs`, zero violations across 1599 modules).
- *Hexagonal where it earns it.* `packages/financial-operations/src/ports.ts` defines the ports; web and runner inject different adapters. Settlement's writer is a genuine application service with the capability check inside it, not at the surface: `writer.ts:220` — "surfaces are courtesy, never the boundary". That is the correct instinct and it is implemented.
- *Event sourcing where it earns it* (auction, settlement, finops) and plain projections elsewhere. Nobody event-sourced the org directory.
- *Three processes, each justified.* Web is stateless and serverless-shaped; the engine is stateful, single-writer and holds timers; the runner is the one home for scheduled work and is deliberately kept off the money path (C-16). A modular monolith is the right shape and this is one, with two small satellites. **No microservice split is warranted and none should be introduced.**

**Where it is weak.**
1. **The tenant boundary is a convention with 133 documented exceptions.** `withTenantDb` is correct and used at 102 sites; `systemDb` — the BYPASSRLS pool — is used at 133, including `/home`'s money aggregates and the conduct screen's lot reads and owner phones. `ops/db/create-app-role.sql:86-110` admits this is a deferred refactor. The result: RLS is defence-in-depth for two thirds of reads and *the only* defence for none, which is fine — but the boundary can no longer be reasoned about as a boundary.
2. **Two writers on `registrations`.** The engine stamps `team_id` inside the sale transaction; the web tier's `assignTeam` also writes it, guarded by a non-transactional "auction has left `scheduled`" check. This breaks the single-writer discipline C-9 asserts.
3. **The web tier reaches for `@desiauction/db` directly** rather than through a repository. This is defensible for RSC read models, but it is why the `systemDb` sprawl was easy.
4. **God modules exist.** `apps/web/src/server/competition/actions.ts` is ~2,000 lines carrying registration triage, import, export and team management; `apps/web/src/app/seasons/[slug]/auction/cockpit/cockpit-panel.tsx` is 1,083 lines. Neither is unsafe; both are past the point where a reader can hold them.
5. **Business rules leak into server actions.** `guardFailureDetail`, `publishBlockers`, readiness composition and several money-visibility decisions live in `apps/web/src/server`, not in `packages/core` — so they are unavailable to the engine and untested by the core suite.

**Patterns worth adding (and only these).** A **fenced-lease pattern** for the finops worker (lease token in the completion `WHERE`). A **transactional outbox** for the two places where a side effect precedes its commit (`dispatch.send`, auction-completion announcements). A **repository seam** for the ~15 hottest read models so `systemDb` cannot spread further. Nothing else: no CQRS beyond what event sourcing already gives, no message broker, no cache tier, no Kubernetes.

---

# 5. Domain / Business Logic Assessment

The 35 invariants in `docs/40-business-rules.md` are the product's constitution. Enforcement was checked against code and, where possible, live data.

| # | Invariant | Claimed by doc | Actually enforced | Verdict |
|---|---|---|---|---|
| 1 | Nothing exists outside one org | schema | `org_id` on tenant tables + 46 FORCE-RLS policies | **OK** (weakened by `systemDb` reads) |
| 2 | An org never has zero owners | schema (52) | app guard only (`orgs/actions.ts:582`); **11 orgs live with no active owner grant** | **GAP** |
| 5 | No auto-approval of a registration | policy | human gate in triage actions | OK |
| 8 | Contact/payment details never public | read model | public payloads carry no phones | OK |
| 9 | All money/time mutations via the engine | platform | second writer on `registrations` (web `assignTeam`) | **PARTIAL** |
| 10 | A bid is never edited or deleted | schema | `revoke update, delete` on `auction_events`/`audit_log` is real; **bid *rows* remain mutable** by the engine (status flips are by design) | PARTIAL by design |
| 11 | Squads/spend derived from purchases | engine | `squadSize` = sold lots + icons; `committed` = Σ `lots.sold_price` | OK |
| 13 | No celebration before commitment | engine | SOLD renders from the post-commit snapshot | OK |
| 14 | Timer never shrinks | engine | `auction.ts:551-566` + replay re-proves `timer_shrank` | **OK, well done** |
| 15 | No LIVE without active Pass, locked rules/pool, ≥2 teams with accepted owners | engine | guard is `≥2 claimed paddles && ≥1 queued lot`. **No Pass/entitlement check exists anywhere** | **GAP** |
| 17 | Undeterminable money freezes for a human | engine | `hold`/`frozen` lot state exists and is reachable | OK |
| **18** | **An owner never owns two teams** | **schema** | **nothing** — `paddle_grants_active_uq` is `(auction, team, person)`; no refusal in the aggregate; **26 (auction, person) pairs live hold paddles on ≥2 teams** | **VIOLATED** |
| 24 | Every charge has an immutable record | commercial | finops documents are dense-numbered and source-keyed | OK |
| 25 | Payment state derives from provider truth | commercial | **the provider callback cannot reach the aggregate in production** (§10 P0-1) | **BROKEN in prod** |
| 28 | Privileged actions fail if the audit write fails | platform | true where audit is in the same tenant transaction; **`acceptInvite` writes claim + member + grant + audit on `systemDb` outside any transaction** | **PARTIAL** |
| 29 | Activity/History/Audit never disagree | read model | one stream per aggregate; projections rebuilt from it | OK |
| **35** | **VIEW tokens never expose purse when redaction is on** | read model | **the money-visibility switch does not exist** (`live-actions.ts:245`: "TODO(founder) … NOT decided here"), and purse is arithmetically recoverable anyway (§10 P1-3) | **NOT IMPLEMENTED** |

**Purse and bid ceiling.** `decideBid` (`packages/core/src/auction.ts:472-534`) is the strongest piece of domain code in the repository: status, arrival-time expiry, holder identity, self-outbid at *team* level, increment ladder membership, purse remaining, reserve for remaining mandatory slots (`(squadMin − squadSize − 1) × minPossiblePrice`), squad max, role quota. Every check is server-side and the client uses the *same core functions*, so the two cannot drift on arithmetic — only on inputs.

**But the inputs are read outside the write transaction.** `aggregate.ts:811-870` computes `committed`, `squadSize` and role counts, then the write happens at `:934`. There is no `SELECT … FOR UPDATE` and no advisory lock inside the transaction. This is safe *only* because the single-writer lease means one process is doing it. It is a correctness property resting on a deployment property.

**Two invariants are silently unreachable.** `is_retained` is excluded from the pool nowhere (`auction-ready.ts:82` filters `is_icon` only) and never counted in squad size — the flag has no writer today, so it is latent rather than live. And a season can be **completed with `queued` lots that were never called**: `unresolvedLots` (`aggregate.ts:381`) counts only `on_block`/`closing_soon`/`frozen`.

---

# 6. Auction & Concurrency Assessment

**Single-writer lease.** `pg_try_advisory_lock` on a dedicated connection, non-blocking, re-verified every 10s, refusal names the holder, loss → process exit (`single-writer.ts:197-265`). The `docker-compose.yml` TCP keepalives that make orphan reaping work are documented and correct, and are flagged as a production database requirement. **There is no fencing token**: between lease loss and the next 10-second verification, a departing engine still writes. The only cross-process fence is `auction_events(auction_id, seq)` unique — so two engines cannot corrupt the log, but can broadcast divergent snapshots for up to 10 seconds, and the loser's failure surfaces as an ack reason `engine_halted` **without actually halting or rebuilding** (`engine-core.ts:436-441`), leaving the in-memory snapshot stale until the next command.

**Idempotency.** The past `commandId` namespace-collision defect is genuinely fixed, twice over: transport ids must match UUID/ULID and are rejected at both `server.ts:342` and `live-actions.ts:439`; the ack cache is keyed `(actor, commandId)`; timer commands use an `ENGINE_ACTOR` the transport cannot claim. Regression tests exist for both halves.

**…and the client defeats it.** `live-panel.tsx:145` calls `intents.idFor(key)` **without the payload**, although `useIntentIds` supports payload-keyed slots and the comment directly above says that is what prevents this. After one lost answer, the next press — a different amount, or *the next lot* — reuses the id and receives the cached ack. The bidder is told "accepted" for a bid that never landed.

**Timers.** Server-authoritative, 250 ms tick, expiry checked against `receivedAtMs` stamped at submit (so a bid that arrives after the hammer is refused `LOT_EXPIRED` regardless of network delay). Anti-snipe extension is capped and monotone and replay re-proves it. Two gaps: **timers only run for auctions resident in memory, and nothing rehydrates live auctions at boot** — after an engine restart a lot's close waits for the first socket join or command; and **`_TimerClose`, `CloseLot`, `Hold` and `Requeue` all execute on a `paused` auction** (only `open` checks `status === 'live'`, `aggregate.ts:618`), so a lot can be hammered during a dispute pause.

**Cost model.** Every command triggers a full re-fold of the entire event log (`rebuild` → `loadEvents`, all rows) — O(n²) across a night — and *rejected* bids append `BidRejected` events, so refusals grow the very log they must re-fold. The rate limit is per actor (200 burst / 50 per second), so a room of N owners multiplies it. At community scale this is survivable; it is the most likely source of a bad night once auctions get long, and the 2-second web→engine timeout is the thing that will break first.

**Failure-mode table (verified):**

| Operation | Two at once | Retried | Client disconnects | Engine crashes | Stale client |
|---|---|---|---|---|---|
| Claim paddle | FIFO; 2nd → `paddle_held`; cross-process → DB partial unique | idempotent | ack lost, state correct | tx atomic, replay recovers | refused |
| Place bid | FIFO; 2nd → `BELOW_CURRENT` / `ALREADY_LEADING` | cached ack — **but see the intent-id defect** | ack lost | tx atomic; bid must be re-sent | `LOT_EXPIRED` / `LOT_NOT_OPEN` |
| Hammer | 2nd → `illegal_transition` (`sold` terminal) | same | ack lost | atomic | same |
| Undo | 2nd → `undo_window_closed` | cached | ack lost | atomic; **after 512 commands the cache evicts and a late retry could undo a different resolution** | — |
| Complete | 2nd → `illegal_transition` | **a new-id retry after a lost ack never announces the outcome** (announcement rides the ack, not the event) | notifications lost | atomic | — |

---

# 7. Database Assessment

Postgres 17, 61 tables, 42 migrations, drizzle. The event-stream, idempotency, status-CHECK and partial-unique layer is well above average. Two things are wrong.

**Referential integrity: the auction spine has none.** `pg_constraint` reports **14 foreign keys in total**, all introduced by migrations 0032/0040/0041 — every one of them on the `person_id` arm. **133 `*_id` / `*_by` columns carry no FK**: `lots.auction_id`, `lots.registration_id`, `lots.sold_to_paddle_id`, `bids.lot_id`, `bids.paddle_id`, `paddles.team_id`, `teams.competition_id`, `competitions.org_id`, `settlement_obligations.case_id` — the entire spine. Live consequences already visible in the development database: **220 of 332 lots reference a registration that does not exist**, **214 sold lots point at a paddle that does not exist**, **100 competitions have no organization**. This is very likely test-teardown residue rather than a runtime writer bug — but it is exactly the silent-empty-join failure that migration 0040 was written to end, now sitting on the auction spine.

**Constraints that do exist are good.** `lots_sold_state_consistent`, `lots_auction_registration_uq`, `paddles_auction_team_active_uq`, `registrations_team_captain_uq`, `registrations_competition_person_uq`, `auctions_competition_active_uq`, `settlement_cases_auction_live_uq`, `*_events (stream, seq)` and `(stream, command_id)` unique. Missing at DB level: purse ≥ 0 (derived, app-only), one-owner-one-team (§5), and CHECK constraints on ~15 status columns that are enums in TypeScript and free text in Postgres (`settlement_cases.status`, `payments.method/status`, `finops_jobs.state`, `grants.capability_set`, `registrations.role`).

**RLS.** 46 tables ENABLE + FORCE, each with exactly one policy, all keyed on `current_setting('app.org_id', true)` so an unset GUC fails closed. No table has RLS enabled with zero policies. `withTenantDb` correctly sets both GUCs transaction-locally on the same connection. `assertTenantIsolation()` refuses to boot a production web tier whose app role can bypass RLS — a genuinely good control. **The problem is reach, not design**: `.env.local` connects as the superuser `desiauction`, so RLS is inert for every local process and every e2e run; and 133 reads use the bypass pool by design.

**Migrations.** Drizzle wraps all pending migrations in one transaction — good atomicity, but it makes `CREATE INDEX CONCURRENTLY` impossible. There is **no `lock_timeout`** anywhere in the migration path and **no advisory lock around `migrate`**, so two deployers can race and an `ALTER TABLE` queued behind a long read blocks the table. Migration 0040's six FK additions were written without `NOT VALID`, so each took a full validation scan. The journal `when`-timestamp trap is real, documented, and has already bitten. Snapshots stop at 0018, so `drizzle-kit generate` is blocked and schema.ts declares 14 FKs / 13 CHECKs against ~50 CHECKs in the live database.

**Indexes.** One genuinely duplicate index (`demo_bookings_slot_idx` ⊂ `demo_bookings_slot_uq`). Three unindexed FK columns on `auction_team_targets` that a registration CASCADE will seq-scan. Ten RLS-filtered tables without an `org_id` index (a filter cost, not a scan). No `audit_log(actor, at)` index though the admin explorer filters by actor. All P3 at current volumes; `docs/operations/KNOWN_LIMITATIONS.md` already names the audit-log one.

**Transactions.** Engine: one transaction per command at READ COMMITTED, serialised by the process lease, with `max(seq)+1` fenced by a unique index. Registration approval correctly takes `pg_advisory_xact_lock` before the count-then-approve. FinOps job claim correctly uses `FOR UPDATE SKIP LOCKED`. **Settlement is the exception**: `store.ts:88` does `max(seq)+1` with no row lock, across a multi-instance web tier, and there is no retry or translation of the resulting `23505` — two operators on one case produce a raw constraint error in the UI.

---

# 8. API Inventory & Assessment

DesiAuction has **no REST API**. Its API surface is ~120 exported Next.js server actions across 30 `"use server"` modules, plus 11 route handlers. This is a defensible choice for a first-party-only product — it removes a whole serialization/versioning layer — but it means the API contract is TypeScript types, and the usual API disciplines have to be re-established by hand. Mostly they have been.

**Route handlers (the only HTTP surface):**

| Route | Auth | Validation | Idempotent | Rate limit | Notes |
|---|---|---|---|---|---|
| `PUT /api/media/upload` | session + (own key ∨ org membership); org id derived **from the key** then checked | `isValidMediaKey` regex, content type, size, **magic bytes** | yes | none | dev/local storage only; body buffered before size check |
| `POST /api/jobs/demo-reminders` | `x-demo-job-secret`, length-checked + `timingSafeEqual`, **404 when unset** | — | row-stamped | none | no overlap lock |
| `POST /api/jobs/settlement-coordination` | `x-settlement-job-secret`, same pattern | — | source-keyed effects | none | no overlap lock |
| `POST /api/webhooks/razorpay` | HMAC-SHA256 over **raw bytes**, `timingSafeEqual`, 5-min freshness window, org pinned from the signed envelope | JSON parse + envelope shape | `kind:providerRef` | none | **no tenant boundary — P0-1** |
| `POST /api/webhooks/delivery-status` | `x-callback-secret`, constant-time, 404 unset | `parseEmailCallback` | `provider:{eventRef}` | none | **writes on the system role — P0-2** |
| `POST /api/webhooks/sms-inbound` | `x-inbound-secret`, constant-time, 404 unset | field sniffing, `from` required | by contact | none | same system-role problem |
| `GET /healthz`, `/readyz` | anon | — | — | none | `/readyz` does `select 1`, 503 on failure, and surfaces the insecure-rehearsal flag |
| `GET /demo/[token]/invite.ics` | HMAC-derived token | 16–128 chars | — | none | org name escaped |

The webhook design is the strongest part of this surface *as designed*: signature over raw bytes (the route explicitly avoids re-serialising), constant-time compare, freshness window, the org taken from the **signed** envelope rather than a request field, then a pin check that the loaded payment's org matches. Fail-closed everywhere: a missing secret 404s the route rather than opening it. It is undone only by the missing tenant transaction.

**Server actions — cross-cutting posture.** Org id is derived server-side from slug → membership in every case except `createCompetitionAction`/`createTournamentAction`, which accept a hidden `orgId` and then re-prove it against the caller's orgs. Ownership checks happen inside the tenant transaction with `competition_id` predicates. Capability checks are enforced in the **writer**, not the surface, for settlement and finops — the correct layer. Errors map to stable generic sentences. CSV exports are formula-escaped and audited in the same transaction.

**Systemic gaps.**
- **No input schema validation anywhere.** Zero `zod` usage in any action module; everything is ad-hoc `formString`/`typeof` checks. `docs/49-security-model.md` claims "all input validated with shared zod contracts". `packages/contracts` is 82 lines and covers only health responses. Nothing catches an unbounded string: `saveImportMappingAction`'s labels and value-maps, consent wording, and `fixtureImportCommitAction`'s CSV (registrations' import has a 2 MB / 5000-row cap; fixtures' does not).
- **No rate limiting in the web tier at all.** `grep -rl rateLimit apps/web/src` returns nothing and there is no middleware. OTP send/verify and demo requests have their own DB-backed throttles; everything else — org/season/team/tournament creation, invite minting, bulk triage, `recordPaymentAction` — is unbounded. `docs/46-payment-flow.md` claims "payment routes rate-limited".
- **Gate helpers are exported from `"use server"` modules** (`liveGate`, `auctionMemberGate`), which makes them callable endpoints. They return only facts about the caller, so the leak is small, but it is off-policy and the file's own comments argue against it elsewhere.
- **Two actions are not idempotent where they should be**: `retryDeliveryAction` mints a fresh command id per call, so a double-click sends two emails; `openCaseAction` likewise (its writer probably refuses the second, unverified).

---

# 9. Authentication & Authorization

**This is the strongest security area in the repository, with one serious exception.**

**Identity.** Phone-first OTP plus WebAuthn passkeys. OTP codes are 6 digits from `randomInt`, SHA-256 at rest, 5-minute TTL, single-use, purpose-bound (`login` vs `phone_change`), with an atomic 5-attempt cap that bumps under a row lock and only for rows still below the cap. Send throttles: 30-second cooldown, 5/phone/hour, 20/IP/hour. Enumeration responses are uniform. Sessions: 32 random bytes, SHA-256 stored, `httpOnly`, `sameSite=Lax`, `secure` in production, 30-day sliding with a 90-day absolute ceiling, DB-revocable individually or in bulk.

**Authorization is grants, not roles** (C-8), and the implementation is unusually clean: `org_members` carries no role column at all — membership is data scope, capabilities are grants. Four *partitioned* capability engines evaluate one `grants` table (org, settlement, finops, platform), and each expands an unknown set to `[]`, so a settlement grant cannot accidentally confer an org capability. `viewer` is literally the empty set. Platform grants are unmintable from the app: migration 0004's `WITH CHECK` restricts writes to `scope_type = 'org' AND scope_id = current_setting('app.org_id')`, so `platform:admin` can only be seeded by a script on the system connection. `/admin` is read-only for money and gated under RLS.

**Findings.**

- **[P1] Phone change needs only a live session — no step-up.** `auth/actions.ts:629-721`: `requestPhoneChange` sends a code to the *new* number and `confirmPhoneChange` rewrites `people.phone`. There is no re-authentication, no cooling period, and no undo. The sole compensating control is a best-effort SMS to the old number, wrapped in a swallowed `catch` and skipped entirely if that number ever sent STOP. Anyone holding a captured session (30–90 day lifetime, shared handsets are the norm in this market) converts it into permanent account ownership, including any org-owner and settlement grants that person holds. The file's own comment acknowledges "a stolen session could move a number".
- **[P2] `issueGrant` accepts any person id, member or not**, and the last-owner guard counts grant holders rather than members — so an owner can grant `org:owner` to an arbitrary ULID, then revoke their own, leaving an org whose only "owner" is not a member and can never mint an invite. Also: `removeMember` revokes `scope_type='org'` grants only, leaving competition-scope grants dormant.
- **[P3] Re-login does not revoke the session the cookie is replacing**; a token captured earlier stays valid for up to 30 days.
- **[P3] `acceptInvite` writes claim + membership + grant + audit on `systemDb` outside any transaction** — a crash mid-way leaves an accepted invite with no membership (invariant 28).

**Documentation divergence is systematic.** `docs/49-security-model.md` claims short-lived access tokens with rotating refresh, device binding, step-up re-auth within 10 minutes for overrides and billing, nonce-based CSP, and zod validation of all input. **None of these exist.** The session model is one 30-day sliding bearer; there is no step-up anywhere. `docs/36-permission-model.md` uses a capability vocabulary (`org:manage`, `tournament:conduct`, `team:bid`) that does not match the code (`org.manage`, `auction.conduct`, and bidding authority is a paddle row, not a grant).

---

# 10. Complete Security Assessment

## P0-1 — Razorpay webhook has no tenant boundary; gateway payments cannot complete in production

**Location:** `apps/web/src/app/api/webhooks/razorpay/route.ts:38` → `apps/web/src/server/settlement/webhook.ts:60` → `apps/web/src/server/settlement/store.ts:456`.

**Evidence.** The route builds its dependencies from the raw pool: `handleRazorpayWebhook(settlementDeps(dbHandle.db), …)`. The handler's own header comment lists step 4 as *"establish tenant context (orgId comes from the VERIFIED envelope)"* and the code at that point simply calls `deps.store.loadPayment(envelope.paymentId)`. The store does `select … from payments where id = ?` with no org predicate and no `set_config`. Migration `0012_collections_payments.sql:24-28` puts `ENABLE` + `FORCE ROW LEVEL SECURITY` on `payments` with `USING (org_id = current_setting('app.org_id', true))`. `ops/db/create-app-role.sql:38` creates `desiauction_app` as `nosuperuser nobypassrls`. With no GUC set, `current_setting(…, true)` is NULL, the policy is false for every row, the select returns nothing, and the handler answers **404 `unknown_payment`**. The subsequent `settlement_events` insert would be refused by the same policy's `WITH CHECK`.

**Why no test catches it.** Every local process connects as `desiauction` — a superuser — so RLS is inert; the regression suite builds `settlementDeps(db)` on that same owner connection, and `webhook-route.regression.test.ts` asserts only existence, 404-when-unset and raw-body handling.

**Impact.** Not an attacker path — an integrity and availability failure on the money path. Captures and refunds never transition the Payment aggregate; Razorpay retries a 404 until it stops; the organizer's account is credited while the platform still shows the obligation outstanding. `docs/46`'s go-live gate is unrunnable.

**Fix.** After the envelope is verified, open `withTenantDb(dbHandle, { personId: SYSTEM_ACTOR, orgId: envelope.orgId }, db => …)` and build `settlementDeps(db)` inside it. The verified envelope org is the correct anchor and is exactly what the comment intends. Keep the existing pin check.

**Validation.** An integration test that connects as `desiauction_app` under the four-role recipe, seeds a payment in org A, posts a signed `payment.captured`, and asserts 200 plus a `PaymentCaptured` event — plus a negative test posting the same event with another org in `notes` and asserting 409.

## P0-2 — Two webhooks write through a role that lacks the grants

**Location:** `app/api/webhooks/delivery-status/route.ts:67,75` (`suppress(systemDb, …)`, `ingestDeliveryCallback(webFinopsDeps(systemDb), …)`); `app/api/webhooks/sms-inbound/route.ts:88` (`applyInbound(systemDb, …)`).

**Evidence.** `apps/web/scripts/verify-grants.ts:86` declares `SYSTEM_MAY_WRITE = ["org_members", "grants", "audit_log", "invites"]` and comments that "any fifth is a decision somebody has to make on purpose". `suppressions`, `finops_events` and `finops_dispatches` are not in that list, and `finops_events` DML is explicitly revoked from the app role. Locally everything runs as the owner, so no suite sees it.

**Impact.** In production, STOP requests never suppress and bounces never register — a DPDP opt-out that is not honoured, and sending-domain reputation damage. The route answers 500, contradicting its own "never 500" contract, and leaks a Postgres permission error to the provider's dashboard.

**Fix.** Resolve the dispatch's org and do the finops write inside `withTenantDb`; write `suppressions` (no RLS) on the app pool. Then extend `grants:verify` so that any table a route writes on `systemDb` must appear in `SYSTEM_MAY_WRITE`.

## P1-1 — Invariant 18 is enforced nowhere, and the live database already violates it

`paddle_grants_active_uq` is `(auction_id, team_id, person_id)` — it prevents a duplicate grant for the *same* team, not a second team. No refusal exists in the aggregate. `docs/40` lists invariant 18 under "Schema/DB constraints", which is false. A live query found **26 `(auction, person)` pairs holding active paddles on two or more teams** and 4 duplicate active grants. Fix: two partial unique indexes (`paddles(auction_id, person_id) WHERE released_at IS NULL`, and the same shape on `paddle_grants`) plus an `owns_another_team` refusal in the issue/grant path. Note the seed fixtures probably create these pairs and must change first.

## P1-2 — Bucket media uploads: size and type are client claims

`media/actions.ts:41` validates `byteSize` and `contentType` **as supplied by the caller**; the SigV4 presign signs only `content-type;host`, with no `Content-Length` or length-range policy; `attachMedia` never HEADs the object. Magic-byte sniffing exists only on the local dev route. Any signed-in registrant on an open season can obtain a 5-minute PUT URL and store arbitrary bytes of arbitrary size under an image key, served from the media origin. Fix: sign `content-length` (or use a POST policy with `content-length-range`), set a bucket-side object-size limit, and verify bytes on attach.

## P1-3 — The "sealed purse" is arithmetically recoverable, and invariant 35 does not exist

`live-actions.ts:245` states outright: *"TODO(founder) … NOT decided here"*. Meanwhile `pursePerTeam` is a single uniform number disclosed to every owner in the join preview and in the public rules payload (`conduct-actions.ts:361`), and every gated payload ships `soldPrice` plus the paddle→team mapping. Remaining purse for any rival = `pursePerTeam − Σ soldPrice`. The gating that exists (`gateAuctionView` omits `committed`) is therefore theatre, and it gives organizers a false assurance. This is a **product decision**, not a patch: either declare purses public (and remove the "seal" language) or withhold hammer prices from non-conductors too — which the product otherwise, and rightly, treats as the public record.

## P1-4 — 133 tenant-scoped reads on the RLS-exempt pool

`/home`'s money aggregates, the organizer conduct screen's lots and owner phone numbers, public competition pages, tournaments and fixtures all read via `systemDb`. Each has a hand-written `where`; one omission is a cross-tenant leak with no second line of defence. The role recipe documents this as a tracked refactor.

## Injection: clean

A dedicated pass found **no injection defects**. One `sql.raw` exists repo-wide and interpolates a server-computed number. GUC values pass through drizzle's parameterising template, not string concatenation. Every ILIKE uses the `ilike()` helper. The single JSON-LD site escapes `<`, `>`, `&`, U+2028/9 before `dangerouslySetInnerHTML`, and no sibling page embeds `JSON.stringify` in a script tag. `safeNext` blocks `//`, `/\`, encoded and dot-segment bypasses. Media keys are regex-locked to a ULID shape before any storage touch. **Every** CSV export writer routes through `neutralizeFormula`, including the finops exporters. No `.passthrough()`, no spread-into-insert, no `Host`-header trust, no ReDoS-shaped regexes, no SSRF sink. Secret scanning of the tree and full git history found nothing; there are no `NEXT_PUBLIC_*` variables at all.

## Threat model summary

| Actor | Threat | Mitigation today | Gap |
|---|---|---|---|
| Anonymous | Kill the engine mid-auction | upgrade handler fenced, 4 KiB `maxPayload`, room/IP caps, origin allowlist required in production | per-IP cap may collapse behind Fly's proxy |
| Anonymous | Read a rival's purse | ticket scope + read-model redaction | defeated by arithmetic (P1-3) |
| Anonymous | Forge a payment | HMAC over raw bytes, constant-time, freshness window, org pinned from the signed envelope | — |
| Authenticated stranger | Cross-tenant read | RLS on 46 tables + membership joins | 133 bypass-pool reads |
| Team owner | Bid after the hammer | arrival-time expiry check, replay verification | — |
| Team owner | Control two purses | — | **invariant 18 unenforced** |
| Team owner | Read a rival's plan | `planGate` + migration 0041's participant-arm RLS policy | none — this one is genuinely well built |
| Compromised session | Permanent takeover | none | **no step-up on phone change** |
| Org owner | Self-grant money authority | audited | `grant.issue` → any capability set, including to non-members |
| Compromised dependency | CI/deploy compromise | gitleaks scan, tag-pinned actions | `superfly/flyctl-actions@master` is a floating branch with `FLY_API_TOKEN` in scope |

---

# 11. Injection Audit

Covered in §10 — the result is a clean pass across SQL, NoSQL-equivalent, command, template, path, SSRF, header/CRLF, XSS (stored/reflected/DOM), Markdown/JSON/YAML, ReDoS, deserialization and prototype pollution. The one structural weakness is the **absent CSP `script-src`**: the shipped policy carries `base-uri`, `object-src`, `frame-ancestors` and `form-action` only, deliberately, because a nonce needs middleware that does not exist. Today that costs nothing because there is no injection point; it means there is no safety net if one is ever introduced. That is the correct trade to have made, and the correct thing to close next.

---

# 12. Frontend Architecture

React 19 / Next 15 App Router, RSC-first. One `ProductShell` with four modes chosen by pathname (`public`, `console`, `live`, `bare`). Data reaches pages through server components calling read models directly; mutations are server actions; live state arrives over a receive-only WebSocket.

**The real-time client is well built.** One hook (`use-auction-socket.ts`) serves live, cockpit, spectate, overlay and board. Full snapshots on every frame — no delta protocol, so there are no gaps to reconcile; frames older than the held `version` are dropped; a 25-second frame watchdog marks the view stale, which freezes the countdown and disables bidding. Reconnect uses capped exponential backoff. Cleanup is correct: sockets closed, timers cleared, listeners removed. The client computes bid affordability with **the same core functions the engine uses**, so arithmetic cannot drift.

**Three real defects.**
1. **The intent-id idempotency bug** (§6): `idFor(key)` without the payload, so a retry after a lost answer can return a cached ack for a different bid or a different lot.
2. **The accumulated feed drops outcomes across a disconnect.** `useLiveFeed` folds only `snapshot.lastOutcome` keyed by `atSeq`; if two lots resolve while a client is disconnected, the earlier one never enters `feed.resolved`, so the client-side squad count under-reads and the UI enables a bid the engine will refuse. The live panel never refreshes on reconnect (the cockpit does).
3. **The go-live guard is discovered by clicking it.** `packages/core` refuses `open` without ≥2 paddles and ≥1 queued lot, and `guardFailureDetail` explains why — but only in a toast after the attempt. The Open button is not disabled on paddle count, the readiness page lists no paddle/owner row, and the "no paddles" warning appears only once the auction is already live.

**Accessibility and motion are taken seriously**: two polite `role="status"` regions for ceremony sentences and 30/10/0-second thresholds, countdown text `aria-hidden` inside a live region, focus-trapped dialogs, a hold-to-confirm gavel with a keyboard path, reduced-motion collapses in CSS. Gaps: spectate/board/overlay have no live regions, and the *bidder* has no keyboard shortcut while the conductor has three.

**Cockpit churn:** `send` is a bare closure that is a dependency of the keydown effect, so window listeners re-subscribe on every render (~1 Hz during a lot) — wasteful, not leaking, and directly contradicted by the comment above it.

---

# 13. UX / Product Assessment

**The information architecture is good and the live surfaces are the best-designed part of the product.** Four-item console rail, seven season tabs, one shell, a `/home` ladder that walks a first-time organizer through org → tournament → season → teams → registrations. Empty, loading, error and success states are systematic through `packages/ui`.

**Terminology is the biggest product-level defect.** The same object is a *competition* in the code (3,679 references), a *season* in the URL and the create form (1,692), and a *tournament* in the navigation rail (873) — all three on one row of one screen: `/seasons/[slug]` renders `CompetitionHomePage` with `data-testid="competition-name"` while the rail highlights "Tournaments". The public URL is `/c/[slug]`. Elsewhere: the rail says "Organizations" but paths are `/org` and `/orgs`; the Standings tab is labelled "Table"; "Grounds" and "Venues" both appear; the owner's purse is called "headroom" in the plan card and "Purse" in the card above it; a lot's outcome is "Signed" in the plan report, "sold" in the ledger and "under the hammer" on spectate.

**Where a first-time organizer gets stuck** (each requires knowledge the screen does not give):
1. A season must be **published** before the public link or registration works — the blocker list exists but lives on a different tab.
2. **Intake must be closed** before an auction can be created.
3. Owners are invited by link and must **claim their own paddle from their own device** in the live room — the organizer cannot do it for them, and the readiness page never mentions it.
4. Consequently, **"Open auction" fails on click** for the most common first-run mistake.
5. The **Money tab is invisible** until someone issues themselves a settlement grant from a different screen.
6. Finance issuance refuses with `profile_missing` until a profile is declared and a series opened.
7. **Registrations' empty state offers no route to import or share** — the one screen where a new organizer has nothing and needs a next step.

**Over-configured and under-configured at once.** The "Rules of the night" form exposes six fields plus base-price bands, while **slabs (the increment ladder), unsold policy and role quotas are not settable at all** — every organizer runs the defaults for three rules that materially shape an auction.

**Simplicity.** ~20% of the app tree (≈13,300 lines) is outside the core loop: tournaments/fixtures/standings/venues, blog/careers/case-studies/newsletter stubs, `/gallery` (dev-only), posters and share cards, demo scheduling. Fixtures/standings are real and coherent; the marketing stubs and `franchises` (a schema concept with no routes) are the candidates to cut or defer. Content carries **21 unresolved `TODO(founder)` markers**, and at least one marketing claim ("one WhatsApp link") is not implemented — the share control is copy/`navigator.share` only.

---

# 14. Performance & Scalability

At the product's actual scale — tens of concurrent bidders, hundreds of players, a handful of simultaneous events — nothing here fails on throughput. The scaling risks are shaped by design decisions, not load:

- **O(n²) per night in the engine** (§6). The first thing to break is the web tier's 2-second command timeout late in a long auction, which will look like a failed bid while the bid actually lands. Fix by checkpointing the fold (persist the projection at seq N, fold only the tail) and by not re-folding for rejected commands. Measure first: `SLOW_COMMAND_WARN_MS` already exists.
- **`/home` fans out unbounded aggregates** across every competition a person belongs to, with no `since` filter or limit. Fine for a member of three orgs, linear in membership.
- **`/admin/health` fans out one snapshot set per finance-declared org in parallel** against a pool of 10 — already flagged in `KNOWN_LIMITATIONS.md`.
- **Migration 0041's RLS policies run three correlated `EXISTS` subqueries per row** on the plan tables; one of the three arms lacks a covering index.
- **`finops_jobs` has no purge of `done` rows** — the table grows forever, and the ops board has already observed "1192 queued, oldest 9 days".
- **DB pool `max` defaults to 10 per pool per process, and the web tier opens two pools.** `DB_POOL_MAX` exists and is documented; on a warm serverless fleet this is the classic way to exhaust `max_connections`. Nothing sizes it today.

Bundle: first-load JS is 103 kB shared, largest route 145 kB — healthy. Build takes 42 seconds. No heavy client libraries.

---

# 15. Reliability & Failure Modes

| Failure | Behaviour today | Verdict |
|---|---|---|
| Database unreachable | web `/readyz` 503s and is pulled from rotation; `/healthz` stays up (correct liveness/readiness split); engine `/readyz` reflects DB + watchdog | **good** |
| Engine crashes mid-hammer | each command is one transaction; state replays from the log on next load | **good** |
| Engine restarts between lots | **timers do not resume until something touches the auction** — no boot rehydration | **gap** |
| Engine lease severed (VM restart, sleep, NAT) | TCP keepalives reap the orphan in ~60s; refusal names the holder | good, but **depends on a production DB setting nobody has applied yet** |
| Two engines | log unique index prevents corruption; up to 10s of divergent snapshots; failure surfaces as a misleading `engine_halted` ack that does not halt | **gap** |
| Runner crashes mid-job | lease expires in ≤60s and another runner reclaims | good |
| Runner job exceeds 60s | **lease lapses while the handler still runs**; a reclaimer executes concurrently; the original's unfenced completion write then overwrites the reclaimer's | **P1** |
| Two runners | job claims are safe (`SKIP LOCKED`), but `followAllOrgs` runs unconditionally on every runner every tick and collides | **not supported today** |
| SMS/email provider down | OTP sender has a circuit breaker with cooldown; email falls back to a filesystem outbox | good |
| Object storage down | uploads fail; finops export verification reports unhealthy | acceptable |
| Deploy during a live auction | C-22 says the platform enforces a live-window freeze. **It does not** — the deploy workflow has no live-window check (the file says it arrives in IP-7) | **gap** |
| One org's follower throws | the **whole tick aborts** and every other org is skipped | **P2** |

**Error handling.** 90 bare `catch {}` blocks discard the error object, concentrated in `competition/actions.ts` (12), `auth/actions.ts` (7) and `engine-client.ts` (3). With a Sentry DSN set, a meaningful share of failures still would not be reported. Several are deliberate ("best effort" notifications) and correctly commented; they are still invisible.

---

# 16. Workers / Async Processing

One worker: `apps/finops-runner`, polling `finops_jobs` every 15 seconds. The queue design is sound in outline — `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction, then a lease stamp; exponential backoff (5s → 10s → 20s → 40s) to `max_attempts = 5`; dead-lettering as `state='dead'` with `last_error`, surfaced on the daily checklist and requeueable by an operator with `finops.operate`. Every finops mutation funnels through one writer whose `execute()` does command-id dedupe then commits events + audit + projections in one transaction, fenced by two unique indexes.

**Five defects, all in the same family — the lease is a timer, not a fence.**

1. **The 60-second lease is never extended**, while `drainJobsOnce` claims up to ten jobs and runs them **sequentially** under that one lease. `export.generate` reproduces every document of every series and `ops.attest-day` runs a follower pass plus double certification plus a full verify — either can exceed 60 seconds for a real org. When it does, another runner reclaims and executes concurrently.
2. **Completion writes are unfenced.** `updateJob` is `WHERE id = ?` with no lease-token predicate, so the slow original marks `done` over whatever the reclaimer wrote. (It also stamps `updatedAtMs` from `notBeforeMs` rather than the clock.)
3. **Reclaimed jobs do not increment `attempts`**, so a job that crashes the process — OOM, or the `die()` path — loops forever at `attempts = 0`, never dead-letters, and never appears in `loadDeadJobs`.
4. **`dispatch.send` calls the provider before committing the `sent` transition.** A crash or lease lapse in between re-sends. The built-in adapters are deterministic, but the web tier injects a real HTTP email adapter — and note the runner and the web tier build *different* deps for the same channel, so which process runs a send decides its behaviour.
5. **`export.daily` deduplicates by an application scan**, not a constraint, and each call mints a fresh export id so the command-id fence cannot help. Two concurrent runs produce two aggregates and two artifacts for the same day.

**Also:** two cron routes (`demo-reminders`, `settlement-coordination`) have no overlap lock and rely on row stamping; `finops_jobs.state` is free text with no CHECK; `done` rows are never purged; and there is no metric for queue depth or job age — the runner logs a tick only when it did work, so **a stopped runner is invisible** in `runnerHealthSnapshot` (which reports healthy while `dead === 0`).

---

# 17. External Integrations

| Integration | State | Verification | Gaps |
|---|---|---|---|
| MSG91 (SMS/OTP) | adapter built, per-shape DLT template ids, circuit breaker with cooldown | forgery-tested | no live account; **OTP is the only login path, so this is go-live-critical** |
| Resend (email) | HTTP adapter behind a port; three settings required together or it keeps a filesystem outbox | — | DNS verified but the domain has no MX |
| Razorpay | HMAC over raw bytes, constant-time, 5-min freshness, org from signed envelope, `kind:providerRef` idempotency, Route `transfers[]` with `settlementAccount()` defaulting to **null** so every gateway payment refuses by design | forgery-tested | **P0-1**; and per-organizer linked accounts are an unstarted founder item |
| S3 / MinIO | server-side SigV4 GET/PUT, no presigned reads, org-prefixed keys | — | no `delete` on the port and no retention sweep anywhere |
| Sentry | wired in all three services, guarded so a missing DSN is a no-op | — | no DSN; 90 bare catches would swallow errors even with one |

The refusal posture throughout is correct and deliberate: an unset webhook secret 404s the route rather than opening it; a half-configured mailer keeps the outbox rather than dropping mail; `settlementAccount()` returning null refuses gateway payments rather than collecting third-party money into the platform's own account. That last one is a genuinely thoughtful piece of regulatory caution encoded as a type requirement.

---

# 18. Dependency / Supply Chain

`pnpm audit` (executed): **8 vulnerabilities — 6 high, 2 moderate** in the production tree; 11 total including dev.

| Package | Severity | Path | Runtime impact |
|---|---|---|---|
| `fast-uri` <4.1.3 | 4× high (SSRF, host confusion) | `apps/engine > fastify > @fastify/ajv-compiler` | low — used for schema `$ref` resolution, not request URLs |
| `fastify` 5.10.0 | 2× moderate | `apps/engine` | schema-validation bypass via root primitive coercion; `X-Forwarded-*` spoofing under `trustProxy` hop counting. **Real**: fix by bumping to ≥ 5.12.1 |
| `browserslist` | 2× high | `@sentry/nextjs > @babel/core` | build-time only |
| `esbuild`, `qs` | moderate | `drizzle-kit`, `style-dictionary` | dev/build only |

**This matters beyond the CVEs: `pnpm audit --prod --audit-level high` is a step in the CI quality job, and it fails today.** The pipeline on this branch cannot be green. There is a root `pnpm.overrides` block already carrying seven pins including `fast-uri: ">=4.1.2"` — which no longer satisfies the advisory range and needs bumping to `>=4.1.3`.

**Actions and images.** Every GitHub Action is pinned to a mutable version tag rather than a commit SHA, and `superfly/flyctl-actions/setup-flyctl@master` in both deploy workflows tracks a **branch** — arbitrary code from a third-party default branch running in a job that holds `FLY_API_TOKEN`. Dockerfiles are otherwise exemplary (multi-stage, `pnpm deploy --prod`, distroless `nonroot` final stage, 310 MB / 244 MB) but pin base images by tag, not digest. `gitleaks` runs on every PR with full history — good.

---

# 19. Deployment / DevOps

**Topology:** web on Vercel, engine and finops-runner on Fly (Mumbai, one machine each), managed Postgres 17, S3-compatible storage. Both Fly workflows deploy staging on a path-filtered main push and production by manual dispatch only, and both no-op with a summary note until `FLY_API_TOKEN` exists. Post-deploy smoke polls `/healthz`. The engine's `fly.toml` correctly separates a DB-independent liveness check from a DB-dependent readiness gate.

**What is genuinely good:** fail-closed environment validation in all three apps, with production refinements that refuse to boot on the dev engine secret, a localhost `PUBLIC_BASE_URL`, `OTP_PROVIDER=dev`, `MEDIA_STORAGE=local`, a filesystem finops store, an aliased system role or a missing Sentry DSN. The one escape hatch is named `ALLOW_INSECURE_LOCAL_PRODUCTION`, is never set by any script, prints a three-line warning to stderr, is reported by `/readyz`, and is refused outright by `preflight:production`. That is how an escape hatch should be built.

**What is missing.**
- **`pnpm preflight:production` refuses with 16 blockers** (5 pass, 4 warn): engine secret, demo token secret, `RP_ID`, `RP_ORIGINS`, `PUBLIC_BASE_URL`, `FINOPS_STORAGE_DIR`, `MEDIA_STORAGE`, `FINOPS_ARTIFACT_STORE`, `SENTRY_DSN` and more. This is the tool working correctly; it is also the honest statement of where the project is.
- **Nothing is provisioned.** No Fly account, no Vercel project, no managed Postgres, no S3, no SMS, no payment keys. `desiauction.in` is registered but **parked with no MX**, which simultaneously blocks passkeys (`RP_ID` must match), canonical URLs, and a published statutory grievance address that currently bounces.
- **No live-window deploy freeze**, despite C-22 making it constitutional.
- **Migrations run outside any advisory lock**, with no `lock_timeout`, and the deploy workflows do not run them — the runbook does, by hand.
- **The production TCP keepalive settings** that make the single-writer lease recoverable are documented and unapplied.

**CI.** The quality job is comprehensive (lint, typecheck, test, build, generated-token no-op check, format, depcruise, motion tokens, audit), and the integration job now creates all four roles and runs `grants:verify` + `rls:verify` on every PR — the right lesson learned from the last audit. There is a full e2e job with a precompiled server, a gitleaks job and a PR-title job. **But the audit step fails today (§18), so the pipeline is red on this branch**, and `gh` is not installed here so no run history could be inspected — the claim "CI is green" could not be verified either way.

---

# 20. Observability

**This is the weakest layer in the system.**

- **The web tier has no logger.** No `pino` dependency in `apps/web/package.json`; **five `console.*` calls in 109,000 lines**, three of them in server code. Every server action, every authentication event, every money mutation and every RLS refusal in the largest service produces **no log line at all**. `docs/56-monitoring.md` states "structured pino JSON in all three services, PII-redacted" — that is true of the engine and the runner and false of the web tier.
- **No request or correlation id** reaches logs anywhere (settlement generates a `correlationId` for its own event rows only).
- **No metrics, no traces, no dashboards, no alerts.** No OpenTelemetry package is installed. None of the eight SLOs in `docs/56` is computed by anything.
- **Sentry is wired but has no DSN**, and 90 bare `catch {}` blocks would swallow a share of errors even once it does.
- **A stopped finops runner is invisible** to its own health snapshot.

What *does* exist is a genuinely good **audit trail**: `audit_log` plus three append-only event streams with DB-enforced `REVOKE UPDATE, DELETE`, capturing actor, scope, correlation and payload for every gate, grant, override and money operation. So the system can answer *what happened to which auction, when, by whom* — from row counts and event streams, exactly as the previous audit predicted. It cannot answer *how fast*, *how often*, or *is it up right now*.

---

# 21. Testing Assessment

**Executed:**

| Suite | Result |
|---|---|
| `pnpm lint` | ✅ 11/11 packages |
| `pnpm typecheck` | ✅ 11/11 |
| `pnpm test` (unit) | ✅ 6 packages, core alone 435 tests / 28 files |
| `pnpm format:check` | ✅ |
| `pnpm depcruise` | ✅ 0 violations, 1599 modules / 7616 deps |
| `pnpm check:motion` | ✅ |
| `pnpm build` | ✅ 41.9 s |
| `pnpm env:check` | ✅ all three apps |
| `pnpm test:integration` | ❌ **engine fails**; web ✅ 836 tests / 63 files |
| `pnpm audit --prod --audit-level high` | ❌ 8 vulns (6 high) — **and this is a CI gate** |
| `pnpm preflight:production` | ❌ 16 blockers (by design) |

**The integration failure is a real regression, not flake.** `apps/engine/src/integration/live-engine.integration.test.ts:156-168`: all 66 assertions pass, then `afterAll` fails deleting `people` — `paddle_grants_person_id_people_id_fk` (added by migration 0040 with `ON DELETE restrict`) still references them, because the teardown never deletes `paddle_grants`. It is one missing line, present on **no branch in the repository**. Its practical effect is worse than a red suite: every run leaks a person and its grants, which is precisely the residue that makes later failures look like product bugs.

**Coverage is substantial and, in places, excellent** — 435 core unit tests, 836 web integration tests, 66 engine integration assertions including replay-after-crash certification, 120 Playwright tests across 29 specs, plus dedicated `rls:verify`, `grants:verify` and `restore-verify` probes.

**Where invariants are and are not covered:**

| Invariant | Covered? |
|---|---|
| One sale per lot; illegal transitions | ✅ core machine tests + DB CHECK |
| Purse ceiling, reserve, squad/role limits | ✅ core gauntlet tests |
| Bid after hammer refused | ✅ arrival-time test |
| Timer never shrinks | ✅ core + replay |
| Command-id poisoning / cross-actor ack isolation | ✅ two regression tests |
| Crash recovery replays to identical state | ✅ engine integration |
| Concurrent bids | ⚠️ probed manually in the last audit (10 simultaneous → one winner); **no automated concurrency test** |
| Two engines, one database | ❌ never exercised |
| **One owner, two teams** | ❌ **no test — and the rule has no implementation** |
| Webhook path under the **production roles** | ❌ **this is why P0-1 survived** |
| Runner duplicate execution / lease expiry | ❌ |
| Rival owner cannot read a rival plan | ✅ e2e + RLS policy |
| Purse confidentiality | ❌ (and the property does not hold) |
| Injection payloads, CSV formula on export | ✅ unit tests on `neutralizeFormula` |
| OTP brute force | ✅ attempt-cap tests |
| Open redirect | ✅ `redirect-safety.test.ts` |

**The structural gap is one sentence: nothing runs as a non-superuser except the two dedicated probes.** Every unit, integration and e2e run connects as the database owner, so RLS is inert and role grants are irrelevant for the entire suite. Both production defects found in this audit live exactly in that blind spot.

**Harness debt:** e2e is single-worker locally (~6 min) with one retry; four specs `skip` under a production build because `/gallery` is dev-only; `fileParallelism: false` for web integration because suites share one database and drain each other's job queue.

---

# 22. Dead Code / Duplication / Technical Debt

- **90 bare `catch {}`** blocks discarding the error object.
- **21 unresolved `TODO(founder)`** markers in shipped marketing/legal content, including two on legal identity.
- **`is_retained`** is a schema column, a documented product rule and an excluded-from-pool concept **with no writer and no reader** — dead weight that looks live.
- **`franchises`** is a table and a `teams.franchise_id` column with no routes.
- **Marketing stubs** (blog 26 lines, careers 29, case-studies 31, newsletter) exist and are not in the public nav.
- **`deepVerify`** — the determinism proof — is dead code; `index.ts` comments claim it runs every 30 seconds and nothing calls it.
- **Duplicated domain logic:** `squadSizesOf` in the squad board mirrors the aggregate's squad count; the leading-by-team check mirrors gauntlet check 3; `roleLabel` exists in both `packages/core` and `apps/web/src/lib/playing-roles.ts`; ~15 status vocabularies are TypeScript-only enums re-declared rather than shared with the database.
- **Drizzle snapshots stop at 0018**, so `drizzle-kit generate` is blocked and `schema.ts` no longer describes the live constraint set.
- **Doc drift** (see §23) is itself technical debt: `README.md` says "27 migrations"; there are 42.

---

# 23. Documentation Assessment

The documentation is unusually extensive (70 numbered canon documents plus operations runbooks and four prior audits) and unusually **honest where it has been corrected** — `docs/62-backup-strategy.md` and `docs/56-monitoring.md` now open with implementation-status notices that split "what exists" from "target state", and the README says outright that the last audit returned NO-GO. That discipline is rare and worth keeping.

It is also **still wrong in ways that would mislead an engineer**:

| Claim | Where | Reality |
|---|---|---|
| "27 migrations" | `README.md:13` | 42 |
| Invariant 18 enforced by schema | `docs/40:64` | enforced nowhere; 26 live violations |
| Invariant 2 enforced by schema | `docs/40:64` | app guard only; 11 orgs with no owner |
| Invariant 15 requires an active Pass | `docs/40` | no Pass/entitlement check exists |
| "All input validated with shared zod contracts" | `docs/49` | zero zod in any action |
| "Nonce-based CSP" | `docs/49` | four directives, no `script-src` |
| "Short-lived access + rotating refresh, device binding" | `docs/49` | one 30-day sliding bearer |
| "Step-up re-auth within 10 min for override/billing" | `docs/49` | does not exist |
| "Rate limiting per-IP, per-identity, per-capability" | `docs/49`, `docs/46` | OTP/demo only |
| Capability vocabulary (`org:manage`, `team:bid`) | `docs/36` | code uses `org.manage`; `team:bid` has no analogue |
| "Structured pino JSON in all three services" | `docs/56` | the web tier has no logger |
| "withTenant call sites = 0; isolation is app-layer" | `docs/settlement/SECURITY.md`, `docs/financial-operations/SECURITY.md` | stale in the opposite direction — `withTenantDb` is wired at 102 sites |
| "The webhook path establishes tenant context from the verified envelope" | `docs/settlement/SECURITY.md` | describes intent; the code does not |
| "Documents served through an authenticated, digest-verifying download route" | `IP-6_ARCHITECTURE §760` | no download route exists; the UI says "not available yet" |
| Retention sweep, archive bundle at PeriodClosed, bounded retry | `IP-6_ARCHITECTURE` | none implemented |
| "Runner establishes tenant context before any org-scoped read" | `IP-6_ARCHITECTURE:741` | runner uses a raw handle and scans cross-tenant |

The pattern is consistent: documents written as design targets have been read, including by release documents and by the team, as descriptions of the running system.

**One measurement deserves its own line, because it is exceptional.** Across all ten packages and apps — 120,000 lines of non-test code — there are **zero** occurrences of `any`, `as any`, `as unknown as`, `@ts-ignore`, `@ts-expect-error` and non-null assertions. `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax` are all on, set once in `packages/config` and never overridden, and `no-explicit-any` is an error under `strictTypeChecked` in CI. There is **zero commented-out code**, and no `FIXME`/`HACK`/`XXX` anywhere. `process.env` is read at 9 sites, all inside an `env.ts`, enforced by an ESLint `no-restricted-syntax` rule. There is exactly one DB pool factory and exactly one `currentSession()`. This is a materially higher standard than most production codebases reach, and it substantially de-risks everything else in this report: the defects found are structural and operational, not landmines hidden behind loose types.

---

# 24. Critical Findings

**[P0] CONFIRMED — Razorpay webhook has no tenant boundary; gateway payments cannot complete in production.**
Location `app/api/webhooks/razorpay/route.ts:38` → `server/settlement/webhook.ts:60` → `server/settlement/store.ts:456`. Evidence, risk, fix and validation in §10 P0-1.
*Note on method:* this is confirmed from code and DDL — the policy text, the role attributes and the absent `set_config` in that path were each read directly. The decisive runtime probe (`SET ROLE desiauction_app` with no GUC) could not be re-run at the end of this session because the local Docker daemon had stopped; it is the first thing to execute when reproducing.

**[P0] CONFIRMED — Delivery-status and SMS-inbound webhooks write on a role without the grants.** §10 P0-2. STOP requests and bounces fail in production; the routes 500 against their own contract.

**[P0] CONFIRMED — `pnpm audit --prod --audit-level high` fails, and it is a CI gate.** 8 vulnerabilities, 6 high (§18). The pipeline on this branch is red; `fastify` 5.10.0 → ≥5.12.1 and the `fast-uri` override bump are the substantive fixes.

**[P0] CONFIRMED — Engine integration suite fails on a foreign-key teardown.** All 66 assertions pass; `afterAll` cannot delete `people` because `paddle_grants` still references them. One missing delete, absent on every branch. It also leaks residue into the shared database on every run.

**[P1] CONFIRMED — Invariant 18 unenforced, with 26 live violations.** §10 P1-1.

**[P1] CONFIRMED — 133 tenant reads on the BYPASSRLS pool**, including `/home` and the conduct screen. §10 P1-4.

**[P1] CONFIRMED — The auction spine has no foreign keys**; 220 lots reference a missing registration, 214 sold lots a missing paddle, 100 competitions a missing org. §7.

**[P1] CONFIRMED — Bid intent ids are reused across amounts and lots**, so a retry after a lost answer returns a cached ack for a bid that never landed. §6.

**[P1] CONFIRMED — Lots can be hammered, held or requeued while the auction is paused.** §6.

**[P1] CONFIRMED — The finops lease is never extended** while ten jobs run sequentially under it, and completion writes are unfenced; a crash-looping job never dead-letters. §16.

**[P1] CONFIRMED — The fiscal-period lifecycle is unreachable.** `openPeriod`, `closePeriod`, `closeSeries` and `requestExport` are exported and have **zero callers in `apps/web/src`** — only scripts and tests. Because `runDailyOps` returns early when no period is open, **daily attestation never runs in production**, no period can ever close, and the entire governance/seal layer is inert. Compounding it: issuance never consults the period, so documents can be issued into a sealed year.

**[P1] CONFIRMED — Phone change requires no step-up**, converting any stolen session into permanent account ownership. §9.

**[P1] CONFIRMED — Bucket uploads accept client-claimed size and type.** §10 P1-2.

**[P1] CONFIRMED — The web tier has no logger.** §20.

**[P1] CONFIRMED — No rate limiting exists in the web tier.** §8.

**[P2] CONFIRMED — Purse confidentiality does not hold and invariant 35 is unimplemented.** §10 P1-3. Filed P2 because the correct response is a product decision, not a patch.

---

# 25. Security Findings

**CRITICAL**
1. Razorpay webhook tenant boundary (§10 P0-1) — integrity of the money path.
2. System-role webhook writes (§10 P0-2) — DPDP opt-out not honoured.

**HIGH**
3. Phone change without step-up — session theft → permanent account takeover (§9).
4. Invariant 18 unenforced — one person controls two purses in one auction (§10 P1-1).
5. Bucket upload size/type unverified — storage DoS and arbitrary content served from the media origin (§10 P1-2).
6. 133 tenant reads on the bypass pool — one bad `where` is a cross-tenant leak with no second line (§10 P1-4).
7. `fastify` 5.10.0 — schema-validation bypass and `X-Forwarded-*` spoofing under `trustProxy` (§18).
8. `superfly/flyctl-actions/setup-flyctl@master` — third-party branch code in a job holding `FLY_API_TOKEN` (§18).

**MEDIUM**
9. Purse recoverable by arithmetic; "seal" language is misleading (§10 P1-3).
10. `issueGrant` accepts non-members; last-owner guard counts grants not members (§9).
11. `x-real-ip` is trusted even at `TRUSTED_PROXY_COUNT=0`, defeating the per-IP OTP cap if the ingress does not overwrite it.
12. No rate limits on org/season/team creation, invite minting, bulk triage or money actions (§8).
13. CSP has no `script-src` — no containment if an XSS bug is ever introduced (§11).
14. Settlement error messages return raw `reason — detail`, leaking journal digest divergences to any `settlement.view` holder.
15. `acceptInvite` writes outside a transaction, so invariant 28 does not hold there (§9).
16. Gate helpers exported from `"use server"` modules are callable endpoints (§8).
17. Engine per-IP socket cap may collapse to one bucket behind Fly's proxy, capping a whole venue at 50 (SUSPECTED — verify against staging).

**LOW**
18. All GitHub Actions pinned by tag, not SHA; Docker base images by tag, not digest.
19. Re-login does not revoke the replaced session.
20. Authenticated phone/email "taken" oracles (deliberate, documented).
21. `windowDays` unvalidated on an admin projection (`new Date(NaN)` → 500 for an admin only).
22. Convenience cookies (`da_joined_org`, `da_created_season`) lack `httpOnly`/`secure`.
23. No explicit `Cache-Control: no-store` on money/admin routes (SUSPECTED — no CDN confirmed in front of them).

---

# 26. Production Blockers

**Engineering (must close before any real traffic)**
1. Razorpay webhook tenant boundary.
2. Delivery-status / SMS-inbound system-role writes.
3. `pnpm audit --prod --audit-level high` green (fastify + fast-uri override).
4. Engine integration teardown FK — and one green full pipeline including e2e, `grants:verify` and `rls:verify`.
5. Invariant 18: two partial unique indexes plus an aggregate refusal.
6. FinOps lease fencing (extend or shorten the batch; add a lease token to the completion `WHERE`; bump `attempts` on reclaim).
7. Fiscal-period lifecycle: either ship the `openPeriod`/`closePeriod` surfaces or explicitly descope the governance layer for beta and say so in the docs and the UI.
8. Bid intent-id payload keying.
9. Hammer-while-paused guard.
10. **One full rehearsal auction under the four-role recipe**, end to end through settlement and a receipt — this is the gate that would have caught P0-1 and P0-2, and neither the unit, integration nor e2e suites can substitute for it.

**Operations (founder-provisioned; none is engineering work)**
11. `desiauction.in` DNS: MX + SPF/DKIM/DMARC — this unblocks the statutory grievance address, passkeys and `PUBLIC_BASE_URL` simultaneously.
12. Managed Postgres with PITR; the four roles created; TCP keepalives applied.
13. `pnpm backup` scheduled against production writing off-host on a separate credential — and **one rehearsed restore with the RTO recorded**. Nothing has ever been restored.
14. MSG91 live account — without it nobody can log in, including the founder.
15. S3-compatible storage for media and finops artifacts.
16. `SENTRY_DSN` set in all three services.
17. `pnpm preflight:production` passing (16 blockers today).
18. Basic alerting: web/engine health, error rate, queue depth, runner liveness, and alert-on-silence during live windows.

---

# 27. Recommended Target Architecture

**Do not restructure.** The shape is correct and the boundaries are enforced. Target = current architecture plus five seams.

```
CURRENT                          PROBLEM                        TARGET
─────────────────────────────────────────────────────────────────────────────
webhook routes → raw pool        RLS invisible; prod-only       every route handler enters
                                 failure                        withTenantDb (or a named,
                                                                asserted system path)

133 systemDb reads               boundary unreasonable          a thin read-model seam;
(spread ad hoc)                                                 systemDb reachable only from
                                                                ~6 named modules, asserted by
                                                                a depcruise rule

app spine: no FKs                silent empty joins             FKs with ON DELETE RESTRICT,
                                                                added NOT VALID then VALIDATE

worker: time-based lease         concurrent duplicate           fenced lease (token in the
                                 execution                      completion WHERE) + heartbeat
                                                                + attempts++ on reclaim

side effect before commit        duplicate emails, lost         transactional outbox for
(dispatch, announcements)        announcements                  dispatch.send and auction
                                                                completion notices

engine: full re-fold/command     O(n²) per night                checkpointed fold: persist the
                                                                projection at seq N, fold the tail
```

**Deliberately not recommended:** microservices, Kubernetes, a message broker, Redis, a cache tier, a separate read database, GraphQL, a REST `/v1` (until a third-party actually needs it), event sourcing anywhere new, or CQRS beyond what the three streams already provide. The architecture is correctly sized for the product; the work is to make three paths obey the boundaries the rest already do.

**Two things to add that are not architecture:** a logger in the web tier, and a schema-validation layer at the action boundary. Both are small and both close whole classes of finding.

---

# 28. Prioritized Remediation Plan

### P0 — before production

| # | Item | Files | Root cause | Fix | Test | Risk | Effort |
|---|---|---|---|---|---|---|---|
| 1 | Webhook tenant boundary | `webhook.ts:58`, `razorpay/route.ts:38` | route built deps from the raw pool | wrap in `withTenantDb` keyed on the verified envelope org | integration under `desiauction_app`: capture → 200 + event; wrong org → 409 | low | 0.5 d |
| 2 | System-role webhook writes | `delivery-status/route.ts:67,75`, `sms-inbound/route.ts:88` | `systemDb` lacks grants | resolve org, write finops in a tenant txn; suppressions on the app pool; assert route-writes ⊆ `SYSTEM_MAY_WRITE` in `grants:verify` | both suites under the role recipe | low | 0.5 d |
| 3 | Dependency audit green | root `package.json` overrides, `apps/engine/package.json` | stale pins | `fastify` ≥5.12.1; `fast-uri` override → `>=4.1.3` | `pnpm audit --prod --audit-level high` | low | 0.5 d |
| 4 | Engine teardown FK | `live-engine.integration.test.ts:156` | migration 0040 added a RESTRICT FK the teardown predates | delete `paddle_grants` before `people`; purge existing residue | `pnpm test:integration` green twice consecutively | none | 15 min |
| 5 | Invariant 18 | new migration; `aggregate.ts` issue/grant | never implemented | two partial unique indexes + `owns_another_team` refusal; fix seeds first | integration: second claim refused; `23505` on direct insert | **medium** — seeds and demo data violate it today | 1 d |
| 6 | FinOps lease fencing | `runner.ts`, `runner-core.ts:292`, `store.ts:380` | lease is a timer, not a fence | lease token in completion `WHERE`; heartbeat or batch of 1 for long kinds; `attempts++` on reclaim | two-runner test: one job, one execution; crash-loop dead-letters at 5 | medium | 1.5 d |
| 7 | Period lifecycle | `financial-operations/actions.ts` + a surface | no caller for `openPeriod` | ship open/close on the ops board, **or** descope and say so | e2e: open → attest → close → seal | medium | 2 d (or 0.5 d to descope) |
| 8 | Bid intent id | `live-panel.tsx:145,167` | payload omitted from the slot key | `idFor(key, payload)` / `settle(key, payload)` | e2e: reject once, bid next lot, assert the event | low | 1 h |
| 9 | Hammer while paused | `aggregate.ts:571-620` | only `open` checks status | require `live` for sell/pass/hold | integration: pause → CloseLot → `auction_not_live` | low | 2 h |
| 10 | Rehearsal auction under production roles | — | nothing local runs non-superuser | full night → settlement → receipt on staging under the four roles | the run itself | — | 1 d |

### P1 — before serious usage

Phone-change step-up + revoke-other-sessions; bucket upload length signing and byte verification; FKs on the auction spine (`NOT VALID` → `VALIDATE`, after purging residue); a logger in the web tier with a request id and PII redaction; rate limits on creation, invites, bulk triage and money actions; the `systemDb` read-model seam starting with `/home` and the conduct screen; `dispatch.send` outbox; settlement stream row lock and `23505` translation; engine boot rehydration of live auctions; `x-real-ip` trust gated on `TRUSTED_PROXY_COUNT`; decide and implement the purse-visibility rule; `grant.issue` membership check; `deepVerify` scheduled or deleted; the go-live guard surfaced *before* the click; SHA-pin the flyctl action.

### P2 — shortly after

Checkpointed fold; CSP `script-src` with a nonce; CHECK constraints on the ~15 free-text status columns; `finops_jobs` purge and queue-depth metric; per-org follower isolation so one exception does not abort the tick; `lock_timeout` and an advisory lock around migrate; settlement error detail redaction; registrations empty-state guidance; import size caps on the fixtures path; `updated_at` on mutable tables; the duplicate index and three missing FK indexes.

### P3 — scheduled

Terminology unification (competition/season/tournament); split `competition/actions.ts` and the four 1,000+ line client panels; a shared `TERMINAL_CASE_STATUSES` and one `entryCategory` type; extract the duplicated event-envelope helpers; `ts-prune` over `packages/core`'s 384 exports; depcruise rules for page→db and settlement/auction purity; delete or implement `is_retained` and `franchises`; resolve the 21 `TODO(founder)` markers; expose slabs / unsold policy / role quotas; live regions on spectate/board/overlay; a bidder keyboard path.

---

# 29. Detailed Test Plan

**The single highest-value change: run one suite as a non-superuser.** Point the web integration suite's `DATABASE_URL` at `desiauction_app` and `SYSTEM_DATABASE_URL` at `desiauction_system` in CI. Both P0s die immediately and cannot come back.

**Concrete cases to add**

*Concurrency (engine integration).* Two paddles bid the identical amount within one tick → exactly one `BidAccepted`, one `BELOW_CURRENT`, purses correct. Ten simultaneous bids → one winner (automate the manual probe from the last audit). Two engine processes, one database → the second refuses to boot and names the holder; kill the first and the second acquires within the keepalive window. A command whose transaction fails → the ack says `command_failed`, the snapshot is rebuilt, and the next command sees correct state.

*Idempotency.* The same `commandId` twice → one effect, second answered from cache. A **different** amount with a stale intent id → **must not** return the first ack (this test fails today). The same Razorpay `payment.captured` delivered three times → one `PaymentCaptured`. `retryDeliveryAction` clicked twice → one dispatch. `export.daily` run concurrently → one artifact.

*Money.* Refund exceeding capture refused. Payment on a closed case refused. Journal balances after a full settle → close cycle. A receipt issued for a payment in a sealed period → refused (this behaviour does not exist yet; the test defines it).

*Authorization.* A viewer-level team owner cannot conduct, cannot read a rival's plan, cannot read a rival's purse **and cannot reconstruct it from `soldPrice` + paddles** (this last one fails today and is the finding). Org A cannot read org B under the app role. `platform:admin` cannot write. A grant to a non-member is refused.

*Auction invariants.* A person claiming paddles on two teams in one auction → refused (fails today). Hammer during pause → refused (fails today). Complete with queued lots → the decision made explicit either way. A bid arriving after `endsAtMs` → `LOT_EXPIRED` regardless of network delay (exists; keep).

*Worker.* A job that runs longer than the lease → executed once, not twice. A job that kills the process → dead-letters at 5 attempts. Two runners → each job runs once.

*Failure recovery.* Engine SIGKILL mid-lot → replay to identical state and the timer resumes **without a client touching it** (fails today). Restore a `pnpm backup` dump into a clean instance, run migrations and roles, prove RLS, record the RTO — **this has never been done**.

*Performance.* 5,000 events in one auction: assert p99 command latency < 500 ms and that it does not grow superlinearly. Five owners bidding for 30 minutes.

**Harness fixes:** the teardown FK (P0-4); a shared teardown helper scoped by org *and* person so residue stops accumulating; and a decision on whether `/gallery`'s four skipped specs get a production-safe mode or are deleted.

---

# 30. Top 10 Production Risks

Ranked by expected damage — probability × impact × how long it would go unnoticed.

| # | Risk | Probability | Impact | Detectability | Notes |
|---|---|---|---|---|---|
| 1 | **Gateway payments silently never capture** (P0-1) | **Certain** the first time a real payment is taken | Money received and not recorded; manual reconciliation | Poor — a 404 to Razorpay, no log line in the web tier, no alert | Certainty × invisibility puts it first |
| 2 | **No backup has ever been restored** | Low per-day, inevitable over a year | Total data loss; the product's one promise is trust | N/A until needed | Tooling exists; nothing runs it |
| 3 | **No observability in the web tier** | Continuous | Every other incident takes hours longer | It *is* the detection failure | Multiplies risks 1, 4, 5, 7 |
| 4 | **One person controlling two teams' purses** (P1-1) | Medium — already true 26 times locally | Auction integrity; a disputed night is unrecoverable reputationally | Poor — nothing flags it | The product exists to prevent exactly this |
| 5 | **A bidder told "accepted" for a bid that never landed** (intent id) | Medium — needs one lost response | The wrong player on the wrong team, live, in front of a hall | Poor until someone disputes | Cheapest fix on the list |
| 6 | **Engine restart mid-auction** (no rehydration, no live-window freeze, 10s lease divergence) | Medium — a deploy or Fly migration during a live window | Timers stop; the room waits; C-22 exists precisely to prevent this and is unimplemented | Moderate | |
| 7 | **FinOps job executed twice** (lease lapse) | Medium once volumes grow | Duplicate emails, duplicate daily exports; document numbering holds | Poor | Numbering invariants contain the blast radius |
| 8 | **A cross-tenant leak through one bad `where`** on the bypass pool | Low per query, 133 chances | Catastrophic for a multi-tenant trust product | Very poor | RLS is the control that would catch it and it is off for these reads |
| 9 | **Session theft → permanent takeover** via phone change | Low–medium (shared handsets) | Full account, including owner and money grants | Poor | |
| 10 | **O(n²) fold pushes commands past the 2s timeout** late on a big night | Medium at 5k+ events | Bids look failed while landing; conductor loses trust in the tool | Moderate — `SLOW_COMMAND_WARN_MS` exists | Measure before optimising |

---

# 31. Final Production Readiness Scorecard

| Dimension | Score | Basis |
|---|---:|---|
| Architecture | 8/10 | Correct shape, enforced boundaries, zero cycles; deducted for the tenant-boundary exceptions and business rules in the action layer |
| Code Quality | 9/10 | Zero `any`, zero commented-out code, zero FIXME, exhaustive comments explaining *why*; deducted for four 1,000+ line panels and a 2,000-line action module |
| Security | 5/10 | Excellent authn/authz/injection posture undone by two P0 tenant-boundary defects, no rate limiting and no step-up |
| API Quality | 6/10 | Consistent, well-gated, fail-closed webhooks; no schema validation, no rate limits, gate helpers exported as endpoints |
| Database Design | 6/10 | Strong constraint/RLS/event-stream layer; **no referential integrity on the auction spine** and live orphans |
| Concurrency Safety | 7/10 | The engine is genuinely good; the worker lease is not a fence, settlement appends are unlocked, purse checks read outside the write txn |
| Business Logic Correctness | 7/10 | The bid gauntlet is excellent; invariants 2, 15, 18 and 35 are unenforced and the period lifecycle is unreachable |
| Frontend Quality | 8/10 | Clean RSC boundaries, one well-built socket hook, perfect type discipline; the intent-id and feed-gap defects, and giant panels |
| UX | 7/10 | Strong IA and live surfaces; three names for one object and seven places a first-time organizer stalls |
| Performance | 7/10 | Healthy bundles and TTFB; O(n²) fold and unbounded `/home` aggregates are the known structural risks |
| Reliability | 5/10 | Good health/readiness split and crash recovery; no boot rehydration, no live-window freeze, unfenced worker, 90 silent catches |
| Observability | 2/10 | Strong audit trail; **no logger in the web tier**, no metrics, no traces, no alerts, no DSN |
| Testing | 6/10 | 435 unit + 836 integration + 120 e2e and excellent replay certification; integration is red, nothing runs as a non-superuser, no concurrency or two-instance tests |
| Deployment | 4/10 | Exemplary env validation and images; nothing provisioned, preflight refuses on 16, migrations unlocked, a floating action ref |
| Documentation | 6/10 | Extensive and honest where corrected; still contradicts the code in fourteen identified places |
| Maintainability | 8/10 | One place for env, DB and session; machine-enforced boundaries; deducted for god modules and duplicated status vocabularies |

**Overall Production Readiness: 6.2 / 10.**

The score is higher than the last audit's 5.2 and the verdict is the same, because a numeric average cannot express "the money path does not work under its own production configuration". Per the project's own §39 rule, a critical blocker overrides the score.

---

# 32. GO / GO WITH CONDITIONS / NO-GO

## 🔴 NO-GO

**Blocking, and each is reproducible from this report:**

1. Gateway payment capture cannot complete under the production role recipe (§10 P0-1).
2. Two webhooks write on a role without the grants; STOP and bounce handling fail (§10 P0-2).
3. The dependency-audit CI gate is red; the pipeline cannot go green (§18).
4. The engine integration suite is red and leaks residue on every run (§21).
5. A constitutional invariant — an owner never owns two teams — is unenforced, with live violations (§10 P1-1).
6. The fiscal-period lifecycle is unreachable; the governance layer is inert (§24).
7. No backups run; no restore has ever been rehearsed (§19).
8. The web tier emits no logs; there are no metrics and no alerts (§20).
9. `pnpm preflight:production` refuses with 16 blockers; nothing is provisioned; the domain has no MX (§19).

**Conditions for reconsideration:** every P0 in §28 closed and evidenced; one green pipeline including e2e, `grants:verify` and `rls:verify`; **one complete rehearsal auction on staging under the four-role recipe, carried through settlement to an issued receipt, with no manual intervention**; one restore from a stored backup with the RTO written into the runbook; and a decision — either way — on purse visibility.

**Estimate:** the engineering blockers are roughly **1–1.5 focused weeks**, most of it proving rather than fixing. The provisioning is founder-held and is the longer pole. That is a shorter list than the last audit's, and the reason is that the last remediation worked.

---

# Final Principal-Architect Verdict

**1. What is already very good.** The auction engine — a pure reducer, an append-only log, a single-writer lease, replay verification that halts on divergence, an eleven-check bid gauntlet, timers that provably never shrink, integer paise everywhere. The type discipline: zero escape hatches in 120,000 lines, machine-enforced. The boundary enforcement: 1599 modules, zero violations, `core` genuinely pure. The authorization model: grants not roles, four partitioned capability engines, platform grants unmintable by construction. Injection resistance: a dedicated pass found nothing. The fail-closed instinct throughout — an unset secret 404s the route, a half-configured mailer keeps its outbox, a missing settlement account refuses the payment rather than collecting other people's money. And the WR-1 owner-plan feature, which is the first thing in this repository to get a participant-arm RLS policy *and* an application gate and to be right in both.

**2. What is architecturally weak.** The tenant boundary is a convention with 133 exceptions, so it can no longer be reasoned about as a boundary. The database has no referential integrity on its own spine. Business rules live in the web tier where the engine cannot see them. Four client panels and one action module are past readable size.

**3. What is security-critical.** Two webhook paths that skip the tenant transaction and therefore fail — or write where they may not — under the production role recipe. No step-up on the operation that changes the login credential. Client-claimed size and type on bucket uploads.

**4. What breaks under scale or concurrency.** The finops lease, which is a timer and not a fence, the moment a job exceeds sixty seconds. The O(n²) fold, late in a long auction, through the 2-second command timeout. `/home`'s unbounded aggregates as membership grows. Two engine instances, which are safe for the log and unsafe for the ten seconds of snapshots either side of a lease handover.

**5. What should NOT be changed.** The three-process topology. Event sourcing where it is and plain projections where it is not. The single-writer engine. The reducer and the bid gauntlet. The capability partitions. The `withTenantDb` design — extend its reach, do not redesign it. Server actions instead of a REST API. Integer-paise money. The fail-closed env validation and its one loudly-named escape hatch. And do not introduce microservices, a broker, a cache tier or Kubernetes; none is warranted at this product's scale.

**6. What MUST be changed.** The two webhook tenant boundaries. The audit gate and the teardown FK. Invariant 18. The worker lease fence. The bid intent id. The hammer-while-paused guard. The period lifecycle — shipped or explicitly descoped. And backups that run, with one restore actually rehearsed.

**7. What should be changed later.** Foreign keys across the spine. A logger and a request id. Rate limits. The `systemDb` read seam. A checkpointed fold. CSP `script-src`. Terminology. The god modules.

**8. Is it safe to ship?** No — not because the engineering is weak, but because the money path does not work under its own documented production configuration, a constitutional invariant is unenforced with live violations in the development database, and there is no operational layer to run on. Nothing here is a design failure; every P0 is a path that skipped a boundary the rest of the system obeys, in a repository where nothing local runs as a role that could notice.

**9. The exact minimum before production.** The ten P0 items in §28 — realistically 1–1.5 weeks — plus one green pipeline, one rehearsal auction under the four-role recipe carried through settlement to a receipt, and one restore from a stored backup with the RTO recorded. Then the founder-held provisioning, of which DNS is the keystone because three separate things wait on it.

**10. The recommended next milestone.** Call it **PA-1R**, and give it one organising principle rather than a list: *nothing merges until it has been proven under the production role recipe.* Concretely — point the web integration suite at `desiauction_app` in CI, close the ten P0s, and finish with a rehearsal auction on staging. That single change to the test harness is what turns this class of defect from "found by an audit" into "cannot merge", and it is the difference between this being the last such audit and the third.

---

*Every command reported here was executed against the working tree at `e6712df`. Where a claim could not be verified — CI run history (`gh` is not installed on this machine) and the closing runtime RLS probe (the Docker daemon stopped mid-session) — the report says so rather than inferring the answer.*
