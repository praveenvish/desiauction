# 33 — Search Standards

> Canon: C-8 · v1.0 · 2026-07-11

## Two search surfaces

### ⌘K Command Palette (Console)

The power user's front door: entities, actions, navigation in one field.

- **Scope:** current org; entities (tournaments, players, teams, registrations by name/phone-suffix), actions ("Lock pool", "Create tournament", "Enter Cockpit"), destinations (settings pages, docs).
- **Ranking:** exact prefix > fuzzy; recent items first on empty query; actions ranked by current context (inside a tournament, its actions outrank global ones).
- **Grants filter results structurally** (C-8): the index query carries the caller's grants; unauthorized objects are absent, not disabled (36 — no existence leaks).
- Action execution: palette actions that mutate open their normal confirmation UI (28) — the palette navigates and invokes, it never skips ladders.
- Keyboard: `⌘K`/`Ctrl+K`; full arrow/enter operation; results announced (13).

### Scoped list search (every major list)

An always-visible filter-as-you-type field on Console lists (registrations, pool, teams): instant client filtering under 500 rows, server search above; debounced 250ms; matches highlighted; clears obviously (34 chip integration).

## Phone-number search (market-specific)

Organizers identify players by phone constantly (42 dedup). Search matches on last-N digits (suffix match ≥ 4 digits), renders numbers masked (`•••••43210`) to non-privileged grants (49 PII rules), and never indexes phone numbers into any public or cross-org surface.

## Rules

- Empty results are filtered-empties ("No matches for '{q}'" + clear), never first-run invitations (22).
- Search never blocks on the network: client-side results render immediately, server results merge in labeled ("More from server…").
- No global cross-org search, by design — orgs are separate worlds (invariant 1); the org switcher is the boundary crossing (16).
- Public surfaces: no search in V1 (17); the results page offers browser-native find with a proper document structure instead.
