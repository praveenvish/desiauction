# PHASE GATE RECORDS
## Blueprint §4 universal checklist · one section per phase closure

## IP-4 — Auction Platform · **FREEZE CANDIDATE** 2026-07-14 · awaiting CTO approval

Milestone decisions: M-IP4-1 **APPROVED** · M-IP4-2 **APPROVED** · M-IP4-3 **APPROVED** · M-IP4-4 = this certification.
**Freeze meaning:** Auction becomes infrastructure. The domain (machines, bid gauntlet, increment ladder, timer/anti-snipe, replay reducer), the aggregate, the engine (single writer, command queue, watchdog), the event log, the **AuctionSnapshot wire contract**, the ledger, recovery, diagnostics and the capability model are **stable**. Downstream phases (Settlement IP-5 onward) **consume** Auction via the ledger, snapshots and completed outcomes; they do not modify auction rules. Regressions are defects.

| # | Gate | Evidence (2026-07-14, freeze-candidate tree, everything rerun fresh) |
|---|---|---|
| 1 | Type safety | `tsc --strict` clean, 8/8 workspaces, zero suppressions in source |
| 2 | Lint | 0 errors, 8/8 workspaces (`--max-warnings 0`) |
| 3 | Unit tests | **211** — core **149** (auction machines/gauntlet/ladder/timer/replay · **certification regressions D-1 ×4, D-2 ×3, D-3 ×2, FB-1 ladder O(#slabs) equivalence + DoS-bound ×2** · snapshot · ledger · ceremony · fixture 32 · competition 14 · capabilities 8 · registration ops 12 · money/phone 9) · ui 52 · engine **8** (+ WS ticket lifetime) · contracts 2 |
| 4 | Integration | **163 vs live PG17** — engine **64** (**certification 31**: two independent engines byte-identical · hash stability ×10 · canonical serialization · ledger regeneration + append-only + audit linkage · kill/restart · **corrupted lot row** · **deleted lot row (row-missing halt, MAJ-1)** · **corrupted bid amount** · **re-crowned losing bid** · **corrupted paddle person (auth hijack)** · **corrupted paddle release** · **corrupted lot rounds** · corrupted auction status · corrupted snapshot cache · **poisoned log / sequence gap (halts, stays halted, recovery refuses)** · unknown event type · timer shrank · **all 15 conduct commands refuse a non-conductor** · undo needs conduct AND override · paddle-holder enforcement · duplicate-command idempotency · concurrent bids → one winner · **D-1 undo-after-requeue** · **D-1 undo-after-withdraw**; live-engine 16 (+ **audit source engine/web attribution, MIN-1**); conduct-ceremony 15; healthz 2) · web 99; migrations re-applied **idempotent** |
| 5 | Accessibility | axe **zero violations** on cockpit, stage/spectate, owner room, ledger, replay, engine dashboard (+ all IP-1/2/3 suites carried); **48/48 Playwright** in real Chrome |
| 6 | Performance | **Measured** (`perf:scale`, live PG17, median/p95): scale matrix **lots 100·250·500·1000·2500 × spectators 50·100·250·500·1000**. Bid ack 7.4 ms @100 lots → **52.6 ms / 60.2 p95 @2500**; pure fold 1.7 ms @5 063 events; **recovery 28.5 ms @2500**; ledger regeneration 0.5 ms @5 063 rows; snapshot payload 18 KiB → **359 KiB**; 1 000 spectators converge in **106 ms**. **Binding constraint: broadcast = snapshot bytes × spectators × events** → certified operating envelope published ([PERFORMANCE](../auction/PERFORMANCE.md) §5) |
| 7 | Visual review | The canonical auction night (create → invite → grant → claim → open → conduct → anti-snipe → pause → resume → **undo** → replay → ledger → diagnostics → **restart** → **recovery** → complete) is the exact green `conduct-ceremony` e2e journey |
| 8 | Founder review | M-IP4-1/2/3 approved; M-IP4-4 = this record. **Awaiting CTO freeze approval — no downstream phase opened** |
| 9 | Documentation | Permanent set shipped: `docs/auction/` (ARCHITECTURE · **ADRS ×8** · EVENT_CATALOG · **COMMAND_MODEL** · **SNAPSHOT** · **LEDGER** · RECOVERY · **DIAGNOSTICS** · **PERFORMANCE** · **SECURITY** · **THREAT_MODEL** · **RUNBOOKS** · API · MONEY · **REVIEW_PACKAGE**) + [closure report](../auction/IP-4_CLOSURE_REPORT.md) |
| 10 | Architecture review | dep-cruiser **0 violations** / 485 modules / 1385 deps; one-way dependency direction verified (packages never import apps); **three freeze-blocking defects found and fixed** (D-1 unreplayable undo event → auction bricked forever; D-2 money rows outside the watchdog → silent sale-price corruption; **D-3 paddle rows outside the watchdog → undetected authorization hijack + purse misattribution, found by the independent hostile audit**), each regression-locked in the pure core AND in integration; one proposed change **rejected and reverted** as a business-rule change rather than a defect (voided-bid visibility — intentional, no money impact) |

**Conditions carried forward (none freeze-blocking):** (1) **enforce the certified operating envelope at the web tier** — the spectator ceiling is a function of lot count; (2, before production) restrict `auction_events` write access to the engine role; (3, operational) grant `auction.override` narrowly and review `UNDO` ledger rows after each auction; (4, post-freeze ADR candidates) **delta broadcasting** (R-1, wire-breaking) and **hash-chaining the event log** (R-3, tamper *detection*); (5, carried from IP-0) no CI — the repo has no remote; all gates are scripted and run locally. All recorded in [IP-4_CLOSURE_REPORT](../auction/IP-4_CLOSURE_REPORT.md) §7 and [REVIEW_PACKAGE](../auction/REVIEW_PACKAGE.md) §6.

## IP-3 — Competition Core · FROZEN 2026-07-14 · tag `ip3-frozen`

Milestone decisions: M-IP3-1 **APPROVED** · M-IP3-2 **APPROVED** · M-IP3-3 **APPROVED** · M-IP3-4 = this freeze.
**Freeze meaning:** Competition is a platform dependency. The domain (machines, scheduling engine, conflict engine), aggregates, read models (FixtureSnapshot, **ScheduleSnapshot**), capability set, schema and RLS posture are stable; future phases (Auction IP-4 onward) **consume** Competition via the documented surfaces ([API](../competition/API.md), `scheduleSnapshot`) and do not redesign it. Regressions are defects.

| # | Gate | Evidence (2026-07-14, freeze-candidate tree, everything rerun fresh) |
|---|---|---|
| 1 | Type safety | `tsc --strict` clean, 7/7 workspaces, zero suppressions in source |
| 2 | Lint | 0 errors, 7/7 workspaces |
| 3 | Unit tests | **134** — core **75** (fixture machine/generator/conflict engine/CSV **32** · competition machines 14 · capabilities 8 · registration ops 12 · money/phone 9) · ui 52 · engine 5 · contracts 2 |
| 4 | Integration | **75 vs live PG17** — fixture-ops **25** (deterministic generation, team/ground/window conflict refusals, reschedule provenance, illegal transitions, published protection, completed immutability, mutation + import rollback, audit completeness, **SCHEDULE SNAPSHOT** determinism/deep-immutability/reconciliation, **RLS READ + WRITE PROOFS** on venues/grounds/fixtures, **520-fixture scale**) · registration-ops 13 (bulk ≡ N singles, bulk rollback, import atomicity, export scoping, 300-row scale) · competition 10 (incl. RLS proofs on the four M-IP3-1 tables) · authz 12 · security 8 · auth 7; migrations 0000–0007 re-applied idempotent |
| 5 | Accessibility | axe **zero violations** on /competitions, registrations dashboard, fixtures dashboard, venues (+ all IP-1/IP-2 suites); keyboard triage shortcuts (j/k/x/a); 360px zero-overflow carried |
| 6 | Performance | **Measured** (perf harness `perf:competition`, PG17 local, median/p95 over 20 runs): 520-fixture stats 0.4 ms · page-1 4.4 ms · deep page-21 3.7 ms · pure conflict engine 2.3 ms · conflict-checked reschedule 6.4 ms · **ScheduleSnapshot 4.4 ms** · CSV serialize 0.2 ms · 300-registration dashboard ≤ 9.2 ms p95. One measured defect fixed in-milestone: O(n²) kickoff re-parsing in the conflict engine (127 ms → 2.3 ms, behavior identical). First-load JS: heaviest competition route 114 kB |
| 7 | Visual review | Founder walked M-IP3-1/2/3 journeys on FLOODLIGHT surfaces; the canonical Competition walkthrough (create → register → import → approve → venue → grounds → generate → publish → resolve conflict → calendar → export) is the exact 44/44-green e2e journey |
| 8 | Founder review | M-IP3-1/2/3 decisions recorded above; M-IP3-3 blocking/warning conflict split confirmed at M-IP3-4 authorization; M-IP3-4 = this record |
| 9 | Documentation | Permanent set shipped: `docs/competition/` (ARCHITECTURE · **ADRS ×5** (CompetitionAggregate, FixtureAggregate, ConflictEngine, ScheduleSnapshot, RegistrationModel) · API · THREAT_MODEL · DPDP_REVIEW · PERFORMANCE · RUNBOOKS · REVIEW_PACKAGE) + [closure report](IP-3_CLOSURE_REPORT.md). Deviations recorded: wall-clock TEXT time model (single-TZ assumption) · drafts hold slots · `start` on the FixtureAggregate · generation refused over live fixtures |
| 10 | Architecture review | dep-cruiser 0 violations / 363 modules / 963 deps; one-way dependency direction verified (nothing in Competition imports Auction/Money — they do not exist); Playwright 44/44 real Chrome (one pre-existing orgs-axe spec flaked under parallel dev-compile load, passed on retry AND clean in isolation — the documented M-IP2-4 jitter, not a logic defect); e2e-in-CI decision (parked at this gate since IP-0) remains parked with the no-remote risk — CI cannot exist before the repository has a remote (founder tail item) |

**Conditions carried forward (none freeze-blocking):** (1, before-production, carried from IP-2 and now spanning IP-2+IP-3 tables) wire `withTenant()` into the serving path; (2, IP-4 entry requirement) the Auction engine consumes Competition ONLY via `scheduleSnapshot`/approved-registration projections and must add the `AuctionReady` gate before ingesting; (3, advisory) serializable-transaction upgrade for conflict pre-checks if multi-organizer concurrency becomes real; (4, advisory) sweep-line interval index inside the conflict engine beyond ~2k live fixtures per org. All recorded in the closure report §6 and REVIEW_PACKAGE §14.

## IP-2 — Identity & Tenancy · FROZEN 2026-07-14 · tag `ip2-frozen`

Milestone decisions: M-IP2-1 **APPROVED** · M-IP2-2 **APPROVED** · M-IP2-3 **APPROVED** · M-IP2-4 = this freeze.
**Freeze gate (RC-4) CLEARED.** The Blueprint's named exit — an independent security review of the auth/authz surface — is complete. Reviewer: **Fable** (founder-named). First pass returned APPROVE WITH CONDITIONS with two verified defects (RLS write-side self-escalation; OTP attempt-counter race); both were fixed in-milestone (commit `9559d9e`) and **independently re-proven** by the reviewer, who then returned **APPROVE WITH CONDITIONS — zero freeze blockers, `ip2-frozen` cleared to proceed**. Remaining conditions are all before-production / before-GA and recorded (see below + closure §6). Review package: [IP-2_RC4_REVIEW_PACKAGE.md](IP-2_RC4_REVIEW_PACKAGE.md) (v1.1).

| # | Gate | Evidence (2026-07-14, tree at freeze commit) |
|---|---|---|
| 1 | Type safety | `tsc --strict` clean, 7/7 workspaces, zero suppressions in source |
| 2 | Lint | 0 errors 7/7 workspaces |
| 3 | Unit tests | 76 — core **17** (capability engine 8: fail-closed sets, revocation, exact-scope) · contracts 2 · engine 5 · ui 52 (IP-1 suite untouched) |
| 4 | Integration | **29 vs live PG17** — auth 7 · security regression **8** (incl. **concurrency cap proof**) · authz regression **12** incl. **RLS PROOF** (read: cross-tenant 0 rows, no-context 0 rows), **RLS WRITE PROOF** (write: self-escalating grant on a foreign org rejected by `WITH CHECK`, active-tenant grant succeeds), and **AUDIT PROOF** (production grant recipe: UPDATE/DELETE on audit_log → permission denied); migrations 0000–0004 re-applied idempotent |
| 5 | Accessibility | axe **zero violations** on /login + /orgs and all IP-1 suites; keyboard-only login journey; 360px zero-overflow |
| 6 | Performance | First-load JS shared 102 kB; /login 113 · /account 114 · /orgs 113 · /org/[slug] 110 · /join 108 kB; /gallery 113 kB vs 112 kB at IP-1 freeze (<1%, chunk attribution) — **unchanged**; prod server verified serving HSTS/DENY/nosniff |
| 7 | Visual review | Founder approved the FLOODLIGHT identity journeys at M-IP2-1/-2/-3; demo script ready (closure §7) — a live founder demo of already-e2e-proven behavior remains available post-freeze |
| 8 | Founder review | M-IP2-1/2/3 decisions recorded above; the one founder input (name the RC-4 reviewer) satisfied — **Fable**; M-IP2-4 = this record |
| 9 | Documentation | Permanent set shipped: `docs/identity/` (AUTHENTICATION · SESSIONS · PASSKEYS · AUTHORIZATION · THREAT_MODEL · DPDP_DATA_INVENTORY · RUNBOOKS) + RC-4 package + closure report. Deviations recorded: NODE_ENV env-file build defect fixed (D-M4-1); local e2e workers=2 (D-M4-2); person-scoped + `organizations` RLS deliberately absent, justified (D-M4-4); `withTenant()` serving-path wiring = named pre-deploy item (D-M4-5); RC-4 remediation 0004 + atomic OTP (D-M4-6) |
| 10 | Architecture review | Boundaries 0 violations / 325 modules (`db → drizzle+postgres` only, intact); e2e-in-CI decision still parked at the IP-3 gate; **independent review = RC-4 CLEARED (verdict above)** |

**Security sweep (M-IP2-4):** five findings total, all fixed or dispositioned in-milestone, **zero product-code defects left open**. Three from the internal sweep (all test/build infra): production build corrupted by env-file NODE_ENV; e2e flake under parallel dev-server load; audit append-only previously untested (now AUDIT PROOF). Two from the RC-4 independent review (both genuine, both fixed + re-proven): RLS write-side self-escalation (migration 0004 `WITH CHECK`); OTP attempt-counter race (atomic guarded increment). Dev-inbox production exclusion **proven live** (404 on `next start`).

**RC-4 verdict (verbatim, Fable):** "On re-review of commit 9559d9e I independently confirmed that both defects my first pass flagged as blocking are fixed and re-proven, not merely asserted. Migration 0004 adds explicit `WITH CHECK` clauses that constrain every write to the caller's active tenant with no self-row escape; re-running my original exploits under the production non-superuser role recipe, the self-escalation to `org:owner` on a foreign org — which succeeded before — is now rejected by row-level security, while legitimate active-tenant writes and the unchanged read policies still behave correctly. The OTP attempt cap is now an atomic guarded increment that I verified ceilings at five under twelve-way concurrency. The decision to leave `organizations` without RLS is a reasonable, well-documented design choice (org names are deliberately semi-public via invite links; non-disclosure is delivered by the app-layer 404), which I accept for freeze with a membership-gated policy folded into the recorded pre-deploy `withTenant()` wiring. IP-2's identity foundation — fail-closed capabilities, per-capability enforcement on a single audited path, hashed rotating sessions, atomic invites, and now a genuine dual-layer read+write RLS lock — is sound; I approve the freeze with the remaining conditions scoped to before-production, and no blockers outstanding for the `ip2-frozen` tag."

**RC-4 conditions carried forward (none freeze-blocking):** (1, before-production) wire `withTenant()` into the serving path, add a membership-gated `organizations` policy, and reconcile the two pre-tenant reads (invite-by-token, org-preview-before-membership); (2, before production signup) SMS-pumping circuit-breaker before RC-1 opens paid delivery; (3, advisory) wrap `acceptInvite`/`createOrg` in transactions; (4, advisory) `issueGrant` capability-set re-validation. All recorded in the closure report §6 and RC-4 package §5.

## IP-1 — FLOODLIGHT Design System · FROZEN 2026-07-13 · `ui@0.1.0` · tag `ip1-frozen`

Milestone decisions: M-IP1-1 **APPROVED** · M-IP1-2 **APPROVED** · M-IP1-3 **APPROVED** (founder: "premium feel achieved, cohesive, worthy of the brand; mobile consistent") · M-IP1-4 **APPROVED** · M-IP1-5 = this freeze.
**VA-8 rulings (final):** V1 ships silent — ceremony sound is a post-V1 organizer opt-in; Hindi copy register = formal-respectful **आप** (commentary energy lives in the visual ceremony, not the words).

| # | Gate | Evidence (2026-07-13, tree at freeze commit) |
|---|---|---|
| 1 | Type safety | `tsc --strict` clean, 6/6 workspaces, zero suppressions |
| 2 | Lint | 0 errors; token purity additionally enforced by guardrail test (no hex/rgb literal in component source — catches `rgb()` too) |
| 3 | Unit tests | ui **52/52**: keyboard contracts, aria wiring, hold-gate clock semantics, announcer queue, placeholder determinism (64-seed spread), grapheme segmentation, guardrails |
| 4 | Integration | engine suite unaffected/green; ui has no infra to integrate |
| 5 | Accessibility | **axe zero violations, both themes, whole gallery**; contrast MEASURED: daylight text pairs 5.22–17.33:1 (worst `text-on-accent` 5.28), floodlight 5.10–18.08:1; UI tokens ≥3:1; reduced-motion parity incl. **hold-gate full-duration proof under emulated reduced motion**; keyboard journeys (dialog Escape/confirm, tabs arrows, Space-hold) in real Chrome |
| 6 | Performance | `/gallery` first-load JS 112 kB (10.4 kB route); Clash woff2 40 K total, all faces self-hosted, **zero external requests** (tested); animations compositor-only |
| 7 | Visual review | Founder reviewed desktop + phone at M-IP1-1/-3; theme flip live; 360px zero-overflow (tested) |
| 8 | Founder review | All five milestone decisions recorded above |
| 9 | Documentation | doc 08 corrected with measured values (volt-600 2.35:1 finding); doc 09 amended — **WI-7 ruled: Anek Devanagari display companion**; ui README = maintainer contract; deviation recorded: doc 18's Tailwind preset deferred (no Tailwind consumer exists) |
| 10 | Architecture review | ui↛core boundary intact (dep-cruiser 0/226 modules); RTL explicitly out of V1 scope (hi is LTR); e2e-in-CI decision deferred to IP-3 gate as recorded at IP-0 acceptance |

**Freeze meaning:** `@desiauction/ui@0.1.0` public API is stable; regressions are defects, changes need codemods (doc 18). Watch items discharged in-phase: WI-7 (ruled) · WI-2 first checkpoint (founder five-second review passed at M-IP1-1/-3). Carried forward unchanged: WI-1/3/8/9-pilot instruments (IP-8), WI-4/5/6 (IP-5 mock night), WI-10 (IP-5).

## IP-0 — Engineering Foundation · engineering closure 2026-07-13

Status: **ENGINEERING CLOSED** (acceptance GO WITH CONDITIONS, both conditions applied and verified). The freeze tag `ip0-frozen` follows the founder tail: accounts → staging deploys → **gated tracer Run 2 (Fly bom + Neon Mumbai)** → onboarding measured on a clean machine → founder demo. This record is completed (gates 6 and 8 finalized) at freeze.

| # | Gate | Evidence (2026-07-13, tree at closure commit) |
|---|---|---|
| 1 | Type safety | `tsc --strict` clean, 6/6 workspaces, zero suppressions |
| 2 | Lint | 0 errors 6/6 workspaces incl. RC-A2 instrumentation exemption reviewed |
| 3 | Unit tests | core 7 · contracts 2 · engine 5 — green |
| 4 | Integration | 2/2 vs live PG17 (healthz over real connection; ws echo); migrations re-applied clean ("already applied" idempotence proven) |
| 5 | Accessibility | n/a this phase per design §26 (axe harness arrives with IP-1 components) |
| 6 | Performance | Tracer local baseline (Run 1) M1 p99 0.92ms · M2 8ms · M3 4000/4000 p95 4ms; **closure re-run** M1 p99 1.36ms · M2 9ms · M3 4000/4000 p95 6ms — all PASS; **gated Run 2 = freeze requirement** |
| 7 | Visual review | n/a this phase (foundation page only; Playwright renders it 2/2) |
| 8 | Founder review | GO WITH CONDITIONS recorded (IP-0_ACCEPTANCE_REVIEW.md); live demo at freeze |
| 9 | Documentation | IP-0_DESIGN reconciled; deviations recorded (semantic-PR-action for commitlint §20; Playwright port 3100→3050, local port collision) |
| 10 | Architecture review | Boundary audit 0 violations / 98 modules; hard-rules audit clean; independent review not required this phase (IP-2/IP-4 scope per RC-4) |

Conditions: **RC-A1** dependabot.yml (security-only) ✓ applied · **RC-A2** guarded @sentry/nextjs instrumentation ✓ applied (boots clean with no DSN — proven by Playwright run).
