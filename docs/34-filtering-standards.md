# 34 — Filtering Standards

> Canon: C-8 · v1.0 · 2026-07-11

## Model

Filters are **chips over a toolbar**, not sidebars of checkboxes (Console lists are operational queues, not e-commerce catalogs):

- **Primary filters** (2–4 per list, declared in the screen spec): one-click segmented controls or dropdown-chips for the list's dominant dimensions — Registrations: status; Pool: role, round; Teams: readiness.
- **Added filters:** a "+ Filter" chip opens a typed picker (field → operator → value) for the long tail; active filters render as removable chips ("Role: Bowler ×").
- **Search integrates** as just another chip ("Name contains 'ar'") so the active-criteria row always tells the whole truth about what the list shows (33).

## Rules

- **State is in the URL** (query params, canonical order) — filtered views are shareable, reload-safe, and back-button-correct (16 return context).
- Filter counts: options show result counts where cheap (`status: Pending (12)`); counts respect grants (C-8).
- Filtered-empty gets its own state with one-click "Clear filters" (22); clearing restores the list's default view, which is itself declared per list (e.g., Registrations defaults to `status: Pending` — the queue view — with the unfiltered view one chip away).
- Combining: chips AND across fields, OR within a field's multi-select; the grammar is never more complex than that in V1 (no nested boolean builder — an operational product, not a BI tool).
- Persistence: the last-used filter set per list is restored per user (sessionStorage), but a shared URL's filters always win — links show the sender's truth.

## Saved views

V1.5 (flagged, 63): named saved filter+sort+density sets per list, org-shared by grant-holders ("Round 2 queue", "Unpaid teams"). Design reserved in the toolbar (view switcher slot) so the pattern arrives without layout upheaval.

## Live-surface note

Live surfaces have no user-facing filters (17 — the auction decides what matters right now); the sole exception is Stage's squad browser between rounds (team selector), which is navigation, not filtering.
