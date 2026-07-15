# IP-5 — SETTLEMENT · FREEZE CERTIFICATION

## DesiAuction NEXT · v1.0 · 2026-07-15 · CTO · **Tag:** `ip5-frozen` · **Status:** ENGINEERING COMPLETE

This is the release-closeout freeze artifact for IP-5 (Settlement). It records
the state certified for freeze after the four milestones (Foundation,
Collections, Closure & Ceremony) and an independent hostile certification pass —
all re-run fresh against live Postgres 17, nothing cached.

Every number here is repository truth measured this cycle, not a claim carried
forward. Where documentation and implementation disagreed, implementation won and
the documentation was reconciled ([IP-5_ARCHITECTURE](IP-5_ARCHITECTURE.md) §29).

---

## 1 · Freeze report

IP-5 is **CERTIFIED FOR FREEZE**. The event-sourced settlement platform — three
aggregates, one writer, append-only streams, double-entry journal, derived
wallets, verified closure with reproducible evidence, fail-closed watchdog and
byte-identical recovery — holds under hostile challenge. Every guarantee the
platform claims survived attack; **zero freeze-blocking defects** remain. The
frozen platforms (IP-1…IP-4) are provably untouched.

## 2 · Certification summary (hostile suite — `settlement-certification.regression`, live PG17)

The suite attacks rather than admires. **All 18 guarantees survived; evidence
recorded, no repairs required.**

| Guarantee | Attack | Result |
|---|---|---|
| Event sourcing | reordered stream | `sequence_gap`, refused |
| Event sourcing | deleted (gapped) stream | refused |
| Single writer | concurrent duplicate `(stream, seq)` | unique index rejects; duplicate never lands |
| Catalog closure | forged event type in the log | `unknown_event_type` |
| Journal integrity | trial balance at every seq | zero, org-wide |
| Money conservation | recognised == collected + waived + outstanding | holds; outstanding 0, liability 0 |
| Money invariants | forged float/negative money | `malformed_posting` |
| One cause one posting | duplicate posting source | `duplicate_posting_source` |
| Projection integrity | tamper journal leg / payment / closure evidence | halt + heal byte-identical |
| Recovery discipline | unfoldable log | refuses to heal (restore path) |
| Replay identity | fold every stream twice | byte-identical |
| Rebuild identity | destroy every projection, recover | byte-identical |
| Evidence reproducibility | reproduce across a reopen + re-close | first evidence still reproduces from pinned prefixes |
| Idempotency | duplicate command / manual capture | deterministic no-op |
| Audit completeness | every event, all three streams | audit row with evidence seq |
| Cross-tenant isolation | 7 tables, non-superuser probe | zero rows blind + foreign; foreign write rejected |

## 3 · Certification gates (fresh, forced, live PG17)

| Gate | Result |
|---|---|
| TypeScript (`tsc --strict`, `--force`) | clean · 9/9 workspaces · zero source suppressions |
| Lint (`--max-warnings 0`, `--force`) | 0 errors · 9/9 workspaces |
| Boundaries (dependency-cruiser) | 0 violations · 478 modules · 1380 dependencies |
| Format (prettier) | clean |
| **Settlement unit** | **89** (case 19 · journal 15 · closure 13 · payment 11 · intake 10 · checkpoint 6 · collections 10 · capabilities 5) |
| **Integration (live PG17)** | **85** settlement — foundation 29 · collections 16 · closure 13 · certification 18 · adapters 9 |
| **Full web integration** | **184** (settlement 85 + identity/competition/auction 99) — all suites green together |
| Migration replay (empty DB → 14 migrations) | 31 tables · 25 RLS policies · applied cleanly |
| Production build | clean (web Next `✓ Compiled` + engine esbuild bundle) |
| Frozen auction suite (re-run on extended schema) | green, unchanged |

## 4 · Performance summary (fresh `perf:collections` / `perf:closure`, live PG17)

All values **measured**, median · p95 · worst (ms). No estimates.

| Operation | median | p95 | worst |
|---|---|---|---|
| Payment creation (manual initiate) | 2.31 | 3.13 | 4.58 |
| Collection / journal posting (capture + discharge) | 9.26 | 11.29 | 11.59 |
| Webhook processing (capture ingress, HMAC + pin) | 10.66 | 13.35 | 15.44 |
| Verification (readyForClosure) | 1.57 | 1.95 | 2.13 |
| Closure (verify + seal evidence) | 7.08 | — | 7.08 |
| Re-open (override) | 3.38 | 3.88 | 4.20 |
| Re-close (verify + seal) | 4.72 | 7.22 | 8.09 |
| Journal fold / replay (genesis @121 events) | 0.45 | 0.47 | 0.48 |
| Wallet rebuild (fold + summary) | 1.43 | 2.24 | 2.63 |
| Ceremony projection | 1.37 | 1.97 | 3.39 |
| Timeline rebuild | 0.73 | 1.08 | 1.49 |
| Evidence reproduction (replay) | 2.44 | 2.93 | 4.30 |
| Projection rebuild + recovery (case) | 4.59 | 5.15 | 6.92 |
| Projection rebuild + recovery (whole org, ~120 events) | 214.55 | 228.37 | 228.37 |

Command-path operations are single-digit ms; the org-wide genesis recovery
(off the command path) is the only 100ms-class path, bounded by event count.

## 5 · Engineering metrics

- Certification guarantees challenged: **18** · survived: **18** · repairs
  required: **0** · freeze-blocking defects: **0**.
- Event catalog: **24 types, closed** (13 case · 4 journal · 7 payment); reducers
  fail closed on the full 19-reason set.
- Money: float / negative / NaN / overflow / off-template / unbalanced /
  duplicate-source / over-discharge / over-refund all fail closed at the log.
- Trial balance zero at every journal seq; money conservation
  (recognised == collected + waived + outstanding) proven.
- Every projection tamper (leg, posting, obligation, payment, checkpoint,
  closure evidence, deleted row) detected fail-closed and healed byte-identical;
  0 false halts across the certified runs.
- Closure evidence reproduces from pinned prefixes **even across reopen** — an
  old closure's proof is valid forever.

## 6 · Repository statistics

| Metric | Value |
|---|---|
| New package | `@desiauction/settlement` (pure domain) |
| Settlement domain source (pkg, excl. tests) | 4,689 LOC · 8 modules |
| Settlement server source (web, excl. tests) | 3,037 LOC · adapters + writer + store + recovery + ceremony + webhook + authz + deps |
| Settlement unit tests | 89 tests · 2,403 LOC |
| Settlement integration tests | 85 tests · 3,089 LOC (regression) + adapters |
| New migrations (forward-only, additive) | 3 — `0011_settlement_foundation` · `0012_collections_payments` · `0013_closure_evidence` |
| Total migrations | 14 (0000–0013) |
| New RLS policies | 7 (one per settlement table) |
| Settlement documents | ARCHITECTURE · EVENT_CATALOG · SECURITY · RUNBOOKS · ADRS · IP-5_FREEZE |
| Prior freeze tags | `ip1-frozen` · `ip2-frozen` · `ip3-frozen` · `ip4-frozen` · `va1-rc1` |

## 7 · Remaining operational items (PRE-DEPLOY ONLY — not freeze blockers)

Full detail in [RUNBOOKS](RUNBOOKS.md) §6.

1. **Tenant isolation** — wire `withTenant` into the settlement serving path and
   deploy under a non-BYPASSRLS role (inherited IP-2/IP-4 MAJ-2). Writer is
   already withTenant-compatible; RLS proven under a non-superuser role.
2. **Writer-role restriction** — restrict `settlement_events` write access to the
   settlement writer role before production (the auction-engine-role precedent).
3. **Sweeps** — schedule `expirePayment` and the daily provider reconciliation
   sweep. Commands and the `fetchPayment` port exist; scheduling is ops wiring.
4. **Razorpay credentials** — wire production keys/webhook-secret into
   `settlementDeps({ gateways })` and register the webhook endpoint. Adapter is
   complete and HMAC-tested.

## 8 · Zero-diff audit (frozen platforms untouched)

`git diff ip4-frozen` over the frozen surfaces is **empty**:

- **IP-1/2/3/4 code** — `packages/core`, `packages/auction`, `packages/ui`,
  `apps/engine`, `apps/web/src/server/{auction,orgs,auth,competition}`: no change.
- **Frozen migrations 0000–0010**: byte-identical (each verified individually).
- **Frozen capability model** (`packages/core/src/capabilities.ts`): no change.
- **Frozen auction event catalog** (`packages/core/src/auction.ts`): unchanged.
- **M-IP5-1/2 migrations 0011/0012**: byte-unchanged by M-IP5-3/4.

IP-5 is purely additive: a new package, three additive migrations, new server
modules, new docs. No existing exported symbol, migration, table, policy, event
type, or capability set changed shape. No backwards incompatibility.

## 9 · Operational readiness (fresh, no cached evidence)

Migration replay from an **empty** database → 14 migrations, 31 tables, 25 RLS
policies, clean. Projection rebuild and cold recovery → byte-identical
(certified). Fresh production build → clean. Dependency + boundary audit → 0
violations. Format / typecheck / lint → clean, forced (uncached).

## 10 · CTO freeze recommendation

**RECOMMEND FREEZE.**

The platform earns the claim the directive demanded: another engineering
organization could build IP-6 (money, notifications, exports) on top of this
without modifying a single settlement rule — they read the settlement read
models, the journal, and the payment port; they never write settlement events,
never add a second source of truth for money, and never require a settlement
rule change. Every invariant is machine-enforced, every recovery is
reproducible, every replay is deterministic, and every claim in this package is
backed by a command a reviewer can run.

The hostile certification found **no defect** — not because the platform was
admired, but because it was attacked (18 adversarial challenges across event
sourcing, money, journals, wallets, recovery, security, tenancy, ordering,
projection integrity, and evidence). The remaining items are **pre-deploy
operational wiring**, each named with its owner and none requiring a code change
to a settlement rule — which is precisely the property a freeze needs.

**Freeze conditions carried forward (operational, not blocking):** the four
items in §7. On acceptance, tag `ip5-frozen`.

---

**IP-5 is CERTIFIED FOR FREEZE.** Engineering for IP-5 ends at this artifact.
