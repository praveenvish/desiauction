# IP-6 — FINANCIAL OPERATIONS · FREEZE CERTIFICATION

## DesiAuction NEXT · v1.0 · 2026-07-16 · CTO · **Tag:** `ip6-frozen` (v0.6.0) · **Status:** ENGINEERING COMPLETE

This is the release-closeout freeze artifact for IP-6 (Financial Operations).
It records the state certified for freeze after four approved milestones
(Foundation · Documents · Dispatch & Exports · Operations & Fiscal Close) and
a full hostile re-certification — everything re-run fresh against live
Postgres 17, nothing cached, nothing carried forward. Where documentation and
implementation disagreed, implementation won and the documentation was
reconciled ([IP-6_ARCHITECTURE](IP-6_ARCHITECTURE.md) §30).

---

## 1 · Freeze report

IP-6 is **CERTIFIED FOR FREEZE**. The operational-governance platform — five
aggregates behind one writer, a closed 23-type catalog, an idempotent
follower over frozen Settlement, reproducible documents, fail-closed delivery
and exports, prefix-pinned fiscal evidence, derived health and replay-derived
certification — holds under hostile challenge. **Zero freeze-blocking
defects** remain. The frozen platforms (IP-1…IP-5) are provably untouched.

## 2 · Certification summary (hostile suites — 77 permanent regressions, live PG17)

The four suites attack rather than admire. **All guarantees survived; the two
defects the hostile suites surfaced during the phase were fixed and
regression-locked in-milestone** (M-IP6-3: cross-tenant job draining under
differently-configured consumers → org-scoped claim; M-IP6-4: export
regeneration-equality broken by lawful register growth → sealed-digest
verification semantics, ADR-9). No defect was found at freeze re-run.

| Guarantee | Attack | Result |
|---|---|---|
| Event sourcing | reordered · gapped · forged-type · forged-money · number-gapped · duplicate-source · watermark-regressing events | fail closed at the offending seq (19-reason set) |
| Single writer | concurrent duplicate `(stream, seq)` | unique index rejects |
| Idempotency | duplicate commands · replayed policies · replayed provider callbacks | original ack, zero appends |
| Quotation | caller-supplied amounts | inexpressible — no API accepts an amount; quotes read off frozen folds |
| Document integrity | competent forged event (self-consistent numbers) | folds, halts commands, survives recovery — **unmasked by reproduction**; never delivered, poisons no archive |
| Delivery | duplicate/late/out-of-order callbacks · retry storms · provider exhaustion · unknown provider behaviour · unconfigured channels | terminal events or audited retries; exactly-one successful send; dead-letter → gated requeue |
| Exports & artifacts | tampered artifact · deleted artifact · store faults · unreproducible input | sealed-digest detection; regeneration from sources (refusing forged runs); terminal failure naming the offender |
| Fiscal evidence | reopen · new documents · re-close · tampered evidence row · forged close | every seal ever made re-derives byte-identically from its pins; row tamper halts and heals |
| Certification | duplicate runs · planted digest | identical digests (time-free, double-derived); forged claims contradicted by re-derivation |
| Health | prettied-up rows · unobservable components · corrupted cursors | derived from folds/observation; unknown never healthy; watermark corruption fails the follower |
| Recovery | deleted/tampered rows on every projection · unfoldable logs · cursor rewinds · lease-expiry crashes | heal byte-identical from events; unhealable logs refuse (restore is a prefix); rewind rebuilds byte-identical |
| Cross-tenant | blind/foreign reads + foreign writes on all ten org tables (non-superuser role) | zero rows; `WITH CHECK` rejects |
| **The boundary** | every finops operation in every suite | **settlement event count bit-identical** (runtime meter, every run) |

## 3 · Certification gates (fresh, forced, live PG17)

| Gate | Result |
|---|---|
| TypeScript (`tsc --strict`, `--force`) | clean · 11/11 workspaces · zero source suppressions |
| Lint (`--max-warnings 0`, `--force`) · Prettier | clean · 11/11 workspaces |
| Boundaries (dependency-cruiser) | 0 violations · 537 modules · 1,930 dependencies |
| **FinOps unit** | **84** (profile 7 · series 10 · period 10 · dispatch 5 · export-run 4 · documents 15 · exporters 7 · operations 11 · capabilities 4 · follower 6 · runner 5) |
| **FinOps integration (live PG17)** | **77** — foundation 30 · documents 15 · delivery 17 · governance 15 |
| **Full web integration** | **261** (finops 77 + identity/competition/auction/settlement 184) — all suites green together; three consecutive full runs |
| Frozen settlement suite (re-run on the extended tree) | green, unchanged (89 unit + 85 integration within the 261) |
| Migration replay (EMPTY DB → 15 migrations) | 42 tables · 35 RLS policies · clean |
| Production build | clean (web Next ✓ · engine esbuild ✓ · finops-runner esbuild ✓) |
| Runner boot (built binary, live PG) | starts, seeds schedules, ticks, SIGTERM-clean |
| Evidence & certification reproduction | every seal re-derived byte-identically; certification digests identical across runs |

## 4 · Performance summary (fresh `perf:finops`, live PG17)

All values **measured**, median · p95 · worst (ms), 30-payment corpus, 32
streams. No estimates.

| Operation | median | p95 | worst |
|---|---|---|---|
| Follower initial catch-up (32 streams) | 31.05 | — | 31.05 |
| Follower steady-state tick | 1.41 | 1.93 | 1.93 |
| issueReceipt (register 1→30) | 7.62 | 11.00 | 12.12 |
| issueInvoice | 5.78 | — | 5.78 |
| reproduceDocument (@30 docs) | 1.88 | 2.30 | 2.67 |
| Dispatch send (in-app, reproduced body) | 7.14 | 8.53 | 8.53 |
| Export generate (journal-csv @32 docs) | 67.45 | 69.12 | 69.12 |
| attestDay (human) | 5.04 | — | 5.04 |
| closePeriod (seal, evidence v2 @32 docs) | 10.78 | — | 10.78 |
| reproduceFiscalEvidence | 3.58 | 4.28 | 4.28 |
| superviseOperations (7 components) | 382.67 | 403.98 | 403.98 |
| certifyOperations (double-derived replay) | 828.14 | 892.49 | 892.49 |
| Follower full rebuild (rewind → genesis) | 26.89 | 28.11 | 28.11 |

Command-path operations are single-to-low-double-digit ms. The governance
sweeps (supervisor, certification) reproduce every document and double-fold
every stream by design and sit OFF the command path (scheduled/on-demand);
they scale O(documents + streams) — sampling tiers are the named headroom.

## 5 · Engineering metrics

- Permanent hostile regressions: **77 integration + 84 unit**, all green;
  hostile drills as enumerated in §2.
- Event catalog: **23 types, closed** (3 profile · 5 series · 5 dispatch ·
  4 export · 6 period) — **never grew across four milestones**; reducers fail
  closed on the 19-reason set.
- Money: zero calculations anywhere; quotes verbatim from frozen folds;
  the only money-shaped code is digit-manipulation display formatting and
  kernel-delegating recomposition VALIDATION.
- Every projection tamper (all ten tables), artifact tamper, cursor tamper,
  evidence-row tamper and certification forgery: detected fail-closed and
  healed/exposed; 0 false halts across the freeze runs.
- Every fiscal seal reproduces from pinned prefixes across reopens; every
  document reproduces from frozen sources; every export artifact verifies
  against its sealed digest.

## 6 · Repository statistics

| Metric | Value |
|---|---|
| New package | `@desiauction/financial-operations` (pure domain + server tier) |
| Pure domain source (excl. tests) | 4,393 LOC · 12 modules |
| Server tier source | 5,240 LOC · 12 modules (writer · store · follower · pipelines · documents · evidence · governance · snapshots · adapters · runner-core · deps · index) |
| Unit tests | 84 tests · 1,868 LOC |
| Integration regression suites | 77 tests · 3,910 LOC (4 permanent suites) |
| New app | `apps/finops-runner` (103 LOC — a thin loop; every decision is pure) |
| Web glue | 132 LOC (grant actions) — no UI beyond verification surfaces |
| Performance harness | `perf:finops` (513 LOC, self-cleaning) |
| New migrations (forward-only, additive) | **1** — `0014_financial_operations_foundation` (11 tables · 10 RLS policies); M-IP6-2/3/4 shipped **zero** schema changes |
| Total migrations | 15 (0000–0014) · 42 tables · 35 RLS policies |
| Settlement events written by finops, ever | **0** (runtime meter in every suite) |
| Prior freeze tags | `ip1-frozen` … `ip5-frozen` · `va1-rc1` |

## 7 · Zero-diff audit (frozen platforms untouched — exact evidence)

Measured on the freeze tree, 2026-07-16:

- `git diff ip5-frozen --` over `packages/core`, `packages/auction`,
  `packages/settlement`, `packages/ui`, `apps/engine`,
  `apps/web/src/server/{auction,settlement,orgs,auth,competition,registrations}`
  → **0 lines**.
- The **14 frozen migrations** (`0000_identity` … `0013_closure_evidence`),
  each checked individually → **14/14 byte-identical**; the journal change is
  purely additive (entry 14 appended).
- Frozen capability model (`packages/core/src/capabilities.ts`) → 0 lines.
- Frozen settlement catalog (`packages/settlement/src/events.ts`) → 0 lines.
- The complete IP-6 surface: **5 modified files, all additive**
  (dependency-cruiser rules +33 · web package deps/scripts +4/−1 · schema
  append +261 · journal append +7 · lockfile) and **7 new paths**
  (`packages/financial-operations/` · `apps/finops-runner/` ·
  `apps/web/src/server/financial-operations/` · `apps/web/scripts/perf-finops.ts`
  · `packages/db/migrations/0014*` ·
  `docs/financial-operations/`). No existing exported symbol, migration,
  table, policy, event type or capability set changed shape.

## 8 · Remaining operational items (PRE-DEPLOY ONLY — not freeze blockers)

Full detail in [RUNBOOKS](RUNBOOKS.md) §10.

1. **Tenant isolation** — wire `withTenant` + non-BYPASSRLS role (inherited
   IP-2/IP-4 MAJ-2; every finops path is withTenant-compatible).
2. **Writer-role restriction** — `finops_events` writes limited to the finops
   writer role (the engine/settlement precedent).
3. **Settlement sweep scheduling** — settlement server commands, hosted with
   settlement's writer; the finops supervisor flags their absence.
4. **Provider & storage wiring** — delivery adapters (email/SMS/WhatsApp
   BSP), an S3-compatible artifact store, durable storage roots, Razorpay
   production keys (settlement, unchanged).
5. **Deferred by scope order, refused deterministically at runtime** — GST
   decomposition (ADR-6) · the doc-impact attention policy · public `/v1` +
   contracts wire schemas.

## 9 · CTO freeze recommendation

**RECOMMEND FREEZE.** Another engineering organization could operate, extend
around, and audit this platform from the documents alone: every invariant is
machine-enforced, every recovery reproducible, every replay deterministic,
every artifact self-proving, and every claim in this package backed by a
command a reviewer can run ([REVIEW_PACKAGE](REVIEW_PACKAGE.md)). Financial
truth never moved: Settlement remains the only authority on money, and the
meters prove it on every run. On acceptance, tag **`ip6-frozen` (v0.6.0)**.

---

**IP-6 is CERTIFIED FOR FREEZE.** Engineering for IP-6 ends at this artifact.
