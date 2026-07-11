# 37 — User Roles

> Canon: C-8 · v1.0 · 2026-07-11

Roles are **named capability sets** (36) — presets that make granting humane. Enforcement never references a role name.

## Personas → presets

### Organizer (persona: "the one whose night it is")

The person who creates the tournament, sweats the auction, and answers to everyone. Usually also the auctioneer at small scale (progressive formality, 03 §7 — one human, several grants).
**Preset `Organizer`:** all `tournament:*` at tournament scope; `org:manage/billing/grants/audit-read` at org scope when they own the org.

### Auction Director (persona: "the operator")

Runs the Cockpit on the night: opens lots, closes lots, pauses, resolves freezes.
**Preset `Director`:** `tournament:conduct`, `tournament:override`, `tournament:auction-setup` (read).
**Preset `Auctioneer` (restricted):** `tournament:conduct` only — can run the night but cannot reverse recorded outcomes or change setup (carried behavioural ruling: conduct is intentionally narrow).

### Team Owner (persona: "the one spending money")

Bids for their team from the Owner Room; carries their squad and purse.
**Preset `Owner`:** `team:bid`, `team:view-own` for exactly one team per tournament (invariant 18). Created via invite token acceptance (36) — ownership is *accepted*, never just assigned (43).

### Staff (persona: "the volunteer at the desk")

Handles registration triage, data entry, exports — trusted with people, not with money.
**Preset `Registrar`:** `tournament:registrations`, `tournament:pool`.
**Preset `Scorekeeper`** (H2): results entry capabilities.

### Player (persona: "the name that gets called")

Registers, gets a status page and their sold-moment artifact. Players are *subjects with a window*, not operators: their surface is their own registration status + public pages. No preset — player access is self-scoped by identity.

### Spectator (persona: "the room")

Token or public link → Stage. No account, no grant — a `view` token capability only.

### Platform operator (us)

`platform:support-read` behind break-glass with mandatory reason + heavy audit (invariant 1: cross-tenant reads only via this audited surface). There is no platform capability to edit tenant money — support fixes flow through the same audited override machinery organizers use, executed by the tenant (invariant 9).

## Preset governance

- Presets are versioned platform data; editing a preset never retro-changes existing grants (grants snapshot their capability set at creation — auditability over convenience).
- Custom capability combinations are allowed at org scope for associations (H3 delegation), UI-gated to keep small organizers in presets (progressive formality).
- Every grant screen shows *capabilities*, not just the preset name — what someone can actually do is never hidden behind a label (36 honesty).
