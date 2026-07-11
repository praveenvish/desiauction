# 03 — Product Principles

> Canon: C-2, C-3, C-10, C-19, C-23 · v1.0 · 2026-07-11

The ten principles, in priority order. When two conflict, the lower number wins.

## 1. Money is sacred

Every rupee of purse movement is server-authoritative, immutably recorded, and identically visible everywhere (C-3, C-9). If a money operation cannot resolve deterministically, it **freezes for a human** — the system never guesses about money (invariant 17). No feature, deadline, or convenience ever compromises this.

## 2. The organizer's evening comes first

The person running the auction is our primary user. Every design decision is tested against their cognitive load at 9pm with 200 people watching. **Calm for the one running it, electric for the ones playing it, fair for everyone.**

## 3. Dignity is a feature (C-23)

An unsold player is a neutral fact, never a public spectacle. A rejected registration has a private reason, never a public one. Real people's names cross this screen on an emotional night; the product protects them structurally, not politely.

## 4. Ceremony over decoration

Visual richness is spent, not sprinkled: the SOLD moment gets gold and choreography (C-5, 11-motion); everything else is calm. A product that celebrates everything celebrates nothing.

## 5. Honest by construction

No dark patterns, no manufactured urgency, no fake scarcity — structurally excluded from templates and timers (invariant 31). Errors state what happened and what happens next (24-error-states). If the system degraded, the user knows before they're bitten.

## 6. The system never hard-blocks the night

Uploads, analytics, notifications, AI may all die; **bidding may not** (invariant 19). Every non-spine dependency has a degraded mode, and the live surfaces state their degradation honestly.

## 7. Progressive formality

A 60-player gully auction and a state association use the same objects — scale activates optional layers (seasons, delegation, venues), never a different product. Defaults make the small case effortless; structure makes the large case possible.

## 8. AI at the edges, never the spine (C-10)

AI drafts, summarizes, flags, and explains. It never bids, prices, verdicts a lot, approves a person, or renders as engine truth. AI output is always visibly advisory and always attributable.

## 9. One truth, many views (C-3)

Every surface is a projection of the same event stream at a stated `seq`. No surface may show a money value that differs from another surface's at the same sequence point (invariant 12). Disagreement between screens is a bug of the highest severity.

## 10. Earn the export

Everything a user creates is theirs: every list exportable, every export audited, no data ransom on entitlement loss (C-11, invariants 26, 33). We keep customers with quality, not hostages.
