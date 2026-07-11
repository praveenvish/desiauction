# 35 — AI Interaction Standards

> Canon: C-10 · v1.0 · 2026-07-11

## The AI constitution (applies to every AI feature, forever)

1. **Never on the money path** (C-10, invariant 32): AI never bids, prices, closes lots, approves people, or alters entitlements. No AI output feeds a money mutation without a human performing the product's normal confirmed action (15).
2. **AI is an actor like any other** (C-8): it holds explicit grants, is rate-limited, and every action it takes writes audit entries attributed to the AI actor + the human who invoked it (48).
3. **Advisory, visibly** — AI output renders in the **Advisory** visual grammar and is never mistakable for engine truth (invariant 32).
4. **Attributable and dismissible:** every AI element says what it looked at ("Based on 64 registrations"), can be dismissed, and stays dismissed.
5. **Honest uncertainty:** confidence is shown when it's low, not manufactured when it's high; "I couldn't determine X" is a sanctioned output.

## The Advisory visual grammar

One consistent treatment product-wide (in `@da/ui`): `AdvisoryCard` / inline `AdvisorySuggestion` with the `sparkle` icon, a distinct dashed-border + `surface-raised` treatment, label "Suggestion", and (where applicable) an accept/edit/dismiss action row. Volt/gold are never used on advisory chrome (gold is earned by the engine, not predicted by AI, C-5). Accepting a suggestion always routes through the normal control — AI pre-fills, humans commit (28 ladders intact).

## V1 AI surfaces

| Feature | What it does | Money-path? |
|---------|--------------|-------------|
| **Setup Copilot** | Conversational tournament setup: asks about the event, drafts config (teams, purse, increments slabs, role quotas) as a pre-filled *draft* the organizer reviews field-by-field (29) | Pre-fills only |
| **Import Assistant** | CSV/messy-paste → structured player rows with per-row confidence; low-confidence rows queue for human review; never auto-approves (invariant 5) | No |
| **Pool insights** | Pre-auction: flags likely marquee lots, role scarcity ("only 4 wicket-keepers for 8 teams"), suggested base-price anomalies | Advisory only |
| **Owner insights** (Owner Room, between lots) | Squad-gap analysis ("You need 2 bowlers; 5 remain in the pool") — facts derived from the read model, plainly separated from AI phrasing | Advisory only |
| **Recap generator** | Post-auction narrative + shareable moment cards from the ledger; organizer reviews before publishing | No |
| **Anomaly sentinel** | Watches ledger patterns (bid bursts, purse edge cases); raises *flags into the attention queue* for humans — never intervenes | Flags only |

Explicitly not in V1: AI auctioneer voice, AI valuation of real people displayed publicly (dignity risk, C-23 — a "predicted price" on a human is a public judgment we refuse), chatbots-as-support-deflection.

## Interaction rules

- AI latency is honest: streaming where >1s, skeleton-free (advisory content may arrive late; the page never waits for it — invariant 19 posture).
- AI failures degrade to absence, silently logged (55) — a broken suggestion never blocks a working flow.
- Every AI feature has a kill switch (flag, 63) and a per-org opt-out (Settings).
- Prompts never receive PII beyond task need (49 DPDP minimization); player contact details never enter prompts.
- Model calls, costs, and acceptance rates are observable per feature (56) — an AI feature we can't measure gets turned off.
