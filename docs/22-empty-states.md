# 22 — Empty States

> Canon: C-4 · v1.0 · 2026-07-11

## Doctrine

An empty state is the product's best teaching moment and worst churn risk. Every empty state answers three questions in order: **what lives here → why it's empty → the one action that fills it.** Rendered by `EmptyState` (19) only — no ad-hoc empties.

## Anatomy

Icon (24px, from 12) or small beam illustration (06) · Title (one line, what lives here) · Body (≤ 2 lines, why/how) · Primary action (verb+object, 20) · Optional secondary link (docs/import).

## The four kinds

| Kind | Trigger | Rule |
|------|---------|------|
| **First-run** | Object never created | Invitational, action-forward ("Your first tournament starts here") |
| **Filtered-empty** | Data exists, filters exclude all | Never looks like first-run: "No players match these filters" + "Clear filters" — the action clears, it doesn't create (34) |
| **Permission-empty** | Data exists, viewer lacks grant | Honest without leaking: "You don't have access to registrations. Ask {org owner}." — never a fake empty (36) |
| **Degraded-empty** | Source unavailable | Belongs to error states (24), never disguised as empty: "Can't load teams right now" + retry |

Distinguishing these four is mandatory — showing first-run copy over filtered data ("Create your first player!" atop 200 filtered-out players) is a classic trust-destroying defect.

## Live-surface empties

- Stage pre-auction: the branded idle composition (lit-pitch motif, 06) with tournament name and start time — an occasion poster, not an empty apology.
- Owner Room between lots: "Next: Lot {n} · {player}" preview — anticipation, not absence.
- Cockpit with no queued lots: state + action ("All lots complete. Review round 2 queue / End auction").

## Rules

- Every list/table/board in the product has all four kinds specified in its screen spec (69) before build.
- Empty states never block chrome: filters, import, and navigation stay reachable.
- Tone: invitational for first-run, neutral for filtered, never cute-for-cute's-sake; no mascots.
