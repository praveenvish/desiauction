# M-IP6-2 — DOCUMENTS · MILESTONE REPORT

## DesiAuction NEXT · v1.0 · 2026-07-16 · CTO · **Status: ENGINEERING COMPLETE — awaiting Founder review**

Implements [IP-6_ARCHITECTURE](IP-6_ARCHITECTURE.md) §10 (documents), on top of
the approved [M-IP6-1 foundation](M-IP6-1_REPORT.md). Every number below is
repository truth measured fresh this cycle against live Postgres 17.

---

## 1 · What was built

**Issuance — the dormant branches awakened.** `IssueReceipt`, `IssueInvoice`
and `IssueCorrection` open the command surface the foundation deliberately
shipped without: they emit the frozen `DocumentIssued`/`CorrectionIssued`
shapes into the existing DocumentSeries streams. **The closed 23-type catalog
is untouched; zero schema, zero migrations, zero new tables** — this milestone
is command surface, rendering and read models only.

**Quotes, never inputs.** Callers name REFERENCES (a payment, a case + team, a
compensating cause event); the writer derives every monetary figure by folding
the settlement stream with the FROZEN reducers (`replayPayment`, `replayCase`)
— no API accepts an amount. A receipt quotes its `PaymentCaptured` figure; an
invoice quotes the `ObligationsComputed` obligation; a correction quotes a
`PaymentRefunded` or `ObligationWaived` compensation. Every quote pins
provenance `{stream, seq}`, a sourceRef, and the fact's IST date (its fiscal
home).

**Validation, layered:** series legality (open lane, kind match, org match) ·
**fiscal legality** (the source fact's fiscal year must be the series' year) ·
**watermark coverage** (a document may only quote history the org's follower
has consumed — which doubles as tenancy: foreign streams have no cursor) ·
**duplicate prevention** (one settlement cause, one document per series —
reducer, schema index, AND command pre-check) · party integrity (the named
party must be the settlement fact's party) · correction linkage (the cause
must compensate THE document it corrects; corrections never chain) · the
**posture gate** (a gst-registered issuer is refused an invoice until tax
decomposition is authorized — never a non-compliant statutory document).

**Deterministic numbering** was already structural (foundation): number =
fold-derived issue order, `number_gap` unfoldable, `(series, number)` unique
in schema. No wall clock, no race dependence — a concurrent issue collides on
the stream seq and fails loudly.

**Deterministic rendering** (`renderDocumentPayload`): a pure function of
(settlement facts at pinned provenance · profile AS IT STOOD at the pinned seq
· series descriptor · issuance facts) → canonical sorted-key JSON bytes → the
digest sealed in the event (ADR-9: the digest IS the document; no blob in the
log, no HTML, no PDF). **`reproduceDocument`** re-derives the bytes from
nothing but those sources and proves byte-identity with the sealed digest —
the constitutional test as a runtime surface.

**Auto-receipts** (§8.6 policy): when the profile declares `autoReceipt`, the
follower issues receipts for captured payments under the derived command id
`settlement:payment:{id}:{captureSeq}:auto-receipt` — scan-based (the
candidate list IS the coordination catch-up), crash-proof, re-run-proof.
Unissuable candidates (no open lane, unresolvable label) are skipped and stay
visible; never a silent loss, never a blocked cursor.

**Read models:** `DocumentSnapshot` (register row + formatted number + live
reproduction verdict), `SeriesSnapshot` (lane + register + derived next
number), `IssuanceSnapshot` (lanes, counts, receipt-due candidates,
auto-receipt posture) — all assembled on read, disposable, rebuildable.

**Surface additions (all additive):** `packages/financial-operations` gains
`documents.ts` (pure, 429 LOC) and `server/documents.ts` (272 LOC); the
writer, ports, store, deps, follower and snapshots gain document members; two
read-only ports appear (`ReferencePort` for party label snapshots,
`listCapturedPayments` for discovery). 2,003 LOC total incl. 1,302 LOC of
tests.

## 2 · What was verified (all fresh, live PG17)

| Gate | Result |
|---|---|
| TypeScript (`tsc --strict`, forced) | clean · 11/11 workspaces |
| Lint (`--max-warnings 0`, forced) · Prettier | clean |
| Boundaries (dependency-cruiser) | **0 violations** · 526 modules · 1,821 dependencies |
| **FinOps unit** | **66 tests** (51 foundation — unchanged — + 15 documents) |
| **Documents regression (live PG17)** | **15 tests**, new permanent suite |
| **Full web integration** | **229 passed** (foundation 30 + documents 15 + frozen identity/competition/auction/settlement 184) — three consecutive full runs green |
| Migration replay (EMPTY DB → 15 migrations) | clean · 42 tables · 35 RLS policies — **no new migration this milestone** |
| Production build | clean (web ✓ · engine ✓ · runner ✓, boot-smoked: starts, ticks, SIGTERM-clean) |
| **Zero-diff vs `ip5-frozen`** | **0 lines** across every frozen tree; all **14 frozen migrations byte-identical** |
| Foundation freeze discipline | no event type added/renamed (catalog closure test pins 23 & disjointness with settlement's 24); no reducer semantics touched (all 51 foundation unit tests pass unmodified) |

The CTO's mandated hostile list, each in the permanent suites: **duplicate
issuance** (command duplicate ⇒ original ack; new command, same source ⇒
`duplicate_document_source`) · **series replay / number gaps** (skipped,
repeated, premature numbers unfoldable) · **watermark replay** (regressions
unfoldable; behind-source issuance refused until the follower catches up) ·
**quoted settlement mismatch** (unknown payment/team/cause, non-compensating
cause, wrong-party, cross-linkage all refused with deterministic reasons) ·
**forged monetary values** — the sharpest drill: a COMPETENT forgery
(self-consistent event: dense number, advancing watermark, amount == lines)
FOLDS, halts commands via row divergence, survives recovery — and is then
UNMASKED by reproduction, because no honest re-render from settlement agrees
with a dishonest figure; restore is PITR-shaped (roll the stream back to the
pre-corruption prefix, never splice) · **corrupted payload** (tampered
amount/digest rows halt and heal byte-identical) · **rebuild identity**
(register destroyed → recovered byte-identical) · **unknown events / illegal
lifecycle** (closed lanes refuse, kinds never interleave, terminality holds) ·
and the **boundary meter**: the settlement event count is bit-identical across
every document operation in the suite.

## 3 · Engineering decisions

1. **The three document aggregates ARE the three series lanes.** The
   authorization's "Receipt/Invoice/Correction aggregate" maps onto the
   ratified DocumentSeries aggregate per kind (receipt · tax-invoice ·
   correction): each kind owns its own streams, lifecycle and dense numbering
   lane; all share the one reducer and the one FinOps Writer. No fourth
   aggregate and **no new event type** was invented — the foundation was
   designed for exactly this awakening (its ADR-3-style dormant branches).
2. **The digest is sealed, the bytes are not stored.** The event carries
   `contentDigest` only; the canonical payload re-derives from pinned sources
   forever (ADR-9). The domain renders bytes; the injected `DigestFn` hashes
   them (the frozen settlement discipline).
3. **Discovery may read the settlement projection; decisions never do.**
   Receipt-due candidates come from the `payments` projection (verified
   upstream, §12); every issuance re-derives from the event fold — a stale or
   tampered projection row can only surface a candidate whose issuance then
   fails closed.
4. **Two additive read-only ports**: `ReferencePort.teamLabel` (party label
   SNAPSHOTS at issue — documents stay readable after renames/erasure) and
   `SettlementSourcePort.listCapturedPayments` (discovery). Foundation
   interface widening is additive; the store is the only implementor.
5. **Watermark coverage doubles as tenancy**: cursors are org-scoped, so a
   foreign stream's history is structurally unquotable (`watermark_behind_source`).
6. **Test hardening (foundation suite, test-only)**: the runner drills are now
   immune to shared-dev-DB residue (the forced slot-fire's cross-org queue is
   purged; assertions scoped to the drill's own job). CI on a fresh DB was
   never affected.

## 4 · Domain decisions

1. **The posture gate (fail-closed compliance):** a `gst-registered` profile
   is REFUSED invoice issuance (`tax_decomposition_not_available`) because
   computing a lawful tax split is explicitly out of this milestone's scope —
   the platform never emits a non-compliant statutory document. Unregistered
   organizers (this market's majority) issue dues bills lawfully. The
   registered lane opens when decomposition is authorized.
2. **A document's fiscal home is its SOURCE FACT's IST date** (the capture,
   the computation, the compensation) — an event fact, so fiscal legality is
   deterministic with zero wall-clock dependence.
3. **Invoices quote the demand as computed**; collections and waivers never
   edit it — they become corrections. **Corrections quote compensations only**
   (`PaymentRefunded`, `ObligationWaived`), must compensate the document they
   name (same party, same settlement stream), and never chain to each other.
4. **One settlement cause, one document per series** — sourceRef idempotency
   enforced three times over (command pre-check, reducer, partial unique index).
5. **Auto-issuance is bookkeeping, issuance of corrections is human** (the
   frozen "lifecycle transitions are human; bookkeeping is policy" doctrine):
   receipts may auto-issue under a declared profile policy; corrections and
   invoices are always deliberate human commands.
6. **Reproduction is the forgery detector**: projection tampering is caught by
   the writer's fold-vs-rows verification (foundation), but a forged EVENT
   with internally-consistent numbers can only be caught by re-deriving the
   quote from settlement — which is exactly what `reproduceDocument` does, and
   why every snapshot carries the live verdict.

## 5 · Remaining risks

1. **Inherited pre-deploy items unchanged** (withTenant wiring; writer-role
   restriction on `finops_events`); all new paths remain withTenant-compatible.
2. **The registered-issuer lane is closed, not built**: orgs with
   `gst-registered` posture cannot invoice until tax decomposition is
   authorized (a deliberate gate, D5/ADR-6 — expected in a later milestone with
   the GST scope). Receipts and corrections are unaffected by posture.
3. **Reproduction of corrections resolves the original via the document
   register row** (`loadDocument`), which is disposable-but-rebuildable; a
   destroyed register must be recovered before cross-series linkage display —
   the canonical payload itself references the original by docId (an event
   fact) and needs no row.
4. **Auto-receipt candidates skipped for a missing open lane stay silent in
   logs** (visible only in `IssuanceSnapshot.receiptDue`); once the ops
   checklist grows a documents check (M-IP6-4 as ratified), a persistent
   backlog should become a red check on the day.
5. **No commit boundary exists between milestones** — the working tree now
   carries IP-6 design + M-IP6-1 + M-IP6-2 uncommitted. Recommend committing
   per approved milestone so freeze gates can reference tags, not memory.

## 6 · Founder demonstration

1. `pnpm verify` — all static gates; 66 finops unit tests.
2. `pnpm --filter @desiauction/web test:integration` — the documents story
   runs live: a real night is conducted and collected through the frozen
   platforms; invoices for both teams and a receipt for the first instalment
   issue with amounts read off the folds; a receipt into last year's lane is
   refused; a rewound follower makes fresh history unquotable until it catches
   up; flipping `autoReceipt` makes the follower issue the second receipt
   itself under a derived command id (and refuse to double on re-run); a
   refund and a waiver become corrections that reference — never touch — their
   originals; a competent forgery folds, halts, survives recovery and is then
   unmasked by reproduction; a destroyed register rebuilds byte-identical; and
   the final meter shows settlement's log bit-identical.
3. Ask for any document twice: `reproduceDocument` returns the same bytes and
   the sealed digest, both times — that is what "immutable rendered payload"
   means here.

## 7 · Recommended Founder decision

**APPROVE M-IP6-2.** The document system is standing and certified: three
statutory lanes behind one writer, numbers that cannot gap, payloads that
cannot drift, quotes that cannot be supplied, forgeries that cannot survive
reproduction — and zero new financial logic anywhere. Settlement remains the
only authority on money, provably untouched (zero-diff, byte-identical frozen
migrations, runtime boundary meters in both permanent suites).

On approval, authorize **M-IP6-3 — Dispatch & Exports** per the ratified
roadmap. Recommend also ratifying a per-milestone commit cadence (risk 5).

---

*Engineering stops at this artifact. No M-IP6-3 work has begun.*
