# M-IP6-1 — FINANCIAL OPERATIONS FOUNDATION · MILESTONE REPORT

## DesiAuction NEXT · v1.0 · 2026-07-15 · CTO · **Status: ENGINEERING COMPLETE — awaiting Founder review**

Implements [IP-6_ARCHITECTURE](IP-6_ARCHITECTURE.md) §5–§9, §12–§15, §17–§22
(foundation scope). Every number below is repository truth measured fresh this
cycle against live Postgres 17 — nothing cached, nothing estimated.

---

## 1 · What was built

**The five aggregates** (`packages/financial-operations`, pure domain — 3,167
LOC, zero IO/clock/randomness): TaxProfile · DocumentSeries · Dispatch ·
ExportRun · FiscalPeriod. Each owns one stream, one pure reducer, one
projection authority, immutable events, machine descriptors, and fails closed
on the full 19-reason set (`sequence_gap` … `watermark_regression`). **No
aggregate calculates money** — the only money-shaped code is quotation
*validation* (kernel-delegating recomposition checks); no command produces a
money figure in this milestone.

**The closed 23-type event catalog**, exactly as ratified (3 profile + 5
series + 5 dispatch + 4 export + 6 period). No additions, no removals, no
renames. `DocumentIssued`/`CorrectionIssued` fold completely but ship **no
command surface** (documents are M-IP6-2 — the frozen settlement ADR-3
discipline applied deliberately).

**The FinOps Writer** — single mutation authority, one pipeline for every
command: capability (re-checked in execution) → idempotency (duplicate
commandId ⇒ original ack) → fold → **verify every projection row against the
fold** (divergence ⇒ `finops_halted`) → pure decide → one transaction: append +
one audit row per event + projection rebuild FROM the fold ("publish" =
same-transaction, zero-lag). Shared by `apps/web` and `apps/finops-runner`
via the package's `server/` subtree — one writer, two processes, races made
loud by the unique `(stream_type, stream_id, seq)`.

**The Follower** (ADR-3) — per-org cursors over the READ-ONLY settlement
streams: dense consumption (a gap ⇒ wait, never skip), watermarks on every
surface, idempotent by construction — **rewind to zero rebuilds
byte-identical** (certified). The source port has no write operation; the
follower cannot express a settlement mutation.

**The Runner** (`apps/finops-runner`, ADR-4) — the platform's one home for
scheduled work: IST-pinned slots (daily-ops 01:30, year-end Apr 1 02:00),
derived job keys (same occasion ⇒ one job, by schema), lease-based claiming
(SKIP LOCKED), deterministic exponential backoff, dead letters that become red
checks on the day. The **daily reconciliation trigger** runs the follower,
evaluates the foundation checklist (follower-current ·
finops-aggregates-healthy · runner-queue-healthy), system-attests green days
and notes exceptions on red ones; a red or burdened day can only be attested
by a HUMAN — **replay-enforced**, not merely command-checked. The **year-end
trigger** fires per org per ended FY and appends nothing (pending close is a
computed fact).

**Four read models**, all disposable and rebuildable: OperationalSnapshot,
WatermarkSnapshot, RunnerHealthSnapshot, FollowerHealthSnapshot.

**Substrate**: migration `0014_financial_operations_foundation` (11 tables;
RLS `ENABLE`+`FORCE`, `USING`+`WITH CHECK`, fail-closed, on all 10 org-scoped
tables from birth); the finops capability module (third partition:
`finops:clerk`/`accountant`/`controller`) with grant actions gated by the
frozen `grant.issue`/`grant.revoke` (IP-6's one sanctioned cross-context
write); dependency-cruiser rules encoding the boundary graph.

## 2 · What was verified (all fresh, live PG17)

| Gate | Result |
|---|---|
| TypeScript (`tsc --strict`, forced) | clean · 11/11 workspaces · zero suppressions |
| Lint (`--max-warnings 0`, forced) | 0 errors · 11/11 workspaces |
| Prettier | clean |
| Boundaries (dependency-cruiser, incl. 4 new IP-6 rules) | **0 violations** · 522 modules · 1,781 dependencies |
| **FinOps unit** | **51 tests** (profile 7 · series 9 · dispatch 5 · export 4 · period 10 · capabilities 4 · follower/watermark 6 · runner 6) |
| **FinOps integration (live PG17)** | **30 tests** — follower 4 · writer/profile 5 · series 3 · dispatch 2 · export 1 · period+daily-ops 5 · runner 3 · authorization+RLS 3 · audit/determinism/boundary 3, plus catalog disjointness |
| **Full web integration** | **214 passed** (identity/competition/auction/settlement 184 + finops 30) — the frozen suites green on the extended schema |
| All package unit suites (serial, forced) | 6/6 green (incl. frozen settlement 89) |
| Migration replay (EMPTY DB → 15 migrations) | clean · 42 tables · 35 RLS policies |
| Production build | clean (web Next ✓ · engine esbuild ✓ · **finops-runner esbuild ✓**, boot-smoked against live PG: starts, ticks, SIGTERM-clean) |
| **Zero-diff vs `ip5-frozen`** | **0 lines** across every frozen tree (`packages/core·auction·settlement·ui`, `apps/engine`, `apps/web/src/server/{auction,settlement,orgs,auth,competition}`); all **14 frozen migrations byte-identical**; journal purely additive |

The regression suites attack, not admire: reordered/gapped/forged-type/
malformed events → fail closed at the offending seq · number gaps and
duplicate document sources unfoldable · watermark regressions unfoldable ·
sentinel attestation of red/burdened days unfoldable · duplicate commands ⇒
original acks, zero appends · projection tampers (profile, series, period,
deleted rows) ⇒ halt ⇒ heal **byte-identical** · forged log ⇒ unhealable,
restore path exercised · cursor rewind ⇒ byte-identical rebuild · runner
retry→dead-letter with exact deterministic backoff instants · crash = lease
timeout (untouchable until lapse, then recovered idempotently) · re-fired
schedules absorb by derived key · three-way capability partition (six
directions) · RLS blind/foreign/write probes on **all ten** org tables under
a non-superuser role · and the boundary meter: **the settlement event count
is bit-identical before and after everything this suite does.**

## 3 · Engineering decisions

1. **Package name and writer home.** The authorization names
   `packages/financial-operations` (the architecture draft said
   `packages/finops`) — the authorization governs. The writer, store, follower
   and runner-core live in the package's `server/` subtree so **one** writer
   serves both processes; only `src/server` may import `@desiauction/db`
   (dependency-cruiser rule `finops-domain-is-pure`). The alternative —
   duplicating the mutation authority per app — was rejected as
   constitutionally worse. Architecture doc to be reconciled at freeze (the
   IP-5 §29 rule).
2. **In-house job substrate instead of pg-boss** (deviation from doc 53's
   named library, recorded deliberately): `finops_jobs` + `finops_schedules`
   with lease-based SKIP-LOCKED claiming and **pure** retry/due decisions.
   Reasons: certifiable determinism (injected clock, exact backoff instants
   asserted in tests), zero new runtime dependency, RLS discipline and the
   empty-DB migration-replay gate (pg-boss self-manages a schema outside the
   journal). Doc 53's constitutional core — Postgres-backed, transactional
   enqueue, never on the money path — is fully preserved; a pg-boss backend
   remains a non-breaking store swap if a later phase wants it.
3. **ULID stream ids** (`series:{seriesId}`, `period:{periodId}`) with
   projection-level unique keys (`org·kind·fy`, `org·fy`) instead of the
   architecture's composite stream-id notation — representation refinement;
   the one-lane/one-period-per-key law is schema-enforced either way.
4. **`finops_schedules` is the one table without RLS** — it holds platform
   slot names and epoch instants, zero tenant rows (documented in the
   migration).
5. Runner logging via pino (doc 55); `ulidx` declared as a direct runner
   dependency (esbuild external under pnpm's strict layout).

## 4 · Domain decisions

1. **Acknowledgment is deterministic and replay-enforced**: an exception is
   open until a HUMAN attestation of its day lands at a later seq; the system
   sentinel can never attest a red or burdened day — a forged sentinel
   attestation *does not fold*.
2. **Mid-year adoption is sealable**: close coverage runs from
   max(FY start, period-opening day) to FY end (`openedDate` derives from the
   recorded event clock — deterministic), and a year can only be sealed after
   it has fully elapsed (`fiscal_year_not_ended`).
3. **Dense numbering is structural twice over**: the document number must
   equal issue-order in the fold (`number_gap` unfoldable) AND
   `(series, number)` is unique in the schema.
4. **One settlement cause, one document per series**
   (`duplicate_document_source` + partial unique index on `sourceRef`).
5. **Watermark monotonicity is law** (`watermark_regression`): no document or
   attestation may stand on less settlement history than its predecessor.
6. **The tax block validates, never calculates**: a quoted decomposition that
   does not recompose exactly is unfoldable (`decomposition_mismatch`), and no
   M-IP6-1 command emits one — GST computation remains out of scope as
   ordered; the reducer branch only guards the catalog's integrity.
7. **Statutory lanes never interleave**: corrections issue only in
   correction-kind series; documents only in receipt/tax-invoice series.
8. **The year-end trigger appends nothing**: "period awaiting close" is a
   computed fact on the OperationalSnapshot — the platform never invents an
   event for a state a fold already answers.
9. **Terminal means terminal** on Dispatch and ExportRun: retry is a NEW
   aggregate; nothing sent is ever unsent (invariant 30).

## 5 · Remaining risks

1. **Inherited, unchanged**: runtime tenant isolation is application-layer
   (`withTenant` call sites = 0 — IP-2/IP-4 MAJ-2, IP-5-confirmed). Every
   finops path (writer, follower, runner, snapshots) is withTenant-compatible
   and nothing depends on BYPASSRLS; the one pre-deploy wiring item covers
   finops with zero rework. **New sibling pre-deploy item**: restrict
   `finops_events` writes to the finops writer role (the settlement/auction
   role precedent).
2. **Human `requestDispatch`/`requestExport` retries with a fresh commandId
   can create a second aggregate** (ids mint at the edge; idempotency is
   per-stream). Deterministic derived-id policies make the production paths
   single-shot in M-IP6-2/3; until then no provider adapters exist, so a
   duplicate is a visible row, never a duplicate send. Named, accepted.
3. **The follower is poll-based** (polling IS the truth mechanism per ADR-3);
   LISTEN/NOTIFY acceleration is future pure optimization. Lag honesty is
   enforced by the checklist, not assumed.
4. **The runner iterates all orgs per tick** — ample now; per-org sharding is
   the named non-breaking headroom (the ADR-8/R-2 pattern).
5. **Foundation checklist is deliberately partial**: settlement
   sweep/verification checks join in M-IP6-4 as ratified; until then a "green
   day" attests foundation health only (the checklist vocabulary is already
   the closed §8.5 set).
6. **Observation, not a defect**: the frozen settlement journal-envelope perf
   assertion (<1 s @ 100k legs) is CPU-contention-sensitive when every
   package suite runs in parallel; it passes serially (515 ms) and the frozen
   code is untouched (zero-diff). Worth pinning test concurrency in CI.

## 6 · Founder demonstration

From a clean checkout with Docker Postgres up:

1. `pnpm verify` — typecheck, lint, unit (incl. 51 finops), format, 0 boundary
   violations.
2. `pnpm --filter @desiauction/web test:integration` — watch the story run:
   a REAL auction night conducted through the frozen IP-4 aggregate, settled
   through the frozen IP-5 writer; the follower consumes it and reports
   current; a rewind rebuilds byte-identical watermarks; a profile declares,
   duplicates bounce, a tampered row halts and heals byte-identical, a forged
   event refuses to fold and recovery refuses to heal it; a green day
   self-attests, a red day demands a human, the year seals with evidence,
   reopens compensating, re-seals; retries back off to a dead letter that
   turns the ops board red; a crash is a lease timeout; cross-tenant probes
   see zero rows on all ten tables — and the final assertion: **settlement's
   event count did not move.**
3. `pnpm --filter @desiauction/finops-runner build && node apps/finops-runner/dist/index.mjs`
   — the platform's third process boots, seeds its schedule slots, ticks, and
   dies cleanly on SIGTERM.

## 7 · Recommended Founder decision

**APPROVE M-IP6-1.** The operational substrate every later Financial
Operations capability consumes is standing and certified: five fail-closed
aggregates behind one writer, a follower that can be rewound with zero loss, a
runner whose crashes are timeouts, read models that rebuild from nothing but
logs — and zero financial truth introduced anywhere. Settlement remains the
only authority on money, provably untouched (zero-diff, byte-identical frozen
migrations, and a runtime boundary meter in the permanent regression suite).

On approval, authorize **M-IP6-2 — Documents** (receipts, tax invoices,
corrections, the register, owner access) per the ratified roadmap.

---

*Engineering stops at this artifact. No M-IP6-2 work has begun.*
