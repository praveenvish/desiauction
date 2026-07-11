# 16 — Navigation System

> Canon: C-3, C-12 · v1.0 · 2026-07-11

## Shells

Three navigation shells, one per audience:

### Console shell (organizer/staff)

- **Left rail, exactly five items, forever:** Home · Tournaments · People · Reports · Settings. New features earn a place *inside* these, never a sixth rail item (carried nav ruling — the rail that grows is the rail that dies). Org switcher sits above the rail (multi-org users only see it when relevant — progressive formality).
- **Tournament hub:** entering a tournament swaps context — breadcrumb `Org / Tournament`, tabs for the tournament's aspects: Overview · Registrations · Pool · Teams · Auction · Results · Settings. Tabs are phase-aware: they carry readiness/attention dots from the phase engine (44), not badges-as-decoration.
- **Command palette (⌘K)** is a first-class navigator: entities, actions, and docs (33).

### Live shell (Cockpit, Owner Room)

Full-screen, railless — the auction owns the viewport. Exit is a single labeled door ("Leave auction", top-left), never browser-back-dependent. Status strip (connection, seq, auction phase) is persistent (17).

### Public shell (Stage, results, registration)

Zero chrome beyond a slim branded header; tokenized links land directly on content — a spectator never sees navigation, they see the show.

## URL grammar

URLs are the product's public API for humans — stable, guessable, shareable:

```
/o/{org-slug}                        Org home (Console)
/o/{org}/t/{tournament-slug}         Tournament hub
/o/{org}/t/{t}/registrations|pool|teams|auction|results|settings
/o/{org}/t/{t}/cockpit               Live conduct (grant-gated)
/room/{tournament-slug}              Owner Room (grant-gated)
/live/{tournament-slug}              Public Stage (token or public)
/live/{tournament-slug}/results      Public results
/r/{registration-token}              Registration form
/join/{invite-token}                 Owner/staff invite acceptance
```

Rules: slugs are immutable after first publish (redirects if renamed); IDs never appear in user-facing URLs; every URL is deep-linkable and reload-safe; tokens live in the path (shareability) but are unguessable ULIDs with scope + expiry (36).

## Wayfinding rules

- **Return context:** leaving a list to a detail and coming back restores scroll, filters, and selection (sessionStorage per view). Peeks (31) exist so most inspection never leaves the list at all.
- Breadcrumbs only in Console, max depth 3 (Org / Tournament / Section); deeper than that is an IA bug, not a breadcrumb need.
- Browser back always works and never loses data (unsaved forms guard with a dialog, 29).
- Active states: rail and tabs mark the current location visibly (fill, not color-only); the document `<title>` mirrors the breadcrumb.

## Cross-surface movement

- Console → Cockpit: explicit "Enter Cockpit" from the Auction tab (with pre-live checklist state, 44); never automatic.
- Cockpit ↔ Stage preview: the Cockpit embeds a Stage thumbnail (what the room sees), not a link that leaves conduct.
- Every public artifact (results, receipts) is reachable by URL without auth, gated only by its token/visibility rules (36).
