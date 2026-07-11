# 26 — Notifications (in-product)

> Canon: C-19 · v1.0 · 2026-07-11

Channel strategy and catalog live in 47-notification-strategy; this document specifies the **in-product surfaces**.

## Surfaces

| Surface | What it carries |
|---------|-----------------|
| **Attention queue** (Console Home, 32) | Things requiring *decision*: pending registrations, unaccepted owner invites, readiness blockers, frozen money ops. Not a feed — a work queue that empties |
| **Notification tray** (bell, Console header) | Ambient FYIs: export ready, import finished, payment received, background job outcomes. Read/unread, 30-day retention |
| **Banners** (page-scoped) | Persistent conditions on the object being viewed: "Pool locked", "Pass expires in 3 days", degraded modes. Dismissible only if the condition is informational |
| **Toasts** (27) | Ephemeral confirmations only — never the sole carrier of anything important |
| **Live announcements** | Auction events on live surfaces — rendered by the event stream itself + `Announcer` a11y layer (13), not by the notification system |

## Sorting rules (what goes where)

- Requires a decision → attention queue. Records an outcome → tray. Describes *this page's* standing condition → banner. Confirms what you just did → toast.
- One event, one surface (plus optional external channel per 47). Duplicating an event across tray + banner + toast is a defect.
- Nothing in-product ever demands attention it doesn't deserve: no unread-count inflation, no red dots for marketing, no re-surfacing dismissed items unchanged (C-19, invariant 31).

## Behavior

- Attention queue items deep-link to the exact decision UI with return context (16); completing the decision removes the item everywhere, instantly.
- Tray items are org-scoped and grant-filtered — a user never sees a notification about an object they can't open (36).
- Banners stack max 2; beyond that, the page has a state-design problem, not a banner shortage.
- All surfaces render from one `notifications` read model (51) — dismissal/read state syncs across devices.
