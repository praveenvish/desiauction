# DesiAuction NEXT

**The trusted operating system for community sports auctions.**

This repository is a greenfield enterprise rebuild. It is not a refactor, not a migration, and not a redesign of the previous implementation. The previous repository serves exactly one purpose: behavioural documentation — business rules, workflows, edge cases, and acceptance criteria. Nothing else crosses over. No code, no architecture, no folder structure, no visual language.

## Status

**Phase 1 — Product Operating System (documentation).** No production code exists yet, by design.

> Code follows documentation. Never the reverse.

## How this repository works

- [`docs/00-index.md`](docs/00-index.md) is the entry point. It holds the **Canon** — the ~two dozen ratified decisions every other document must agree with — and the reading order.
- Documents `01`–`70` form the complete Product Operating System: product, design, UX patterns, domain, platform, and engineering.
- [`docs/reviews/`](docs/reviews/) holds the Phase 1 gate reviews (product, UX, architecture, CTO). Phase 2 (implementation planning) begins only after every review passes and the founder approves.

## Rules of the repository

1. **Docs are the source of truth.** A PR that makes code disagree with a doc must change the doc first, in the same PR, with the reasoning.
2. **The Canon wins conflicts.** If two documents disagree, the one consistent with `00-index.md` Canon is correct; fix the other.
3. **The 35 invariants** ([`docs/40-business-rules.md`](docs/40-business-rules.md)) are constitutional. No feature ships that violates one; violating states should be unrepresentable, not merely forbidden.
4. **The old repository is read-only reference.** Cite it as behaviour ("the reference implementation does X"), never as justification for an architecture or design decision.

## The five-second test

When a user opens this product, their first reaction within five seconds must be: _"This feels like an exceptional premium product."_ Every decision in `docs/` is downstream of that sentence and of one organizer saying: _"For the first time, I actually enjoyed running my own auction."_
