# IP-5 — SETTLEMENT · ARCHITECTURE

## DesiAuction NEXT · v1.1 · 2026-07-15 · CTO · **Constitutional phase artifact** (IP-5, phase open)

> The canonical IP-5 architecture. Nothing in this phase may be implemented
> until this document is approved; every later IP-5 milestone is measured
> against it. Governed by canon C-7/C-8/C-9/C-13/C-18, docs
> [39](../39-state-machines.md) · [45](../45-billing-model.md) ·
> [46](../46-payment-flow.md) · [48](../48-audit-strategy.md) ·
> [51](../51-event-architecture.md), and the frozen IP-4 package
> ([ARCHITECTURE](../auction/ARCHITECTURE.md) ·
> [EVENT_CATALOG](../auction/EVENT_CATALOG.md) ·
> [LEDGER](../auction/LEDGER.md) §6 · [MONEY](../auction/MONEY.md) ·
> [IP-4_CLOSURE_REPORT](../auction/IP-4_CLOSURE_REPORT.md) §10).

### Constitutional constraints (ratified by the dependency authorization — binding, not revisited)

1. **IP-4 is immutable.** Zero modification of anything reachable from tag
   `ip4-frozen`'s certified surfaces (§26 defines the zero-diff gate).
2. **Settlement owns its own event stream.** It never writes `auction_events`.
3. **Auction events are read-only.** The frozen log and its pure fold are the
   only auction history settlement may consume.
4. **Wallets are append-only.** No balance is ever stored or edited; every
   balance is derived.
5. **Payments are adapters.** Every external gateway sits behind a port owned
   by the settlement domain.
6. **The money kernel is frozen.** `packages/core` Money (integer paise,
   closed arithmetic, bijective serialization) is consumed as-is; no arithmetic
   on money exists outside it.
7. **IP-5 is purely additive.** New package, new tables, new events, new
   surfaces; nothing existing changes shape.

---

## 1 · Purpose

IP-4 froze a machine that tells the truth about an auction night. IP-5 builds
the machine that **settles** that truth: it converts the frozen auction ledger
into a verified statement of account, tracks the real-world money the organizer
collects against it, issues receipts, and closes the night with the same
incorruptibility guarantees the auction itself earned — append-only history,
derived balances, deterministic replay, fail-closed verification.

Settlement is the organizer's exhale (doc 04 beat 5, doc 39
`Completed → Reconciled`): *receipts issued, ledger checksum verified, results
published*. It is also the platform's financial spine: the double-entry
journal, the wallet views over it, and the payment ports built here are the
substrate every later commercial phase (Pass billing, registration fees,
exports) will reuse without redesign.

The phase succeeds when a completed auction can be taken from
"the gavel fell" to "every rupee accounted for, every receipt issued, the case
closed" — with every step an event, every balance a fold, and every replay
producing identical balances to the paisa.

## 2 · Bounded Context

**Context name: Settlement.** Ubiquitous language: **Case** (one auction's
settlement), **Intake** (the pinned fold of the frozen auction log),
**Obligation** (a team's dues on a case), **Posting** (a balanced double-entry
journal fact), **Wallet** (a derived account view over the journal),
**Payment** (one collection attempt, gateway or manual), **Attestation** (a
human-recorded offline payment), **Waiver** (an audited forgiveness),
**Receipt** / **Credit Note** (immutable money documents), **Closure** (the
terminal, published state of a case).

Context relationships (all conformist-consumer, never partnership):

| Neighbor | Direction | Published language consumed | Never |
|---|---|---|---|
| **Auction** (frozen, `ip4-frozen`) | upstream | `auction_events` read-only + the pure fold (`replayAuction`) and ledger fold from frozen core | write events · mutate rows · require a rule change · re-derive its own money differently |
| **Identity** (frozen, `ip2-frozen`) | upstream | sessions, `grants` substrate, audit substrate, tenancy — plus the one declared cross-context write (§20: settlement grant issuance, under identity's unchanged policies) | modify the capability engine or its sets |
| **Competition** (frozen, `ip3-frozen`) | upstream | team/competition reference data (names, ids) via existing read surfaces | write anything |
| **Future Billing / Ops / Notifications** | downstream | settlement read models, the payment port, the journal | those phases never write settlement events |

**The reconciliation boundary decision (D1 — the trap, named).** The frozen
auction machine contains a `completed → reconciled` edge, but the frozen
command model exposes **no reconcile operation**, the frozen event catalog is
**closed at 28 types with no reconcile event**, and the frozen watchdog
verifies the `auctions` status row against the log and heals it — a
directly-mutated status would be detected as divergence and reverted.
Therefore **an auction's stream can never record reconciliation, and
settlement must never try**. "Reconciled" is a **settlement fact**: the truth
is `CaseClosed` in the settlement stream, and any surface that renders an
auction as *Reconciled* derives it by overlaying the settlement read model on
the auction's frozen `completed` status. No auction write exists, ever.

## 3 · Responsibilities

Settlement owns, exclusively:

1. **Case lifecycle** — opening a settlement case on a completed (or
   abandoned) auction, pinning intake, verifying the frozen log's fold,
   freezing on discrepancy, settling, closing, and the audited compensating
   paths (reopen, void).
2. **Obligation computation** — the pure, deterministic conversion of the
   frozen ledger fold into per-team dues under the organizer's declared
   obligation basis (§11), recorded as events.
3. **The org journal** — the only place money moves: balanced, append-only,
   double-entry postings with full provenance.
4. **Wallets** — derived account balances and statements over the journal.
5. **Payments** — gateway and manual collection lifecycles, provider-truth
   doctrine (invariant 25), webhook verification and idempotency, the daily
   reconciliation sweep against provider records (doc 46).
6. **Money documents** — receipts and credit notes: immutable at issue, dense
   org-scoped numbering, corrections as new documents (invariant 24).
7. **The settlement audit trail** — every mutation audited in-transaction
   (invariant 28), owner-visible money trails (doc 48).
8. **Its own recovery** — halt-on-divergence, heal-from-events, for every
   settlement aggregate.
9. **Its own capability vocabulary** — the settlement capability sets and the
   grant actions that mint them (§20).

## 4 · Out of Scope

Explicitly not IP-5 (each is a later phase that will consume, not modify,
what IP-5 builds):

- **Pass / entitlement billing** (doc 45) and GST invoices — the Pass lane
  will reuse the Payment port, the journal, and the document model; it is not
  built here.
- **Registration fees** (doc 42/46 V1.5 lane, Razorpay Route) — reserved.
- **Notifications** (WhatsApp/SMS/email) — never on the money path (C-16/C-19);
  settlement emits events others may subscribe to later.
- **PDF export pipeline** (doc 53) — receipts are data plus a printable
  surface in IP-5; branded document rendering arrives with exports.
- **Payouts, transfers, marketplace, platform commission** — no money leaves
  the platform in IP-5; settlement records collections, it does not move funds
  between third parties.
- **Dunning / collection enforcement** — settlement records truth; chasing is
  human.
- **Any auction behavior** — no new auction rules, commands, events, surfaces,
  or performance work. R-1/R-3 (delta broadcast, hash-chained auction log)
  remain post-freeze ADR candidates owned by the Auction backlog, not IP-5.
- **Multi-currency** — INR integer paise only (C-7).

## 5 · Dependency Graph

Arrows point from consumer to consumed. Everything below the line is frozen;
every IP-5 arrow into it is **read-only** (the single declared exception —
grant-row issuance under identity's unchanged policies — is specified in §20).

```
                 apps/web  (settlement surfaces + Settlement Writer + adapters)
                    │
                    ▼
            packages/settlement          packages/contracts (additive wire schemas)
       (pure domain: machines, reducers, │
        postings, capabilities, ports)   │
                    │                    │
        ┌───────────┼────────────────────┘
        ▼           ▼
   packages/db   packages/core ────────── FROZEN (money kernel, replayAuction,
  (additive       read-only                ledger fold, capability engine)
   migrations,      │
   new tables)      ▼
 ═══════════════════════════════════════════════════════════ ip4-frozen ═════
   auction_events (read-only) · auctions/lots/bids/paddles (read-only)
   grants/org_members/audit_log substrate (identity, additive rows only)
   teams/competitions reference (read-only)          apps/engine (untouched)
```

Boundary rules (dependency-cruiser-enforced, §26):

- `packages/settlement` imports **only** `packages/core` (frozen, read-only)
  and `packages/contracts`. It never imports `packages/auction`, `packages/db`,
  or any app.
- Apps import packages; packages never import apps (existing platform rule).
- `apps/engine` gains **zero** edges — in or out.
- No IP-5 module imports the auction aggregate; auction history enters
  settlement **only** as `auction_events` rows folded by frozen core functions.
- No settlement import may appear in `apps/web/src/server/auction` (the
  zero-diff gate makes this structural); the *Reconciled* overlay composes at
  the page layer, outside the frozen server modules.

## 6 · Package Structure

| Location | Content | Status |
|---|---|---|
| `packages/settlement` | **New.** The pure domain: settlement/payment state machines and guards, the case/journal/payment replay reducers, posting templates, obligation computation, receipt/statement folds, the settlement capability module, the `PaymentGatewayPort` port definition. Zero IO, zero ambient time, zero randomness — the `packages/core/src/auction.ts` discipline, verbatim. | created in M-IP5-1 |
| `packages/db` | Additive migrations `0011+`: `settlement_events`, `settlement_cases`, `settlement_obligations`, `journal_postings`, `journal_legs`, `journal_checkpoints` (disposable acceleration artifact, §13), `payments`, `receipts` — all org-scoped with RLS read+write policies from birth (§21). The eleven frozen migrations (0000–0010) byte-untouched (§26). | additive |
| `packages/contracts` | Additive settlement wire schemas (desk, statement, webhook ack, diagnostics). New modules only; no existing export changes. | additive |
| `apps/web/src/server/settlement/` | **New.** The Settlement Writer (sole mutation authority, §7), the coordinator policies, read-model assembly, the settlement grant actions (§20), and the gateway adapters (Razorpay adapter; Manual-attestation adapter). Follows the `requireSession → resolveTenant → requireCapability → act → audit` spine (identity D7). | new |
| `apps/web/src/app/…/settlement` | **New surfaces**: Settlement Desk, Case view, Team Statement, Receipt register, Payment log, Case ledger/replay (§12). FLOODLIGHT components as-is. | new |
| `apps/engine`, `packages/auction`, `packages/core`, `packages/ui` | **Untouched.** | frozen |

**D6 — no new runtime process.** Settlement is human-paced (an organizer and a
handful of payments over days), not contention-heavy; it needs no tick, no
WebSocket fan-out, no dedicated single-writer daemon. The Settlement Writer
lives in the web tier; the single-writer-per-aggregate invariant is enforced
**structurally**, exactly as IP-4's D2: the unique `(stream_type, stream_id,
seq)` makes a concurrent writer's append fail loudly, and the loser retries or
reports.

**The per-org journal is a deliberate serialization ceiling.** One journal
stream per org is what makes multi-account money movement atomic: a balanced
posting is one fact in one total order, so no transfer can ever half-happen
and the trial balance is checkable at every seq. The price is that org-wide
money throughput is bounded by sequential append: concurrent captures collide
on the journal seq, the loser retries with bounded backoff, and correctness
never depends on winning the race. At the certified envelope (§24) this bound
is ample — collections are owner-paced, and even a burst of every owner paying
at once is dozens of postings, not thousands per second. If a future season
outgrows it, the promotion path is IP-4's own: the Settlement Writer becomes a
dedicated single-writer process (per org), an **internal, non-breaking**
change — the log shape, the events, the reducers, and the authorities are
already built for it. Like IP-4's R-2, this is a ceiling on how large
settlement may grow, never on whether it tells the truth.

## 7 · Event Architecture

One doctrine, inherited whole from IP-4 and applied to new streams:

- **Envelope** (persisted in `settlement_events`, append-only):
  `stream_type` (`case` | `journal` | `payment`) · `stream_id` · `seq`
  (per-stream total order, dense from 1) · `type` · `at_ms` (server epoch ms,
  injected — the only clock) · `actor` (person ULID or system sentinel) ·
  `correlation_id` (ties event ↔ audit row ↔ request) · `payload` (JSON;
  money as exact integers) · `org_id` (tenancy). Unique
  `(stream_type, stream_id, seq)`.
- **One aggregate, one stream, one reducer, one projection authority, one
  mutation authority** — per mutable concept (D2):

| Mutable concept | Aggregate | Stream | Reducer (pure, in `packages/settlement`) | Projection authority | Mutation authority |
|---|---|---|---|---|---|
| A night's settlement | **SettlementCase** (one per auction) | `case:{caseId}` | case fold | `settlement_cases` + `settlement_obligations` rows | Settlement Writer |
| An org's money movements | **OrgJournal** (one per org) | `journal:{orgId}` | journal fold | `journal_postings` + `journal_legs` rows; every wallet balance | Settlement Writer |
| One collection attempt | **Payment** (one per attempt) | `payment:{paymentId}` | payment fold | `payments` rows | Settlement Writer (webhook and sweep ingress included) |

- **Emission discipline**: every mutation appends **exactly one** event to
  exactly one stream, with a **same-transaction** audit row (invariant 28 —
  audit failure fails the action) and same-transaction projection updates
  (projection lag zero, IP-4 D1). Composite outcomes are separate envelopes
  sharing one `correlation_id`.
- **Commands and idempotency**: every mutation enters through a command
  carrying `commandId`; a duplicate returns the **original ack** without
  re-execution (engine discipline, M-IP4-2). Every command acks
  Accepted/Rejected with a deterministic reason.
- **Cross-aggregate coordination** is by deterministic policy, never by
  distributed transaction: after an event commits, the coordinator derives
  follow-up commands with **derived command ids**
  (`{source stream}:{seq}:{policy name}`), so re-running coordination after a
  crash is idempotent by construction. The catalog (§8) names each policy edge.
  A catch-up scan (on writer start and on recovery) re-derives commands for any
  source event whose policy effect is absent — coordination is replayable.
- **Closed catalog**: the reducer fails closed (`unknown_event_type`) on
  anything outside §8. Adding an event type after freeze is an ADR.
- **No secrets in the log**: gateway credentials, webhook secrets, raw
  provider payload blobs, and attestation evidence files stay outside the
  stream; events carry references and verified facts only (the
  `auction_owner_invites` precedent).
- **Lifecycle transitions are human commands; bookkeeping is policy.** A case
  never advances state because money arrived; a person closes it. Policies
  only record consequences (postings, discharges).

## 8 · Settlement Event Catalog

**v1.0 — the prescriptive set.** Milestones may not invent types outside this
catalog without amending this document pre-freeze; at freeze the catalog
closes. All money fields are integer paise. `compensates` fields carry the seq
being reversed — history is never rewritten.

### 8.1 · Case stream (`case:{caseId}`) — 13 types

| Event | Emitted on | Payload (summary) | Replay effect |
|---|---|---|---|
| `CaseOpened` | open command | caseId, auctionId, competitionId, obligationBasis (§11), sourceEventCount, sourceDigest | case → `opened`; intake pinned |
| `CaseVerified` | verify command (fold matches pin) — including override re-verification, which **re-pins** (§11) | foldDigest, **sourceEventCount, sourceDigest** (the pin this verification stands on — every verification records it), teamCount, totalCommitted | case → `verified`; pin refreshed to the payload's values |
| `CaseDiscrepant` | verify command (mismatch / fold failure) | reasonCode, detail | case → `discrepant` (frozen-money posture) |
| `ObligationsComputed` | compute command from `verified` | items [{teamId, amount}] — pure function of (fold, basis) | obligations registered, all outstanding |
| `ObligationDischarged` | policy: on collection posting | teamId, amount, paymentId, postingRef | outstanding −= amount; fails closed if over-discharge |
| `ObligationWaived` | waive command (**override**) | teamId, amount, reason | outstanding −= amount, marked waived |
| `ObligationReinstated` | policy: on the dues-debiting portion of a refund posting (§9.3) | teamId, amount, paymentId, postingRef, compensates | outstanding += amount (compensating, never a delete) |
| `ObligationAdjusted` | adjust command (**override**) | teamId, kind (`increase`\|`reduce`), amount, reason | obligation resized; audit-heavy |
| `CaseSettled` | settle command | — (guard: every obligation outstanding = 0) | case → `settled` |
| `CaseClosed` | close command | publishedDigest, receiptRefs | case → `closed` (terminal; the **Reconciled** designation) |
| `CaseReopened` | reopen command (**override**) | reason, compensates | `settled`/`closed` → `settling` (compensating) |
| `CaseVoided` | void command (**override**) | reason | case → `voided` (terminal; guard: zero journal postings reference the case) |
| `CaseRecovered` | recover command | divergences, eventCount | — (recovery **is** the replay) |

### 8.2 · Journal stream (`journal:{orgId}`) — 4 types

| Event | Emitted on | Payload (summary) | Replay effect |
|---|---|---|---|
| `JournalPosted` | policy (obligation/collection/waiver/refund) or adjust command | postingId, template (§9.3), legs [{account, direction, amount}], source {stream, seq}, memo | legs applied to accounts; fails closed unless legs sum to zero, the shape matches the named template, and source is unique |
| `ReceiptIssued` | issue command | receiptId, receiptNo (dense per-org series = journal order), caseId, teamId, amount, coversPostings | receipt registered; number allocated |
| `CreditNoteIssued` | credit command (**override**) | noteId, noteNo, receiptId, amount, reason | reversal document registered (invariant 24: never an edited receipt) |
| `JournalRecovered` | recover command | divergences, eventCount | — |

### 8.3 · Payment stream (`payment:{paymentId}`) — 7 types

| Event | Emitted on | Payload (summary) | Replay effect |
|---|---|---|---|
| `PaymentInitiated` | initiate command | paymentId, caseId, teamId, method (`gateway:razorpay` \| `manual:cash` \| `manual:upi-direct` \| `manual:bank`), amount, orderRef? (gateway orders carry paymentId + org identity in provider metadata — the webhook's trusted envelope, §21) | payment → `created`; amount pinned (guard: ≤ team outstanding) |
| `PaymentAuthorized` | webhook ingress (gateway only) | providerRef, providerEventId | → `authorized` |
| `PaymentCaptured` | webhook/sweep ingress (gateway) **or** attest command (manual) | providerRef?/providerEventId? · attestedBy?/evidenceRef?, amount | → `captured` (triggers Collection posting policy) |
| `PaymentFailed` | webhook ingress / expiry sweep | code, detail | → `failed` (terminal; retry = **new** payment, same case) |
| `PaymentRefunded` | webhook/sweep ingress (gateway) or reverse command (**override**, manual) | providerEventId?, amount, reason | refundedTotal += amount (guard: cumulative ≤ captured); state stays `captured` while refundedTotal < captured, → `refunded` (terminal) when equal — **partial refunds are first-class** (§10); each triggers the Refund posting policy |
| `PaymentDisputed` | webhook ingress | providerRef, reason | → `disputed` (attention queue; frozen posture) |
| `PaymentRecovered` | recover command | divergences, eventCount | — |

**24 types total (13 + 4 + 7).** Policy edges (deterministic, idempotent,
source-keyed): `ObligationsComputed → JournalPosted(Obligation)×N` ·
`PaymentCaptured → JournalPosted(Collection | Overpaid Collection) →
ObligationDischarged` · `ObligationWaived → JournalPosted(Waiver)` ·
`PaymentRefunded → JournalPosted(Refund) → ObligationReinstated` (for the
dues-debiting portion only).

## 9 · Wallet Model

**D3 — wallets are projections; the journal is the aggregate.**

### 9.1 · Double-entry, append-only

Every financial mutation in the platform is a `JournalPosted` event on the
org's single journal stream: a **posting** of **legs**
`(account, debit|credit, amount)` that **must sum to zero** (debits = credits,
exactly, in integer paise). The reducer fails closed on an unbalanced posting
(`unbalanced_posting`) — an unbalanced ledger is unrepresentable in a replayed
projection. Corrections are new compensating postings; no posting is ever
edited or deleted.

### 9.2 · Balances are folds

A **wallet** is a named view over one account: its balance is the fold of that
account's legs; its statement is the leg list in journal order. Nothing stores
a balance — not a column, not a cache with authority. The `journal_legs`
projection table exists for query ergonomics and is disposable (§13); the
truth is the stream. **Trial balance zero** — the sum over all accounts at
every journal seq — is a machine-checked invariant (§17), not a report.

### 9.3 · Chart of accounts (closed set of families) and posting templates

Accounts are structured strings from a **closed set of families**; posting
templates are the **only** shapes money movement can take. Each template has a
fixed leg shape whose amounts are a pure function of its inputs — no free-form
journal entry exists, and the reducer rejects a posting whose legs do not
match its named template's shape:

| Family | Account | Meaning |
|---|---|---|
| `dues` | `dues:{caseId}:{teamId}` | what a team owes on a case (receivable) |
| `case-control` | `case:{caseId}` | the case's contra — total obligations recognized |
| `funds` | `funds:{method}` | value collected, by method (`gateway:razorpay`, `manual:cash`, …) |
| `waived` | `waived:{caseId}` | audited forgiveness (visible, never a quiet zeroing — invariant 25 spirit) |
| `refund-liability` | `refund-liability` | over-collection awaiting refund |

| Template | Legs (fixed shape; sums to zero) | Source event |
|---|---|---|
| **Obligation** | debit `dues:{case}:{team}` · credit `case:{case}` | `ObligationsComputed` |
| **Collection** | debit `funds:{method}` · credit `dues:{case}:{team}` — used when captured amount ≤ outstanding | `PaymentCaptured` |
| **Overpaid Collection** | debit `funds:{method}` (full capture) · credit `dues:{case}:{team}` (the outstanding portion) · credit `refund-liability` (the excess) — three legs, selected deterministically whenever capture > outstanding (the raced-waiver case, §22 F-8) | `PaymentCaptured` |
| **Waiver** | debit `waived:{case}` · credit `dues:{case}:{team}` | `ObligationWaived` |
| **Refund** | credit `funds:{method}` (refund amount) · debits by the **liability-first rule**: `refund-liability` up to its remaining balance for this payment, then `dues:{case}:{team}` for the remainder — a pure function of (amount, remaining liability); only the dues-debiting portion reinstates obligations (§8.1) | `PaymentRefunded` |

The template set and the account families are **closed**; adding either after
freeze is an ADR. Wallet views in product language: the **Team wallet**
renders `dues:{case}:{team}` (what the owner owes/paid — the owner-visible
money trail, doc 48); the **Org cash view** renders `funds:*`; the **Case
wallet** renders the case's control and waiver accounts.

### 9.4 · Provenance and idempotency

Every posting carries `source {stream, seq}` — the event that caused it — and
the reducer fails closed on a duplicated source (`duplicate_posting_source`).
**One cause, one posting**: each source event produces exactly one posting
(an overpaid capture is one three-leg posting, never two postings). Money
without provenance is unrepresentable; the same cause can never post twice.

## 10 · Payment State Machine

One machine (doc 39, frozen canon — restated, not redesigned), two transition
authorities distinguished by `method`:

```
created ──authorize──▶ authorized ──capture──▶ captured ──dispute──▶ disputed
   │                        │                     │ ⟲ refund (partial; Σ < captured)
   │                        │                     └─refund (Σ = captured)──▶ refunded
   └────────fail────────────┴──fail──▶ failed   (terminal; retry = NEW payment)

manual methods enter captured directly (attestation), from created:
created ──attest──▶ captured        (attestedBy + evidenceRef, audited)
```

| Rule | Content |
|---|---|
| **Transition authority — gateway** | Provider truth only (invariant 25): HMAC-verified webhooks and the daily reconciliation sweep. The browser callback never transitions anything — it renders "confirming…" (doc 46). |
| **Transition authority — manual** | A capability-gated human attestation (`settlement.collect`), recorded with attester and evidence reference, flagged as attested (never masquerades as provider truth). Reversal of a manual payment is override-gated. |
| **Idempotency** | Webhook ingress is idempotent by `providerEventId` (doc 46/50); a replayed webhook returns the original ack and appends nothing. Manual attestation is idempotent by `commandId`. |
| **Amounts** | Pinned at `PaymentInitiated`, ≤ the team's outstanding at initiation; full-amount capture only in V1 (installments = multiple Payment aggregates — the market's part-payment reality is modeled as many payments, not partial captures). |
| **Refunds** | **Partial refunds are first-class**: a `captured` payment accumulates `PaymentRefunded` events, each guarded by cumulative-refunds ≤ captured; the payment reaches the terminal `refunded` state only when cumulative refunds equal the capture. This is what lets an overpayment be resolved by refunding exactly the excess (§9.3 liability-first rule) without unwinding the legitimate collection. Gateway refunds are provider-truth events; manual reversals are override-gated. |
| **Terminality** | `failed` is terminal — retry is a new payment (new order, same case; doc 46). `disputed` freezes the affected discharge posture until human resolution (invariant 17's commercial cousin). |
| **Order → case linkage** | Gateway orders are created at initiation carrying `receipt = paymentId` **and the org's ULID in provider order metadata**, both pinned in `PaymentInitiated`. This is the webhook's **trusted envelope** (§21): the webhook's order/amount/currency/org are verified against the pinned initiation before any transition (doc 46). |

**D4 — the port.** `PaymentGatewayPort` is defined in `packages/settlement`
(the domain owns the port; adapters implement it web-side): create-order,
verify-webhook-signature, fetch-payment-record (for the sweep), initiate-refund.
Adapters in IP-5: **Razorpay** (C-18) and **Manual attestation** (the desi
market's cash/direct-UPI majority — a first-class adapter, not a bypass: it
produces the same `PaymentCaptured` event through the same writer with
attestation fields). A second gateway is a new adapter, never a rewrite. The
domain never imports a provider SDK; no provider type crosses the port.

## 11 · Settlement State Machine

```
            ┌─────────── void (override; guard: no postings) ──────────┐
            │                                                          ▼
opened ──verify──▶ verified ──compute──▶ settling ──settle──▶ settled ──close──▶ closed
   │                  │  ▲                                       ▲                 │
   │ (fold mismatch)  │  │ re-verify (override, audited,         │                 │
   └──▶ discrepant ◀──┘  │  RE-PINS intake)                      └──── reopen ─────┘
            │____________│                                     (override, compensating)
            └────────────────────── void (override) ──▶ voided (terminal)
```

| Transition | Guard (all pure, in `packages/settlement`) | Capability (§20) |
|---|---|---|
| open | auction status ∈ {completed, abandoned} · no existing non-voided case for this auction (one case per auction, partial-unique) · intake digest pinned at open | `settlement.manage` |
| verify | re-fold of `auction_events` succeeds fail-closed **and** fold digest = pinned digest **and** event count = pinned count → `verified`; anything else → `discrepant`. Every `CaseVerified` records the pin it stands on (sourceDigest + sourceEventCount) | `settlement.manage` |
| discrepant → verified | re-verify after investigation; **override** + mandatory reason; the emitted `CaseVerified` **re-pins intake** — it records the fresh sourceDigest and sourceEventCount as the new pin. This is what absorbs the one lawful way a completed auction's stream can grow: an `AuctionRecovered` append (the only command legal on any auction) changes the event count without changing the fold, so re-verification confirms the fold digest and re-pins the count instead of stranding the case in `discrepant`. While `discrepant`, the frozen posture holds (invariant 17): no obligation, payment, or waiver command is accepted | `settlement.override` |
| compute | from `verified` only; obligations = pure function of (fold, **obligationBasis**); basis ∈ `committed` (each team's committed total is its dues) · `fixed` (declared per-team amount recorded at open) · `none` (statement-only: verification, receipts of record and publication, zero collections). The basis is the organizer's declared policy, pinned at `CaseOpened` — **the platform never invents a debt** | `settlement.manage` |
| settle | every obligation outstanding = 0 (discharged + waived + adjustments net to zero) | `settlement.manage` |
| close | from `settled`; every discharged team's receipt issued; published digest recorded. Terminal. Surfaces render the auction **Reconciled** (§2 D1) | `settlement.manage` |
| reopen | from `settled`/`closed`; **override** + mandatory reason; compensating event — the closed history stays; subsequent corrections are new postings/documents | `settlement.override` |
| void | from `opened`/`verified`/`discrepant` only, and only while zero journal postings reference the case; **override** + reason. Terminal. (An abandoned auction's case is typically voided or settled `none`.) | `settlement.override` |

While a case is `discrepant` or a payment `disputed`, money quiesces — the
non-deterministic-money state is frozen for human resolution, never guessed at
(invariant 17).

## 12 · Read Models

All read models are **grant-filtered at assembly** (C-8), derived purely from
folds, and disposable. None is a second source of truth.

| Read model | Content | Audience (authority) |
|---|---|---|
| **Settlement Desk** | all cases for the org: status, totals, outstanding, discrepancies, attention items (disputes, refund liabilities, sweep mismatches) | `settlement.view` |
| **Case view** | one case: intake pin, verification result, obligations with discharge/waiver detail, payments, documents | `settlement.view` |
| **Team Statement** | one team on one case: obligations, every payment with method and status, waivers, receipts — the owner's money trail (doc 48: transparency to the person whose money moved) | the team's accepted owner(s) — derived from the frozen auction fold's owner facts (§19); org side via `settlement.view` |
| **Wallet balances / Trial balance** | every account's derived balance; org-wide zero-sum check surfaced, not assumed | `settlement.view` |
| **Payment log** | every payment attempt with provider refs, webhook trail, sweep results | `settlement.view` |
| **Receipt register** | dense-numbered receipts and credit notes | `settlement.view`; a team's own documents to its owners |
| **Case Ledger** | the human-readable rendering of the case's full event history — the `AuctionLedger` pattern: a pure fold `(events, refs, names) → rows`, regenerated on read, **never a table**; unknown types render as themselves | `settlement.view` |
| **Reconciled overlay** | `auctionId → closed-case designation` for auction/competition surfaces (§2 D1) | same visibility as the auction surface it decorates |

## 13 · Projection Strategy

The IP-4 doctrine, whole:

1. **Transactional with the append.** Projection rows (`settlement_cases`,
   `settlement_obligations`, `journal_postings`, `journal_legs`, `payments`,
   `receipts`) update in the same transaction as the event append — zero lag,
   no eventual anything inside an aggregate.
2. **Verified on every command — at bounded cost.** Before acting, the writer
   re-derives the aggregate's fold and diffs the projection rows it will read
   against it — **every row the writer reads to decide is verified** (the
   D-2/D-3 lesson, adopted as a birthright rather than a defect fix).
   Divergence halts the aggregate fail-closed (§15). For the **case** and
   **payment** streams — bounded by a night and an attempt — the fold runs
   from genesis on every command. For the **org journal** — the one stream
   that grows without bound across seasons — command-path verification uses
   **verified fold checkpoints** (§13a) so its cost is independent of journal
   length.
3. **Disposable.** Any projection table can be truncated and rebuilt from its
   stream to byte-identical rows. Rebuild is a maintenance command, not a
   migration. Checkpoints are equally disposable (§13a).
4. **One projection authority per stream** (§7 table). Read models compose
   from folds and projection rows; nothing else writes them.
5. **Documents are folds too.** A receipt's rendered content derives from
   `ReceiptIssued` + covered postings; regeneration is byte-identical
   (canonical serialization, §23). Immutability of issued documents is the
   replay guarantee, not a locked row.

### 13a · Verified fold checkpoints (journal only)

A **checkpoint** is the journal reducer's canonical fold state at seq N —
serialized bytes plus their digest, persisted in `journal_checkpoints`
(org-scoped, RLS'd like everything else). Checkpoints exist so the
verification rule survives unbounded journal growth without becoming cached
truth:

- **Creation** is at a fixed cadence — every 1,000 journal events — by the
  writer, deterministically (the fold state it already holds, canonically
  serialized). A new checkpoint is **unverified** at birth.
- **Verification**: a background pass re-folds the journal **from genesis**
  and marks the checkpoint verified only on **byte-identity** with the
  genesis fold at that seq. A mismatch halts the journal like any other
  integrity failure.
- **Use**: the command path folds from the latest **verified** checkpoint
  through the tail events and diffs the touched rows — O(cadence + tail),
  bounded by roughly two cadence intervals regardless of journal length.
  Trial-balance checking runs on the folded state (O(accounts)).
- **Never truth**: genesis replay remains the definition of the journal
  (§14). Checkpoints are re-derivable acceleration — truncate them all and
  the system re-creates them from the stream; recovery (§15) and every
  certification run fold from genesis and re-verify the chain; a tampered or
  stale checkpoint is detected exactly like a tampered projection row.

The case and payment streams need no checkpoints and get none — their folds
are small by construction, and fewer moving parts is the point.

## 14 · Replay Strategy

- One **pure reducer per stream type** in `packages/settlement`; replay is a
  fold from seq 1 with no IO, no clock, no randomness. **The genesis fold is
  the definition of truth** for every stream; a checkpointed fold (§13a) must
  be byte-identical to it and holds no independent authority.
- **Fail-closed reason set (closed):** `sequence_gap` · `unknown_event_type` ·
  `illegal_replayed_transition` · `malformed_{event}` · `unknown_case` ·
  `unknown_team` · `unknown_payment` · `unknown_posting` · `unknown_receipt` ·
  `unbalanced_posting` · `template_shape_mismatch` ·
  `duplicate_posting_source` · `obligation_overdischarged` ·
  `refund_exceeds_captured` · `negative_account_flow` (a leg that would drive
  a `dues` account below zero). Anything unfoldable halts, loudly — an older
  reducer reading a newer log halts rather than mis-folds.
- **Replay reproduces identical balances** — the constitutional test: for any
  stream, fold twice (and on two independent processes) → byte-identical
  projections and paisa-identical balances. Certified at §25.
- **Cross-stream replay** needs no global order: policies are source-keyed, so
  re-deriving coordination from replayed streams reproduces the same postings
  and discharges regardless of interleaving.
- The **auction intake fold** uses only frozen core functions; settlement
  never re-implements auction replay. The pin (digest + event count) makes
  intake reproducible: verification at any later date re-folds the immutable
  auction log and must reproduce the pinned result — and every verification
  event records the pin it stood on (§11).

## 15 · Recovery Strategy

- **Halt-on-divergence, per aggregate.** A failed fold, a projection diff, a
  checkpoint divergence, a determinism check failure, or an unbalanced state
  halts **that aggregate**: its commands reject with `settlement_halted` until
  recovered. Other aggregates (and every auction) are unaffected.
- **Recovery is replay — from genesis, never from a checkpoint.**
  `RecoverCase` / `RecoverJournal` / `RecoverPayment` re-fold the stream from
  seq 1 and heal projection rows from events, emitting
  `*Recovered {divergences, eventCount}` — the auction `RecoverAuction`
  discipline. `RecoverJournal` additionally discards and re-derives the
  checkpoint chain, re-verifying it against the genesis fold. Recovery never
  invents facts; it restores the log's.
- **Healable:** any projection-row tamper, deletion, duplication, or drift —
  including money columns (`journal_legs.amount`, `payments.amount`,
  obligation outstanding) — and any checkpoint tamper or staleness.
  **Unhealable:** corruption of `settlement_events` itself (gap, malformed
  payload, unbalanced posting *in the log*) — that is restore-from-backup/PITR
  territory, documented in runbooks, never patched by hand.
- **Coordinator recovery:** the catch-up scan (§7) re-derives any policy
  effect missing after a crash; derived command ids make re-derivation
  idempotent.
- **Webhook recovery:** missed webhooks are healed by the daily sweep
  (fetch-payment-record through the port); the sweep's transitions carry the
  sweep sentinel actor and are idempotent by `providerEventId`.

## 16 · Money Invariants

Inherited from the frozen kernel ([MONEY](../auction/MONEY.md)) and extended —
each machine-enforced, none merely documented:

1. All money is **integer paise**, constructed only by the frozen kernel;
   floats, negatives, NaN, and >2^53 are unrepresentable.
2. **No arithmetic outside the kernel**: sums, differences, and comparisons in
   settlement — obligations, legs, balances, refund bounds — use kernel
   operations only; a lint boundary forbids `+`/`-` on money-typed values
   outside `packages/settlement`'s kernel-delegating functions.
3. Database money columns are `bigint`; SQL aggregates arrive as strings and
   are parsed exactly; event payloads carry plain JSON integers.
4. **Serialization is bijective**: canonical integer strings only; same value
   ⇒ same bytes, forever.
5. Display (`formatPaiseINR`) never feeds storage, comparison, or arithmetic.
6. Every amount in settlement is **non-negative**; direction lives in the leg
   (`debit`/`credit`) and the template, never in a sign.
7. Bounded flows: discharge ≤ obligation outstanding · cumulative refunds ≤
   captured (per payment) · initiation ≤ team outstanding · waiver ≤
   outstanding. Each violation is a deterministic rejection code, not an
   exception. (A capture may lawfully exceed outstanding when a waiver raced
   the order — the Overpaid Collection template absorbs the excess into
   `refund-liability` deterministically, §9.3.)

## 17 · Accounting Invariants

1. **Double-entry**: every posting's legs sum to exactly zero **and** match
   the fixed shape of the posting's named template (§9.3). Unbalanced or
   off-template postings are unrepresentable in a replayed projection (§14).
2. **Trial balance zero** at every journal seq, org-wide — property-tested
   across random walks (§25), verified on command (§13).
3. **Append-only corrections**: no posting, document, or event is edited or
   deleted; every correction is a compensating posting or a new document
   (credit note), itself permanent history.
4. **Every balance is derived**; no stored balance has authority anywhere —
   checkpoints included (§13a: byte-verified against genesis, disposable,
   never load-bearing for truth).
5. **Provenance**: every posting names its source event; every discharge names
   its posting and payment; every receipt names the postings it covers;
   every reversal names what it compensates. The chain from a rupee on a
   statement back to a gavel-fall in the frozen auction log is complete and
   machine-walkable.
6. **Conservation per case**: `case-control` = Σ obligations posted;
   Σ(discharged + waived + reinstated net) ≤ Σ obligations; on `CaseSettled`,
   every `dues` account folds to exactly zero.
7. **One cause, one posting**: source-keyed idempotency
   (`duplicate_posting_source` fails closed) — a webhook replayed, a policy
   re-run, a sweep repeated can never double-post; a single cause with a
   composite consequence (overpaid capture, liability-first refund) is one
   multi-leg posting, never two postings.
8. **Documents are dense**: receipt/credit-note numbers are allocated in
   journal order — a dense, replayable, per-org series; a gap is a halt, not a
   shrug.
9. **Obligations are pinned facts**: recomputing obligations from the frozen
   auction log under the pinned basis must reproduce `ObligationsComputed`
   exactly, at any later date.

## 18 · Audit Strategy

Doc 48, applied without exception:

- **Every settlement mutation** appends its event **and** an `audit_log` row
  in the same transaction — audit failure fails the action (invariant 28).
  The row carries who (actor + grant context) · what (action taxonomy
  `settlement.case.opened`, `settlement.payment.attested`,
  `settlement.obligation.waived`, … — one taxonomy with §8) · when · why
  (mandatory reason on every override-gated action) · source (`web`,
  `webhook:razorpay`, `sweep`, `recovery`) · correlation id · event seq.
- **Label snapshots** on subjects (team name, player-context) keep the trail
  readable after renames/erasure; DPDP erasure pseudonymizes actors, never
  removes financial facts (doc 48/49).
- **Webhook ingress is audited** even when it appends nothing (replayed
  event id, failed verification, envelope/aggregate mismatch) — rejected
  truth attempts are evidence.
- **Owner-visible trail**: the Team Statement is the owner's own audit slice —
  receipts, payments, waivers concerning their team (doc 48 "who sees what").
- Audit substrate immutability (append-only, no UPDATE/DELETE grants) is
  inherited from identity and re-proven over the new action taxonomy.

## 19 · Authorization Model

- **Grants, not roles** (C-8): settlement asks about capabilities on exact
  org scope through the same `grants` substrate; deny by default; revoked
  grants confer nothing; capability loss effective on next check.
- **One enforcement path** (identity D7): `requireSession → resolveTenant →
  requireCapability → act → audit` for every settlement server action. The
  writer re-checks capability inside command execution — surface affordances
  are courtesy, never the boundary.
- **Separation of powers** (the conduct/override precedent):
  `settlement.manage` (lifecycle), `settlement.collect` (record money in),
  and `settlement.override` (waive, adjust, reopen, void, reverse,
  discrepant-exit) are distinct atoms — recording a payment does not confer
  forgiving a debt; running a case does not confer rewriting one.
- **Owners** read their Team Statement without any settlement grant: access
  derives from the **frozen auction fold's owner facts** (`OwnerAccepted` /
  active `PaddleGranted` for the team) — no new grant machinery, no new
  owner table. Org existence privacy (404-not-403) and money-visibility
  redaction (invariant 35) carry over from platform rules.
- **Webhook ingress** authenticates by HMAC + timestamp window (doc 46/49),
  never by session; org identity comes from the verified envelope and is
  cross-checked against the pinned payment before any transition (§21). It
  can only cause payment-stream transitions for the payment its verified
  payload names.

## 20 · Capability Strategy

**The frozen `Capability` union is untouched (D7).** IP-3 grew the closed
union in `packages/core/src/capabilities.ts` additively, but that path closed
at `ip4-frozen`. IP-5 therefore adds a **parallel, settlement-owned capability
module** in `packages/settlement`:

- A closed union of settlement atoms: `settlement.view` ·
  `settlement.manage` · `settlement.collect` · `settlement.override` ·
  `settlement.export`.
- Named sets (ergonomics only): `settlement:officer` = {view, manage, collect,
  export} · `settlement:controller` = officer + {override} · nothing else.
- A pure evaluator with **identical fail-closed semantics** to the frozen
  engine (unknown set ⇒ ∅ · revoked ⇒ ∅ · exact scope only), unit-tested to
  the same standard.
- **Storage is the existing `grants` table** — additive rows whose
  `capability_set` is a settlement set name. No schema change
  (`capability_set` is unconstrained text by design).
- **Issuance authority — the one sanctioned cross-context write, declared
  here.** The frozen issuance paths refuse unknown sets by design (the
  invite-creation gate), so no existing path can mint a settlement grant —
  deliberately. Settlement grants are minted and revoked by the **settlement
  grant actions**, owned by the Settlement context
  (`apps/web/src/server/settlement/`): issuing requires the **frozen**
  `grant.issue` capability on the org scope and revoking the **frozen**
  `grant.revoke` — both evaluated by the frozen engine, so the power to hand
  out money authority rests exactly where the platform already vests the
  power to hand out authority. The action validates the set name against the
  settlement module's closed set (unknown sets refused at creation — nothing
  mints an unexpandable grant, the invites discipline), inserts the
  org-scoped grant row (identity's RLS write policy applies unchanged:
  `scope_type = 'org' AND scope_id = app.org_id`), and writes the audit row
  (`grant.issued` / `grant.revoked` taxonomy, settlement set named) in the
  same transaction. Identity remains the storage and policy owner; settlement
  owns only its own vocabulary. No other cross-context write exists in IP-5.
- **Fail-closed compatibility is the load-bearing property, proven by test:**
  the frozen engine's `capabilitiesOf` expands unknown sets to nothing, so a
  settlement grant confers **zero** frozen capabilities; and the settlement
  evaluator recognizes only settlement sets, so frozen sets (`org:owner`,
  `org:staff`) confer **zero** settlement capabilities. The two engines
  partition the capability space with no bleed in either direction.
- Deliberate consequence, stated plainly: **`org:owner` does not implicitly
  hold settlement powers.** Money powers are granted explicitly, per person,
  per org — the founder-visible act of trusting someone with the books.
  Invariant 2's spirit extends: a case cannot strand — `grant.issue` holders
  can always mint a `settlement:controller` grant.

## 21 · RLS Strategy

The identity/auction discipline, applied at birth — including the RC-4 lesson
(write-side from day one, never patched in later):

- Every new table (`settlement_events`, `settlement_cases`,
  `settlement_obligations`, `journal_postings`, `journal_legs`,
  `journal_checkpoints`, `payments`, `receipts`) carries `org_id` and gets
  `ENABLE` + `FORCE ROW LEVEL SECURITY` in its creating migration, with
  **both** `USING` and `WITH CHECK` keyed to
  `current_setting('app.org_id', true)` — fail-closed (NULL context ⇒ zero
  rows, rejected writes). No self-row disjunct exists on any settlement
  policy; no cross-org read shape is needed.
- **No new policies on frozen tables.** Settlement reads `auction_events` and
  reference tables under the existing frozen policies; it neither adds nor
  needs any.
- Proof tests run under dedicated **non-superuser** roles mirroring
  production: cross-tenant reads fold to zero rows; cross-tenant writes and
  no-context writes are rejected; the settlement writer's own transactions
  succeed under tenant context.
- **Pre-tenant resolution — the third sanctioned pattern.** The platform
  records two pre-tenant read patterns (identity RUNBOOKS R-1:
  invite-lookup-by-token, org-preview). Webhook ingress is the third,
  resolved by **trusted-envelope resolution**, so no org-scoped read ever
  runs without tenant context:
  1. At `PaymentInitiated`, the gateway order is created carrying
     `receipt = paymentId` and the org's ULID in provider order metadata —
     both pinned in the event (§10).
  2. Ingress verifies the webhook HMAC + timestamp window using
     **platform-level** webhook credentials — no database read.
  3. Org identity is taken from the now-verified envelope and tenant context
     is established (`app.org_id`, system actor) **before** any org-scoped
     read.
  4. Under that context, the payment aggregate is loaded and the envelope's
     claims are cross-checked against the pinned initiation (org, payment,
     order ref, amount, currency). A verified-HMAC envelope naming a payment
     that does not match its pin fails closed and is audited as attempted
     forgery — envelope data selects the tenant; the pinned aggregate is the
     authority it must agree with.

  The daily sweep needs no special pattern: it iterates orgs and runs under
  each org's tenant context with the sweep sentinel actor.
- **Recorded platform fact, inherited honestly:** runtime isolation is
  application-layer today (`withTenant` call sites = 0; IP-4 MAJ-2, a named
  pre-deploy item — not a freeze blocker then, not one now). IP-5 must not
  widen the gap: the Settlement Writer is built **withTenant-compatible**
  (single transaction per command, no pre-tenant reads on org-scoped
  settlement tables — the webhook path above establishes context first), so
  the one pre-deploy wiring item covers settlement with zero rework. Nothing
  in this design depends on BYPASSRLS.

## 22 · Failure Modes

Every mode has a named detection and a fail-closed disposition; none is
recovered by guesswork.

| # | Failure | Detection | Disposition |
|---|---|---|---|
| F-1 | Forged webhook | HMAC + timestamp-window verification; envelope-vs-pin cross-check (§21) | rejected, audited as attempted truth-forgery |
| F-2 | Replayed webhook | `providerEventId` idempotency | original ack returned; appends nothing |
| F-3 | Out-of-order webhook (capture before authorize visible) | payment machine guards | machine accepts provider-truth capture from `created`; illegal sequences reject deterministically |
| F-4 | Missed webhook | daily sweep vs provider records | sweep heals by port fetch; mismatch → attention queue (frozen commercial ops) |
| F-5 | Duplicate manual attestation | `commandId` idempotency + outstanding-bound guard | original ack; over-discharge structurally impossible |
| F-6 | Projection row tampered (any money column) | fold-vs-rows diff on every command | aggregate halts; recovery heals from events |
| F-7 | Journal/event log corrupted | reducer fail-closed set (§14) | halt; restore-from-backup path (unhealable by design) |
| F-8 | Capture exceeds outstanding (waiver raced the order) | conservation guard at posting | the **Overpaid Collection** template (§9.3) posts the excess to `refund-liability` in the same balanced posting; case flagged; human resolves by partial refund (liability-first, §9.3/§10) |
| F-9 | Auction log fails intake verification | pinned digest / fold mismatch | case → `discrepant`; money quiesces; override-gated re-verification re-pins intake (§11) |
| F-10 | Concurrent writers on one aggregate | unique `(stream_type, stream_id, seq)` | loser fails loudly; bounded retry (the journal's deliberate serialization ceiling, §6); never a silent merge |
| F-11 | Coordinator crash mid-policy | catch-up scan; derived command ids | effects re-derived idempotently; no double-posting (§9.4) |
| F-12 | Dispute after case closed | `PaymentDisputed` on a closed case | attention item; resolution via override `CaseReopened` + compensating postings — closed history intact |
| F-13 | Gateway outage | port errors surfaced honestly | manual methods unaffected; gateway payments retry as new attempts; no state guessed |
| F-14 | Settlement capability set typo'd into frozen engine context | both evaluators fail closed on unknown sets (§20) | confers nothing anywhere; test-locked |
| F-15 | Checkpoint tampered or stale | background genesis re-verification; recovery re-derivation (§13a/§15) | journal halts; checkpoints truncated and re-derived from the stream |

## 23 · Determinism Guarantees

1. **Pure reducers** — no IO, no ambient time, no randomness in
   `packages/settlement`; the writer injects `Date.now()` as a number
   (the IP-4 D3 clock discipline).
2. **Identity at the edge**: ULIDs (case, payment, posting, receipt ids) are
   minted at the command edge and **recorded in event payloads**; replay reads
   ids, never re-mints. Nothing non-deterministic executes inside a fold.
3. **Canonical serialization**: sorted-key JSON, kernel-canonical money
   strings; identical events ⇒ identical projection **bytes**; no timestamp
   is generated during serialization.
4. **Byte-identical replay across processes**: two independent folds of the
   same stream produce identical bytes and identical balances — certified,
   not assumed (§25).
5. **Checkpoint equivalence**: a checkpointed fold (checkpoint + tail) is
   byte-identical to the genesis fold at every seq — certified; divergence is
   a halt (§13a).
6. **Deterministic verdicts**: every guard, bound check, posting template
   (including the Overpaid Collection split and the liability-first refund
   rule — pure functions of their inputs), and rejection code is a pure
   function — identical inputs yield identical verdicts, forever.
7. **Deterministic coordination**: policy effects are pure functions of the
   source event; derived command ids make the effect set order-independent
   and re-entrant.
8. **Reproducible intake**: the pin (digest + event count) over the immutable
   auction log makes verification repeatable at any future date with the
   frozen fold; every verification event records the pin it stood on.

## 24 · Performance Targets

Settlement is human-paced; targets are honesty margins, not race conditions.
Measured on the IP-4 harness posture (live PG17, certified envelope inputs).
The command path is bounded by checkpointed verification (§13a); genesis folds
run on scheduled verification, recovery, and certification — never per command.

| Operation | Target |
|---|---|
| Case intake + verify (fold a 2,500-lot / ~5,000-event auction log + digest) | < 250 ms (frozen fold measured 23.8 ms — 10× headroom) |
| Settlement command ack, case/payment streams (genesis fold + diff) | p95 < 100 ms |
| Journal command-path verification (verified checkpoint + ≤ 2,000-event tail + row diff + trial balance) | < 50 ms, independent of journal length |
| Webhook ingress ack (HMAC verify + envelope resolution + append + project + checkpointed verification) | < 200 ms |
| Journal genesis fold + trial-balance check @ 100,000 legs (scheduled verification · recovery · certification only) | < 1 s |
| Desk / Case / Team Statement read | < 100 ms |
| Case Ledger regeneration @ 5,000 events | < 50 ms (auction ledger: 0.5 ms @ 5,063 — no cache, nothing to go stale) |
| Recovery of any aggregate at envelope (genesis fold + heal + checkpoint re-derivation) | < 2 s |
| Daily sweep (per 1,000 payments) | < 60 s, idempotent, resumable |
| Certified envelope | 64 teams · 10,000 payments/org/season · 100,000 journal legs/org — enforced at the web tier like the auction envelope; the per-org journal's sequential-append ceiling (§6) is part of the envelope, with writer promotion as the named headroom |

## 25 · Certification Strategy

The IP-4 lesson is doctrine: **value comes from attacking the platform and
then re-attacking the conclusions** (the D-3 pattern). Certification for IP-5:

1. **Property suites** (pure, in `packages/settlement`): trial balance zero
   across random command walks · conservation per case · discharge/refund
   bounds (including partial-refund accumulation and the liability-first
   split) · template-shape closure (no expressible posting outside §9.3) ·
   replay determinism (fold twice, byte-equal) · fail-closed on every §14
   reason · both capability evaluators fail closed on the other's sets.
2. **Tamper drills** (live PG, non-superuser roles): mutate a `journal_legs`
   amount → halt + heal · delete a payment row → halt + heal · tamper a
   checkpoint → halt, truncate, re-derive · forge/replay a webhook →
   rejected/original-ack · verified-HMAC envelope naming a mismatched payment
   → rejected + audited · inject an unbalanced or off-template posting event →
   unhealable halt, restore path exercised · cross-tenant probes → zero rows,
   rejected writes.
3. **Two-process determinism**: independent processes fold identical streams →
   byte-identical projections, paisa-identical balances; checkpoint
   equivalence (genesis fold ≡ checkpoint + tail, byte-compared) at every
   checkpoint seq.
4. **Frozen-boundary proofs**: zero-diff gate over frozen paths (§26) ·
   dependency-cruiser zero violations · a hostile test asserting settlement
   holds no write path to `auction_events` or auction rows (permission-level,
   not convention-level, once the engine-role restriction lands).
5. **End-to-end founder journey** (real browser, axe-clean): complete auction
   → open case → verify → obligations → gateway payment (test mode) + cash
   attestation → waiver (override friction) → receipts → settle → close →
   auction renders *Reconciled* → reopen (override) → compensating correction
   → re-close. Plus: kill the writer mid-policy → catch-up completes; tamper →
   halt → recover → continue; an overpaid capture resolved by partial refund.
6. **Independent hostile review** before freeze, mandated to re-attack the
   passing certification's own claims — the reviewer's brief is D-3's:
   find the sibling row nobody verified.

## 26 · Acceptance Gates

**Standing gates, every milestone** (the platform's permanent bar):
`tsc --strict` clean, zero suppressions · lint `--max-warnings 0` ·
dependency-cruiser 0 violations (§5 rules encoded) · prettier clean · unit +
integration (live PG17) + e2e green · migration replay from empty DB clean
(journal-ordering discipline per the recorded IP-3 incident) · production
build clean.

**The frozen-path zero-diff gate, every milestone.** Two checks, both empty:

1. `git diff ip4-frozen -- packages/core packages/auction apps/engine
   apps/web/src/server/auction` — the frozen module trees.
2. Byte-identity against `ip4-frozen` of the **eleven frozen migrations,
   enumerated by exact filename** — `0000_identity.sql` · `0001_keys.sql` ·
   `0002_invite_revocation.sql` · `0003_rls_org_isolation.sql` ·
   `0004_rls_write_check.sql` · `0005_competition.sql` · `0006_reg_ops.sql` ·
   `0007_fixtures_venues.sql` · `0008_auction_foundation.sql` ·
   `0009_paddle_claims.sql` · `0010_conduct_ceremony.sql` — and of their
   journal entries. The frozen set is enumerated rather than glob-matched
   **deliberately**: any prefix pattern that matches the frozen files also
   matches this phase's own lawful additive migrations (`0011+`), producing a
   gate that can never pass and invites informal widening — the opposite of a
   fence.

Contracts/db/web changes are additive-only: no existing exported symbol,
migration, table, or policy changes.

**Phase-specific gates:**

| Gate | Proves |
|---|---|
| G-1 Event discipline | catalog closed at §8's 24 types · reducers fail closed on the full §14 set · every mutation = 1 event + same-tx audit + same-tx projection |
| G-2 Accounting | trial balance zero property-locked · conservation per case · template-shape closure · provenance chain walkable from statement row to auction gavel event |
| G-3 Determinism | byte-identical replay, two processes · identical balances · checkpoint equivalence at every checkpoint seq · pinned-intake reproducibility |
| G-4 Payments | provider-truth only for gateway transitions · webhook forge/replay/mismatched-envelope drills · sweep heals a dropped webhook · manual attestation audited and bounded · partial-refund bounds locked |
| G-5 Recovery | every projection and checkpoint tamper healed · unhealable cases halt + documented restore · coordinator catch-up after kill |
| G-6 Authorization | both capability engines fail closed on foreign sets · override separation enforced · settlement grant issuance gated by frozen `grant.issue` and refusing unknown sets · owner statement access from frozen fold facts only · RLS read+write proofs under non-superuser roles · webhook trusted-envelope resolution proven under tenant context |
| G-7 Boundary | zero-diff gate (both checks) · no settlement write path to auction truth · `apps/engine` untouched byte-for-byte |
| G-8 Experience | founder journey e2e green · axe zero violations · money rendered via kernel display only |

## 27 · Founder Review Milestones

Each milestone ends with a founder demonstration and a written report; no
milestone opens until the prior one is approved (the IP-1…IP-4 cadence).

| ID | Name | Scope (all within this document — nothing new) | Founder demonstration |
|---|---|---|---|
| **M-IP5-1** | **Settlement Foundation** | `packages/settlement` pure domain: machines, reducers, posting templates, obligation computation, capability module + grant actions; migrations 0011+ with RLS; the Settlement Writer; case open → verify → obligations against a real frozen auction log; Case Ledger + Desk (read-only money) | a completed auction's night verified and turned into a statement of account — no payment yet |
| **M-IP5-2** | **Collections** | `PaymentGatewayPort` + Razorpay adapter (test mode) + manual attestation adapter; webhook trusted-envelope ingress + idempotency; daily sweep; collection/overpayment/waiver/refund postings; journal checkpoints; discharge policies; Team Statement | money in: a UPI test payment and a cash attestation both discharge dues; a replayed webhook bounces; the sweep heals a dropped one; an overpayment resolves by partial refund |
| **M-IP5-3** | **Closure & Ceremony** | receipts + credit notes with dense numbering; waive/adjust/reopen/void override paths with friction; settle → close; the *Reconciled* overlay on auction surfaces; owner-visible statements; attention queue (disputes, refund liabilities) | the exhale: a night taken to `closed`, receipts in hand, the auction wearing **Reconciled** — then reopened and corrected without rewriting history |
| **M-IP5-4** | **Certification & Freeze** | §25 in full: property suites, tamper drills, two-process determinism + checkpoint equivalence, hostile independent review, performance envelope, runbooks, closure package | the drills run live: tamper → halt → heal; the reviewer's findings closed; `ip5-frozen` recommended |

## 28 · Freeze Criteria

IP-5 freezes (`ip5-frozen`) when every line below is repository truth,
re-measured fresh — not carried forward:

1. All §26 gates green on live PG17; zero freeze-blocking defects open.
2. The §8 catalog **closed** and frozen; reducers fail closed on everything
   else; additions declared ADR-only. The posting-template set and account
   families equally closed (§9.3).
3. **Replay reproduces identical balances** — byte-identical projections
   across two independent processes at the certified envelope, and checkpoint
   equivalence proven at every checkpoint seq.
4. Trial-balance-zero, conservation, and provenance properties
   regression-locked in the pure domain **and** in integration.
5. Every tamper drill — rows, checkpoints, envelopes — detected fail-closed
   and healed (or halted unhealable with the restore path exercised); zero
   false halts across envelope runs.
6. The frozen-path zero-diff gate (both checks, §26) empty against
   `ip4-frozen`; boundary graph clean; the hostile
   no-write-path-to-auction proof standing.
7. Capability partition proofs standing (both engines fail closed on foreign
   sets); the settlement grant actions proven gated by frozen `grant.issue` /
   `grant.revoke` and refusing unknown sets; RLS read+write proofs standing
   under non-superuser roles; the `withTenant` pre-deploy item covers
   settlement with zero rework, webhook path included (§21).
8. Independent hostile review completed, findings resolved and
   regression-locked, its report in the closure package.
9. Documentation reconciled to implementation truth (the IP-4 rule:
   implementation wins, docs are corrected) — architecture, event catalog,
   runbooks, security/threat model, closure report.
10. The freeze boundary declared for downstream phases: they may read
    settlement read models, the journal, and the payment port; they may not
    write settlement events, may not add a second source of truth for money,
    and may not require a settlement-rule change to function. If one does,
    that is an ADR and a thaw, not a patch.

---

## 29 · Implementation reconciliation (M-IP5-4 freeze · 2026-07-15)

The architecture above was implemented across M-IP5-1…3 and certified at M-IP5-4.
Where the ratified design and the built system differed, **the documentation is
corrected here to match the code** (the IP-4 rule; implementation won, and no
certification challenge proved the implementation wrong). The deltas are small
and additive-preserving:

- **§8.1 `ObligationAdjusted` — reducer only, no command surface.** The event
  type and its replay branch exist (the catalog is unchanged at 24 types), but
  **no writer command emits it** and the ratified posting-template set gives an
  adjustment no journal shape. Shipping an adjust command would let a team's
  case dues diverge from its dues wallet, so it was deferred (referred to the
  Board at M-IP5-1). Foundation therefore holds a **stronger** property than the
  design demanded: *dues wallet == case outstanding at every seq* (asserted in
  every settlement suite). Adjustments remain an ADR/thaw, not an implementation.
- **§11 close guard — financial verification, not receipts.** The design's
  provisional close guard ("every discharged team's receipt issued") was
  superseded: receipts are out of IP-5 scope, and the real guard is the
  **financial verification engine** (`verifyClosure`, seven deterministic
  checks — settled · no-outstanding · trial-balance-zero · dues-cleared ·
  no-refund-liability · obligations-match-source · collections-reconcile). A
  failed check is a deterministic close **rejection** (money quiesces); nothing
  bypasses verification. The closure's proof is the **evidence package**
  embedded in `CaseClosed` (§7 below).
- **Closure evidence package (new detail).** `CaseClosed` carries an immutable,
  reproducible evidence bundle — `verificationDigest · projectionDigest ·
  journalDigest · walletDigest · paymentDigest · trialBalanceDigest`, pinned by
  `caseEventCount` + `journalSeq`. Re-folding the pinned prefixes and re-running
  `verifyClosure` reproduces every digest, forever — even across a later reopen
  (certified). It is persisted on `settlement_cases` (migration 0013) as a
  disposable, recovery-rebuilt projection.
- **§12 Ceremony — read-model projections (no React surface in IP-5).** The
  ceremony is delivered as pure, read-only projection functions
  (`closureCeremony`, `reconciledOverlayFor`, `reproduceClosureEvidence`,
  timeline/summary folds). A FLOODLIGHT rendering sits atop this data as
  presentation; IP-5 is server-side, consistent with M-IP5-1/2.
- **The daily reconciliation sweep and payment expiry** exist as commands
  (`expirePayment`, the `fetchPayment` port) but are **not yet scheduled** — a
  named pre-deploy operational item (see [IP-5_FREEZE](IP-5_FREEZE.md) §7), not a
  rule change.

Everything else in §1–§28 is implemented as written. The freeze artifact,
certification evidence and operational checklist are in
[IP-5_FREEZE](IP-5_FREEZE.md); the closed catalog in
[EVENT_CATALOG](EVENT_CATALOG.md); operating procedures in
[RUNBOOKS](RUNBOOKS.md); the attacker model in [SECURITY](SECURITY.md); the
ratified decisions in [ADRS](ADRS.md).

---

*IP-5_ARCHITECTURE.md v1.1 · CTO · 2026-07-15. §1–§28 are design-time (ratified
before implementation). §29 is the M-IP5-4 reconciliation to implemented truth.*
