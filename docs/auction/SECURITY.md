# AUCTION SECURITY CERTIFICATION

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **CERTIFIED** (IP-4, M-IP4-4)

> Authorization is **grants, not roles** (C-8): a Grant = (person, scope,
> capability set); enforcement is **per-capability**. This document certifies
> that every auction mutation is capability-gated, that the gates are enforced in
> the engine (not the browser), and that each gate carries a permanent
> regression.

## 1 · The trust boundary

```
browser ──(session + capability gate)──▶ web tier ──(shared secret)──▶ engine ──▶ Postgres
   ▲                                                                     │
   └────────────── WebSocket: SNAPSHOTS ONLY (HMAC ticket) ◀─────────────┘
```

- **The browser never reaches the engine.** There is no route from a client to
  `/command`. The web tier resolves capabilities and passes the *verdict*
  (`conduct`, `override`) on the envelope.
- **The engine trusts its authenticated caller, never a browser claim.** A forged
  `conduct: true` from a browser is impossible: the browser cannot present the
  shared secret.
- `/command`, `/diagnostics`, `/snapshot`, `/admin/reset` all require
  `x-engine-secret`, compared with `timingSafeEqual` (constant time).
- WebSocket upgrades require an HMAC ticket, `wsTicket(auctionId, secret)` — HMAC
  over `auctionId · 24h-window`, accepted for the current or previous window
  (**bounded ≤ 48h lifetime**, MIN-2), also compared in constant time.
  **Spectators can never reach engine internals.**
- `/admin/reset` returns **404 in production** — it does not exist there.

## 2 · Capability enforcement (certified, command by command)

| Capability | Commands |
|---|---|
| `auction.conduct` | `QueueLots` · `OpenLot` · `CloseLot` · `OpenAuction` · `PauseAuction` · `ResumeAuction` · `CompleteAuction` · `AbortAuction` · `WithdrawLot` · `HoldLot` · `RequeueLot` · `IssuePaddle` · `InviteOwner` · `GrantPaddle` · `RecoverAuction` |
| `auction.conduct` **AND** `auction.override` | `UndoLastAction` |
| Paddle **holder** (or conduct, for manual mode) | `PlaceBid` · `ReleasePaddle` |
| Unrevoked paddle **grant** | `ClaimPaddle` |
| The **invitee** | `AcceptOwnerInvite` |

**Regression:** the certification suite loops over **all 15 conduct-only
commands** and asserts each refuses a non-conductor with `not_authorized`. Adding
a command without a gate fails the suite — the list is enforced, not documented.

## 3 · The authority chain for money

No paddle exists without an explicit chain, and every link is an event:

```
InviteOwner → AcceptOwnerInvite → GrantPaddle → ClaimPaddle → PlaceBid
   (conduct)      (the invitee)     (conduct)     (grant)     (holder)
```

- `ClaimPaddle` **without a grant is refused** (`no_grant`). The temporary
  "any team member may claim" rule of M-IP4-2 is gone.
- Only an **accepted owner** of the team can be granted (`not_an_owner`).
- A person **cannot drive a paddle they do not hold** — certified: Owner B bidding
  with Owner A's paddle is refused `NOT_AUTHORIZED` by gauntlet check 2.
- A **released paddle can never bid again** (`releasedAt` is checked in the
  gauntlet's authorization input).
- Paddle identity is **immutable**: numbers are never reused, a claim *issues* a
  new paddle, a release *ends* a claim. Rows are never mutated into a new identity.
- **Self-outbidding is refused at the TEAM level** (check 3), so releasing a
  paddle and claiming a new one cannot be used to bid against yourself.

## 4 · Integrity enforcement (the engine polices itself)

Authorization stops the wrong *person*. These stop the wrong *state* — including
an attacker or an operator with direct database access.

| Surface | Enforcement |
|---|---|
| **Event integrity** | Append-only log; unique `(auction_id, seq)` makes a second writer a loud failure. A **sequence gap** stops replay dead — no snapshot is served, and recovery refuses to invent the missing event. |
| **Replay integrity** | The reducer is total and fail-closed: unknown event type, illegal transition, malformed payload, or a **shrinking timer** (invariant 14) all stop the fold at the offending seq. |
| **Projection integrity** | After **every** command the engine re-folds the log and verifies **the auction status, every lot row (status, sale price, sold paddle, rounds), every bid row (amount, paddle, lot, status), and every paddle row (team, person, number, released)** against it. Any divergence **halts** the auction. |
| **Money integrity** | The sale price is read from the leading **bid row** — so the bid rows are verified against `BidAccepted`/`BidInvalidated` on every command. Certified by drill: a bid amount tampered with directly in the database **halts the engine** and is **healed from the log**. (This closed defect **D-2**.) |
| **Authorization + purse integrity** | The **paddle row** gates who may bid (`personId`) and attributes every bid and sale to a purse/squad/role (`teamId`), so the paddle rows are verified against `PaddleIssued`/`PaddleReleased` on every command. Certified by drill: reassigning a paddle's person (authorization hijack) or its release state **halts the engine** and is **healed from the log**. (This closed defect **D-3**.) |
| **Snapshot integrity** | `deepVerify` folds the log twice and compares bytes; indeterminism halts the auction. |
| **Ledger integrity** | The ledger is a **pure fold** of the log. It cannot be written to, so it cannot be forged; regenerating it can never diverge from history. |
| **Audit integrity** | Every event writes exactly one audit row carrying actor, action, scope, subject, `correlationId` and the **event seq** as evidence. Certified: every event has an audit row bearing its seq. |

**The security property that matters most:** an attacker with **write access to
the projection tables cannot steal a lot, hijack a paddle, or misattribute a
purse.** Corrupting a bid row, a **paddle row**, a lot row, or the auction status
is *detected on the next command*, halts the auction, and is healed from the
immutable log. To actually forge an outcome an attacker must forge the **event
log** itself — and a gap or an illegal transition there stops replay entirely
rather than folding into a plausible lie.

**Certification history.** The bid rows (**D-2**) and the paddle rows (**D-3**)
were each, at one point, *outside* this verification — a corrupted bid amount
would have sold at the wrong price, and a reassigned paddle `personId` would have
let the wrong person bid, with neither detected. Both were found by hostile
drills, closed, and regression-locked. The rule they enforce is now absolute:
**if the engine reads a row to make a decision, the watchdog verifies that row
against the log.**

## 5 · Isolation

- **Tenancy:** `org_id` on every auction table, with RLS `USING` + `WITH CHECK`
  as defence in depth (C-13).
- **Spectators:** the snapshot carries team names and paddle numbers — **never
  person identity** (no phone, no email, no person ULID). Regression asserts the
  serialized snapshot does not contain a person id.
- **Diagnostics** expose counters and hashes only — never snapshot payloads,
  never secrets, never person data — and require the engine secret.
- **Dignity (C-23):** rejection reasons and `BidRejected` evidence are recorded in
  the ledger and diagnostics but are **never** broadcast to spectators. UNSOLD is
  a neutral fact.

## 6 · Secrets

- The raw owner-invite token **never reaches the aggregate**: the web tier
  generates it and passes only the **hash**. The event log records **ids only** —
  secrets never enter the immutable log (verified: `tokenHash` is stored on the
  invite row, and the `OwnerInvited` payload carries `inviteId` + `teamId` only).
- `ENGINE_SECRET` is required at boot (`env.ts`) and is never logged.

## 7 · Evidence

`apps/engine/src/integration/certification.integration.test.ts` §SECURITY
CERTIFICATION · §WATCHDOG CERTIFICATION · §RECOVERY CERTIFICATION ·
`apps/engine/src/server.test.ts` (secret + ticket enforcement) ·
`apps/web/src/server/auction/auction-foundation.regression.test.ts` (RLS,
capability gates) · [THREAT_MODEL](THREAT_MODEL.md).
