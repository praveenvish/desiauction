# 45 — Billing Model

> Canon: C-11, C-18 · v1.0 · 2026-07-11

## The model: Passes, not subscriptions (C-11)

Organizers buy a **Pass per tournament** — matching how this market actually spends (per event, from the event budget). No seats, no monthly billing for organizers, no "contact sales" for standard tiers (invariant 27: pricing is public).

## Tiers

| | **Free** | **Pro Pass** | **Association** |
|---|---|---|---|
| Price | ₹0 | One-time per tournament (public price, GST-inclusive display) | Bundle pricing (n passes + org features) |
| Teams / pool | Up to 4 teams, 40 players | Tier limits generous (16 teams / 400 players) | Per agreement, self-serve bundles first |
| Trust spine | **Full** — immutable ledger, receipts, dignity rules, audit (trust is never premium, 02) | Full | Full |
| Live surfaces | Cockpit, Owner Room, Stage (DesiAuction-branded) | + Overlay, custom branding, sponsor slots | + multi-tournament reporting, delegation presets |
| Notifications | In-app | + WhatsApp/SMS to players & owners (47) | + bulk comms |
| Exports | Standard (with provenance) | + branded PDF packs | + org-level exports |
| AI features | Import Assistant (rate-limited) | Full V1 AI set (35) | Full + org insights |

Limit philosophy: Free limits are **honest capacity limits, not crippled trust** — a free gully auction gets the same incorruptible ledger (02). Upgrades are capability unlocks, visible in advance ("Overlay requires a Pro Pass") without nag loops (invariant 31).

## Entitlement mechanics

- Pass attaches to the tournament at creation (Free auto-attach; upgrade any time pre-live; mid-tournament upgrades apply instantly).
- **Limits snapshot at activation** (38 Pass entity): later price/tier changes never mutate an active tournament's entitlements.
- Enforcement at the readiness gate (44) and at creation-time counters (team #5 on Free prompts the upgrade path, politely, once — then a persistent quiet banner, 26).
- **Entitlement loss never destroys data** (invariant 26): expiry/refund locks *capabilities* (can't go live, can't add teams); everything recorded stays readable and exportable forever. No ransom, structurally.

## Commercial invariants in practice

- Every charge has an immutable Invoice (invariant 24) with GST fields (46).
- Discounts/comps are explicit invoice line items with reasons — auditable generosity, no quiet zeroing (invariant 25 spirit).
- Refund policy is public and simple: full refund until the auction goes LIVE; after LIVE, the Pass is consumed (the service was rendered). Edge cases (platform-fault abandonment) favor the organizer, logged as flagged overrides (invariant 25).

## Future lanes (reserved, not built)

Registration fees (42, V1.5 — platform fee % on collections is the second revenue lane); sponsor marketplace (H3, refused for now); paid player profiles (never — players are never charged for dignity, C-23).
