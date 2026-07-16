# IP-6 — FINANCIAL OPERATIONS · ARCHITECTURE

## DesiAuction NEXT · v1.0 · 2026-07-15 · CTO · **Constitutional phase artifact** (IP-6, design phase — DESIGN ONLY, awaiting Founder review)

> The canonical IP-6 architecture. **Nothing in this phase may be implemented
> until this document is approved**; every later IP-6 milestone is measured
> against it. Governed by canon C-7/C-8/C-13/C-14/C-16/C-19/C-24, docs
> [45](../45-billing-model.md) · [46](../46-payment-flow.md) ·
> [47](../47-notification-strategy.md) · [48](../48-audit-strategy.md) ·
> [51](../51-event-architecture.md) · [53](../53-background-jobs.md), and the
> frozen IP-5 package ([IP-5_ARCHITECTURE](../settlement/IP-5_ARCHITECTURE.md) ·
> [EVENT_CATALOG](../settlement/EVENT_CATALOG.md) ·
> [ADRS](../settlement/ADRS.md) · [IP-5_FREEZE](../settlement/IP-5_FREEZE.md) ·
> [RUNBOOKS](../settlement/RUNBOOKS.md)).

### Constitutional constraints (ratified by the phase authorization — binding, not revisited)

1. **IP-1…IP-5 are immutable.** Zero modification of anything reachable from
   tag `ip5-frozen`'s certified surfaces (§27 defines the zero-diff gate,
   now enumerating **fourteen** frozen migrations, 0000–0013).
2. **Settlement is the single financial source of truth — forever.** IP-6
   consumes the frozen settlement contracts as published at `ip5-frozen`; it
   never requires a settlement rule change, and **this design contains no thaw**.
   If a future need demands one, that is a Board matter, not an IP-6 milestone.
3. **No second ledger. No second wallet. No second payment model. No duplicate
   money calculation.** Every rupee IP-6 shows the world is a **quoted**
   settlement fact with machine-walkable provenance — never a figure IP-6
   computed. The single, bounded exception (statutory tax decomposition of a
   settled amount) is ratified as D5/ADR-6 and delegates every operation to the
   frozen money kernel.
4. **Receipts are projections. Invoices are projections. Exports are
   projections. Reports are projections.** Everything IP-6 produces derives
   from Settlement and is reproducible from event streams, byte-identical,
   forever. What IP-6 *owns* is the operational fact that a projection was
   issued, delivered, exported, or attested — never the financial fact inside it.
5. **IP-6 writes only its own streams.** It never appends to
   `settlement_events` or `auction_events`, never mutates any frozen row, and
   never emits any of the 24 frozen settlement event types (the dormant
   `ReceiptIssued` / `CreditNoteIssued` types **stay dormant**, D2/ADR-2).
6. **The money kernel is frozen.** `packages/core` Money (integer paise,
   closed arithmetic, bijective serialization) is consumed as-is; no arithmetic
   on money exists outside kernel-delegating functions.
7. **IP-6 is purely additive.** New package, new tables (`0014+`), new events,
   new process, new surfaces; nothing existing changes shape.

---

## 1 · Purpose — the operational problems IP-6 solves

IP-5 froze a machine that settles the truth about an auction's money: verified
cases, a double-entry journal, derived wallets, closure evidence reproducible
forever. What the platform cannot yet do is **operate** that truth in the
world outside the database:

1. **A paid-up owner holds nothing.** Money was collected, the case closed —
   and no receipt exists in anyone's hand. The frozen catalog reserved
   `ReceiptIssued` but deliberately shipped no command for it
   ([IP-5 §29](../settlement/IP-5_ARCHITECTURE.md), ADR-3's sibling).
2. **A GST-registered organizer cannot issue a compliant document.** No tax
   invoice, no GSTIN fields, no statutory numbering series, no credit-note
   document for a correction.
3. **The organizer's accountant re-keys everything.** The journal is exact and
   incorruptible, and completely unreadable to Tally. No accounting export, no
   ERP hand-off, no GSTR-shaped return data.
4. **Nobody is told when money moves.** The one delivery lane the market
   demands — a receipt on the owner's WhatsApp, an invoice in the inbox — does
   not exist. Settlement (correctly) refused to put notifications on the money
   path; nothing downstream picked them up.
5. **Settlement's own operations have no operator.** The payment-expiry sweep,
   the daily provider reconciliation, and journal verification exist as frozen
   commands, but nothing schedules them — a named IP-5 pre-deploy gap
   ([RUNBOOKS §6.3](../settlement/RUNBOOKS.md)). There is no attested answer to
   the question *"did yesterday reconcile?"*
6. **There is no fiscal calendar.** Cases close; years never do. No period
   discipline, no year-end evidence bundle, no archive an auditor can take away.
7. **Operational attention is scattered.** Disputes, refund liabilities,
   discrepant cases, halted aggregates, dead-lettered jobs — each exists as a
   fact somewhere, with no single ops surface that ranks what needs a human today.
8. **Financial history is unsearchable and unreportable.** No document
   register, no collections-by-period report, no outstanding aging, no
   provenance walk from a number on a statement to the gavel-fall that caused it.

IP-6 is the **mouth of the money machine**: everything outward-facing and
operational — documents, delivery, exports, reporting, scheduling, attestation,
close, archive — built as disposable projections and auditable operational
facts on top of a settlement core it can read but never touch.

The phase succeeds when an organizer's season runs like a books-kept business:
every capture produces a document, every document reaches its person, every
day ends attested, every year ends sealed and exportable — and deleting every
IP-6 table loses **nothing** that cannot be rebuilt byte-identical from the
frozen streams plus IP-6's own event log.

## 2 · Bounded Context

**Context name: Financial Operations (FinOps).** Ubiquitous language:
**Document** (an issued receipt, tax invoice, or correction note),
**Series** (a dense, fiscal-year-scoped numbering lane), **Issue** (the act of
minting a document), **Dispatch** (one delivery attempt of a document or
notice), **Export Run** (one generation of an external artifact),
**Fiscal Period** (an org's financial year under attestation),
**Day Attestation** (the recorded verdict that a day reconciled),
**Exception** (a recorded operational anomaly), **Tax Profile** (the org's
declared tax identity and posture), **Watermark** (the pinned settlement
stream positions an artifact stood on), **Bundle** (an archival/compliance
export artifact).

Context relationships (all conformist-consumer, never partnership):

| Neighbor | Direction | Published language consumed | Never |
|---|---|---|---|
| **Settlement** (frozen, `ip5-frozen`) | upstream | `settlement_events` read-only · the pure folds of `@desiauction/settlement` (`replayCase`, `replayJournal`, `replayPayment`, `statementOf`, `walletOf`, `trialBalance`, `closureCeremony`, `reproduceClosureEvidence`, …) · settlement projection rows (convenience reads only, §12) · the settlement server commands as **invoker** for scheduled operations (§15, D7) | write settlement events · emit any of the 24 frozen types · re-derive money differently · require a rule change |
| **Auction** (frozen, `ip4-frozen`) | upstream | `auction_events` read-only + frozen folds, for provenance walks and label facts only | write anything |
| **Identity** (frozen, `ip2-frozen`) | upstream | sessions, `grants` substrate, audit substrate, tenancy — plus the one declared cross-context write (§19: finops grant issuance under identity's unchanged policies, the IP-5 §20 precedent) | modify the capability engine or its sets |
| **Competition** (frozen, `ip3-frozen`) | upstream | team/competition reference data via existing read surfaces (label snapshots at issue) | write anything |
| **Future Pass billing / commercial phases** | downstream | the document domain, dispatch port, export port, fiscal calendar | those phases never write finops events |

**D1 — Truth vs. testimony (the constitutional boundary of this phase).**
Settlement owns what is **true** about money. IP-6 owns what has been
**said and done about it** to the world: which documents were issued under
which numbers, what was delivered to whom over which channel, what was
exported with which digest, which days were attested and which year was
sealed. Every IP-6 event records operational facts; every money figure inside
one is a quotation of a settlement fact, pinned by provenance
(`{stream, seq}` references) and a watermark. IP-6 can therefore be **wrong
about nothing financial**: challenge any document and the platform re-folds
the frozen streams it names and reproduces it byte-identically — or proves it
forged.

**D2 — The dormant types stay dormant.** The frozen settlement catalog
reserves `ReceiptIssued`/`CreditNoteIssued` as reducer branches with no
command surface. IP-6 does **not** wake them: emitting settlement-typed events
from a second writer would break the single-writer doctrine and the frozen
catalog's closure, and a thaw is constitutionally out of bounds. Document
issuance is an **operational** fact (numbering, rendering, delivery) — it
belongs in IP-6's own streams. The dormant branches remain what they are:
harmless, closed, frozen. A hostile certification test (§25) proves no IP-6
code path can construct a settlement-typed envelope.

## 3 · Domain verdicts — what belongs in IP-6, and what does not

The authorization lists sixteen candidate domains and instructs rejection of
any that violate platform boundaries. Verdicts, each justified:

| Domain | Verdict | Boundary reasoning |
|---|---|---|
| **Receipts** | **ACCEPT** | Content is a pure projection of settlement facts; issuance (dense number, render, digest) is an IP-6 operational fact (D1/D2). |
| **Invoices** | **ACCEPT** (organizer tax documents over collections) | Same shape as receipts plus the declared tax posture (§10). *Platform-issued Pass invoices are NOT here* — no Pass billing exists; that commercial phase will consume this document domain (doc 45's deferral stands). |
| **GST** | **ACCEPT, narrowed** | IP-6 holds the org's **declared** tax profile and performs statutory decomposition of settled amounts under pinned, reproducible rules (D5). The platform never decides taxability — the organizer declares it (the `obligationBasis` precedent: the platform never invents a debt, and never invents a tax). GSTR-shaped exports included (§11). |
| **TDS** | **REJECT** | TDS attaches to *outbound* payments; the frozen platform records collections only — no payout, commission, or fee lane exists to deduct at source from. Modeling TDS would require deduction math at capture, i.e. a new posting template — a settlement thaw, constitutionally out of bounds. **Revisit trigger:** the V1.5 registration-fee/Route lane or any payout phase (ADR-7). |
| **Accounting export** | **ACCEPT** | Pure serialization of journal folds (Tally XML, journal CSV) with provenance and digests (§11). No adapter computes money. |
| **ERP adapters** | **ACCEPT** (as export adapters behind a port) | Tally-first (the Indian accountant's actual workflow is file import); a second ERP is a new adapter, never a rewrite (the `PaymentGatewayPort` precedent). |
| **Notification pipeline** | **REJECT platform-wide · ACCEPT financial dispatch** | The C-19 catalog (OTP, registration, auction ceremony) serves frozen non-financial domains and belongs to a dedicated platform phase. IP-6 owns **financial dispatch only**: documents, statements, financial attention — behind a `DeliveryPort` whose pattern (templates, dispatch log, provider truth, DLQ) is deliberately liftable by the later platform phase (ADR-8). |
| **Financial reporting** | **ACCEPT** | Read models over journal/case folds: collections by period and method, outstanding aging, waiver and refund-liability registers, season rollups (§16). All disposable, all watermarked. |
| **Daily reconciliation** | **ACCEPT, split** | The sweeps and verifications are **frozen settlement commands**; IP-6 owns the **scheduler that runs them** (the ops wiring IP-5 itself named as pending) and the **attestation record** of their outcomes (§15, D7). IP-6 never re-implements reconciliation logic. |
| **Year-end close** | **ACCEPT, as attestation** | A fiscal close **seals evidence**, it does not account: no closing entries, no balance recomputation, no year boundary in the journal (which is one unbroken stream by frozen design). `PeriodClosed` pins watermarks and digests — the closure-evidence pattern at year scale (ADR-10). |
| **Operational dashboards** | **ACCEPT** | The ops board: unified attention queue, day board, period board, follower freshness (§15–§16). Projections only. |
| **Audit reporting** | **ACCEPT, read-only** | Filterable, exportable slices over the existing `audit_log` + event streams (doc 48's Console→Audit view and the owner/team slices), plus provenance walks. **No new audit writer** — IP-6 adds only its own action taxonomy through the existing in-transaction rule. |
| **Search** | **REJECT product-wide · ACCEPT financial search** | Command-palette/product search (doc 33) is a product-shell concern. IP-6 ships financial search: document number, provider ref, party, amount, provenance — a disposable index over its own register and the frozen streams (§16). |
| **Archive** | **REJECT general · ACCEPT fiscal archive** | Tournament archival is the Competition domain's (doc 44). IP-6 archives **books**: the FY bundle — documents, register, journal export, attestations, evidence digests — as a reproducible export artifact (§11). |
| **Retention** | **ACCEPT, narrowed** | IP-6 declares and enforces retention for **its own artifacts** and records the statutory horizons for financial records (Companies Act 8 years; GST ~6 years from annual return). PII erasure machinery remains identity's (frozen; doc 49): erasure pseudonymizes parties, **never** removes financial facts — IP-6 documents carry label snapshots for exactly this reason (§10). |
| **Compliance exports** | **ACCEPT** | GSTR-shaped data, audit bundles, closure-evidence packages, DPDP-safe redacted variants — all export-run artifacts with digests (§11). |

**Also explicitly out of IP-6** (not requested, stated to kill ambiguity):
Pass/entitlement billing and platform-issued invoices (doc 45 — a later
commercial phase, which will consume IP-6's document/dispatch/export domains);
registration fees and Razorpay Route (V1.5 reserved); payouts or any movement
of money (IP-6 moves **information about** money, never money); dunning
automation (attention surfaces inform; chasing is human); multi-currency
(C-7); AI features; any new posting template, account family, capability atom,
or event type in any frozen catalog.

## 4 · Dependency Graph

Arrows point from consumer to consumed. Everything below the line is frozen;
every IP-6 arrow into it is **read-only** except the two declared, sanctioned
patterns: grant-row issuance (§19) and *invocation* of frozen settlement
server commands by the scheduler (§15 — invocation is not authorship: the
Settlement Writer remains the sole author of settlement events).

```
   apps/web (finops surfaces + FinOps Writer + adapters)     apps/finops-runner
        │                                                    (scheduler · follower ·
        ▼                                                     dispatch/export workers)
  packages/finops            packages/contracts (additive wire schemas)   │
  (pure domain: reducers,          │                                      │
   document folds, tax             │              ┌───────────────────────┘
   decomposition, capability       │              │
   module, ports)                  │              │
        │                          │              │
        ├──────────┬───────────────┘              │
        ▼          ▼                              ▼
   packages/db  packages/core ────── FROZEN (money kernel, capability engine)
   (additive     read-only
    0014+)      packages/settlement ─ FROZEN (pure folds, machines, ports)
 ══════════════════════════════════════════════════════════ ip5-frozen ═════
   settlement_events (read-only) · settlement projections (read-only)
   auction_events (read-only) · grants/audit substrate (additive rows only)
   teams/competitions reference (read-only)      apps/engine (untouched)
```

Boundary rules (dependency-cruiser-enforced, §27):

- `packages/finops` imports **only** `packages/core` and
  `packages/settlement` (both frozen, read-only) and `packages/contracts`. It
  never imports `packages/db`, `packages/auction`, or any app.
- `apps/finops-runner` imports packages only; no app imports it; it holds
  **no HTTP surface** (webhook ingress for delivery-provider callbacks lives
  in `apps/web`, the platform's single ingress, §13).
- `apps/engine` gains **zero** edges — in or out (unchanged since IP-4).
- No IP-6 module imports the settlement writer's internals; scheduled
  invocation targets only the **exported** settlement server commands
  (`RUNBOOKS` §1/§5/§6 surface) exactly as a human operator would.
- No finops import may appear in any frozen server module (zero-diff makes
  this structural).

## 5 · Package Structure

| Location | Content | Status |
|---|---|---|
| `packages/finops` | **New.** The pure domain: the five reducers (§7), document content folds and canonical renderers, tax decomposition (kernel-delegating), series/number derivation, attestation checklist evaluation, the finops capability module, `DeliveryPort` + `ExportPort` + `ArtifactStorePort` definitions. Zero IO, zero ambient time, zero randomness — the `packages/settlement` discipline, verbatim. | design |
| `packages/db` | Additive migrations `0014+`: `finops_events`, `finops_profiles`, `finops_documents`, `finops_dispatches`, `finops_exports`, `finops_periods`, `finops_period_days`, `finops_cursors`, `finops_attention` — all org-scoped with RLS read+write policies from birth (§20). The fourteen frozen migrations (0000–0013) byte-untouched (§27). | design |
| `packages/contracts` | Additive finops wire schemas (document payloads, dispatch acks, export manifests, ops board, diagnostics). New modules only. | design |
| `apps/web/src/server/finops/` | **New.** The FinOps Writer (sole mutation authority for finops streams, §7), coordinator policies, read-model assembly, the finops grant actions (§19), delivery-provider callback ingress, document download routes, adapters (delivery: in-app/email/WhatsApp-BSP/org-webhook; export: Tally XML/journal CSV/GSTR JSON/bundles). Follows the `requireSession → resolveTenant → requireCapability → act → audit` spine. | design |
| `apps/finops-runner` | **New process** (D3): pg-boss workers — the settlement ops schedule (§15), the follower (§9), dispatch senders, export generators, retention sweep, attestation runs. Shares the writer module with `apps/web` via `packages`-mediated composition; both entry points funnel every append through the one writer (single-writer enforced structurally by unique seq, as ever). | design |
| `apps/web/src/app/…/finops` | **New surfaces**: Documents register, Owner documents, Ops Board, Day/Period boards, Reports, Financial search, Export center, Dispatch log. FLOODLIGHT as-is. | design |
| `apps/engine`, `packages/auction`, `packages/settlement`, `packages/core`, `packages/ui` | **Untouched.** | frozen |

**D3 — the FinOps Runner: the first new process since the engine.** IP-5
needed no process because settlement is human-paced. IP-6 is different in
kind: it exists to run things **on schedule** (sweeps, verification,
attestation, retries, retention) and to follow streams continuously. Doc 53
ratified pg-boss with workers in the engine's process group "with a clean
seam to split out later" — the engine froze before any worker landed, so the
seam splits **now**: a separate worker process, additive, zero engine edges.
C-16 holds trivially and by construction: **there is no money path in IP-6**
— every job is aftermath (documents, delivery, exports, attestation), and no
IP-6 job can affect a settlement or auction outcome because no write path to
those streams exists. Scheduling is IST-pinned and live-window-aware (C-22):
heavy runs skip while any org auction is LIVE.

**D4 — the Follower: IP-6's projections over settlement are after-commit,
cursor-tracked, and idempotent.** IP-4/IP-5 projections update in the same
transaction as their append — possible only for the writer that owns the
stream. IP-6 does not own settlement streams and must never join their
transactions, so its settlement-derived read models are **followers**: a
per-org cursor over `settlement_events` (ordered by stream seq), advanced
at-least-once, with every downstream effect keyed by a derived command id
(`{sourceStream}:{seq}:{policy}` — the frozen coordinator discipline) so
re-delivery is a no-op. Consequences, stated honestly:

- **Eventual consistency exists in IP-6 and is declared, bounded, and
  visible.** Every settlement-derived surface carries its watermark (the
  source seq it reflects); staleness is rendered, never hidden (the doc 51
  seq-answers-staleness doctrine). Lag budget: §23.
- **Truth is never the follower's.** Any question of record is answered by
  re-folding the frozen streams with the frozen folds; every follower-fed
  projection is disposable and rebuilds byte-identically from a cursor rewind
  (certified, §25).
- IP-6's projections **of its own streams** remain same-transaction,
  zero-lag, exactly like every writer before it. Two projection classes, one
  doctrine each — never confused (§12).

## 6 · Responsibilities

FinOps owns, exclusively:

1. **Document issuance** — receipts, organizer tax invoices, and correction
   notes: dense FY-scoped numbering, canonical rendering, content digests,
   party label snapshots, watermark pins; corrections as new documents, never
   edits (invariant 24).
2. **The org tax profile** — declared tax identity and posture, amendable
   with audit, pinned by documents at issue.
3. **Financial dispatch** — delivery of documents and financial notices over
   in-app/email/WhatsApp/org-webhook channels behind `DeliveryPort`, with a
   full dispatch log, provider-truth status, retries, and DLQ→attention.
4. **Exports** — accounting, ERP, compliance, and archive artifacts behind
   `ExportPort`: every run recorded with digest, row count, and watermark
   (invariant 33).
5. **Settlement operations** — scheduling the frozen settlement maintenance
   surface (expiry sweep, provider reconciliation, journal/checkpoint
   verification) and recording outcomes; IP-5's pre-deploy items 3 (sweeps)
   get their permanent operational home here.
6. **The fiscal calendar** — periods, daily attestation with a fixed
   checklist, exceptions, year-end close with sealed evidence, override
   reopen.
7. **Operational read models** — ops board (attention), reports, registers,
   financial search, provenance walks, freshness meta.
8. **Its own recovery** — halt-on-divergence, heal-from-events, for every
   finops aggregate; cursor rewind safety for the follower.
9. **Its own capability vocabulary** — the finops capability sets and the
   grant actions that mint them (§19).

## 7 · Aggregate Model

One doctrine, inherited whole: **one aggregate, one stream, one pure reducer,
one projection authority, one mutation authority.** The FinOps Writer is the
single mutation authority for all five; concurrent writers fail loudly on the
unique `(stream_type, stream_id, seq)` (the structural single-writer proof).

Envelope (persisted in `finops_events`, append-only): `stream_type`
(`profile` | `series` | `dispatch` | `export` | `period`) · `stream_id` ·
`seq` (dense from 1) · `type` · `at_ms` (injected server clock) · `actor`
(person ULID, `system:runner`, or `system:follower`) · `correlation_id` ·
`command_id` (idempotency) · `payload` (JSON; money as exact integers,
quoted) · `org_id`. Unique `(stream_type, stream_id, seq)`; unique
`(stream_type, stream_id, command_id)`.

| Mutable concept | Aggregate | Stream | Why this boundary | Projection authority | Writer |
|---|---|---|---|---|---|
| The org's declared financial identity | **TaxProfile** (one per org) | `profile:{orgId}` | Tax posture is one org-wide declaration that documents must pin at a point in time — an append-only history of declarations, tiny by construction | `finops_profiles` | FinOps Writer |
| A numbering lane | **DocumentSeries** (one per org · kind · FY) | `series:{orgId}:{kind}:{fy}` | Dense statutory numbering **is** a total order — the stream's seq is the number's proof; scoping by kind+FY matches Indian series practice and keeps every stream bounded by one year's documents | `finops_documents` | FinOps Writer |
| One delivery attempt | **Dispatch** (one per attempt) | `dispatch:{dispatchId}` | Delivery is provider-truth with retries; per-attempt streams mirror the frozen Payment aggregate (failed is terminal; retry = new dispatch) | `finops_dispatches` | FinOps Writer |
| One export generation | **ExportRun** (one per run) | `export:{exportId}` | An export is an audited, provenance-carrying act (invariant 33), not a query; per-run streams make every artifact's history self-contained | `finops_exports` | FinOps Writer |
| An org's financial year | **FiscalPeriod** (one per org · FY) | `period:{orgId}:{fy}` | Attestation accumulates daily and seals annually; one stream per FY bounds it at ~370 events and makes the year's evidence one fold | `finops_periods` + `finops_period_days` | FinOps Writer |

No aggregate needs checkpoints: every stream is bounded by construction
(a year of documents, a year of days, one attempt, one run, one small
profile). If a series ever outgrows its fold budget, the frozen journal's
verified-checkpoint pattern is the named, non-breaking remedy.

## 8 · Event Catalog

**v1.0 — the prescriptive set: 23 types.** Milestones may not invent types
outside this catalog without amending this document pre-freeze; at freeze the
catalog closes (additions become ADRs). All money fields are integer paise
and are **quotations**: each carries provenance (`{stream, seq}` and posting
ids where applicable). `compensates`/`corrects` fields reference what is
being compensated — history is never rewritten.

### 8.1 · Profile stream (`profile:{orgId}`) — 3 types

| Event | Emitted on | Payload (summary) | Replay effect |
|---|---|---|---|
| `ProfileDeclared` | declare command (first) | legalName, address, gstin?, taxPosture (`none` \| `gst-registered`), placeOfSupply, defaultRatePolicy {sacCode, ratePermille, basis: `inclusive`\|`exclusive`, rounding: `paise`\|`rupee-invoice`}, issuancePolicy {autoReceipt, autoDispatch per kind/channel}, retentionDeclaration | profile v1 active |
| `ProfileAmended` | amend command | delta + mandatory reason | profile advanced; prior versions remain addressable by seq (documents pin `profileSeq`) |
| `ProfileRecovered` | recover command | divergences, eventCount | — |

### 8.2 · Series stream (`series:{orgId}:{kind}:{fy}`) — 5 types

| Event | Emitted on | Payload (summary) | Replay effect |
|---|---|---|---|
| `SeriesOpened` | open command or first-issue policy | kind (`receipt` \| `tax-invoice` \| `correction`), fy, prefix, numberFormat | series active; next number = 1 |
| `DocumentIssued` | issue command (manual) or issuance policy (auto-receipt) | docId, number (dense, seq-derived), kind, party {type, id, labelSnapshot}, lines [{description, amount, provenance {stream, seq, postingId?}}], tax? {basis, ratePermille, taxableValue, cgst?, sgst?, igst?, roundingApplied} (D5 — pure decomposition, inputs pinned), profileSeq, watermark {caseStream+seq?, paymentStream+seq?, journalSeq}, contentDigest | document registered; number allocated; a gap is a halt |
| `CorrectionIssued` | correct command (**override-adjacent**: `finops.document` + mandatory reason) | docId, number, corrects {docId}, reason, lines (negative-effect quotations with provenance to the compensating settlement facts), same pins as issue | correction registered, linked; original untouched forever |
| `SeriesClosed` | close command / period-close policy | count, registerDigest | series terminal; further issues in this kind+FY refused |
| `SeriesRecovered` | recover command | divergences, eventCount | — |

### 8.3 · Dispatch stream (`dispatch:{dispatchId}`) — 5 types

| Event | Emitted on | Payload (summary) | Replay effect |
|---|---|---|---|
| `DispatchRequested` | request command or issuance policy | dispatchId, channel (`in-app` \| `email` \| `whatsapp` \| `org-webhook`), recipientRef, templateId+version, subjectRefs {docId? \| noticeKind}, quietHoursClass | → `requested` |
| `DispatchSent` | runner (send via `DeliveryPort`) | providerRef, at | → `sent` |
| `DispatchConfirmed` | provider callback / status poll (provider truth, where the channel offers it) | providerEventRef | → `confirmed` (terminal) |
| `DispatchFailed` | runner (exhausted retries) / provider callback | code, detail | → `failed` (terminal; retry = **new** dispatch; DLQ → attention) |
| `DispatchRecovered` | recover command | divergences, eventCount | — |

### 8.4 · Export stream (`export:{exportId}`) — 4 types

| Event | Emitted on | Payload (summary) | Replay effect |
|---|---|---|---|
| `ExportRequested` | request command or period-close policy | exportId, kind (`tally-xml` \| `journal-csv` \| `gstr1-json` \| `audit-bundle` \| `archive-bundle`), params (range, scope), requestedBy | → `requested` |
| `ExportCompleted` | runner (generation done) | artifactRef, artifactDigest, rowCount, watermark | → `completed` (artifact disposable; digest is the truth) |
| `ExportFailed` | runner | code, detail | → `failed` (terminal; retry = new run) |
| `ExportRecovered` | recover command | divergences, eventCount | — |

### 8.5 · Period stream (`period:{orgId}:{fy}`) — 6 types

| Event | Emitted on | Payload (summary) | Replay effect |
|---|---|---|---|
| `PeriodOpened` | open command / first-attestation policy | fy, openingWatermark | period `open` |
| `DayAttested` | attestation run (auto when all checks green) or attest command (human, after exceptions acknowledged) | date, checks [{name, outcome, detail?}] (fixed checklist, §15), watermark, attestor | day recorded; re-attestation of a day is a new event (append-only), latest governs |
| `ExceptionNoted` | attestation run / follower policy / human command | kind (closed set: `sweep-mismatch` · `verification-failure` · `late-upstream-event` · `dispatch-dlq` · `export-failure` · `follower-stall` · `manual`), detail, sourceRef, date? | exception registered → attention; blocks auto-attestation of its day until acknowledged |
| `PeriodClosed` | close command (guard: every day attested through FY end · zero unacknowledged exceptions · watermark current) | closingWatermark, evidence {journalSeq, trialBalanceDigest (quoted from frozen verification), documentRegisterDigest, attestationDigest, exceptionCount, exportRefs (archive bundle)} | period `closed` (terminal; the year's seal) |
| `PeriodReopened` | reopen command (**override**) | reason, compensates | `closed` → `open` (compensating; the seal's history stays; a later re-close seals fresh evidence) |
| `PeriodRecovered` | recover command | divergences, eventCount | — |

**23 types total (3 + 5 + 5 + 4 + 6).**

### 8.6 · Policy edges (deterministic, idempotent, source-keyed)

| Source | Effect | Key |
|---|---|---|
| settlement `PaymentCaptured` (observed by follower) | `DocumentIssued` (receipt) when `profile.issuancePolicy.autoReceipt` — else attention item "receipt due" | `settlement:payment:{id}:{seq}:auto-receipt` |
| `DocumentIssued` | `DispatchRequested` per declared channel when autoDispatch | `finops:series:{id}:{seq}:dispatch:{channel}` |
| settlement `PaymentRefunded` / `CaseReopened` / `ObligationReinstated` touching a documented fact (observed) | `ExceptionNoted (late-upstream-event)` → attention; **correction is a human command**, never automatic | `settlement:{stream}:{seq}:doc-impact` |
| attestation run completion | `DayAttested` (all green) or `ExceptionNoted` per failed check | `ops:{orgId}:{date}:attest` |
| `PeriodClosed` | `ExportRequested (archive-bundle)` | `finops:period:{id}:{seq}:archive` |
| `DispatchFailed` (DLQ) / `ExportFailed` | attention item (projection, not an event) | — |

The frozen doctrine carries: **lifecycle transitions are human commands;
bookkeeping is policy.** Auto-issuance of a receipt is bookkeeping (recording
a consequence of settled truth under a declared policy); corrections, closes,
and reopens are human.

## 9 · The Follower (settlement ingestion)

The one genuinely new mechanism in IP-6, specified precisely:

1. **Source**: `settlement_events` rows, read per org under tenant context
   (the sweep-sentinel pattern — the runner iterates orgs; no pre-tenant
   org-scoped read exists).
2. **Cursor**: `finops_cursors` holds, per org per source stream-type, the
   last consumed `(stream_id, seq)` frontier. The cursor is **operational
   state, not truth**: rewinding it to zero is always safe because every
   effect is keyed by derived command id and re-delivery no-ops (certified).
3. **Ordering**: within a stream, strictly by seq (dense — a gap means the
   read raced an in-flight transaction; the follower waits and re-reads,
   never skips). Across streams, no global order is needed: policies are
   source-keyed, exactly like the frozen coordinator.
4. **Cadence**: poll at a fixed short interval (acceleration by
   LISTEN/NOTIFY permitted later as pure optimization; **poll is the truth
   mechanism** — nothing depends on a notification arriving).
5. **Failure posture**: if a settlement aggregate is halted upstream, its
   log simply stops growing — the follower reads what is committed and
   raises `follower-stall`/attention only on *its own* lag breach. The
   follower never interprets upstream projections, only the log; it can
   never read through a divergence because it does not read rows the log
   does not vouch for.
6. **Honesty**: every settlement-derived read model and document records the
   watermark it reflects; surfaces render freshness (seq + age), never
   pretend liveness (doc 23/51 doctrine).

## 10 · Documents (receipts · tax invoices · corrections)

- **Content is a fold.** A document's canonical content is a pure function
  `(frozen settlement facts at watermark, profile at profileSeq, issuance
  event) → canonical bytes → contentDigest`. Re-rendering at any later date
  reproduces the bytes or proves tampering (the closure-evidence discipline
  applied to paper). Stored PDFs are disposable artifacts; the digest in the
  event is the document.
- **Receipts** quote captured payments: party (team + owner label snapshot),
  amount (quoted from `PaymentCaptured`/its Collection posting), method,
  case/auction references, covered postings. Guard: payment `captured`;
  exactly one receipt per payment per series (source-keyed; duplicate issue
  = original ack).
- **Tax invoices** exist only when the profile declares `gst-registered`,
  and add the statutory surface: supplier identity (GSTIN, legal name,
  address), recipient details as declared, place of supply, SAC, taxable
  value, rate, and the CGST/SGST-vs-IGST split per the declared place-of-
  supply rule. **D5 — the tax decomposition exception**: this is the only
  arithmetic IP-6 performs. It is a pure, kernel-delegating decomposition of
  a settled amount under pinned inputs (basis, rate, rounding rule — all
  recorded in the event), property-locked so decomposed parts recompose to
  the source amount **exactly** in integer paise, reproducible forever. It
  computes presentation of settled money; it never changes what was settled,
  posts nothing, and creates no balance.
- **Corrections** are new documents referencing the original
  (`corrects: docId`), issued by a human after an upstream compensation
  (refund, reopen, reinstatement) raises attention. Originals are never
  edited, voided, or renumbered (invariant 24/30). A correction quotes the
  compensating settlement facts by provenance, like every other line.
- **Numbering** is dense per series, derived from the stream seq (the number
  IS the order — a gap is structurally impossible without a halt), FY-scoped,
  formatted per profile (`{prefix}/{FY}/{n}`). Statutory constraints (length,
  charset) validated at declaration.
- **Label snapshots** at issue (party names, GSTIN as-declared) keep
  documents readable after renames and DPDP erasure; erasure pseudonymizes
  upstream identity but issued financial documents retain their facts for
  the statutory horizon (doc 48/49 doctrine, §3 Retention).
- **Owner access**: a team's owners read and download their own documents
  with no finops grant — access derives from the frozen auction fold's owner
  facts, exactly like the IP-5 Team Statement. Org-side access is
  `finops.view`.

## 11 · Exports, ERP adapters, archive & compliance

- **`ExportPort`** (defined in `packages/finops`; adapters app-side):
  `generate(kind, params, folds) → artifact bytes + manifest`. Every adapter
  is a **pure serializer over folds** — no adapter computes money; sums come
  from kernel-folded balances; every row carries provenance references.
- **Adapters, V1 (closed set; a new adapter is additive, a new kind is an
  ADR after freeze):**
  - `tally-xml` — journal postings as Tally vouchers (the Indian
    accountant's file-import workflow); account mapping is declared org
    config, defaulted from the closed account families.
  - `journal-csv` — the raw double-entry export (postings + legs +
    provenance).
  - `gstr1-json` — GSTR-1-shaped data over issued tax invoices for a period
    (data for filing, not a filing — the platform is not a GSP and does not
    talk to the GST network in IP-6).
  - `audit-bundle` — a case or period's evidence: events, audit slice,
    closure evidence, provenance walk (what a disputing party or auditor
    takes away).
  - `archive-bundle` — the year: document register + canonical documents +
    journal export + attestation record + evidence digests. Auto-requested
    at `PeriodClosed`.
- **Every run is an aggregate** (§7): requested → completed(digest, rowCount,
  watermark) | failed. Every export is audited (invariant 33: what, by whom,
  row count). Artifacts live in the artifact store (`ArtifactStorePort` —
  filesystem/S3-compatible, org-scoped keys), **outside** the event log
  (no blobs in events — the evidence-file precedent); digests in events are
  the integrity truth; a served artifact is digest-verified on read and
  regenerated from folds on mismatch.
- **Retention**: artifact classes carry declared retention (statutory floor:
  8 years for books-equivalent bundles; profile may extend, never shorten
  below statute). The retention sweep (runner, low priority) removes only
  expired **artifacts** — events and digests are never removed; a purged
  artifact remains reproducible from streams for as long as the streams live.

## 12 · Projection Strategy

Two classes, one doctrine each — never confused (D4):

1. **Own-stream projections** (`finops_profiles`, `finops_documents`,
   `finops_dispatches`, `finops_exports`, `finops_periods`,
   `finops_period_days`): updated in the **same transaction** as the append —
   zero lag; verified on every command by fold-vs-rows diff over every row
   the writer reads to decide (the ADR-7 birthright); divergence halts the
   aggregate; disposable and rebuilt byte-identical from the stream.
2. **Follower-fed projections** (report tables, search index, attention
   items derived from settlement facts, freshness meta): after-commit,
   cursor-tracked, idempotent, **watermarked**, and equally disposable —
   rebuild = cursor rewind + re-fold, byte-identical (certified). They are
   convenience; any question of record re-folds the frozen streams.

Settlement projection rows (`settlement_cases`, `journal_legs`, …) may be
**joined for display** (they are verified by their own writer upstream), but
no IP-6 *decision* and no *document content* ever derives from them —
decisions and documents derive from event folds only, because only folds are
reproducible.

## 13 · APIs

- **Internal server actions** (the only mutation surface; the identity D7
  spine `requireSession → resolveTenant → requireCapability → act → audit`,
  writer re-checks capability inside execution):
  - Profile: `declareProfile` · `amendProfile`
  - Documents: `openSeries` · `issueReceipt(paymentId)` ·
    `issueTaxInvoice(caseId, teamId | paymentId)` ·
    `issueCorrection(docId, reason)` · `closeSeries`
  - Dispatch: `requestDispatch(docId | noticeKind, channel)` ·
    `resend(dispatchId → new dispatch)`
  - Exports: `requestExport(kind, params)`
  - Period: `openPeriod` · `attestDay(date)` ·
    `acknowledgeException(exceptionRef, note)` · `closePeriod(fy)` ·
    `reopenPeriod(fy, reason)` (**override**)
  - Recovery: `recoverProfile` · `recoverSeries` · `recoverDispatch` ·
    `recoverExport` · `recoverPeriod` · `rewindFollower(orgId, streamType)`
  - Grants: `issueFinopsGrant` · `revokeFinopsGrant` (§19)
- **Read surfaces**: the §16 read models, all grant-filtered at assembly,
  all watermarked.
- **Document downloads**: authenticated routes serving digest-verified
  artifacts; org side by `finops.view`, team owners by frozen fold owner
  facts (§10).
- **Delivery-provider callbacks** (email/WhatsApp status): HMAC-verified per
  provider, idempotent by provider event id, resolved by trusted-envelope
  (dispatchId + org in provider metadata, pinned at `DispatchSent`) — the
  IP-5 webhook doctrine §21, applied to delivery. Callbacks can only cause
  dispatch-stream transitions for the dispatch their verified payload names.
- **Org-registered outbound webhooks** (doc 51's integration plane, financial
  subset): a dispatch channel — after-commit by construction (the follower
  is), HMAC-SHA256-signed, timestamped, retried (5 attempts / 24 h) →
  DLQ→attention; per-delivery log; SSRF-guarded egress allowlist (doc 49).
  Event kinds: document.issued, case.reconciled (overlay fact), export
  .completed — a closed public subset, PII-minimal (invariant 8).
- **Public REST `/v1`**: **not in IP-6.** Reserved; exposing finops read
  models publicly is a later phase and an ADR (contracts are additive-ready).

## 14 · Command Model

Every mutation enters as a command carrying `commandId` (duplicate ⇒ original
ack, no re-execution); acks are Accepted/Rejected with deterministic reasons.
Guards (all pure, in `packages/finops`), abridged to the load-bearing:

| Command | Guard highlights | Capability |
|---|---|---|
| declare/amendProfile | GSTIN syntax valid when posture `gst-registered` · rounding/basis from closed sets · amend requires reason | `finops.manage` |
| issueReceipt | payment `captured` (fold-verified) · no prior receipt for payment in series · series open · profile current (expected profileSeq matches) | `finops.document` |
| issueTaxInvoice | profile posture `gst-registered` · subject facts fold-verified · decomposition inputs pinned · no duplicate for subject | `finops.document` |
| issueCorrection | original exists · reason mandatory · quoted compensating facts exist upstream (fold-verified) | `finops.document` |
| requestDispatch | subject document exists · channel declared for org · recipient resolvable · quiet-hours class honored (money receipts non-optional per doc 47) | `finops.dispatch` |
| requestExport | kind in closed set · params bounded (range ≤ envelope) | `finops.export` |
| attestDay | all checklist checks evaluated · exceptions for the day acknowledged | `finops.operate` |
| closePeriod | every day attested · zero unacknowledged exceptions · watermark current (re-checked inside the command — a late upstream event between check and commit rejects deterministically) · archive export will be policy-triggered | `finops.close` |
| reopenPeriod | closed · reason mandatory · compensating (seal history preserved) | `finops.override` |
| recover* / rewindFollower | always available; never invents facts | `finops.operate` |

## 15 · Operational Workflows

**The daily cycle (per org, IST, live-window-aware):**

1. **Settlement ops runs** (runner → frozen settlement commands, invoked
   exactly as a human operator would; the Settlement Writer authors any
   resulting events): payment-expiry sweep · provider reconciliation sweep ·
   `verifyJournal` (journal + checkpoint verification). **D7 — invocation is
   not authorship**: IP-6 supplies the schedule and records outcomes; the
   settlement rules, guards, and events remain entirely settlement's. This
   is the permanent home of IP-5 pre-deploy item 3.
2. **Attestation run** evaluates the fixed checklist (closed set):
   `sweeps-ran` · `sweep-mismatches-zero-or-acknowledged` ·
   `journal-verified` (trial balance zero quoted from frozen verification) ·
   `no-halted-aggregates` (settlement + finops) · `follower-current`
   (lag within budget) · `dispatch-dlq-empty-or-acknowledged` ·
   `documents-current` (no unissued auto-receipts older than budget).
   All green → `DayAttested` (system attestor). Any red → `ExceptionNoted`
   per failure → attention; a human acknowledges (with note) and attests, or
   fixes and re-runs.
3. **Dispatch and export workers** drain their queues (priority classes per
   doc 53: dispatch high, exports normal, retention low; an export storm
   never delays a receipt).

**Year-end close:** organizer reviews the period board (365 attested days,
exceptions history) → `closePeriod` seals evidence → archive bundle
auto-generated → accountant hand-off (Tally export + bundle). A material
post-close upstream correction (a reopened case reaching into a closed FY)
raises `late-upstream-event` → next-period disclosure by default (the
prior-period-adjustment reality of bookkeeping), override `reopenPeriod` when
the organizer must re-seal.

**Attention queue** (the ops board's spine — a read model, not a stream):
union of settlement attention facts (disputes, refund liabilities,
discrepant cases, halted aggregates — read from frozen surfaces) and finops
facts (DLQ, export failures, follower stalls, receipt-due, doc-impact,
unacknowledged exceptions), ranked, each item carrying its provenance and its
resolving action.

**Runbooks** (authored in full at milestone build, the IP-5 pattern; the
design commits to these chapters): the daily cycle and its failure branches ·
reading rejection reasons · halted finops aggregate → diagnose/heal ·
follower stall/rewind · dispatch DLQ handling · artifact digest mismatch →
regenerate · period close and reopen · unhealable finops log →
restore-from-backup (PITR) · delivery-provider outage posture · the
settlement runbooks remain authoritative for everything upstream.

## 16 · Read Models

All grant-filtered at assembly (C-8), watermarked, derived purely from folds
(+ joined frozen projections for display), and disposable.

| Read model | Content | Audience (authority) |
|---|---|---|
| **Documents register** | every document: number, kind, party, amount, status of dispatch, provenance, digest | `finops.view` |
| **Owner documents** | a team's own receipts/invoices/corrections, downloadable | team owners via frozen fold owner facts; org via `finops.view` |
| **Ops board** | the ranked attention queue + freshness meta (per-stream watermarks, follower lag) | `finops.view` |
| **Day board / Period board** | checklist outcomes per day; the FY at a glance; exceptions history; close readiness | `finops.view` |
| **Reports** | collections by period/method, outstanding aging, waiver register, refund-liability register, season/multi-tournament rollups (doc 45 Association tier) | `finops.view` |
| **GST register** | issued tax invoices with decomposition detail, GSTR-1-shaped preview | `finops.view` |
| **Dispatch log** | every attempt: channel, template version, provider refs, status trail | `finops.view` |
| **Export history** | every run: kind, params, digest, row count, watermark, requester | `finops.view` |
| **Financial search** | by document number, provider ref, party, amount, date — resolving to register rows and provenance walks | `finops.view` |
| **Provenance walk** | a rupee's chain: document line → posting → settlement event → (across the frozen boundary, read-only) auction gavel event | `finops.view`; a team's own slice to its owners |
| **Audit reporting** | filterable audit slices (doc 48 Console→Audit posture) scoped to financial taxonomies, exportable via audit-bundle | `finops.view` + existing audit-read conventions |

## 17 · Replay Strategy

- One **pure reducer per stream type** in `packages/finops`; replay is a
  fold from seq 1 — no IO, no clock, no randomness; ids minted at the
  command edge and recorded in payloads; canonical sorted-key serialization;
  **the genesis fold is the definition of truth** for every finops stream.
- **Fail-closed reason set (closed):** `sequence_gap` · `unknown_event_type` ·
  `illegal_replayed_transition` · `malformed_{event}` · `unknown_profile` ·
  `unknown_series` · `unknown_document` · `unknown_dispatch` ·
  `unknown_export` · `unknown_period` · `number_gap` (a document number not
  dense with its seq) · `duplicate_document_source` (second receipt for one
  payment in a series) · `decomposition_mismatch` (tax parts do not recompose
  to the quoted amount exactly) · `watermark_regression` (an event pinning an
  older watermark than its predecessor where monotonicity is required).
  Anything unfoldable halts, loudly.
- **Byte-identical replay** across two independent processes — projections
  and rendered document bytes both — is the constitutional test (§25).
- **Cross-stream and cross-context replay needs no global order**: all
  coordination is source-keyed (§8.6); re-deriving effects from replayed
  streams reproduces the same documents, dispatch requests, and attestations
  regardless of interleaving.
- **Quotation reproducibility**: for every event quoting settlement facts,
  re-folding the frozen streams to the pinned watermark must reproduce the
  quoted values exactly — certified over the whole register (§25). IP-6
  never re-implements a settlement fold; it calls the frozen ones.

## 18 · Failure Model

Every mode has a named detection and a fail-closed disposition; none is
recovered by guesswork.

| # | Failure | Detection | Disposition |
|---|---|---|---|
| F-1 | Upstream compensation after issue (refund/reopen touches a documented fact) | follower doc-impact policy | `ExceptionNoted` → attention; human issues a **correction document**; original immutable |
| F-2 | Late upstream event for a **closed** period | watermark comparison at follower | `late-upstream-event` exception; next-period disclosure by default; override `reopenPeriod` if material — the seal's history preserved either way |
| F-3 | Settlement aggregate halted upstream | ops checklist `no-halted-aggregates` | day cannot auto-attest; attention names the frozen runbook; follower unaffected (reads only committed log) |
| F-4 | Follower crash / stall / double-run | cursor heartbeat + lag budget | resume/rewind is always safe (derived command ids); `follower-stall` exception on budget breach |
| F-5 | Duplicate issue command / replayed policy | `commandId` + `duplicate_document_source` | original ack; one receipt per payment per series, structurally |
| F-6 | Profile amended between decision and issue | expected `profileSeq` pin in command | deterministic rejection; re-issue under current profile |
| F-7 | Tax misdeclared (wrong rate/posture) | human discovery; amendments audited | corrections + profile amendment; the platform never decided the tax, so it never silently "fixes" one |
| F-8 | Dispatch provider outage / undeliverable | port errors; retries exhausted | DLQ → attention; **nothing sent is ever unsent**; resend = new dispatch; critical financial docs surface to organizer (doc 47 failure honesty) |
| F-9 | Forged delivery callback | per-provider HMAC + trusted-envelope pin cross-check | rejected, audited (the IP-5 F-1 doctrine on the delivery plane) |
| F-10 | Artifact tampered/lost in store | digest verification on serve; retention sweep audit | serve refused; regenerated from folds; digest in event is truth |
| F-11 | Own projection row tampered (register, period days, …) | fold-vs-rows diff on every command | aggregate halts; recovery heals byte-identical from events |
| F-12 | Finops event log corrupted | reducer fail-closed set (§17) | halt; restore-from-backup/PITR (unhealable by design); frozen streams unaffected |
| F-13 | Concurrent writers on one finops aggregate | unique `(stream_type, stream_id, seq)` | loser fails loudly; bounded retry; never a silent merge |
| F-14 | Runner double-schedules a job / crash mid-policy | derived job/command ids; catch-up scan | effects re-derived idempotently; no double document, dispatch, or attestation |
| F-15 | Number series gap or fork | seq-derived numbering + `number_gap` fail-closed | structurally near-impossible; any occurrence halts the series |
| F-16 | Capability set bleed (finops set in a foreign engine) | all three evaluators fail closed on foreign sets (§19) | confers nothing anywhere; test-locked |
| F-17 | Cross-tenant probe on any finops table | RLS USING + WITH CHECK, non-superuser proofs | zero rows; rejected writes |
| F-18 | IP-6 code constructs a settlement-typed envelope | hostile certification test + writer-role restriction (settlement pre-deploy item 2) | structurally refused; permission-level once roles land |

## 19 · Capability Strategy & Permissions

The IP-5 §20 pattern, applied as the **third parallel partition**. The frozen
`Capability` union and the frozen settlement module are both untouched.

- **Atoms** (closed union in `packages/finops`): `finops.view` ·
  `finops.manage` (profile, series lifecycle) · `finops.document` (issue
  receipts/invoices/corrections) · `finops.dispatch` · `finops.export` ·
  `finops.operate` (run/ack ops, attest days, recover) · `finops.close`
  (period close) · `finops.override` (period reopen).
- **Named sets** (ergonomics only): `finops:clerk` = {view, document,
  dispatch} · `finops:accountant` = clerk + {export, operate, manage} ·
  `finops:controller` = accountant + {close, override}. Nothing else.
- **A pure evaluator** with identical fail-closed semantics (unknown set ⇒ ∅ ·
  revoked ⇒ ∅ · exact scope only), unit-tested to the same standard.
- **Storage is the existing `grants` table** — additive rows; issuance and
  revocation by the **finops grant actions**, gated by the frozen
  `grant.issue`/`grant.revoke` on org scope, refusing unknown sets at
  creation, audited in-transaction. This is IP-6's **one sanctioned
  cross-context write**, the exact IP-5 precedent, declared here.
- **Three-way partition, proven**: the frozen engine, the settlement engine,
  and the finops engine each expand the other two's sets to **nothing** —
  certified in all six directions (§25). `org:owner` holds no implicit finops
  power; settlement officers hold none either — handing someone the books'
  *mouth* (documents, dispatch, close) is a distinct, explicit act of trust
  from handing them the books.
- **Separation of powers**: issuing documents does not confer sealing years;
  operating the schedule does not confer reopening a sealed year; nothing
  confers any settlement or auction power.
- **Owners** read their documents via frozen fold owner facts (§10) — no new
  grant machinery. 404-not-403 and money-visibility redaction carry over.
- **The runner** acts under system sentinels (`system:runner`,
  `system:follower`) with per-org tenant context — audited like any actor,
  granted nothing beyond its coded surface.

## 20 · RLS Strategy

The platform discipline, applied at birth:

- Every new table (`finops_events`, `finops_profiles`, `finops_documents`,
  `finops_dispatches`, `finops_exports`, `finops_periods`,
  `finops_period_days`, `finops_cursors`, `finops_attention`) carries
  `org_id` and ships `ENABLE` + `FORCE ROW LEVEL SECURITY` in its creating
  migration with **both** `USING` and `WITH CHECK` keyed to
  `current_setting('app.org_id', true)` — fail-closed; no self-row disjunct;
  no cross-org shape.
- **No new policies on frozen tables**; settlement/auction reads run under
  the existing frozen policies.
- **No new pre-tenant pattern is introduced.** The runner iterates orgs and
  establishes tenant context before any org-scoped read (the sweep pattern);
  delivery-provider callbacks resolve by trusted envelope (dispatchId + org
  pinned at `DispatchSent`) exactly as IP-5's webhook ingress — verify HMAC
  platform-level first, then establish context, then load and cross-check.
- Proof tests run under dedicated **non-superuser** roles: cross-tenant reads
  fold to zero rows on all nine tables; cross-tenant and no-context writes
  rejected; runner transactions succeed under tenant context.
- **Inherited platform fact, not widened**: runtime isolation is
  application-layer today (`withTenant` call sites = 0 — IP-2/IP-4 MAJ-2,
  IP-5-confirmed). Every IP-6 path (web writer, runner, follower, callbacks)
  is built **withTenant-compatible** — single transaction per command,
  context established before org-scoped reads — so the one pre-deploy wiring
  item covers finops with zero rework. Nothing depends on BYPASSRLS.
- The artifact store enforces org-scoped keys and is served only through the
  authenticated, digest-verifying download route.

## 21 · Recovery Strategy

- **Halt-on-divergence, per aggregate**: a failed fold, a projection diff, or
  a determinism failure halts that aggregate (`finops_halted`); other
  aggregates, all settlement, and all auctions are unaffected.
- **Recovery is replay from genesis**: `Recover{Profile|Series|Dispatch|
  Export|Period}` re-folds and heals rows from events, emitting
  `*Recovered {divergences, eventCount}`. Never invents facts.
- **Follower recovery is a rewind**: reset the cursor to any earlier frontier
  and re-run — idempotent effects make it safe; a full rebuild of
  follower-fed projections is cursor-to-zero plus re-fold, byte-identical.
- **Artifacts are regenerated, never restored by hand**: digest mismatch ⇒
  regenerate from folds; the event's digest decides.
- **Healable**: any projection tamper (register rows, period days, dispatch
  rows, attention, cursors), artifact loss/tamper. **Unhealable**: corruption
  of `finops_events` itself — restore-from-backup/PITR, runbook-documented,
  never patched by hand. Frozen streams are outside IP-6's blast radius
  entirely.
- **Coordinator/runner recovery**: catch-up scans re-derive missing policy
  effects and missed schedule ticks idempotently (derived ids). A crashed
  attestation run re-runs; a crashed export re-runs as a new attempt.

## 22 · Determinism Guarantees

1. Pure reducers; injected clock; ids at the edge; canonical sorted-key
   serialization; no timestamp generated during serialization.
2. **Byte-identical replay across processes** for projections **and rendered
   document bytes** — certified, not assumed.
3. **Deterministic decomposition**: identical (amount, basis, rate, rounding
   rule) ⇒ identical splits, forever; parts recompose exactly.
4. **Deterministic coordination and scheduling effects**: policy effects are
   pure functions of source events; derived ids make effect sets
   order-independent and re-entrant.
5. **Reproducible quotation**: every quoted money figure re-derives exactly
   from the frozen folds at the pinned watermark.
6. **Reproducible evidence**: `PeriodClosed` evidence re-derives from pinned
   prefixes at any later date, across reopens — the closure-evidence
   guarantee at year scale.

## 23 · Performance Strategy & Targets

FinOps is human-and-schedule-paced; targets are honesty margins. **Every
number below is a design budget to be measured on the IP-4/IP-5 harness
posture (live PG17, certified envelope inputs) during the build — none is a
measurement today.** The only measurements cited are frozen IP-5 baselines
(e.g. journal genesis fold 0.45 ms @ 121 events; org recovery ~215 ms), which
bound what the folds IP-6 calls already cost.

| Operation | Budget |
|---|---|
| Document issue ack (fold-verify subject + decompose + append + project) | p95 < 150 ms |
| Document render / re-render (canonical bytes @ envelope document) | < 200 ms |
| Follower lag (settlement commit → follower-fed projection reflects) | p95 < 5 s · budget breach at 60 s raises `follower-stall` |
| Dispatch enqueue → provider send (non-quiet-hours) | p95 < 60 s |
| Ops board / registers / reports read | < 200 ms |
| Financial search | < 200 ms |
| Attestation run (full checklist, per org) | < 5 min including the settlement sweeps it awaits |
| Tally/CSV export @ 100,000 legs | < 30 s, resumable |
| GSTR-1 export @ one FY of invoices | < 60 s |
| Archive bundle @ envelope FY | < 5 min, resumable |
| Any finops aggregate recovery at envelope | < 2 s |
| Follower full rebuild (cursor zero, one org season) | < 60 s |
| Certified envelope | inherited: 64 teams · 10,000 payments/org/season · 100,000 journal legs/org — plus ≤ 12,000 documents/org/FY · ≤ 40,000 dispatches/org/FY · 365 attested days/org/FY; enforced at the web tier like the frozen envelopes |

Strategy: command paths touch bounded streams only (§7 — no unbounded fold on
any command); the journal is read through the frozen checkpointed
verification, never re-folded per command by IP-6; exports and bundles are
background, chunked, resumable; the follower batches by seq ranges; the
search index is rebuildable and never load-bearing.

## 24 · Audit Strategy

Doc 48, applied without exception: every finops mutation appends its event
**and** an `audit_log` row in the same transaction — audit failure fails the
action. New taxonomy (one namespace with §8): `finops.profile.declared/
amended`, `finops.document.issued/corrected`, `finops.series.opened/closed`,
`finops.dispatch.requested/sent/confirmed/failed`, `finops.export.requested/
completed/failed`, `finops.period.opened/day-attested/exception-noted/closed/
reopened`, `finops.recovery.*`, `grant.issued/revoked` (finops set named).
Overrides carry mandatory reasons. Runner and follower actions are audited
under their sentinels. Provider callback ingress is audited even when it
appends nothing (replayed id, failed verification) — rejected truth attempts
are evidence. Owner-visible slices carry over (documents are the owner's own
audit trail). Audit substrate immutability is inherited and re-proven over
the new taxonomy.

## 25 · Certification Strategy

The platform doctrine: attack, then re-attack the conclusions.

1. **Property suites** (pure, `packages/finops`): document render
   determinism (same inputs ⇒ same bytes, two processes) · numbering density
   under random issue/correct walks · decomposition recomposition exactness
   across random amounts/rates/roundings (kernel-locked) · quotation
   reproducibility against generated settlement streams · attestation
   checklist determinism · replay determinism and the full §17 fail-closed
   set · all three capability engines fail closed on all foreign sets (six
   directions).
2. **Tamper drills** (live PG17, non-superuser roles): mutate a register
   row / period day / dispatch row → halt + heal byte-identical · corrupt an
   artifact → serve refused, regenerated, digest matches · rewind and
   double-run the follower → zero duplicate effects · forge/replay a
   delivery callback → rejected/original-ack · cross-tenant probes on all
   nine tables → zero rows, rejected writes.
3. **Two-process determinism**: independent processes fold identical finops
   streams → byte-identical projections **and document bytes**; quotation
   re-derivation over the whole register.
4. **Frozen-boundary proofs**: zero-diff gate (§27) · dependency-cruiser
   zero violations · the hostile no-write-path test: no IP-6 code path can
   append to `settlement_events`/`auction_events` or construct a
   settlement-typed envelope; the frozen settlement catalog still folds
   IP-5 streams unchanged; dormant types remain dormant (no emitter exists
   in the tree, asserted structurally).
5. **Reconciliation drills**: drop a provider webhook upstream → the
   scheduled sweep heals it (frozen behavior) → the attestation run reflects
   the healed record and the day attests · force a sweep mismatch → exception
   → acknowledge → attest · halt a settlement aggregate → day refuses
   auto-attestation, names the runbook.
6. **End-to-end founder journey** (real browser, axe-clean): season runs →
   captures auto-issue receipts → owner receives WhatsApp receipt and
   downloads it → organizer declares GST profile → tax invoice issued →
   accountant pulls Tally export → a refund raises doc-impact → correction
   issued → days attest across the run → FY closes, archive bundle sealed →
   upstream reopen raises late-event exception → next-period disclosure →
   override reopen/re-close reproduces fresh evidence while the old seal
   still re-derives. Plus: kill the runner mid-attestation → catch-up
   completes; kill the follower mid-batch → resume, zero duplicates.
7. **Independent hostile review** before freeze, briefed to re-attack the
   passing certification's own claims — with specific mandate on the two new
   mechanisms (follower idempotency, decomposition exactness) and the
   boundary (find a write path to settlement).

## 26 · Milestone Roadmap

Defined here because the design mandate requires it; **not opened** — the
stop condition holds and no milestone begins without Founder approval of this
document. The IP-1…IP-5 cadence: each milestone ends with a founder
demonstration and a written report; none opens until the prior is approved.

| ID | Name | Scope (all within this document — nothing new) | Founder demonstration |
|---|---|---|---|
| **M-IP6-1** | **Foundation & Follower** | `packages/finops` pure domain; migrations `0014+` with RLS; the FinOps Writer; TaxProfile aggregate; the follower + cursors + watermarks; attention/ops board (read-only); capability module + grant actions | a settled season's facts flowing into watermarked finops read models — and a cursor rewind reproducing them byte-identically |
| **M-IP6-2** | **Documents** | DocumentSeries aggregate; receipts (auto + manual), tax invoices with decomposition, corrections; register + owner access + downloads; renders digest-pinned | a captured payment becomes a numbered receipt in an owner's hands; a GST invoice decomposes exactly; a refund becomes a correction, the original untouched |
| **M-IP6-3** | **Dispatch & Exports** | Dispatch aggregate + `DeliveryPort` adapters (in-app, email, WhatsApp-BSP, org-webhook) + callbacks + DLQ; ExportRun + `ExportPort` adapters (Tally, CSV, GSTR-1, audit bundle) + artifact store | the receipt arrives on WhatsApp; the accountant imports the Tally file; a forged callback bounces; a dead-lettered dispatch surfaces and resends |
| **M-IP6-4** | **Operations & Fiscal Close** | `apps/finops-runner`; the settlement ops schedule (sweeps + verification — IP-5 pre-deploy item 3 discharged); attestation runs + day/period boards; exceptions; period close + archive bundle; financial search; retention sweep | a day reconciles itself and says so; a dropped webhook heals and the day still attests; the year closes sealed, exported, and reproducible |
| **M-IP6-5** | **Certification & Freeze** | §25 in full: property suites, tamper drills, two-process determinism, reconciliation drills, boundary proofs, hostile review, performance measurement against §23 budgets, runbooks, closure package | the drills run live; the reviewer's findings closed; `ip6-frozen` recommended |

## 27 · Acceptance Gates

**Standing gates, every milestone**: `tsc --strict` clean, zero
suppressions · lint `--max-warnings 0` · dependency-cruiser 0 violations
(§4 rules encoded) · prettier clean · unit + integration (live PG17) + e2e
green · migration replay from empty DB clean · production build clean
(web + engine + runner).

**The frozen-path zero-diff gate, every milestone.** Two checks, both empty:

1. `git diff ip5-frozen -- packages/core packages/auction
   packages/settlement packages/ui apps/engine apps/web/src/server/auction
   apps/web/src/server/settlement apps/web/src/server/orgs
   apps/web/src/server/auth apps/web/src/server/competition` — the frozen
   module trees.
2. Byte-identity against `ip5-frozen` of the **fourteen frozen migrations,
   enumerated by exact filename** — `0000_identity.sql` … `0010_conduct_
   ceremony.sql` (the IP-4 eleven) plus `0011_settlement_foundation.sql` ·
   `0012_collections_payments.sql` · `0013_closure_evidence.sql` — and of
   their journal entries. Enumerated, never glob-matched (the IP-5 §26
   rationale stands: a prefix pattern would also match this phase's lawful
   `0014+`).

Contracts/db/web changes are additive-only.

**Phase-specific gates:**

| Gate | Proves |
|---|---|
| G-1 Event discipline | catalog closed at §8's 23 types · reducers fail closed on the full §17 set · every mutation = 1 event + same-tx audit + same-tx own projection |
| G-2 Quotation | every money figure in every finops event/document re-derives exactly from frozen folds at its watermark · decomposition recomposes exactly · zero money arithmetic outside kernel delegation |
| G-3 Determinism | byte-identical replay and document bytes, two processes · follower rebuild byte-identical from cursor zero |
| G-4 Documents | numbering dense, gap = halt · one receipt per payment per series · corrections never mutate originals · owner access from frozen fold facts only |
| G-5 Dispatch & exports | provider-truth callbacks (forge/replay/mismatch drills) · nothing unsent ever unsent · DLQ visible · every export digest-pinned with provenance · artifact tamper refused and regenerated |
| G-6 Operations | sweeps scheduled and outcomes recorded (IP-5 item 3 discharged) · attestation checklist deterministic · exceptions block auto-attest · period close guard re-checks watermark · reopen compensating with seal history intact |
| G-7 Authorization & tenancy | three-way capability partition (six directions) · grant issuance gated by frozen `grant.issue`, unknown sets refused · RLS read+write proofs on all nine tables under non-superuser roles · trusted-envelope callback resolution · withTenant-compatibility preserved |
| G-8 Boundary | zero-diff (both checks) · no write path to `settlement_events`/`auction_events` (hostile test) · dormant settlement types still dormant · `apps/engine` untouched byte-for-byte · settlement certification suite still green on the extended schema |

## 28 · Freeze Criteria

IP-6 freezes (`ip6-frozen`) when every line below is repository truth,
re-measured fresh:

1. All §27 gates green on live PG17; zero freeze-blocking defects open.
2. The §8 catalog **closed at 23 types**; reducers fail closed on everything
   else; additions declared ADR-only. Export kinds, dispatch channels,
   checklist checks, and exception kinds equally closed.
3. Byte-identical replay — projections and document bytes — across two
   independent processes at the certified envelope; follower rebuild
   byte-identical; quotation reproducibility proven over the full register.
4. Decomposition exactness, numbering density, and quotation properties
   regression-locked in the pure domain **and** in integration.
5. Every tamper drill detected fail-closed and healed (or halted unhealable
   with the restore path exercised); zero false halts across envelope runs.
6. The zero-diff gate empty against `ip5-frozen`; boundary graph clean; the
   hostile no-write-path-to-settlement proof standing; dormant types dormant.
7. Three-way capability partition proofs standing; grant actions gated by
   frozen `grant.issue`/`grant.revoke`; RLS proofs standing under
   non-superuser roles; the `withTenant` pre-deploy item covers finops with
   zero rework, runner and callbacks included.
8. §23 budgets **measured** and met (or re-ratified with measurements —
   never estimates); the envelope enforced.
9. Independent hostile review completed, findings resolved and
   regression-locked, its report in the closure package.
10. Documentation reconciled to implementation truth (implementation wins,
    docs corrected): architecture, event catalog, runbooks, security/threat
    model, closure report.
11. The freeze boundary declared for downstream phases: they may read finops
    read models and the document/dispatch/export/period registers, and may
    build atop `DeliveryPort`/`ExportPort` with new adapters; they may not
    write finops events, may not mint document numbers outside the series
    aggregates, and may not require a finops or settlement rule change to
    function. If one does, that is an ADR and a thaw, not a patch.

## 29 · Architecture Decision Records (proposed — ratified upon approval of this document)

| ADR | Decision |
|---|---|
| **ADR-1 · Truth vs. testimony** | Settlement owns financial truth; IP-6 owns operational testimony about it (issuance, delivery, export, attestation). Every IP-6 money figure is a quoted settlement fact pinned by provenance and watermark; challenge any artifact and the platform re-derives it from frozen streams or proves it forged. No second ledger, wallet, or payment model exists or can be expressed. |
| **ADR-2 · Documents are IP-6 facts; the dormant types stay dormant** | `ReceiptIssued`/`CreditNoteIssued` in the frozen settlement catalog never gain an emitter. Document issuance (numbering, rendering, digest, delivery) is operational and lives in IP-6 streams. Waking the dormant types would require a settlement thaw — constitutionally out of bounds. |
| **ADR-3 · The Follower** | IP-6's settlement-derived projections are after-commit, cursor-tracked, at-least-once with idempotent source-keyed effects, watermarked on every surface, and disposable. Eventual consistency is declared and bounded, never hidden. The first non-zero-lag projections on the platform — justified because IP-6 may never join frozen transactions, and made safe because truth remains the fold. |
| **ADR-4 · The Runner** | A dedicated worker process (pg-boss, IST-pinned, live-window-aware) — the doc-53 seam split now that the engine is frozen. No money path exists in IP-6, so C-16 holds by construction. The runner invokes frozen settlement maintenance commands on schedule; **invocation is not authorship** — the Settlement Writer remains the sole author of settlement events. |
| **ADR-5 · The third capability partition** | A finops capability module over identity's `grants` substrate; all three engines (frozen, settlement, finops) fail closed on the others' sets, proven in six directions. Grant issuance is IP-6's one sanctioned cross-context write, gated by the frozen `grant.issue`. Money-mouth authority is explicit, per person, per org. |
| **ADR-6 · Tax is declared, never invented** | The organizer declares tax posture, rates, basis, and rounding in an append-only profile; documents pin the profile version. The only arithmetic in IP-6 is the pure, kernel-delegating decomposition of settled amounts under those pinned inputs — property-locked to recompose exactly, reproducible forever. The platform computes presentation of taxes; it never decides them and never posts them. |
| **ADR-7 · TDS is rejected** | No outbound-payment lane exists in the frozen platform; deduction-at-source is capture-time money math requiring a new posting template — a settlement thaw. Revisit only when a payout/commission lane phase opens, as that phase's ADR. |
| **ADR-8 · Financial dispatch only** | IP-6 ships delivery for financial documents and notices behind `DeliveryPort` with a full dispatch log and provider-truth status. The platform-wide C-19 notification catalog is a later phase, which lifts this pattern; IP-6 does not build the org-wide pipeline. |
| **ADR-9 · Artifacts are disposable; digests are truth** | Rendered PDFs, export files, and bundles live outside the event log, referenced by digest. Serving verifies the digest; mismatch regenerates from folds. Retention sweeps remove artifacts only — never events, never digests. |
| **ADR-10 · Fiscal close is attestation, not accounting** | The journal has no year boundary and gets none. `PeriodClosed` seals evidence (digests, watermarks, attestation history) — the closure-evidence pattern at year scale. No closing entries, no balance recomputation, no re-statement of anything settlement said. Reopen is compensating; old seals re-derive forever. |

---

*IP-6_ARCHITECTURE.md v1.0 · CTO · 2026-07-15 · **DESIGN ONLY.** Engineering
holds at this artifact pending Founder review. No milestone is open; no
implementation, schema, or code is authorized by this document.*

