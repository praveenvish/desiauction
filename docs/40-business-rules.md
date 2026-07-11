# 40 — Business Rules: The 35 Invariants

> Canon: C-20 · v1.0 · 2026-07-11

The product's constitution, carried from the reference implementation's ratified rules (behaviour, not architecture). **What must never happen.** Violating states are made *unrepresentable* wherever possible — in schema, machine, or engine — not merely forbidden by policy. Every invariant maps to at least one automated test (70).

## Identity & tenancy

1. No object exists outside exactly one Organization; nothing reads or writes across tenants except the audited platform support surface (37).
2. An Organization can never have zero owners.
3. A player identity (Person) is never duplicated per tournament; participation records are, identities are not (38).
4. A Person's erasure destroys identity, never facts — money records survive pseudonymized (49 DPDP).

## People & dignity

5. A Registration is never approved without a human gate — no auto-approval, no AI approval (C-10).
6. A rejection never occurs without a recorded reason; no rejection reason is ever publicly visible.
7. No public "unsold players" listing exists; UNSOLD is a neutral fact rendered with dignity rules (C-23).
8. Contact details and payment states of people are never public, on any surface, under any setting.

## Auction & money

9. Every money/time mutation flows through the Engine; no workspace, admin tool, or support path writes auction money directly.
10. A Bid, once recorded, is never edited or deleted — by anyone, including the platform.
11. A Purchase must reference an accepted Bid or an explicit pre-assignment; squads and spend are derived from Purchases, never edited directly.
12. No surface may show a money value that differs from another surface's at the same event-sequence point (one truth, five surfaces, C-3).
13. No celebration before commitment: SOLD renders only after the Purchase is durably recorded.
14. The timer never shrinks from anti-snipe; timer truth is server-side only.
15. An auction never goes LIVE without: active Pass, locked rules, locked pool, ≥2 teams with accepted owners.
16. Post-lock changes to rules/pool/purses occur only via audited override; there is no quiet edit path.
17. A money operation that cannot resolve deterministically freezes for a human; the system never guesses about money.
18. An Owner never owns two teams in one tournament.
19. The auction as a whole never hard-blocks on a non-spine failure (uploads, analytics, comms may die; bidding may not).

## Competition (H2, binding when it ships)

20. A Match cannot exist without its Fixture; a Result cannot exist without its Match.
21. Standings are never hand-edited; corrections flow through Results, visibly versioned.
22. A ground is never double-booked; conflicts block publication rather than warn-and-pass.
23. Points/tiebreak rules never change silently after first confirmation — recomputation is announced and versioned.

## Commercial

24. No undocumented money: every platform charge and registration fee has an immutable Invoice/record.
25. Payment state derives from provider truth; manual overrides are flagged on the document forever.
26. Entitlement loss never destroys data — capabilities lock, records remain readable and exportable (no ransom, C-11).
27. Pricing is public; no grassroots buyer ever meets a "contact sales" wall for standard passes.

## Trust & data

28. Every gate, override, grant change, token use, export, and break-glass writes an Audit entry — and privileged actions fail if the audit write fails.
29. Activity, History, and Audit never disagree — they project one event stream (C-9).
30. Nothing sent (communications) is ever unsent or edited; corrections are new messages.
31. No dark patterns: no manufactured urgency, no fake scarcity, no engagement traps — structurally excluded from templates and timers, not just discouraged.
32. AI never bids, prices, verdicts a lot, or decides on a person; AI output is never rendered as engine truth (C-10).
33. Every list shown is exportable; every export is audited; exported artifacts carry provenance.
34. A Task/queue item is never assigned to a capability its assignee lacks; no queue can contain un-completable work.
35. VIEW tokens never expose purse details when the money-visibility switch redacts them; redaction is applied at the read model, not the display layer.

## Enforcement map

| Mechanism | Invariants |
|-----------|-----------|
| Schema/DB constraints (52) | 1, 2, 3, 10 (no UPDATE/DELETE on ledger), 18, 20, 24 |
| Engine machine guards (39, 41) | 9, 11, 13, 14, 15, 16, 17, 19 |
| Read-model construction (51) | 8, 12, 29, 35 |
| Policy module (36) | 5, 28, 34 |
| Product/UX law (reviewed) | 6, 7, 23, 27, 31 |
| Platform architecture | 4, 21, 22, 25, 26, 30, 32, 33 |

Each implementation phase's Definition of Done (69) includes the invariant tests for whatever it touched.
