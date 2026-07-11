# 46 — Payment Flow

> Canon: C-18 · v1.0 · 2026-07-11

## Provider

**Razorpay** (C-18): UPI-first (the market's instrument), cards/netbanking secondary; Checkout drop-in for V1 (their hosted flow — PCI scope stays theirs). The provider is wrapped behind `packages/core/payments` — one interface, so a second provider (H3) is an adapter, not a rewrite.

## The purchase flow (Pro Pass)

```
Organizer clicks Upgrade (Console → tournament → Settings/Pass)
→ server creates Invoice (immutable, 45) + Razorpay Order (amount, GST, receipt=invoice id)
→ Checkout opens (UPI intent on mobile)
→ Payment authorized/captured by provider
→ WEBHOOK (payment.captured, HMAC-verified) → verify order/amount/currency
→ Payment record transitions by provider truth (39; invariant 25)
→ Pass activates (entitlements live) → T2 success + invoice available (25)
```

Rules:

- **Webhook is the source of truth**, not the browser callback (the callback races and lies; it only optimistically shows "confirming…"). Idempotent webhook handling by provider event id (50).
- Reconciliation job (53): daily sweep of provider records vs Payments; discrepancies → attention queue as frozen commercial ops (invariant 17's commercial cousin, invariant 25 flags).
- Failure UX: honest states — `Failed` offers retry (new order, same invoice); `Authorized-not-captured` shows "confirming, up to 30 min" honestly; support path visible (24).
- Amounts always integer paise end-to-end (C-7); currency INR-only V1.

## Invoices & GST

- Invoice: immutable at issue (number series `DA-{FY}-{seq}`, org GSTIN optional field, our GST breakdown, SAC code); PDF from the document renderer (exports pipeline, 53) with provenance (invariant 33).
- Credit notes for refunds — never edited invoices (invariant 24): corrections are new documents, like everything else in this product (invariant 30 spirit).

## Refunds

- Self-serve until auction LIVE (45 policy): triggers provider refund + credit note + Pass → `Refunded(locked)` (39).
- Post-LIVE refunds = support-mediated overrides, flagged forever (invariant 25).
- Refund state also webhook-driven; UI shows provider-truth stages ("refund initiated → credited, 5–7 days").

## Registration fees (V1.5, reserved design)

Player pays at submit (42): same Order→Webhook→record spine, money routed to the organizer (Razorpay Route/linked accounts), platform fee as commission line; refund-on-rejection automatic. **Player money never touches our books** beyond the fee — we are the trusted rail, not the merchant of record for their event. Full spec deferred until the flag's phase; the invariants (24, 25) already bind it.

## Security & compliance

- No card/UPI data ever touches our servers (hosted checkout); webhook endpoints HMAC + timestamp-window verified (49); payment routes rate-limited; all payment mutations audited (48).
- Payments observable end-to-end: order→webhook lag, capture rate, refund lag as product metrics with alerts (56).
