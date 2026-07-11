# 47 — Notification Strategy

> Canon: C-19 · v1.0 · 2026-07-11

## Channels, in priority order (C-19)

1. **WhatsApp** (Business API) — where this market lives; templated, opt-in at data collection, per Meta template approval flow.
2. **SMS** — fallback for OTP and critical transactional when WhatsApp undeliverable.
3. **In-app** — the tray/queue/banners (26).
4. **Email** — receipts/invoices archive and org-admin matters; never the primary channel for players.

Provider abstraction in `packages/core/notifications` (one interface; Twilio/Gupshup/MSG91 are adapters — provider choice is an ops decision, not an architecture one).

## The catalog (V1, complete list — additions require review against invariant 31)

| Event | To | Channels | Class |
|-------|----|----------|-------|
| OTP | Player/Owner | WhatsApp→SMS | Critical |
| Registration received / approved / rejected / waitlisted | Player | WhatsApp | Transactional (respectful copy, 21/C-23) |
| Owner invite / reminder (max 2) | Owner | WhatsApp | Transactional |
| Auction scheduled / T-24h / T-30m | Owners; players opt-in | WhatsApp | Transactional |
| **SOLD moment** | The sold player | WhatsApp (the one celebratory template, 21) | Ceremony |
| Owner receipt per purchase | Buying owner | WhatsApp + in-app | Transactional |
| Auction complete + results link | Owners, players | WhatsApp | Transactional |
| Pass purchased (invoice), payment failed, refund states | Org billing contacts | Email + in-app | Commercial |
| Export ready / import finished / job failed | Requesting user | In-app (tray) | Operational |
| Frozen money op, readiness regressions | Grant-holders (relevant capability, invariant 34) | In-app queue (+WhatsApp if auction < 24h) | Attention |

**No marketing lane exists in V1.** No re-engagement, no streaks, no "we miss you" (invariant 31). Product announcements: an in-app changelog surface, pull not push.

## Delivery rules

- Every send: templated (versioned templates, 21 owns canonical copy), logged as NotificationRecord (38) with provider ids, idempotency-keyed (an event never double-sends on retry, 53).
- **Nothing sent is ever unsent** (invariant 30): corrections are follow-up messages.
- Quiet hours: non-critical sends hold 22:00–08:00 IST (auction-night events are exempt — the auction IS the night).
- Preferences: players/owners manage channel opt-outs from their status page/Owner Room (42); OTP and money receipts are non-optional (transactional integrity).
- Failure honesty: undeliverable critical notifications surface to the organizer ("2 owners unreachable on WhatsApp — share links manually"), because the organizer can fix it in the room (invariant 19 posture).

## Observability

Per-template delivery/read rates, per-provider failure rates, cost per tournament (56); alerts on delivery collapse during live windows (C-17).
