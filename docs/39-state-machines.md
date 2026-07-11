# 39 — State Machines

> Canon: C-9 · v1.0 · 2026-07-11

Every lifecycle is an explicit machine in `packages/core` — typed states, typed transitions with guard functions, exhaustively unit- and property-tested (58). UI affordances derive from machine state (15 disabled-with-reason); illegal transitions are unrepresentable at the API layer, not just rejected.

## Tournament

The reference implementation's 3-state enum (DRAFT/ACTIVE/CLOSED) was a documented gap — phases were derived views. Here the machine is real:

```
Draft → Setup → RegistrationOpen → RegistrationClosed
      → AuctionReady → AuctionLive ⇄ AuctionPaused
      → AuctionComplete → [H2: Playing] → Completed → Archived
```

- Guards: `Setup→RegistrationOpen` needs identity+config minimums; `→AuctionReady` needs the readiness gate (44); `→AuctionLive` needs invariant 15 (active Pass, locked rules, locked pool, ≥2 teams with accepted owners).
- Backward transitions: `RegistrationOpen ⇄ RegistrationClosed` freely (reopening intake is normal); backward out of `AuctionReady` unlocks nothing silently — locks persist unless explicitly reversed by audited override (invariant 16).
- `Archived` is read-only forever; un-archive is `org:manage` + audit.

## Auction

```
Scheduled → Live ⇄ Paused → Completed → Reconciled
                 ↘ Abandoned (audited, terminal)
```

- `Live→Paused`: conduct capability; broadcast with reassurance (21). All bid commands rejected while Paused except none — pause is total (money quiesces, invariant 17 posture).
- `Completed→Reconciled`: the post-auction verification step (receipts issued, ledger checksum verified, results published) — the organizer's exhale has a machine state (04 beat 5).
- `Abandoned`: catastrophic exit (venue lost power and the night is off): freezes ledger as-is, releases nothing automatically; recovery/resumption decisions are explicit overrides.

## Lot

```
Queued → OnBlock → ClosingSoon → Sold | Unsold | Frozen
  ↑                                        │
  └—— Requeued (next round, if allowUnsold policy) ←┘
Unsold(final) when rounds exhausted
```

- `OnBlock→ClosingSoon`: timer under threshold (visual state, 11) — same machine so surfaces agree on urgency.
- `ClosingSoon→OnBlock`: anti-snipe extension (41; timer never shrinks, invariant 14).
- `Sold` requires a durable Purchase (invariant 13); `Frozen` is the non-deterministic-money state (invariant 17): held for human resolution in Cockpit, exits only via override to Sold/Unsold/Requeued.
- Reopening a `Sold` lot (undo) is not a backward transition — it is a **compensating event** (`lot.reopened` with reversal purchase, 41 undo) creating a new OnBlock state; history stays intact (C-9).

## Registration

```
Draft → Submitted → Verified → Approved → InPool
                  ↘ Rejected          ↘ Withdrawn
                  ↘ Waitlisted → Approved
```

- `Submitted→Verified`: OTP mobile verification (42) — may be instant (verify-at-submit).
- `Approved` requires a human (invariant 5); `Rejected` requires a private reason (invariant 6); `Withdrawn` is player-initiated, always available pre-pool-lock.

## Ownership (team owner grant)

```
Invited → Accepted → Active(at auction) → [Revoked]
        ↘ Expired
```

Acceptance is the trust moment (43): the invite token converts to a Grant + Person link. Revocation pre-auction is normal admin; revocation mid-auction is an override with a frozen-team consequence set (team cannot bid until a new owner accepts — never silent proxy).

## Pass / Payment

```
Pass:    Provisional → Active → Consumed | Expired | Refunded(locked)
Payment: Created → Authorized → Captured → [Refunded | Disputed]
                 ↘ Failed
```

Payment state transitions arrive **only from provider webhooks/reconciliation** (invariant 25); Pass activation follows Captured (46). Entitlement loss locks capabilities, never data (invariant 26).

## Jobs (Import/Export/Notification)

```
Queued → Running → Succeeded | Failed → Retrying(n≤max) → DeadLetter
```

Standard job machine (53); DeadLetter items surface in the attention queue (26) when user-visible.

## Machine discipline

- One machine per concept, owned by `packages/core`, rendered from generated diagrams in these docs (68 keeps them true).
- Every transition: guard + emitted event + audit posture declared.
- Property tests assert global invariants across random walks (e.g., no path reaches `Sold` without a Purchase; no path shrinks a timer) — 58.
