# FINANCIAL OPERATIONS ARCHITECTURE DECISION RECORDS

## DesiAuction NEXT · v1.0 · 2026-07-16 · CTO · **FROZEN** (IP-6 freeze)

> The load-bearing decisions ratified for IP-6 and preserved through freeze —
> the ten from the ratified architecture (reconciled to implemented truth
> where the build refined them) plus four earned during implementation. These
> are the constraints a later engineering organization must not violate
> without a **thaw** (a new ADR + re-certification).

## ADR-1 · Truth vs. testimony

Settlement owns financial truth; Financial Operations owns operational
TESTIMONY about it — documents issued, deliveries made, artifacts exported,
days attested, years sealed. Every money figure in a finops event is a QUOTED
settlement fact read off the FROZEN folds (`replayPayment`, `replayCase`,
`replayJournal`) with `{stream, seq}` provenance and a watermark; **no API
accepts an amount**. Challenge any artifact and the platform re-derives it
from the frozen streams or proves it forged. No second ledger, wallet or
payment model exists or can be expressed. *Certified: the settlement event
count is bit-identical across every finops regression suite.*

## ADR-2 · Documents are finops facts; the dormant settlement types stay dormant

`ReceiptIssued`/`CreditNoteIssued` in the frozen settlement catalog never
gained an emitter. Document issuance (dense numbering, canonical rendering,
digest sealing, delivery) lives in finops series streams. The three document
kinds are the three series LANES (receipt · tax-invoice · correction), one
lane per org·kind·fiscal-year forever, corrections never interleaving with
originals and never chaining to each other.

## ADR-3 · The Follower — after-commit, cursor-tracked, idempotent

The platform's first non-zero-lag projections: per-org cursors over the
read-only settlement streams, dense consumption (a gap waits, never skips),
watermarks on every surface, effects keyed by derived command ids. Rewinding
any cursor to zero rebuilds byte-identically (certified). Polling is the
truth mechanism. The source port has NO write operation — a settlement
mutation is inexpressible.

## ADR-4 · The Runner — the platform's one scheduled-work home

A dedicated worker process (`apps/finops-runner`): IST-pinned slots, derived
job keys (same occasion ⇒ one job, by schema), lease-based claiming, pure
deterministic backoff, dead letters that become red checks. No cron in web,
none in the follower, none in settlement. C-16 holds by construction: no
money path exists in finops.

## ADR-5 · The third capability partition

`finops:clerk` / `finops:accountant` / `finops:controller` over identity's
`grants` substrate; all three engines (frozen · settlement · finops) expand
the others' sets to NOTHING — certified in all six directions. Grant issuance
is IP-6's one sanctioned cross-context write, gated by the frozen
`grant.issue`. Money-mouth authority is explicit, per person, per org.

## ADR-6 · Tax is declared, never invented — and the invoice lane fails closed

The organizer declares posture (GSTIN shape-validated); documents pin the
profile seq they stood on. **GST decomposition was NOT implemented** (scope
order): a `gst-registered` profile is REFUSED invoice issuance
(`tax_decomposition_not_available`) rather than issued a non-compliant
document. The reducer's recomposition guard (`decomposition_mismatch`) stands
ready; shipping decomposition is a future milestone against this ADR, not a
patch.

## ADR-7 · TDS remains rejected

No outbound-payment lane exists; deduction-at-source is capture-time money
math requiring a settlement thaw. Revisit only when a payout/commission phase
opens.

## ADR-8 · Financial dispatch only, ports over providers

`DeliveryPort` + `ArtifactStorePort` are owned by the domain; adapters live
at the edge; no provider SDK exists in the package. Shipped first-class
channels: **in-app** (delivery IS register visibility) and **filesystem
outbox**; provider-backed email/SMS/WhatsApp/S3 are drop-ins (pre-deploy
configuration, the Razorpay precedent). Provider OUTCOMES are events;
transient attempts are audited job retries; unknown provider behaviour
dead-letters for a human. The platform-wide C-19 notification catalog remains
a later phase that lifts this pattern.

## ADR-9 · Artifacts are disposable; sealed digests are truth

Rendered payload bytes are never stored in events — the sealed
`contentDigest`/`artifactDigest` is the document/export; bytes re-derive from
pinned sources. Export generation read-back-verifies; a lost or corrupted
artifact regenerates from sources; regeneration REFUSES to overwrite a run
whose sources contradict its seal (`regeneration_digest_mismatch` — forgery,
surfaced). Health judges artifacts by the SEALED digest; regeneration
equality is a heal-window fact (lawful later documents move the register).

## ADR-10 · Fiscal close is attestation, not accounting

The journal has no year boundary and gets none. `PeriodClosed` seals
**evidence v2**: attestation digest, per-series register digests pinned by
prefix event-count, the export register with per-run pins, the settlement
watermark, quoted delivery telemetry, and the period's own prefix pin.
`reproduceFiscalEvidence` re-folds the pins byte-identically forever — for
EVERY seal ever made, across reopens. Coverage runs from the period's opening
day (mid-year adoption is sealable); the year must have fully elapsed; open
exceptions bar the seal in the COMMAND and in REPLAY.

## ADR-11 · The in-house job substrate (recorded deviation from doc 53's pg-boss)

`finops_jobs` + `finops_schedules` with SKIP-LOCKED lease claiming and PURE
retry/due decisions — chosen for certifiable determinism (backoff instants
asserted to the millisecond), zero new runtime dependency, and RLS/
migration-replay gate compatibility. Doc 53's constitutional core (Postgres-
backed, transactional enqueue, never on the money path) is fully preserved; a
pg-boss backend remains a non-breaking store swap. Org-scoped draining is the
landed sharding seam.

## ADR-12 · One writer, one package, two processes

The FinOps Writer, store, follower and pipelines live in
`packages/financial-operations/src/server` (the only subtree permitted to
import `@desiauction/db` — dependency-cruiser-enforced), so `apps/web` and
`apps/finops-runner` share ONE mutation authority. `src/*` outside `server/`
is pure (no IO, no clock, no randomness). This supersedes the ratified
apps-side writer placement: duplicating the mutation authority per process
was the constitutionally worse alternative.

## ADR-13 · Coordination is scan-based, everywhere

No writer enqueues jobs and no transactional outbox exists: pipelines
DISCOVER work from state (requested dispatches/exports, receipt-due
captures), derive job keys and command ids from aggregate identity, and
re-derive after any crash. Recorded breadcrumbs with `eventSeq 0` audit rows
(attempt failures, callback rejections, certifications, year-end verdicts)
carry operational evidence that is not aggregate truth — the closed 23-type
catalog never grew.

## ADR-14 · Certification is a derivation; fiscal seals are the eternal proofs

`certifyOperations` derives from replay NOW — every stream double-folded and
byte-compared, every projection verified, every document reproduced, every
artifact digest-checked, every seal re-derived, the settlement journal
balanced — into a TIME-FREE report whose digest is identical for identical
repository state (duplicate certification is therefore harmless; a claimed
digest that re-derivation contradicts is a forged certificate, exposed).
Historical certification digests are audit breadcrumbs whose re-derivability
lasts while streams are unchanged; the FOREVER-reproducible artifacts are the
pinned fiscal seals (ADR-10). Health is derived from observation with the
clock as an argument; **unknown state is never healthy**; the supervisor
repairs nothing — repair is always an explicit, audited command.
