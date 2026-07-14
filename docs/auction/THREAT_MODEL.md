# AUCTION THREAT MODEL

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **IP-4, M-IP4-4**

> Scope: the auction platform (engine, aggregate, event log, snapshot transport,
> cockpit, owner and spectator surfaces). Method: STRIDE against the trust
> boundary in [SECURITY](SECURITY.md) §1, plus the domain-specific question that
> actually matters — **can anyone make an auction lie?**

## 1 · Assets, in priority order

1. **The event log** (`auction_events`) — the truth. Everything else is derived.
2. **Money outcomes** — who won which lot, at what price, from which purse.
3. **Fairness** — the total order of bids; the timer; anti-snipe.
4. **Person data** — phones, identities (DPDP Act 2023, C-24).
5. **Availability during a live auction** — an auction that stops is a failed event.

## 2 · Adversaries

| # | Adversary | Capability |
|---|---|---|
| A1 | **Spectator** | Any public surface; a WS ticket |
| A2 | **Team owner** | Authenticated; holds a paddle; wants to win a lot |
| A3 | **Rogue conductor** | Holds `auction.conduct`; can run the night |
| A4 | **Network attacker** | Can observe/replay traffic between web and engine |
| A5 | **Database attacker / careless operator** | **Write access to the projection tables** |
| A6 | **Log attacker** | Write access to `auction_events` itself |

## 3 · Findings

### A1 · Spectator

| Threat | Control |
|---|---|
| Reach the engine directly | No route exists. `/command` requires the shared secret; browsers never hold it. |
| Read engine internals | `/diagnostics`, `/snapshot` require the secret. WS upgrade requires a windowed HMAC ticket (HMAC over `auctionId · 24h-window`, bounded ≤ 48h), constant-time compared. |
| Harvest person data | The snapshot carries the **auctioned player's name** (the lot's subject), **team names and paddle numbers** — no bidder/owner identity. Regression asserts no person id is serializable into a snapshot. |
| Learn who was rejected / unsold humiliation | Dignity (C-23): rejection reasons live in the ledger, never on the spectator wire. UNSOLD is a neutral fact. |

### A2 · Team owner — *the adversary the domain is built against*

| Threat | Control |
|---|---|
| Bid with someone else's paddle | Gauntlet check 2 — the actor must **hold** the paddle (`paddle.personId === actor`). Certified: refused `NOT_AUTHORIZED`. The paddle row itself is verified against the log (D-3), so this cannot be bypassed by editing `personId` in the database. |
| Bid without a grant | `ClaimPaddle` refuses (`no_grant`). No paddle exists without an explicit grant. |
| Outbid **yourself** to inflate a price | Check 3 compares **teams, not paddles** — releasing and re-claiming a paddle does not evade it. |
| Bid beyond your purse | Check 8 (purse) + check 9 (**reserve rule**: enough must remain to complete `squadMin`). |
| Exceed squad or role quotas | Checks 10 and 11. |
| Snipe the close | Anti-snipe: `endsAt := max(endsAt, now + extension)`, capped at `now + initial`. The timer **never shrinks** — and replay *re-proves* it (`timer_shrank` halts the fold). |
| Win by racing (submit first, be ordered first) | Commands are **totally ordered by a single writer**. Certified: two simultaneous bids at the same price → exactly one winner, the loser gets `BELOW_CURRENT`. |
| Replay a stale bid command | The idempotency cache returns the original ack. Across a restart the cache is empty — but the **gauntlet** refuses it anyway (`ALREADY_LEADING` / `BELOW_CURRENT`). Defence in depth; the gauntlet is the guard. |

### A3 · Rogue conductor

A conductor **can** legitimately run the auction — that is their job. The controls
are **friction, attribution and irreversibility of the record**, not prevention:

| Threat | Control |
|---|---|
| Undo a sale they dislike | `UndoLastAction` requires `auction.conduct` **AND** `auction.override` — the highest-friction action in the platform. Certified: conduct alone is refused. |
| Quietly reverse history | **Impossible.** Undo appends *compensating* events; the voided bid survives as `invalidated`, and the ledger row reads `UNDO — lot reopened (compensates #n)`. Every reversal is permanently visible and attributed. |
| Pass a lot that has money on it | The lot machine forbids it: `pass` **requires no leading bid**. A lot with money must be sold or frozen. |
| Edit a bid or a price | **No such command exists.** |
| Act without attribution | Every event carries `actor` + `correlationId`, and writes an audit row carrying the event seq. |

**Residual risk (accepted):** a conductor with `override` can repeatedly undo the
most recent resolution. This is inherent to having an undo at all. It is bounded
(only the most recent resolution, only until the next lot opens or the lot is
acted on) and it is **loud** — every undo is a permanent, attributed ledger row.
Detection, not prevention, is the control. Recommendation for operators: grant
`auction.override` to as few people as possible, and review `UNDO` rows after
every auction.

### A4 · Network attacker

| Threat | Control |
|---|---|
| Forge a command | `/command` requires `x-engine-secret` (constant-time compare). Deploy web↔engine over TLS on a private network. |
| Forge `conduct: true` | Requires the secret; a browser cannot obtain it. |
| Replay a captured command | Idempotency by `commandId`; plus the gauntlet (see A2). |
| Timing-attack the secret | `timingSafeEqual` on both the secret and the WS ticket. |

**Residual risk:** the engine secret is a **bearer credential**. Anyone who holds
it is the web tier. Rotate it, never log it, never ship it to a browser.

### A5 · Database attacker / careless operator — *the interesting one*

Can someone with **write access to the projection tables steal a lot?**

**No.** Certified by drill:

- Tamper with a **bid amount** (the row the gavel reads the sale price from) →
  the engine **halts** on the next command with `bid …: amount diverged
  (rows=X events=Y)` and `RecoverAuction` **heals it from the log**.
- Re-crown a **losing bid** as leader → halts (`bid …: rows=accepted
  events=outbid`), healed.
- Reassign a **paddle's person** (hand it to a different bidder) → halts
  (`paddle …: person diverged`), healed. This is an **authorization hijack**:
  the engine authorizes bidding by `paddle.personId === actor`.
- Reassign a **paddle's team** (misattribute a purse) or flip its **release
  state** → halts (`paddle …: team/released diverged`), healed.
- Tamper with a **lot row** (status, sale price, sold paddle, rounds) → halts, healed.
- Tamper with the **auction status** → halts, healed.

Two rows were, at points during M-IP4-4, **not** covered by projection
verification: the *bid* rows (defect **D-2** — a corrupted bid would have sold at
the wrong price) and the *paddle* rows (defect **D-3** — a reassigned `personId`
would have let the wrong person bid, and a reassigned `teamId` would have charged
the wrong purse). Both were found by hostile drills and are now closed and
regression-locked. The verification rule is now absolute: **every row the engine
reads to make a decision is verified against the log.**

### A6 · Log attacker

The last line of defence. Writing to `auction_events` is the only way to actually
forge an outcome — and the log defends itself:

| Attack | Result |
|---|---|
| **Delete** an event | `sequence_gap` → replay stops, **no snapshot is ever served**, recovery **refuses**. The auction halts rather than folding into a plausible lie. |
| **Insert** an event out of order | Same: the seq is dense and verified; a gap or duplicate is a loud failure (unique `(auction_id, seq)`). |
| **Forge** an illegal event | The reducer is total: an event illegal in the current state stops the fold (`illegal_replayed_transition`). |
| **Forge** a *legal-looking* sale | Requires a coherent, correctly-sequenced event chain **and** the matching audit row. This is the residual risk, and it is why database write access is the crown jewel. |

**Residual risk (accepted, escalated to operations):** an attacker with
unrestricted write access to `auction_events` who forges a *well-formed* chain can
forge an outcome. No application-layer control can prevent this. Mitigations are
operational and out of the auction platform's scope:

- restrict write access to the log to the engine role alone;
- append-only enforcement at the database/backup layer (PITR, WAL archiving);
- the audit trail is a **second, independently-written record** — a forger must
  corrupt both consistently;
- **Recommendation, post-freeze (not freeze-blocking):** hash-chain the event log
  (each event carries `prev_hash`), making tampering detectable rather than merely
  difficult. Recorded as a risk in [IP-4_CLOSURE_REPORT](IP-4_CLOSURE_REPORT.md) §6.

## 4 · Availability

| Threat | Control |
|---|---|
| Engine crash mid-auction | Recovers from the log in **28.5 ms** (2 500 lots). Nothing is lost: every accepted command committed its event in one transaction. |
| A client floods commands | Per-auction FIFO; `queueDepth` is exposed. Rate limiting is a web-tier concern (identity layer). |
| **Spectator flood** | **A real limit.** Broadcast cost is `snapshot bytes × spectators × events` — see [PERFORMANCE](PERFORMANCE.md) §4. Enforce the operating envelope (§5) at the web tier. |
| Timer authority dies | `watchdog.stalled` → `/healthz` 503 → restart. Lots do not close while stalled; they do not resolve wrongly. |

## 5 · Privacy (DPDP, C-24)

Person data never enters the event log payloads (ids only), never enters the
snapshot (team names and paddle numbers only), and never enters diagnostics.
Owner-invite **tokens are hashed before they reach the aggregate** — the raw
secret never touches the immutable log.
