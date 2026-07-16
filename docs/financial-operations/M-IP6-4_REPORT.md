# M-IP6-4 — OPERATIONS & FISCAL CLOSE · MILESTONE REPORT

## DesiAuction NEXT · v1.0 · 2026-07-16 · CTO · **Status: ENGINEERING COMPLETE — IP-6 IMPLEMENTATION COMPLETE — awaiting Founder review and freeze authorization**

Implements [IP-6_ARCHITECTURE](IP-6_ARCHITECTURE.md) §15/§16 (operations,
governance, fiscal close) on the approved [M-IP6-1](M-IP6-1_REPORT.md),
[M-IP6-2](M-IP6-2_REPORT.md) and [M-IP6-3](M-IP6-3_REPORT.md). Every number
below is repository truth measured fresh this cycle against live Postgres 17.

---

## 1 · What was built

**Fiscal close, completed (Seal the Year).** `closePeriod` now composes the
full year-scale evidence package (v2) from EVENT FOLDS at close: the
attestation history digest, per-series document register digests **pinned by
prefix event-count**, the export register digest with per-run pins, the
settlement watermark, quoted delivery telemetry, and the period's own prefix
pin — with a race guard (`period_advanced_retry`) so no seal ever stands on a
stale pin. **`reproduceFiscalEvidence`** re-folds the pinned prefixes and
proves the seal byte-for-byte — for the LATEST close or any historical one:
old seals verify forever, across reopens, even after new documents (the IP-5
closure-evidence guarantee at year scale, exactly as ADR-10 promised). Open /
Close / Reopen map onto the frozen `PeriodOpened`/`PeriodClosed`/
`PeriodReopened` shapes — **zero new event types; the catalog stays closed at
23. Zero schema, zero migrations.**

**The Operations Supervisor** (`superviseOperations`): observations gathered
ONLY from event folds, immutable substrates and port probes — never a mutable
projection trusted on its own (fold-vs-row divergence is itself an
observation) — derived through pure rules into seven components: follower
(including **watermark-corruption detection**: a cursor claiming more history
than exists fails outright), runner, dispatch, exports, documents
(reproduction health), **settlement-sync** (reconciliation supervision: the
org journal folded with the FROZEN `replayJournal` must balance; stale open
payments flag the un-scheduled settlement expiry sweep — read-only, appending
nothing), and fiscal (open exceptions, awaiting-close, evidence
verification). **An unobservable component derives `unknown`, which is never
healthy** — unknown operational state fails closed. The supervisor repairs
nothing; every verdict names the explicit human command.

**The daily checklist, completed**: the foundation's three checks plus five
governance checks (documents-reproducible · exports-verified ·
dispatch-current · settlement-synchronized · fiscal-evidence-reproducible),
each mapped onto the CLOSED exception-kind set; the sentinel still cannot
attest a red day; humans still acknowledge by attesting.

**Certification, derived from replay** (`certifyOperations`): fold every
finops stream TWICE (byte-compared), verify every projection against its
fold, reproduce every document, verify every artifact against its sealed
digest, re-derive every seal ever made, and check settlement's journal
balances — into a **time-free report** whose digest is identical for
identical repository state. The whole derivation runs **twice internally**
and refuses on mismatch (a nondeterministic certification certifies
nothing). Each run leaves an audit breadcrumb (`finops.CertificationDerived`,
eventSeq 0 — the append-only register); a claimed digest that re-derivation
contradicts is a forged certificate, exposed by the register snapshot.

**Runner extension**: `runDailyOps` evaluates the completed checklist;
`runYearEnd` derives the ended year's close readiness and records the verdict
as an audit breadcrumb — still appending **zero events** (sealing remains a
deliberate human command). Compliance evidence generation rides the existing
close/verification paths.

**Ten read models**, all derived, watermarked, disposable:
OperationalChecklistSnapshot, OperationsDashboardSnapshot,
FiscalTimelineSnapshot (the period stream rendered — the ledger pattern),
FiscalCloseSnapshot (close readiness), EvidenceSnapshot (seal + live
reproduction verdict), EvidenceRegisterSnapshot (every seal ever made,
re-verified live), ComplianceSnapshot, ComplianceQueueSnapshot (ranked
attention with resolving actions), CertificationSnapshot (fresh,
double-derived), CertificationRegisterSnapshot (breadcrumb history + forgery
check). 2,144 LOC added (1,034 of it tests).

## 2 · What was verified (all fresh, live PG17)

| Gate | Result |
|---|---|
| TypeScript (`tsc --strict`, forced) · Lint (`--max-warnings 0`) · Prettier | clean · 11/11 workspaces |
| Boundaries (dependency-cruiser) | **0 violations** · 536 modules · 1,917 dependencies |
| **FinOps unit** | **84 tests** (73 prior unchanged + 11 operations) |
| **Governance regression (live PG17)** | **15 tests**, new permanent suite |
| **Full web integration** | **261 passed** (foundation 30 + documents 15 + delivery 17 + governance 15 + frozen 184) — **three consecutive clean runs** |
| Evidence reproduction · Certification reproduction | exercised live: seals reproduce across reopen + new documents; certification digests identical across runs |
| Migration replay (EMPTY DB → 15 migrations) | clean · 42 tables · 35 policies — **no migration in any of M-IP6-2/3/4** |
| Production build | clean; runner binary boot-smoked (starts, ticks, SIGTERM-clean) |
| **Zero-diff vs `ip5-frozen`** | **0 lines** across every frozen tree; all **14 frozen migrations byte-identical** |
| Frozen Settlement/Documents/Dispatch/Exports | settlement boundary meter bit-identical; documents/exporters/pipelines/adapters files untouched this milestone; all 62 prior finops regression tests pass (one test-only drill updated — see decision 5) |

The CTO's mandated attack list, each in the permanent suite: **false health**
(a prettied-up row cannot fake a broken fold — supervisor fails on the
divergence) · **forged evidence** (a tampered evidence ROW halts commands
while the log's seal still reproduces; recovery heals) · **forged
certification** (a planted digest is contradicted by re-derivation) ·
**missing document / missing export** (deleted rows and garbaged artifacts
fail the supervisor; explicit recovery heals) · **runner/follower
interruption** (idempotent re-runs, foundation lease drills still standing) ·
**checkpoint/watermark corruption** (a cursor ahead of its source head fails
the follower component; rewind heals) · **fiscal reopen** (the first seal
verifies FOREVER — after reopen, after new documents, after a re-close; the
register shows every seal verified) · **duplicate certification** (two runs,
identical digests — determinism makes duplication harmless) · **year-end
replay** (twice-run verification appends nothing) · **reconciliation
supervision** (a stale open payment flags the missing settlement sweep at a
future clock; capturing it clears the signal) — and the boundary meter: the
settlement log is bit-identical across all governance operations.

## 3 · Engineering decisions

1. **Everything maps onto the closed catalog** — no `CertificationDerived` or
   `YearEndVerified` event exists: certification and year-end verification
   are DERIVED facts recorded as append-only audit breadcrumbs (eventSeq 0,
   the rewindFollower precedent). The 23-type catalog never grew across four
   milestones.
2. **Evidence pins prefixes, not snapshots**: series/export pins are
   `(streamId, eventCount)` pairs — small, immutable-by-append, and
   sufficient to re-fold the exact registers the seal stood on. Dispatch
   tallies are QUOTED telemetry (transport, not compliance substance),
   marked as such.
3. **Certification is current-state and time-free**: it derives from replay
   NOW (double-derived, refuse-on-mismatch); historical run digests are
   register breadcrumbs whose re-derivability lasts while streams are
   unchanged. The forever-reproducible artifact is the fiscal seal (pinned);
   the certification is the operational now-proof. Stated plainly rather
   than pretended otherwise.
4. **Export health judges the SEALED digest** (the hostile suite exposed
   that regeneration-equality breaks for past exports whenever a lawful new
   document moves the register): artifact-matches-digest is the health and
   certification criterion; regeneration equality remains the heal-window
   fact on `ExportSnapshot`. `regenerateExportArtifact` still refuses to
   whitewash a run whose sources contradict its seal.
5. **One test-only adaptation**: the M-IP6-1 export drill sealed a fictional
   digest with no stored artifact — honest then (no store existed), honestly
   RED under the completed checklist now; the drill stores real bytes as the
   M-IP6-3 pipeline does. No production surface changed.
6. **Reconciliation supervision is read-only by construction**: the frozen
   settlement PURE folds (`replayJournal`, `trialBalance`) run against the
   read-only source port. Executing the settlement sweeps still requires the
   settlement server modules (apps/web — unreachable from the runner by the
   boundary graph), so sweep SCHEDULING remains the named IP-5 pre-deploy
   wiring item; supervision now tells operators loudly when it is missing.

## 4 · Domain decisions

1. **Unknown is never healthy**: an observation that cannot be made derives
   `unknown` and the overall verdict is not healthy — fail-closed health.
2. **The supervisor never repairs**: every verdict names the explicit
   command (`rewindFollower`, `requeueDeadJob`, `regenerateExportArtifact`,
   `recover*`, `attestDay`, `closePeriod`); repair is always a deliberate,
   audited act.
3. **A period opened after its year ended has zero mandatory coverage days**
   (the mid-year/backfill adoption rule, now surfaced by
   `FiscalCloseSnapshot.ready`) — exceptions still gate the seal.
4. **Seals are additive history**: reopen + re-close yields TWO seals, both
   forever-verifiable; the register lists every seal ever made with its live
   verdict.
5. **Health thresholds are deterministic constants** (dispatch backlog 15
   min; schedule overdue 6 h; stale payment 24 h) — supervision is
   reproducible given the same clock, and the clock is always an argument.
6. **Certification pass/fail is absolute**: any unfoldable stream,
   divergence, unreproducible document, unverifiable artifact, unverifiable
   seal or unbalanced journal fails the whole certificate — there is no
   partial credit for financial governance.

## 5 · Remaining risks

1. **Inherited pre-deploy items, unchanged and now supervised**: withTenant
   wiring; writer-role restriction on `finops_events`; settlement sweep
   scheduling (supervision flags its absence via stale payments); provider/
   S3/Razorpay credentials.
2. **Historical certification digests are re-derivable only while streams
   are unchanged** (decision 3) — the register proves tampering of claims,
   not eternal replay of old certificates; eternal proof lives in the fiscal
   seals. A freeze-time ADR should ratify this split explicitly.
3. **Daily verification cost is O(documents + exports) per org per day**
   (full reproduction sweep). Fine at the envelope; sampling tiers are the
   named headroom if an org outgrows it.
4. **Supervisor thresholds are constants, not org policy** — a future
   milestone could move them to the profile if organizers need different
   budgets.
5. **Program hygiene, final call**: all four milestones plus the design doc
   remain uncommitted in one working tree. Freeze REQUIRES a commit and tag
   (`ip6-frozen` must reference something) — this is now blocking, not
   advisory.

## 6 · Founder demonstration

1. `pnpm verify` — all static gates; 84 unit tests.
2. `pnpm --filter @desiauction/web test:integration` — the governance story
   attacks itself: a settled night with documents, a confirmed dispatch and a
   verified export derives HEALTHY on all seven components; a prettied-up
   forged row fails the supervisor instantly; a corrupted cursor fails the
   follower as watermark corruption; a garbaged artifact fails exports and
   heals from sources; a stale open payment flags the missing settlement
   sweep; the ended year opens, its days attest under the full 8-check
   checklist, a red day demands a human, and the year SEALS with pinned
   evidence that reproduces byte-for-byte — then still reproduces after a
   reopen, new documents and a re-close, with every seal in the register
   verified; certification derives twice to identical digests and a planted
   fake digest is exposed; year-end verification replays without appending —
   and settlement ends bit-identical.
3. `node apps/finops-runner/dist/index.mjs` — one process now runs the whole
   operational governance layer.

## 7 · Recommended Founder decision

**APPROVE M-IP6-4 — and with it, IP-6 IMPLEMENTATION IS COMPLETE.**

Four milestones, one closed 23-type catalog, one migration, zero settlement
events ever written, zero frozen lines ever touched. The platform now:
follows settlement, issues reproducible documents, delivers and archives them
over fail-closed ports, attests its days, seals its years with evidence that
proves itself forever, supervises its own health without ever repairing
silently, and certifies the whole edifice from replay.

On approval, authorize the **IP-6 freeze process**: per-milestone commits and
the `ip6-frozen` tag (risk 5 is blocking), the architecture reconciliation
(§29-style: package naming, job substrate, checklist completion, evidence v2,
certification posture), the freeze certification package, and the closure
report. Engineering holds until freeze authorization.

---

*Engineering stops at this artifact. IP-6 implementation is complete; the
freeze has not begun.*
