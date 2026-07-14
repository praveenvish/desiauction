# MONEY SPECIFICATION

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-4, M-IP4-1)

> The Money value object as implemented in `packages/core/src/money.ts` (C-7),
> extended for the auction engine. Every rule below is unit-tested.

## 1 · Representation

Money is **integer paise**, branded: `type Paise = number & { __brand: "Paise" }`.
`paise(n)` is the only constructor and throws on anything that is not a
non-negative safe integer — floats, negatives, NaN and values beyond 2^53 are
unrepresentable. There is **no floating point anywhere** in a money path:
database columns are `bigint`, event payloads carry plain JSON integers
(exact), SQL aggregates over money arrive as strings and are parsed exactly.

## 2 · Arithmetic (closed — nothing computes money outside this module)

| Operation | Contract |
|---|---|
| `addPaise(a, b)` | exact; re-validates the safe-integer range |
| `deductPaise(from, amount)` | never negative: returns `{ok:false, reason:"insufficient"}` as a VALUE, not an exception |
| `multiplyPaise(amount, factor)` | whole non-negative factors only (reserve = players × price); throws otherwise |
| `comparePaise(a, b)` | deterministic three-way (−1/0/1) — THE ordering for bids, purses, ladders |

Ladder arithmetic (`ladderStep`, `ladderContains`, `nextMinimumBid`) and the
reserve rule build on these — every rung, step and floor is a `Paise`.

## 3 · Serialization (deterministic, bijective)

`serializePaise(p)` → the plain base-10 integer string (`110500000`).
`parsePaise(s)` accepts ONLY canonical integer strings (no leading zeros, no
sign, no decimal, no exponent, within safe range) and fails closed otherwise.
Same value ⇒ same bytes, forever.

## 4 · Display is a separate concern

`formatPaiseINR` renders exact Indian notation (`₹11,05,000`, paise shown only
when non-zero). It exists for surfaces, never for storage, comparison or
arithmetic — no money value ever round-trips through a display string.

## 5 · Auction usage map

Purse (`pursePerTeam`), base prices (bands + default), ladder slab bounds and
steps, bid amounts, sold prices, committed-purse projections: all `Paise`.
The gauntlet's checks 5–9 (base, current, increment, budget, reserve) are pure
`Paise` comparisons — deterministic verdicts, identical forever for identical
inputs.
