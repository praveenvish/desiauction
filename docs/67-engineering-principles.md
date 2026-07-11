# 67 — Engineering Principles

> Canon: C-2, C-21 · v1.0 · 2026-07-11

How we build and decide — the culture the architecture (66) assumes.

## 1. Docs lead, code follows (README rule 1)

Behavior changes start in `docs/`; the PR that implements cites the section. When reality teaches us the doc was wrong, the doc changes *first, in the same PR*, with the lesson recorded. Drift between docs and code is a defect with an owner.

## 2. Evidence over confidence

"It works" means: which test, which environment, which browser, at what seq. Claims carry their evidence tier (unit-verified < integration < staging simulation < production observation) — the reference program's certification-ledger discipline, kept because it repeatedly caught "done" that wasn't. A demo on the author's machine is a hypothesis.

## 3. Honest status, always (C-2)

Red is reported as red the moment it's known. Skipped steps are stated as skipped. "Zero silent failures" applies to the team as much as the system: burying a known issue outranks — as an offense — having caused it.

## 4. Consume before invent (19's law, generalized)

Foundation first: tokens, components, core functions, existing patterns. Inventing a parallel mechanism because finding the existing one was inconvenient is the primary entropy source in product codebases; reviewers are charged with catching it.

## 5. Delete the problem before managing it

The single-writer decision (66 §2) is the template: prefer designs where the failure mode is unrepresentable over designs with excellent handling of a representable failure. Applies at every scale — schema constraints over validation-and-hope (52), INSERT-only over audit-the-updates, machines over boolean soup (39).

## 6. Small, reversible, frequent

Small PRs (64), flags over branches (63), rollback-tested releases (60). The unit of progress is a safely shippable increment; anything that can't roll back gets extraordinary review by definition.

## 7. The night is the deadline that matters

Auction nights are immovable; roadmaps are not. Season-aware pacing (63), freeze windows (60), and the standing rule: **we do not ship risk into someone's big night to hit our internal date** (C-22 as culture).

## 8. Complexity is spent, like gold (03 §4 for engineers)

Every abstraction, dependency, and service must pay rent in problems actually had. The innovation budget goes to the engine (66 §5); everywhere else, the boring choice wins ties, and "we might need it" loses to "we'll design the seam" (54, 52 partitioning posture).

## 9. Operate what you build

The team that ships the engine carries its pager, writes its runbooks (61), and drills them. Operational pain is design feedback with perfect fidelity — outsourcing it breaks the loop that makes §10 possible.

## 10. Craft is the brand

The five-second premium test (01) applies to code, PRs, and docs: named like the glossary, shaped like the idiom, finished like it will be read — because it will. A product about trust cannot be built carelessly; users can't see the code, but they can feel it.
