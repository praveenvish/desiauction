# SETTLEMENT ARCHITECTURE DECISION RECORDS

## DesiAuction NEXT · v1.0 · 2026-07-15 · CTO · **FROZEN** (IP-5, M-IP5-4)

> The load-bearing decisions ratified for IP-5 and preserved through freeze.
> These are the constraints another engineering organization must not violate
> without a **thaw** (a new ADR + re-certification).

## ADR-1 · The event catalog is closed at 24 types

Case (13) + journal (4) + payment (7). Every reducer fails closed on anything
else, so an older reducer reading a newer log **halts loudly** instead of
mis-folding money. The directive's workflow vocabulary across all milestones
(CreatePayment, WebhookReceived, PaymentExpired, CaseReadyForClosure,
DiscrepancyDetected, OverrideApproved, …) **maps onto** these 24 types — no new
type was ever added. Adding one is a thaw.

## ADR-2 · Three aggregates, one writer, projections are disposable

SettlementCase (per auction), OrgJournal (per org), Payment (per attempt) — each
with one stream, one pure reducer, one projection authority. The Settlement
Writer (web tier) is the single mutation authority; the unique
`(stream_type, stream_id, seq)` makes a concurrent writer fail loudly. Every
balance is a **fold**; no balance is stored with authority anywhere. The genesis
fold is the definition of truth; checkpoints are byte-verified acceleration.

## ADR-3 · No obligation-adjust command (deferred)

`ObligationAdjusted` exists in the catalog and reducer, but the ratified posting
templates give an adjustment no journal shape, so **no writer command ships it**.
Exposing it would let a team's case dues diverge from its dues wallet. Foundation
instead holds the stronger invariant *dues wallet == case outstanding at every
seq*. Organizer-initiated dues adjustments require ratifying an Adjustment
posting template first — a thaw, not an implementation choice.

## ADR-4 · Payments are ports; the manual channel is first-class

`PaymentGatewayPort` is owned by the domain; adapters (Razorpay, Manual) live in
the app tier. No provider SDK crosses into `packages/settlement`. Manual
attestation is a **first-class channel**, not a bypass: it produces the same
`PaymentCaptured` event through the same writer, flagged as attested, never
masquerading as provider truth. Gateway transitions come only from HMAC-verified
webhooks and the reconciliation sweep (provider-truth doctrine).

## ADR-5 · The settlement capability partition

Settlement owns a parallel capability engine over identity's `grants` substrate;
the frozen `Capability` union is untouched. The two engines expand the other's
sets to nothing — proven in both directions. `org:owner` holds no implicit money
power; money authority is an explicit, per-person, per-org grant. Issuance is
the one sanctioned cross-context write, gated by the frozen `grant.issue`.

## ADR-6 · Closure is verified, evidence is reproducible, the auction stays frozen

Closure runs the financial verification engine (seven deterministic checks) and
**cannot emit `CaseClosed` without it passing** — a failed check is a
deterministic rejection (money quiesces). The proof is an immutable evidence
package embedded in `CaseClosed`, pinned by `caseEventCount` + `journalSeq`, and
reproducible by replay forever (even across reopen). "Reconciled" is a pure
**overlay** off the settlement case's closed state — the auction's status and
event catalog are never touched. Reopen is compensating (override + reason),
never a back edge; a closed financial history is corrected only by new
append-only events.

## ADR-7 · Verify every row before deciding; heal from events; never guess

Adopted as a birthright from the IP-4 D-2/D-3 lesson: every projection row the
writer reads to decide is diffed against the fold first; a divergence halts the
aggregate fail-closed; recovery rebuilds the rows FROM the events, byte-identical.
Corruption of the log itself is unhealable-by-design (restore-from-backup),
never a hand patch.

## ADR-8 · The per-org journal is a deliberate serialization ceiling

One journal stream per org makes multi-account money movement atomic (one
balanced posting, one total order). The price is sequential-append throughput,
ample at the certified envelope; the loser of a race retries. Promotion to a
dedicated per-org writer process is the named, internal, non-breaking remedy —
a ceiling on scale, never on truth (the IP-4 R-2 pattern).
