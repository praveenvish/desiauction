# 68 — Documentation Standards

> Canon: C-20 · v1.0 · 2026-07-11

## The documentation system

| Kind | Lives | Owner rhythm |
|------|-------|--------------|
| **Product Operating System** (01–70) | `docs/` | Versioned like the constitution it is: changes via PR with rationale; Canon (00) changes require founder sign-off |
| Engineering records (ADRs) | `docs/adr/NNN-*.md` | One per significant decision at implementation time; immutable once accepted (superseded, never edited) |
| Runbooks | `docs/runbooks/` | Drilled or broken (61); every alert links to one (56) |
| Component docs | Storybook (19) | Ship with the component |
| API reference | Generated from contracts (50) | Never hand-written, so never stale |
| Changelog | In-app, generated from GA'd flags (63) | Per release |

## Rules for the Operating System docs

- **One concern per document; cross-reference by number** (as these docs do). Duplication is how contradictions breed — state a rule once, cite it everywhere else.
- Every doc carries its Canon citations and version header; the Canon (00) resolves conflicts (README rule 2).
- Diagrams are generated where possible (state machines from `packages/core` definitions, 39; ER from schema) — hand-drawn diagrams rot silently.
- Specific over general: numbers, names, and rules that can be violated (and therefore enforced). "Should be fast" is not documentation; "LCP < 1.8s on the reference device" is (57).
- Honest gaps: what's deferred, refused, or unknown is written down as such (44 danger zone, 45 future lanes) — an undocumented gap is a future dispute.

## ADR format

`Context → Decision → Consequences → Alternatives considered`, ≤ 1 page, linked from the doc section it affects. The Phase 1 reviews (reviews/) are the first ADR-grade records.

## The docs gate (59 #9)

PRs changing domain behavior cite the doc section implemented, or change the doc in the same PR. CI checks for the citation footer; reviewers check it's *true*. This gate is what makes "docs are the source of truth" an enforced property instead of a poster.

## Writing style

Scorer voice (20) applies to internal docs too: present tense, plain words, no aspiration-speak. A doc that can't be acted on ("we value quality") gets rewritten as rules that can ("axe violations block merge") or deleted.

## Freshness

Every doc reviewed at each phase boundary (README phases); `Last verified` dates on operational docs; a doc contradicted by reality is fixed within the sprint that finds it (67 §1) — staleness is measured from *discovery*, not from writing.
