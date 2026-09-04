# PA-1R — Remediation Plan to Production-Grade

**Date:** 2026-09-04 · **Baseline:** `e6712df` · **Closes:** [PA-1 REPORT](REPORT.md)
**Goal:** every finding in PA-1 either fixed and proven, or explicitly and visibly descoped — with a permanent gate that prevents its class from recurring.

---

## 0 · The organizing principle

PA-1's three most serious defects were not hard to fix. They were hard to *see*: every local process, every unit test, every integration test and every e2e run connects as the database superuser, so RLS is inert and role grants are irrelevant. Code that skipped the tenant boundary behaved perfectly in every environment the team could observe, and would have failed on the first real payment.

So this plan is **gate-first, fix-second**. Phase 0 builds the harness that makes the defects go red *before* anything is repaired. Every later phase lands its fix against a test that was failing, and leaves behind a gate that fails CI if the class returns.

> **The rule for this milestone:** nothing merges until it has been proven under the production role recipe.

A fix without a gate is a fix that comes back. Each item below therefore carries two columns that matter more than the code: **Proof** (what turns red now, green after) and **Gate** (what stops it recurring forever).

---

## 1 · Decisions taken (2026-09-04)

These were open questions in PA-1. They are now settled, and they materially reduce scope.

| # | Decision | Consequence for this plan |
|---|---|---|
| **D1** | **Manual payments only at beta.** Cash / UPI / bank capture is the money path; the Razorpay gateway stays off. | The webhook tenant-boundary defect **drops from P0 to P1** — still fixed in Phase 2, but it no longer gates launch. The per-organizer Razorpay Route KYC dependency leaves the critical path entirely. **New requirement:** the gateway must be provably off, not accidentally off (§Phase 2.4). |
| **D2** | **Purses are public.** Hammer prices are the public record and purse is arithmetic on top of them. | Delete the gating that only looks like a seal, correct the copy, keep engine-side redaction as defence-in-depth. **Invariant 35 is rewritten** to describe the product we have. Hours, not days. |
| **D3** | **FinOps governance descoped for beta.** Receipts and invoices work; period sealing, daily attestation and year-end do not ship. | The unreachable lifecycle stops being a latent half-built path and becomes a documented boundary, surfaced in the UI. ~0.5 day instead of ~2 days + e2e. |

**Revised launch-blocking set** after D1–D3: **8 items**, down from 10.

---

## 2 · Definition of done

Production-grade for this product means all nine of these are true at once:

1. `pnpm verify` and `pnpm verify:local` green, and **one green CI pipeline** including e2e, `grants:verify`, `rls:verify` and the two new posture gates.
2. Every route handler and every server action either enters `withTenantDb` or appears on a reviewed system-path allowlist with a written reason — **checked by a script in CI**.
3. The critical journeys pass **under the four-role recipe**, not as the database owner.
4. Every constitutional invariant in `docs/40` is either enforced in schema or machine, or the document is corrected to say where it actually lives. No invariant claims an enforcement that does not exist.
5. Every service emits structured, redacted logs with a request id; Sentry has a DSN; health, error rate, queue depth and runner liveness are alerted.
6. A backup runs on a schedule to off-host storage on a separate credential, and **one restore has been rehearsed with the RTO written down**.
7. `pnpm preflight:production` exits 0.
8. **One complete rehearsal auction on staging under the production roles**, carried through settlement to an issued receipt, with no manual intervention.
9. Every P0/P1 in PA-1 is closed, or listed in `KNOWN_LIMITATIONS.md` with an owner and a date.

---

## 3 · Phase plan

Nine phases. Phases 0–3 are strictly sequential (each depends on the last). Phases 4–6 can run in parallel once Phase 0 lands. Phase 7 is founder-gated and runs in parallel throughout. Phase 8 certifies.

```
P0 Gates ──► P1 Auction ──► P2 Money ──► P3 Data
   │                                        │
   └──────► P4 Observability ───┐           │
   └──────► P5 Security ────────┼──► P8 Certify ◄── P3
   └──────► P6 Product/UX ──────┘           ▲
                                            │
   P7 Operations (founder track, parallel) ─┘
```

---

### Phase 0 — Gates: make the invisible visible · ~2–3 days · **do this first, fix nothing else until it lands**

| # | Item | Change | Proof | Gate |
|---|---|---|---|---|
| 0.1 | Engine teardown FK | `live-engine.integration.test.ts:156` — delete `paddle_grants` before `people` | `pnpm test:integration` green twice in a row | — |
| 0.2 | Purge accumulated residue | New `scripts/purge-orphans.mjs`: delete rows whose parent is missing, in FK-safe order; report counts | 220 orphan lots / 214 paddle refs / 100 competitions → 0 | Phase 3.1 makes it impossible to recreate |
| 0.3 | Dependency audit green | `fastify` → ≥5.12.1; root override `fast-uri` → `>=4.1.3`; re-run | `pnpm audit --prod --audit-level high` exits 0 | already a CI step — it starts passing |
| 0.4 | **Static posture gate** | New `scripts/check-tenant-posture.mjs`: walk the 9 `route.ts` handlers and 30 `"use server"` modules; every DB-touching export must reach `withTenantDb`, or be named in `ops/posture-allowlist.json` with a reason. Seed the allowlist from today's 28 `systemDb` files so it is a **ratchet, not a cliff** | The two webhook defects appear as unlisted violations | New CI step; a new unlisted bypass fails the PR |
| 0.5 | **Runtime posture suite** | New `apps/web/src/posture/*.posture.test.ts` + `posture:verify` script: seed as owner, then exercise each route handler and each high-risk read (`/home`, cockpit, settlement command, finops issuance, both non-Razorpay webhooks) with `DATABASE_URL=desiauction_app` and `SYSTEM_DATABASE_URL=desiauction_system` | **P0-2 goes red here** — the delivery-status and sms-inbound writes fail on grants | New CI job alongside `rls:verify` |
| 0.6 | Grants manifest ratchet | Extend `apps/web/scripts/verify-grants.ts`: assert every table written on `systemDb` ∈ `SYSTEM_MAY_WRITE` | Flags `suppressions`, `finops_events`, `finops_dispatches` | Existing CI step gets teeth |
| 0.7 | ~~Ban silent failure~~ | **MOVED TO PHASE 4.2** — see below | | |

**Exit criteria:** CI is green, and the posture suite encodes the predicted defects as `it.fails` — a test that starts failing the moment the bug is fixed, forcing the marker's removal. That encoded red is the deliverable.

> **0.7 moved to Phase 4.2, on execution (2026-09-04).** The item read "enable
> `no-empty` with `allowEmptyCatch: false`; disable the ~15 deliberate ones".
> Two things were wrong with it. First the count: 84 bare catches sit in linted
> source, not 15. Second, and decisive — reviewing the money-path sites found
> **9 of 10 are legitimate fail-closed control flow**: `timingSafeEqual`
> throwing on a length mismatch, `JSON.parse` of an untrusted webhook body,
> `requireCapability` throwing into a refusal. Enforcing the rule now would
> produce 84 disable comments on mostly-correct code, which is noise wearing a
> gate's clothes.
>
> The sequencing is also backwards. A swallowed error is only *silent* failure
> if there was somewhere for it to go, and the web tier has **no logger at all**
> until Phase 4.1. Enforced today, the only alternative a developer has is to
> rethrow — turning a deliberate degradation into a user-facing 500. The rule's
> precondition is the logger, so it belongs immediately after it, when each site
> can be given a `logger.warn` and a reason instead of a disable comment.
>
> One site is worth carrying forward by name: `packages/financial-operations/src/server/runner-core.ts:397`
> swallows a `certifyOperations` failure inside the daily ops path. That is the
> real thing the rule was aimed at, and it should be fixed in Phase 2.8 rather
> than waiting.

> **Why a ratchet and not a full conversion.** Pointing all 836 integration tests at the app role means rewriting fixtures that legitimately need owner rights (cross-tenant setup, teardown). That is a multi-day fight with low marginal value. The allowlist freezes today's 28 bypasses, the posture suite proves the critical paths under real roles, and Phase 3.4 burns the allowlist down. Full conversion is a Phase 9 goal, not a launch blocker.

---

#### Phase 0 — EXECUTED 2026-09-04 (branch `fix/pa1r-phase-0`)

| # | Outcome |
|---|---|
| 0.1 | **Done.** `paddle_grants` + `auction_owner_invites` deleted before `people` in the engine teardown. Suite green twice consecutively — 66/66, and it no longer leaks a person per run. |
| 0.2 | **Done.** `scripts/purge-orphans.mjs`, dry-run by default. Found the audit's numbers, then a flaw in the script itself: a single pass misses cascades, because deleting an orphaned competition orphans everything beneath it. Rewritten to sweep to a **fixed point** — which removed **2,988 rows in 4 passes**, five times the 577 a single pass reported. One row (a sold lot in a dead "Career Fixture Cup" fixture whose paddle is gone) is flagged for a human and blocks nothing until Phase 3.1. |
| 0.3 | **Done.** `fastify` → ^5.12.1, `fast-uri` override → `>=4.1.3`, `browserslist` override added, spike bumped. `pnpm audit --prod --audit-level high` **exits 0 with zero vulnerabilities** (was 8, six high). The CI quality job can go green. |
| 0.4 | **Done.** `scripts/check-tenant-posture.mjs` + `ops/posture-allowlist.json`, wired as `pnpm check:posture` in CI. Seeded at **30 by-design · 9 debt · 3 defect**. Ratchet proven in both directions: removing an entry fails the build, and adding an entry for a file that no longer bypasses also fails it. Also catches a direct `systemDb` write to a table outside `SYSTEM_MAY_WRITE` (0.6, folded in). |
| 0.5 | **Done, and it caught the bug.** `apps/web/vitest.posture.config.ts` + `src/posture/webhooks.posture.test.ts`, CI step added. Running the real handler as `desiauction_app`/`desiauction_system` reproduced **P0-2 exactly as predicted**: `PostgresError: permission denied for table suppressions` (42501) at `sms-inbound/route.ts:88`. Also proved the P0-1 mechanism directly — the raw pool cannot see a payment that plainly exists; a tenant boundary can. |
| 0.6 | **Folded into 0.4**, and scoped honestly: only two direct `systemDb` writes exist and both are to `audit_log`, which is permitted — so a static write check passes vacuously. The 64 writes that matter arrive as a passed-in handle, which no regex can follow. `posture:verify` is what actually covers them. |
| 0.7 | **Moved to Phase 4.2** — see the note above. |

**Handling the known-red test.** P0-2's failure is real and scheduled, so painting CI red for a month helps nobody — but neither does deleting the evidence. It is recorded as `it.fails`, which inverts: the moment Phase 2.1 lands, the test fails *because it passed*, forcing whoever fixed it to remove the marker. Verified by temporarily granting the missing INSERT and watching it flip.

**Gate state after Phase 0** — `verify` ✅ · `build` ✅ · `test:integration` ✅ (engine 66, web 836) · `check:posture` ✅ · `posture:verify` ✅ 5/5 · `audit --prod --audit-level high` ✅ 0 vulnerabilities.

---

### Phase 1 — Auction integrity · ~2 days · *the hour this product exists for*

| # | Item | Change | Proof | Gate |
|---|---|---|---|---|
| 1.1 | **Invariant 18** — one owner, one team | Audit `seed-demo.ts` + e2e fixtures for the 26 violating pairs and give each team a distinct person **first**; then a migration adding `paddles(auction_id, person_id) WHERE released_at IS NULL` and `paddle_grants(auction_id, person_id) WHERE revoked_at IS NULL`, both unique; then an `owns_another_team` refusal in the issue/grant path | Integration: second claim refused; direct insert raises `23505` | DB constraint — unforgeable |
| 1.2 | Bid intent id | `live-panel.tsx:145,167` — `intents.idFor(key, payload)` / `settle(key, payload)`, as the comment above already describes | e2e: reject the action once, bid on the **next lot**, assert a `BidAccepted` carrying the new lot id | regression test |
| 1.3 | Hammer while paused | `aggregate.ts:571-620` — require `auction.status === "live"` for sell / pass / hold, matching the existing `open` guard | Integration: Pause → CloseLot → `auction_not_live` | core machine test |
| 1.4 | Boot rehydration | `apps/engine/src/index.ts` — before `listen`, `ensureAuction` every auction in `live`/`paused` so timers resume without a client touch | Restart mid-lot with zero sockets; assert LotSold within one tick | integration test |
| 1.5 | Honest failure ack | `engine-core.ts:436` — rename `engine_halted` → `command_failed` and call `rebuild()` in the catch so the snapshot cannot lag the database | Force a write failure; assert the next snapshot is correct | — |
| 1.6 | `deepVerify` | Schedule it on the 30s cadence its comment already claims, or delete both | Unit: the timer invokes it for resident auctions | — |
| 1.7 | Go-live guard, surfaced early | Wire `auctionReadiness` counts into the Open button's `disabled` + a reason line, and add a paddle/owner row to `/readiness` | e2e: with <2 paddles the button is disabled and says why | — |

---

#### Phase 1 — EXECUTED 2026-09-04

| # | Outcome |
|---|---|
| 1.1 | **Done, and the plan was wrong about how.** A blanket unique index would have broken DA-02 — a deliberate shipped feature letting a conductor hold several paddles to bid for owners not in the room — and `seed:demo` with it. The DB showed the split cleanly: `paddle_grants` (the owner arm) had **0** violations, `paddles` had 4, all conductor-held. Founder decision: constrain the owner arm. Migration 0042 + an `owns_another_team` refusal. `grantPaddle`'s catch had to be hardened first — it answered `{ok:true, alreadyGranted:true}` for ANY failed insert, so with a second index a refused grant would have reported SUCCESS with a grantId never written. Removing the app check leaves the suite green: the database refuses on its own. |
| 1.2 | **Done, and it found a second instance.** `idFor(key)` without the payload collapsed every bid into one slot. Rather than test the caller, the payload is now REQUIRED — `idFor("bid")` does not compile. That immediately surfaced the same omission on `CompleteAuction`, where an unanswered close left its slot occupied and the conductor's override retry inherited the cached `squad_below_minimum` refusal: **the night could not be closed from the panel at all.** |
| 1.3 | **Done.** Only `open` checked auction status, so a paused auction still accepted the gavel. Now `sell`/`pass`/`hold` require `live`; `requeue`/`withdraw` stay allowed. Verified by reverting the guard and watching the new test fail. |
| 1.4 | **Done.** `engine.rehydrate()` loads every `live`/`paused` auction before the listener binds. The test is hostile to the old behaviour: the fresh engine is never asked about the auction — only `rehydrate()`, then assert residency. |
| 1.5 | **Done.** `command_failed` split from `engine_halted`, which had been telling auctioneers to run engine recovery for a dropped connection. The catch now also rebuilds, because a commit can succeed and a later step still throw, leaving the room rendering a snapshot the database has moved past. |
| 1.6 | **Done — by NOT scheduling it.** `deepVerify` was documented as running every 30s and never had a caller. Putting it on a timer is the obvious repair and a dangerous one: it folds twice in parallel and halts the auction on any difference, so from a timer it races the queue and two honest folds straddling a commit would stop a healthy night. Scheduling it needs the FIFO queue; the false claim is removed and the hazard recorded. |
| 1.7 | **Done.** The Open button is disabled with a named blocker instead of failing on click. Counted as distinct teams to match `auctionReadiness` exactly — disabling a button the engine would have accepted is a worse failure than the toast it replaces. |

**Gate state after Phase 1** — `verify` ✅ · `build` ✅ · `test:integration` ✅ (engine **69**, web 843) · `check:posture` ✅ · `posture:verify` ✅ · `audit` ✅ 0 vulnerabilities · `seed:demo` ✅.

---

### Phase 2 — Money path · ~2 days

| # | Item | Change | Proof | Gate |
|---|---|---|---|---|
| 2.1 | **System-role webhook writes** (was P0-2) | `delivery-status/route.ts:67,75`, `sms-inbound/route.ts:88` — resolve the dispatch's org, do the finops write inside `withTenantDb`; keep `suppressions` (no RLS) on the app pool | Posture suite 0.5 goes green | 0.6 manifest ratchet |
| 2.2 | Razorpay tenant boundary (P1 under D1) | `webhook.ts:60` — wrap from the verified envelope: `withTenantDb(dbHandle, { personId: SYSTEM_ACTOR, orgId: envelope.orgId }, …)`, build `settlementDeps` inside, keep the pin check | Posture test: signed capture → 200 + `PaymentCaptured` under `desiauction_app`; wrong org → 409 | posture suite |
| 2.3 | Settlement append lock | `settlement/store.ts:88` — `SELECT … FOR UPDATE` on the case (or `pg_advisory_xact_lock`) before computing `seq`; translate `23505` on `*_stream_seq_uq` into a retryable result instead of a raw error | Two concurrent `recordPaymentAction` calls on one case both commit in order | integration test |
| 2.4 | **Gateway provably off** (D1) | Assert `settlementAccount()` returns null and every gateway order refuses `no_settlement_account`; surface "gateway not enabled at beta" in the collections UI rather than an error | Test: attempting a gateway payment refuses with that reason | regression test |
| 2.5 | `retryDeliveryAction` idempotency | `financial-operations/actions.ts:761` — derive the command id from `retry:{failedDispatchId}:{intentKey}` | Double-click → one dispatch | regression test |
| 2.6 | Worker lease is a fence, not a timer | `runner.ts` / `runner-core.ts:292` / `store.ts:380` — mint a lease token on claim; put it in the completion `WHERE`; `attempts++` on reclaim; batch size 1 for long kinds (or heartbeat mid-job) | Two-runner test: one job, one execution. Crash-loop dead-letters at 5 | integration test |
| 2.7 | `dispatch.send` outbox | Commit the `sent` transition **before** the provider call, or record an outbox row and let the send be the retryable step | Kill between send and commit → no duplicate email | integration test |
| 2.8 | Follower tick isolation | `followAllOrgs` — wrap per-org so one org's exception cannot abort the tick for every other org | Inject a throwing org; assert the rest still run | unit test |

---

#### Phase 2 — EXECUTED 2026-09-05 (2.7 outstanding)

| # | Outcome |
|---|---|
| 2.1 | **Done, and it uncovered a bigger defect.** `suppressions` moved to the app pool (the table is not org-scoped — a STOP tells the platform, not one club). The delivery route's finops half now runs inside `withTenantDb`, opened by ONE adapter-verified id→org lookup on the system pool. **Probing that path found the whole finance workspace could not write**: `finops_events` was `SELECT`-only for the app role, so every Issue receipt / Declare profile / Open series click failed under the documented recipe. The revoke was incoherent — the app role holds full DML on every projection rebuilt from that log — so the line moved to where it means something: INSERT yes, UPDATE/DELETE never (founder decision). |
| 2.2 | **Done.** The tenant boundary is now a *parameter* of `handleRazorpayWebhook`, because the ordering is the security property: no tenant-scoped handle exists until the signature passes. Proven by removing it and reproducing `404:unknown_payment`. |
| 2.3 | **Done.** A transaction-scoped advisory lock per settlement stream, so two operators on one case serialize instead of one receiving a raw `23505`. Fails on all three runs without the lock. |
| 2.4 | **Done.** A posture test pins the gateway shut (D1), so enabling collection has to be deliberate and has to delete a test explaining why. |
| 2.5 | **Done.** Retry now derives BOTH the command id and the dispatch stream id from one fingerprint — a stable command id alone would have deduped nothing, because `requestDispatch` mints the stream it would be deduped on. `derivedId` extracted to `server/derived-id.ts` so settlement and finops cannot solve it two ways. |
| 2.6 | **Done.** The claimed lease is the fence token (no new column): a reclaim writes a fresh `leased_until_ms`, so a slow worker's write stops matching. Reclaims now count as attempts and exhausted ones are retired, closing the crash-loop that never dead-lettered. Both halves proven independently. |
| 2.7 | **OUTSTANDING** — `dispatch.send` still calls the provider before committing the `sent` transition, so a crash in between re-sends. |
| 2.8 | **Done.** One org's follower failure no longer aborts every org after it — and is reported per-org rather than swallowed, since isolation without reporting is a quieter version of the same bug. |

**Gate state** — `verify` ✅ · `build` ✅ · `test:integration` ✅ (engine 69, web 847) · `check:posture` ✅ **defect 0** · `posture:verify` ✅ 13/13 · `grants:verify` ✅ 286 · `audit` ✅ 0 vulnerabilities.

> **Method note, recorded because it recurred.** Three times a "prove the test
> catches the bug" experiment reported a PASS because the string replacement had
> silently not matched — the change never happened and the green was meaningless.
> Every such experiment now asserts the edit applied before trusting the result.
> A green test after a change that did not happen is exactly the false
> confidence this milestone exists to remove.

---

### Phase 3 — Data integrity · ~1–2 days · *depends on 0.2 purge*

| # | Item | Change | Proof | Gate |
|---|---|---|---|---|
| 3.1 | **FKs on the auction spine** | One migration adding `NOT VALID` FKs then `VALIDATE`, all `ON DELETE RESTRICT` (evidence never cascades): `lots.auction_id`, `lots.registration_id`, `lots.sold_to_paddle_id`, `bids.lot_id`, `bids.paddle_id`, `paddles.team_id`, `paddles.auction_id`, `teams.competition_id`, `competitions.org_id`, `competitions.tournament_id`, `auctions.competition_id`, `registrations.competition_id`, `registrations.team_id`, `settlement_obligations.case_id`, `payments.case_id`, and `*.org_id → organizations` | Re-run the orphan query: all zero. Suites green on a **pristine** database | the constraints themselves |
| 3.2 | Status CHECKs | `NOT VALID` + `VALIDATE` CHECKs on the ~15 free-text enum columns (`settlement_cases.status`, `payments.method/status`, `finops_jobs.state`, `fixtures.status`, `registrations.role`, `grants.capability_set`, `*_events.stream_type`, …) | Invalid insert rejected | DB |
| 3.3 | Migration safety | Wrap `db:migrate` in a script that sets `lock_timeout='5s'` and takes `pg_advisory_lock` for the run; adopt `NOT VALID` + `VALIDATE` as the house style for future constraints; document the journal `when` trap at the top of the runner | Two concurrent migrates: one waits, neither corrupts | migrate script |
| 3.4 | Burn down the allowlist | Move the highest-risk `systemDb` reads into `withTenantDb`, starting with `home/dashboard.ts` and `auction/conduct-actions.ts` (lots + owner phones); delete each from `ops/posture-allowlist.json` as it lands | Posture gate passes with a shorter list | the allowlist shrinks and can never grow silently |
| 3.5 | Index hygiene | Drop the duplicate `demo_bookings_slot_idx`; add the three missing `auction_team_targets` FK indexes, `audit_log(actor, at)`, and the covering index for migration 0041's third policy arm | `EXPLAIN` on the plan read under the app role | — |
| 3.6 | `finops_jobs` retention | Purge `done` rows older than N days on the daily tick; add a queue-depth/oldest-job metric | Table stops growing | Phase 4 alert |

---

#### Phase 3 — 3.1, 3.2, 3.3, 3.5, 3.6 DONE · 3.4 PARTIAL (2026-09-05)

| # | Outcome |
|---|---|
| 3.1 | **Done — migration 0043, 21 constraints, all validated.** `lots`, `bids`, `paddles`, `auctions`, `teams`, `registrations`, `competitions`, `settlement_obligations`, `payments`. ON DELETE RESTRICT everywhere: a cascade would mean deleting an org silently destroys its auctions, bids and sale record, and invariant 4 says money records survive erasure. `NOT VALID` then `VALIDATE`, which is the shape every future constraint should take. |
| | **The constraints were the easy part.** Landing them required first closing what still produced orphans: sixteen teardowns leaving the spine behind (660/run), then two fixtures that INVENTED parents the product cannot produce — one inserting paddles for an org, competition and auction it never created; the career fixture giving two sold lots `soldToPaddleId: newId()`, a buyer referencing nothing. A third, the engine's deleted-lot drill, had to stage its corruption a step differently now that a lot with bids cannot vanish. Two of my own posture fixtures had the same flaw and were caught by the same constraints. |
| 3.2 | **Done — migration 0044, 33 CHECKs.** The audit counted ~15 enum-shaped text columns; there were 33. Generated FROM `schema.ts`'s own declarations, never from the data — a CHECK built from "what exists today" refuses a legal value the first time a state is used. Immediately caught two of my own posture fixtures using a settlement `basis` that was never a declared value. |
| 3.3 | **Done.** `packages/db/scripts/migrate.mjs`: session advisory lock so two deploys cannot apply one batch, and a 5s `lock_timeout` so a blocked ALTER fails fast and loudly. Without it, an ALTER waiting on a long reader blocks every statement behind it — one slow query plus one deploy is a total outage of that table, and it looks like the app hanging. Verified on a fresh database and a re-run; the timeout path is code-reviewed, not simulated. |
| 3.4 | **Started — debt 9 → 8.** `conduct-actions` burned down: `ownerAcceptancesOf` (owner names and PHONE NUMBERS) moved inside the boundary `cockpitView` already used, plus the org-name read one line outside it. What remains there is `publicSpectatorView`, which is anonymous. **`/home` deliberately not converted**: its money aggregates span every org a person belongs to via `inArray`, so a boundary means N per-org round trips — a design change on the largest money read surface, deserving its own pass. |
| 3.5 | **Done (in 0044).** Dropped the duplicate `demo_bookings_slot_idx`; added the three unindexed FK columns on `auction_team_targets`, `audit_log(actor, at)`, and the covering index for 0041's third policy arm. |
| 3.6 | **Done.** Hourly sweep drops `done` jobs past a week and never touches `dead` ones — those are the operator's alert queue. On the tick rather than the schedule, because the schedules live inside the governance lifecycle beta descopes (D3), and a sweep that only runs when somebody opens a fiscal period never runs. |

**Verified:** 35 FKs / 35 validated, on the working database and on a **fresh database built from migrations alone**; engine 69, web 849, posture 13/13, grants 286; and a full suite run now leaves **zero** orphans where it used to leave hundreds.

---

### Phase 4 — Observability · ~2 days · *parallel after Phase 0*

| # | Item | Change |
|---|---|---|
| 4.1 | **A logger in the web tier** | Add `pino`; `apps/web/src/server/logger.ts` mirroring the engine's redact paths (`phone`, `token`, `secret`, `code`, `authorization`); a request id generated per server action / route handler and carried on every line |
| 4.2 | Kill the silent failures | Fix the bare catches on the money, auth and engine-client paths first (log + Sentry); the deliberate ones keep their disable comment and a reason from 0.7 |
| 4.3 | Sentry real | DSN in all three services; verify one captured error per service; `beforeSend` scrub |
| 4.4 | The five alerts that matter | web/engine health, error rate, `finops_jobs` depth and oldest age, runner liveness (**alert on silence** — a stopped runner is currently invisible), and DB connection saturation |
| 4.5 | Runner health honesty | `runnerHealthSnapshot` must report unhealthy on silence, not only when `dead > 0` |

---

#### Phase 4 — EXECUTED 2026-09-05

| # | Outcome |
|---|---|
| 4.1 | **Done.** `apps/web/src/server/logger.ts` — pino with the engine's shape (same level var, base fields, redaction) plus a superset redact list for what only this tier sees: one-time codes, session/invite tokens, three webhook secrets. Request id via `AsyncLocalStorage`, preferring the edge's own; all five webhook and job routes wrapped. |
| 4.2 | **Partially done, deliberately.** The swallows where silence cost most now log: the engine-client's three (an unreachable engine was a correct refusal and an invisible one) and the settlement/finops capability checks (which turn a DB outage into "you may not"). The repo-wide `no-empty` rule stays deferred — 84 sites, most legitimate fail-closed control flow — but its precondition now exists, so it can be done file by file with judgement instead of 80 disable comments in one pass. |
| 4.3 | **Done in code.** `scrub` in `packages/core` (5 tests) wired as `beforeSend` in all three services. Key-path redaction does nothing for an error MESSAGE, and `duplicate key ... Key (phone)=(+91...)` would reach Sentry verbatim. The scrub deliberately keeps ids, amounts and lot numbers — a report with the money removed is not a report. **The DSN itself remains founder-held.** |
| 4.4 | **Specified, not provisioned.** [operations/ALERTS.md](../../operations/ALERTS.md): the five alerts that close PA-1's four worst "detectability: poor" risks, each against a signal that exists in code today. Latency SLOs are explicitly excluded — nothing measures them, and an alert on an unmeasured number is a lie. |
| 4.5 | **Done.** `runnerHealthSnapshot` scored a STOPPED runner as perfectly healthy, because `dead === 0` answers "did anything fail loudly" and a crashed runner produces no dead jobs at all. It now also fails on queue AGE, which is the only signal that separates a busy platform from a dead worker, and says in words why. |

**Gate state** — `verify` ✅ · `build` ✅ · `depcruise` ✅ (2057 modules) · `test:integration` ✅ · `posture` ✅ 13/13 · core 440 tests.

---

### Phase 5 — Security hardening · ~2–3 days · *parallel after Phase 0*

| # | Item | Change |
|---|---|---|
| 5.1 | **Step-up on phone change** | Require a fresh `login` OTP to the **current** number (or a passkey assertion) within 10 minutes; revoke all other sessions on success; send the old-number notice on the security channel, bypassing marketing STOP |
| 5.2 | **Upload verification** | Sign `content-length` (or a POST policy with `content-length-range`); bucket-side max object size; `HEAD` + magic-byte sniff on attach — the local route already does this and is the reference |
| 5.3 | **Rate limiting** | A Postgres-backed token bucket modelled on the existing OTP throttle (`otp.ts:30-95` — the pattern is already proven here, no Redis needed): per-person daily caps on org/season/team/tournament creation and invite minting; per-IP on public forms; per-actor on money actions and bulk triage |
| 5.4 | Grant hygiene | `issueGrant` requires the target ∈ `org_members`; `wouldOrphanOrg` intersects holders with members; `removeMember` also revokes tournament-scope grants |
| 5.5 | Session hygiene | Revoke the replaced session on re-login |
| 5.6 | `acceptInvite` atomicity | Wrap claim + membership + grant + audit in one transaction (invariant 28) |
| 5.7 | Proxy trust | Honour `x-real-ip` only when `TRUSTED_PROXY_COUNT > 0`; make preflight fail if it is 0 in production |
| 5.8 | Error detail | Settlement `messageFor` must stop returning raw `reason — detail`; copy the finops pattern |
| 5.9 | Supply chain | SHA-pin `superfly/flyctl-actions/setup-flyctl` (currently `@master`, in a job holding `FLY_API_TOKEN`) and every other action; digest-pin both Docker base images |
| 5.10 | CSP `script-src` | Nonce via middleware, `'strict-dynamic'`, plus `connect-src` for the engine WS and Sentry. *Last in the phase — it is the safety net, not a live hole* |
| 5.11 | Gate helpers | Move `liveGate` / `auctionMemberGate` out of the `"use server"` module so they stop being callable endpoints |

---

### Phase 6 — Product & UX · ~2 days · *parallel after Phase 0*

| # | Item | Change |
|---|---|---|
| 6.1 | **Purses public (D2)** | Delete the omission theatre in `gateAuctionView`; correct every "sealed"/"private" string; **rewrite invariant 35** in `docs/40` to describe the real rule; keep engine-side scope redaction as defence-in-depth. Add a test asserting the documented behaviour so the rule is now pinned either way |
| 6.2 | **Governance descoped (D3)** | Remove or disable the `canClose` affordance; state the boundary on the ops board and in `KNOWN_LIMITATIONS.md`; leave `openPeriod`/`closePeriod` exported and tested for the milestone that ships them |
| 6.3 | Invariant doc truth-up | Correct the enforcement map in `docs/40` for invariants 2, 15, 18, 28, 35; fix the fourteen doc contradictions in PA-1 §23, starting with `README.md`'s "27 migrations" (42) |
| 6.4 | The seven stuck points | Registrations empty state → import/share; publish + close-intake prerequisites surfaced where the organizer is, not on another tab; owner paddle-claim explained on `/readiness`; Money tab discoverability; finance `profile_missing` given a route forward |
| 6.5 | Terminology | Pick one noun for competition/season/tournament and apply it to UI copy and test ids (keep URLs — they are in bookmarks and QR codes). One PR, mechanical, high readability payoff |
| 6.6 | Expose the locked rules | Slabs, unsold policy and role quotas in the "Rules of the night" form — three rules every organizer currently runs on defaults they cannot see |
| 6.7 | A11y gaps | Live regions on spectate/board/overlay; a keyboard path for the bidder (the conductor has three) |
| 6.8 | `TODO(founder)` | Resolve the 21 content markers; delete or implement `is_retained` and `franchises` |

---

### Phase 7 — Operations · founder-gated · runs in parallel from day 1

**Start this immediately — DNS is the long pole and three things wait on it.**

| # | Item | Owner | Blocks |
|---|---|---|---|
| 7.1 | **`desiauction.in` DNS**: MX + SPF/DKIM/DMARC | founder | the statutory grievance address (currently bouncing, on a running clock), passkeys (`RP_ID`), `PUBLIC_BASE_URL` |
| 7.2 | Managed Postgres 17 (Mumbai) + PITR; the four roles created; **TCP keepalives applied** | founder → eng | the engine lease is unrecoverable without the keepalives |
| 7.3 | **Backups that run**: schedule `pnpm backup` to off-host storage on a **separate credential**; retention set | eng | DoD #6 |
| 7.4 | **One rehearsed restore**, RTO written into `RESTORE_RUNBOOK.md` | eng | DoD #6 — *nothing has ever been restored* |
| 7.5 | MSG91 live account | founder | **nobody can log in without it, including the founder** |
| 7.6 | S3-compatible storage (media + finops artifacts) | founder | `MEDIA_STORAGE=bucket`, `FINOPS_ARTIFACT_STORE=bucket` |
| 7.7 | Fly + Vercel projects, secrets set | founder | first deploy |
| 7.8 | `pnpm preflight:production` exits 0 | eng | DoD #7 |
| 7.9 | **Live-window deploy freeze** (C-22): a pre-deploy check that refuses while an auction is live | eng | risk #6 in PA-1 |

---

### Phase 8 — Certification · ~2 days

1. `pnpm verify:local` green.
2. One green CI run: quality + integration + **posture** + e2e + `grants:verify` + `rls:verify` + secrets scan.
3. **The rehearsal**: a full auction on staging under the four-role recipe — create season → import → publish → teams → invite two owners on two devices → both claim paddles → go live → bid → hammer → complete → settle → record a manual payment → issue a receipt. No manual DB intervention. Any refusal is a finding.
4. One restore drill with the RTO recorded.
5. Re-run PA-1's §52 toolchain and diff the scorecard.
6. Write `docs/audits/PA-1/REMEDIATION.md` recording what was fixed, what was descoped and what remains, in the style of the FINAL-PRR record.

---

## 4 · Sequencing and effort

| Phase | Focus | Effort | Depends on |
|---|---|---|---|
| 0 | Gates | 2–3 d | — |
| 1 | Auction integrity | 2 d | 0 |
| 2 | Money path | 2 d | 0 |
| 3 | Data integrity | 1–2 d | 0.2 |
| 4 | Observability | 2 d | 0 |
| 5 | Security | 2–3 d | 0 |
| 6 | Product/UX | 2 d | 0 |
| 7 | Operations | 2 d eng + founder lead time | — (start now) |
| 8 | Certification | 2 d | all |

**≈ 3–4 focused weeks** of engineering, plus founder provisioning in parallel. Serial critical path is roughly **11–13 working days**; the rest parallelises.

**Suggested order of merge:** 0 → 1 → 2 → 3, with 4/5/6 interleaved as capacity allows, 7 running throughout, 8 last.

---

## 5 · Risk register for the remediation itself

| Risk | Mitigation |
|---|---|
| **Invariant 18 breaks the demo seed and e2e fixtures** (26 violating pairs today) | Fix fixtures *before* the migration; run the full e2e suite between the two commits, not after both |
| **FK migration fails on residue** | 0.2 purge is a hard prerequisite; `NOT VALID` + `VALIDATE` so a failure is diagnosable rather than a rolled-back batch |
| **Posture suite becomes a flaky second harness** | Keep it small and journey-shaped; it asserts *reachability under roles*, not business behaviour, which the existing suites already cover |
| **Rate limiting locks out a real organizer on auction night** | Per-person daily caps sized from real usage; **never** rate-limit the bid path in the web tier — the engine's per-actor bucket already owns it |
| **CSP nonce breaks hydration** | Last item in Phase 5, behind its own e2e pass; revert is one header |
| **Scope creep into the O(n²) fold** | Explicitly **not** in this milestone. Measure with `SLOW_COMMAND_WARN_MS` during the rehearsal and decide with data |

---

## 6 · Deliberately NOT in this milestone

Recording these so they are decisions, not omissions:

- Checkpointed engine fold (O(n²)) — measure at the rehearsal first.
- Converting all 836 integration tests to the app role — the ratchet covers the risk.
- Splitting the god modules (`competition/actions.ts`, the four 1,000-line panels) — readability, not safety.
- `ts-prune` over `packages/core`'s 384 exports.
- Extracting the duplicated event-envelope helpers.
- Razorpay Route per-organizer linked accounts (removed from the path by D1).
- The FinOps period lifecycle UI (D3).
- WhatsApp, `i18n`/hi-IN, multi-region, OpenTelemetry.
- Microservices, Kubernetes, a broker, a cache tier — none is warranted at this product's scale, and PA-1 §27 says so explicitly.

---

## 7 · The one thing that makes this the last audit of its kind

Everything above is ordinary engineering except **0.4 and 0.5**. Those two gates are what change the system's failure mode: today a boundary violation is invisible until production, and after them it is a red PR. If only part of this plan is ever executed, execute Phase 0.
