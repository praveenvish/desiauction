# Architecture Review — Phase 1 Gate

> Reviewer role: principal architect · Scope: docs 36–66 against 00 Canon · 2026-07-11

## Method

Every architectural claim traced to (a) a product requirement it serves, (b) its enforcement mechanism, (c) its failure story. Special scrutiny on the two deliberate risks: the stateful engine and event sourcing.

## Findings

### F-A1 · The stateful engine is justified, but its operational cost must be priced in — **Resolved**
The single-writer engine (66 §2) deletes the reference's lock/timer/watchdog complexity and is the foundation of seq, replay, and invariant 12. Cost: we now operate a stateful service (deploy drains, cells, restarts) that serverless outsourced. Verdict: the trade is right *because* the docs price it honestly — 60 (drain/handoff), 61 (replay drills), 53 (watchdog retained). Condition carried to Phase 2: the engine recovery drill (kill mid-lot) must be demonstrated before any real tournament runs, and its < 10s budget (57) verified.

### F-A2 · Event-sourcing scope creep risk — **Resolved by boundary**
ES is confined to the auction domain (C-9); the rest is conventional relational CRUD (52). The docs consistently resist "event-source everything" (38, 52). No contradiction found. Guard: 66 §5 (one interesting component) is the standing defense; reviewers should cite it against future creep.

### F-A3 · Dual API planes (tRPC + REST) could drift — **Resolved by construction**
50's rule that both planes are thin adapters over `packages/core` commands/queries makes drift structurally unlikely; contracts generate OpenAPI from the same zod source. Accepted with the note that the docs-gate (59 #9) must apply to contract changes with extra force.

### F-A4 · Projection consistency claim needs precision — **Resolved (spec tightened)**
51 claims "projection lag is zero within an auction" — this holds because projections update transactionally with the append (52), which is feasible at auction write rates (52 sizing: ~2k bids/night). Confirmed as written; flagged for load-test verification (58 chaos suite) since transactional projections trade write latency for read consistency. The 20ms append budget (57) is the tripwire.

### F-A5 · RLS + application checks double-enforcement — **Consistent, keep both**
49 and 52 both claim tenancy enforcement; verified they describe *layers* (app policy primary, RLS defense-in-depth), not duplication. Integration tests must attack with app checks removed (58) — present. Pass.

### F-A6 · Minor: engine-served WebSockets vs Vercel-hosted web — cross-origin/session detail unspecified — **Deferred to Phase 2 design**
Auth handshake between web session and engine WS (token exchange, origin policy) is not yet specified. Not a Phase 1 contradiction; recorded as the first ADR required in Phase 2 (68). Owner: engine lead.

### F-A7 · Provider choices marked "candidate" (Neon, Fly) — **Correct posture**
52/60 deliberately defer final vendor picks to Phase 2 with exit-cost analysis. This is right for a docs phase; no doc treats a candidate as a commitment.

## Contradiction sweep

Canon cross-check: all 24 Canon IDs consumed; no doc contradicts C-1..C-24. Invariant citations: all ≤ 35, spot-checked 14 citations to correct numbers. Numbers coherent: bid ack (56 SLO 400ms client / 57 20ms server), SOLD→Stage < 1s (56, 11, GJ-5), timer defaults (41 = reference behaviour). One wording gap fixed pre-review (36's "bid traces to grant" cites invariant support loosely — the trace requirement is enforced via 41 gauntlet #2 and the ledger actor envelope; acceptable).

## Verdict

**PASS**, with two carried conditions: (1) F-A1 recovery-drill evidence before first real tournament; (2) F-A6 ADR on WS auth handshake as the first Phase 2 architecture task.
