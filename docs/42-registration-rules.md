# 42 — Registration Rules

> Canon: C-23, C-24 · v1.0 · 2026-07-11

## Flow (behavioural carry, upgraded)

```
Organizer shares registration link (token, 36)
→ Player opens on phone (mobile-first, 14)
→ Form: name, mobile, role, base-price band, photo (optional but encouraged)
→ OTP verifies mobile at submit (upgraded from reference "future" status — verification is V1 core: it IS the identity system, 38)
→ Duplicate check (verified mobile, per tournament)
→ Submitted → organizer triage (peek queue, 31) → Approved | Rejected | Waitlisted
→ Approved → PoolEntry created; player notified (47)
```

## Rules

- **Human approval always** (invariant 5): no auto-approve thresholds, no AI approval; the Import Assistant (35) can *stage* rows but each enters the pool through the same gate (bulk-approve of human-reviewed selections is allowed — the human act is the selection).
- **Rejection requires a private reason** (invariant 6): structured categories (duplicate, ineligible, withdrew, capacity, other+note); the player notification is respectful and reason-category-appropriate; reasons never render publicly, ever.
- **Duplicate handling:** same verified mobile in the same tournament → blocked with self-service help ("Already registered? Check your status: {link}"); across tournaments → links to the same Person (38 identity).
- **Verification:** 6-digit OTP, 3 attempts, resend cooldown 60s, expiry 10min, rate limits per mobile and per IP (49); WhatsApp OTP first with SMS fallback (C-19). Failure is honest (24) and never silently drops the form (drafts persist, 29).
- **Waitlist:** capacity-bound tournaments queue overflow; promotion is the same human approval; waitlisted players see honest status ("Waitlisted · you'll be notified"), never a fake pending.
- **Withdrawal:** self-service until pool lock; after lock, organizer-mediated (override, audited).
- **Player data minimalism (C-24 DPDP):** the standard form collects only what the auction needs; custom fields are organizer-configurable but PII-flagged fields (address, ID numbers) are discouraged by design and excluded from public read models automatically (invariant 8).

## Registration fees (V1.5, flagged)

When enabled: fee configured on the tournament, collected at submit via Razorpay (46), refunded automatically on rejection (policy-configurable for withdrawal). Immutable fee records (invariant 24); payment state never gates *triage* visibility (organizers see all submissions), only pool eligibility. Until the flag ships, the model reserves the fields — no schema retrofit.

## The player's window (their status page)

Every registration gets a private status URL (tokened): current state (respectfully worded), their submitted details, correction requests (pre-approval), and — post-auction — their sold-moment artifact or a dignified conclusion (C-23, 04 beat 4). Players are people the product honors, not rows it processes: this page is a first-class deliverable, not an afterthought.

## Organizer triage ergonomics (the volume reality)

200+ registrations arrive in bursts. The queue (Console → Registrations): peek-driven review with `↑/↓` (31), one-tap approve from the peek, batch-select approve for clean cohorts (30), duplicate-suspect flags (same name+similar mobile via Person linkage), progress stated plainly ("41 approved · 12 pending · target pool 60"). Triage of a full tournament must be a 20-minute job, and that number is a UX acceptance criterion (70).
