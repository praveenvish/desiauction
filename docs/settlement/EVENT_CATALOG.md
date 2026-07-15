# SETTLEMENT EVENT CATALOG

## DesiAuction NEXT · v1.0 · 2026-07-15 · CTO · **FROZEN** (IP-5, M-IP5-4)

> The complete, **closed** set of settlement events. Source of truth:
> `packages/settlement/src/events.ts` (`SETTLEMENT_EVENT_TYPES`), the three
> reducers (`replayCase`, `replayJournal`, `replayPayment`), and the coordinator
> (`coordinationEffects`, `buildPolicyEvent`). Envelope, persisted in
> `settlement_events` (append-only): `stream_type` (`case`|`journal`|`payment`) ·
> `stream_id` · `seq` (per-stream total order, dense from 1) · `type` · `at_ms`
> (server epoch ms) · `actor` (person ULID or the system sentinel) ·
> `correlation_id` · `command_id` (idempotency key) · `payload` · `org_id`.
> Unique `(stream_type, stream_id, seq)` is the single-writer proof; unique
> `(stream_type, stream_id, command_id)` is idempotency. Money is integer paise
> (JSON-exact). Every reducer fails closed (`unknown_event_type`) on anything
> not below.

**24 event types. The set is FROZEN. Adding a type is an ADR (a thaw).**

## Case stream (`case:{caseId}`) — 13 types

| Event | Emitted by | Payload (summary) | Replay effect |
|---|---|---|---|
| `CaseOpened` | `decideOpenCase` | caseId, auctionId, competitionId, basis, sourceEventCount, sourceDigest, fixed? | case → `opened`; intake pinned |
| `CaseVerified` | `decideVerifyCase` (fold matches pin) | foldDigest, **sourceEventCount, sourceDigest** (re-pins), teamCount, totalCommitted | → `verified`; pin refreshed |
| `CaseDiscrepant` | `decideVerifyCase` (mismatch) | reasonCode, detail | → `discrepant` (money quiesces) |
| `ObligationsComputed` | `decideComputeObligations` | items [{teamId, amount}] | obligations registered; → `settling` |
| `ObligationDischarged` | coordinator (capture policy) | teamId, amount, paymentId, postingRef | outstanding −= amount; fails `obligation_overdischarged` |
| `ObligationWaived` | `decideWaive` (**override**) | teamId, amount, reason | outstanding −= amount, waived |
| `ObligationReinstated` | coordinator (refund policy) | teamId, amount, paymentId, postingRef, compensates | outstanding += amount (compensating) |
| `ObligationAdjusted` | *reducer branch only — no command ships (deferred, ADR-3)* | teamId, kind, amount, reason | obligation resized |
| `CaseSettled` | `decideSettle` | — (guard: every outstanding = 0) | → `settled` (ready for closure) |
| `CaseClosed` | `decideCloseCase` (verification passed) | publishedDigest, **evidence{…}** | → `closed`; evidence sealed |
| `CaseReopened` | `decideReopen` (**override**) | reason, compensates | `settled`/`closed` → `settling`; clears closed anchor |
| `CaseVoided` | `decideVoid` (**override**) | reason | → `voided` (guard: zero postings reference the case) |
| `CaseRecovered` | `recoverCase` | divergences, eventCount | — (recovery IS the replay) |

## Journal stream (`journal:{orgId}`) — 4 types

| Event | Emitted by | Payload (summary) | Replay effect |
|---|---|---|---|
| `JournalPosted` | coordinator (obligation/collection/overpaid/waiver/refund) | postingId, template, legs [{account, direction, amount}], source {stream, seq}, memo | legs applied; fails closed unless legs sum to zero, match the template shape, and the source is unique |
| `ReceiptIssued` | *reducer branch only — receipts out of IP-5 scope* | receiptId, receiptNo, caseId, teamId, amount, coversPostings | receipt registered (dense series) |
| `CreditNoteIssued` | *reducer branch only — out of IP-5 scope* | noteId, noteNo, receiptId, amount, reason | reversal document registered |
| `JournalRecovered` | `recoverJournal` | divergences, eventCount | — |

## Payment stream (`payment:{paymentId}`) — 7 types

| Event | Emitted by | Payload (summary) | Replay effect |
|---|---|---|---|
| `PaymentInitiated` | `decideInitiatePayment` | paymentId, caseId, teamId, method, amount, orderRef? | → `created`; amount pinned (≤ team outstanding) |
| `PaymentAuthorized` | `decideWebhookEvent` (gateway) | providerRef, providerEventId | → `authorized` |
| `PaymentCaptured` | `decideWebhookEvent` (gateway) / `decideAttestCapture` (manual) | amount(=pin), providerRef?/providerEventId? · attestedBy?/evidenceRef? | → `captured` (triggers Collection policy) |
| `PaymentFailed` | `decideWebhookEvent` / `decideExpirePayment` | code, detail | → `failed` (terminal; retry = new payment) |
| `PaymentRefunded` | `decideWebhookEvent` (gateway) / `decideManualRefund` (**override**) | amount, reason, providerEventId? | refundedTotal += amount (≤ captured); → `refunded` when full (triggers Refund policy) |
| `PaymentDisputed` | `decideWebhookEvent` | providerRef, reason | → `disputed` |
| `PaymentRecovered` | `recoverPayment` | — | — |

## Coordination (deterministic, source-keyed) — the ratified policy edges

`ObligationsComputed → JournalPosted(obligation)` ·
`ObligationWaived → JournalPosted(waiver)` ·
`PaymentCaptured → JournalPosted(collection | overpaid-collection) → ObligationDischarged` ·
`PaymentRefunded → JournalPosted(refund, liability-first) → ObligationReinstated`.
Each downstream effect is keyed by a **derived command id**
(`{sourceStream}:{seq}:{policy}`); re-running after a crash (`runCoordination`,
`runPaymentCoordination`) finds the effect already present and does nothing —
one cause, one posting, forever.

## Closed fail-closed replay reasons

`sequence_gap` · `unknown_event_type` · `illegal_replayed_transition` ·
`malformed_case` · `malformed_obligation` · `malformed_posting` ·
`malformed_receipt` · `malformed_payment` · `unknown_case` · `unknown_team` ·
`unknown_payment` · `unknown_posting` · `unknown_receipt` ·
`unbalanced_posting` · `template_shape_mismatch` · `duplicate_posting_source` ·
`obligation_overdischarged` · `refund_exceeds_captured` · `negative_account_flow`.

## Posting templates (closed) & chart of accounts (closed families)

Templates: `obligation` · `collection` · `overpaid-collection` · `waiver` ·
`refund`. Account families: `dues:{caseId}:{teamId}` · `case:{caseId}` ·
`funds:{method}` · `waived:{caseId}` · `refund-liability`. A posting whose legs
do not sum to zero **and** match its named template's shape is unrepresentable
in a replayed projection. Adding a template or family is an ADR.

**Certified (M-IP5-4):** reordered, gapped, duplicated, forged-type, forged-money
(float/negative), off-template and duplicate-source events all fail closed; a
concurrent duplicate `(stream, seq)` is rejected by the unique index; every
projection tamper halts and heals byte-identical from the log. See
[IP-5_FREEZE](IP-5_FREEZE.md) §2.
