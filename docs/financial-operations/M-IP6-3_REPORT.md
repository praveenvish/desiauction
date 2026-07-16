# M-IP6-3 — DISPATCH & EXPORTS · MILESTONE REPORT

## DesiAuction NEXT · v1.0 · 2026-07-16 · CTO · **Status: ENGINEERING COMPLETE — awaiting Founder review**

Implements [IP-6_ARCHITECTURE](IP-6_ARCHITECTURE.md) §11/§13/§15 (delivery,
exports, pipelines) on the approved [M-IP6-1](M-IP6-1_REPORT.md) and
[M-IP6-2](M-IP6-2_REPORT.md). Every number below is repository truth measured
fresh this cycle against live Postgres 17.

---

## 1 · What was built

**The delivery pipeline.** The frozen Dispatch aggregate (M-IP6-1's closed
shapes) gains its operational life: the runner discovers `requested`
dispatches by SCAN (the platform's catch-up doctrine — crash anywhere and the
next scan re-derives the identical work), assembles the body EXCLUSIVELY from
**reproduced document bytes** (`reproduceDocument`, byte-verified against the
sealed digest — an unreproducible document is never delivered), and sends
through a `DeliveryPort`. Outcome taxonomy, fail-closed throughout:
unconfigured channel / unreproducible document / permanent provider rejection
→ terminal `DispatchFailed` events; retryable provider failures → **audited
attempts** + deterministic job backoff; exhaustion → terminal
`retries_exhausted` event; adapter crashes and unknown provider behaviour →
job retries → **DEAD LETTER**, operator-recoverable via the audited,
capability-gated `requeueDeadJob`. Every transition is a writer command with a
derived command id — replayed sends can never double-transition.

**Provider ports & adapters** (the IP-5 gateway doctrine on the delivery
plane): `DeliveryPort` (send + optional callback verification) and
`ArtifactStorePort`, with three production-grade adapters that need no
external service — **in-app** (delivery IS register visibility; confirms
inline), **filesystem outbox** (the email dev/pickup pattern; the written file
carries the reproduced bytes + digest), and the **filesystem artifact store**
(root-confined keys, fail-closed on escape). Provider-backed
email/SMS/WhatsApp/S3 adapters are drop-ins behind the same ports — pre-deploy
configuration (the Razorpay-credentials precedent), never a rewrite. No
provider SDK exists anywhere in the package.

**Callback ingress** (`ingestDeliveryCallback`): adapter-verified, idempotent
by `provider:{providerEventRef}` (a replayed callback returns the original ack
and appends nothing), deterministic on late and out-of-order arrivals (they
bounce off the frozen machine) — and **audited even when nothing appends**:
rejected truth attempts are evidence.

**Manual operations** mapped onto the frozen shapes (the settlement ADR-1
precedent — no new event types, ever): manual completion →
`DispatchConfirmed` with a `manual:{commandId}` ref (never masquerading as
provider truth); manual cancellation → terminal `DispatchFailed(cancelled)`;
retry of any terminal failure → a NEW dispatch/export (history is never
reopened).

**The export pipeline.** Requested runs generate deterministically: gather
every in-scope document, **reproduce each one** (a single unreproducible
document poisons no archive — the run fails terminally with the offender
named), build the artifact with a pure serializer, store it, **read-back
verify**, then `ExportCompleted` seals ref + digest + rowCount + watermark.
Five builders (`exporters.ts`, pure): `journal-csv` (the document register,
fields verbatim), `tally-xml` (Receipt/Sales/Credit-Note vouchers),
`gstr1-json` (tax-invoice payloads verbatim — zero tax computation),
`audit-bundle` and `archive-bundle` (reproduced bytes + sealed digests +
series metadata). The only money-shaped code is paise→decimal STRING
formatting by digit manipulation — no arithmetic. `verifyExport` checks both
the stored artifact AND a full regeneration against the sealed digest;
`regenerateExportArtifact` heals lost/corrupted artifacts from sources
(ADR-9), audited.

**Runner extension**: three new job kinds (`dispatch.send`,
`export.generate`, `export.daily`); the daily-ops slot now also enqueues the
per-org **daily register export** (idempotent by `dailyKey`,
crash-resumable); the tick gains the two pipeline scans; `claimJobs`/
`drainJobsOnce` gain an **org-scoped drain** (the per-org sharding seam,
also what isolates test tenants). No scheduling exists in web or follower.

**Six read models**, all watermarked, rebuildable, disposable:
DispatchSnapshot (with the subject's live reproduction verdict),
ExportSnapshot (with artifact + regeneration verification),
ProviderHealthSnapshot, DispatchQueueSnapshot, RetrySnapshot, ArchiveSnapshot.

**Zero new event types. Zero schema. Zero migrations.** 2,162 LOC added
(1,193 of it tests); additive members on ports/store/deps/writer only.

## 2 · What was verified (all fresh, live PG17)

| Gate | Result |
|---|---|
| TypeScript (`tsc --strict`, forced) · Lint (`--max-warnings 0`) · Prettier | clean · 11/11 workspaces |
| Boundaries (dependency-cruiser) | **0 violations** · 531 modules · 1,865 dependencies |
| **FinOps unit** | **73 tests** (66 prior unchanged + 7 exporters) |
| **Delivery & exports regression (live PG17)** | **17 tests**, new permanent suite |
| **Full web integration** | **246 passed** (foundation 30 + documents 15 + delivery 17 + frozen 184) — **three consecutive clean runs** |
| Migration replay (EMPTY DB → 15 migrations) | clean · 42 tables · 35 policies — no new migration |
| Production build | clean; runner binary boot-smoked (starts, ticks, SIGTERM-clean) |
| **Zero-diff vs `ip5-frozen`** | **0 lines** across every frozen tree; all **14 frozen migrations byte-identical**; `packages/db` untouched this milestone |
| Frozen Documents & catalog | no reducer/renderer/issuance file edited; catalog pinned at 23 (test-locked); the 30 M-IP6-2 document tests pass unmodified |

The CTO's mandated attack list, each in the permanent suite: **duplicate
dispatch** (re-scan + re-drain move nothing) · **duplicate provider callback**
(original ack, zero appends) · **late callback** (bounces off the terminal
machine, audited as evidence) · **out-of-order acknowledgements** (confirm
before send → `dispatch_not_sent`) · **retry storms** (backoff instants
asserted to the millisecond; two audited attempts; **exactly one** successful
provider send) · **provider timeout/exhaustion** (five attempts, then the
terminal `retries_exhausted` event — never a loop) · **unknown provider
status** (SDK garbage fails closed → dead letter → unauthorized requeue
refused → authorized requeue → delivery completes) · **dead-letter recovery**
· **export corruption & archive corruption** (tampered AND deleted artifacts
detected by digest, proven by regeneration, healed from sources) · **rebuild
after delete** (dispatch and export rows heal byte-identical) · **provider
replay** · plus the two boundary meters: across every delivery and export
operation, the settlement log AND the document series streams are
bit-identical — dispatch edited neither settlement nor documents.

## 3 · Engineering decisions

1. **Scan-based pipelines, not writer-enqueued jobs**: discovery reads state,
   job keys derive from aggregate ids, effects carry derived command ids —
   the same crash-proof shape as the follower policies and the frozen
   coordinator. No transactional-outbox machinery was needed.
2. **Two failure planes, deliberately distinct**: aggregate OUTCOMES are
   events (terminal facts on the dispatch/export streams); transport
   ATTEMPTS are job state + standalone audit rows (`DispatchAttemptFailed`,
   eventSeq 0 — the rewindFollower precedent). "Every provider response
   becomes immutable" holds: transitions as events, transients as audit
   evidence — and the closed 23-type catalog never grew.
3. **Org-scoped draining** added to `claimJobs`/`drainJobsOnce` — the per-org
   sharding seam named in M-IP6-1, landed now because the hostile suites
   proved a global drain lets one tenant's consumer claim another's work
   with differently-configured deps. Production ticks still drain globally.
4. **Built-in adapters over stub SDKs**: in-app and filesystem-outbox are
   REAL first-class channels (the IP-5 manual-adapter doctrine), so the
   pipeline is honest end-to-end today; provider SDK wiring is pre-deploy
   configuration behind the same ports.
5. **Read-back verification on every export write**, plus dual verification
   at rest (artifact digest AND regeneration digest) — a corrupted store and
   a forged run are distinguishable: the first heals, the second is exposed
   (`regeneration_digest_mismatch` refuses to overwrite).
6. **`requeueDeadJob` is capability-gated** (`finops.operate`) and audited —
   dead-letter recovery is an operator power, not a loophole.

## 4 · Domain decisions

1. **Reproduce-before-deliver is absolute**: the dispatch body IS the
   reproduced canonical payload; the export content IS reproduced payloads
   serialized. A forged or drifted document can neither leave the platform
   nor enter an archive — `document_not_reproducible` is terminal and names
   the offender.
2. **Terminal means terminal, still**: cancellation and exhaustion are
   `DispatchFailed` codes; retry is always a NEW aggregate; failed originals
   are history, never state.
3. **Manual completion never masquerades as provider truth** — the
   `manual:{commandId}` ref keeps attestation and provider evidence
   distinguishable forever (the IP-5 attestation doctrine).
4. **The daily export is bookkeeping under a derived occasion key** (one
   register per org per day, `dailyKey`-idempotent, crash-resumable);
   nothing is exported for an org with nothing to archive.
5. **`tally-xml`/`journal-csv` serialize the DOCUMENT register** (the CTO's
   "exports serialize frozen document payloads only" narrowed the ratified
   journal-posting serialization — settlement's journal stays untouched and
   unexported until a future authorization says otherwise).
6. **Unknown provider responses are crashes, not guesses**: anything outside
   the typed port contract dead-letters for a human; only typed outcomes
   move aggregates.

## 5 · Remaining risks

1. **Inherited pre-deploy items unchanged** (withTenant wiring; writer-role
   restriction on `finops_events`; provider/S3 credentials now join Razorpay
   in the pre-deploy configuration list).
2. **Async-channel callbacks are exercised via the fake adapter's HMAC-style
   verification**; a real BSP's signature scheme lands with its adapter
   (drop-in, but its verifier deserves its own hostile tests then).
3. **The outbox/artifact filesystem stores are single-node**; the S3-compatible
   adapter (MinIO is already in docker-compose) is the named production path —
   port-conformant, not yet written.
4. **Pipeline scans are O(orgs) per tick** (same posture as the follower);
   per-org sharding is the landed seam if scale demands it.
5. **`retryOf` linkage for dispatch retries is not recorded in the event**
   (the frozen request payload has no such field; export retries DO carry it
   in params). Traceable today via subject+recipient; an explicit link would
   need a catalog-payload note at freeze reconciliation.
6. **Program hygiene, repeated**: three approved milestones plus this one
   remain uncommitted; freeze gates still reference file discipline instead
   of tags. Recommend the per-milestone commit cadence again, more firmly.

## 6 · Founder demonstration

1. `pnpm verify` — all static gates; 73 unit tests.
2. `pnpm --filter @desiauction/web test:integration` — watch the delivery
   story attack itself: a real settled night becomes documents; an in-app
   dispatch confirms with the reproduced bytes as its body; the email outbox
   file carries the exact canonical payload and its digest; a flaky provider
   is retried at asserted backoff instants with audited attempts and exactly
   one successful send; a replayed callback returns its original ack; a late
   contradictory callback bounces and is audited; a never-recovering provider
   ends in a terminal event; SDK garbage dead-letters, an unauthorized
   requeue is refused, an authorized one recovers delivery; a forged document
   is never delivered and poisons no archive; a tampered artifact is exposed
   by digest, proven by regeneration, healed from sources; deleted rows
   rebuild byte-identical — and the meters show settlement and documents
   bit-identical throughout.
3. `node apps/finops-runner/dist/index.mjs` — the same binary now carries the
   whole delivery layer: schedules, scans, sends, exports, retries.

## 7 · Recommended Founder decision

**APPROVE M-IP6-3.** The platform now DELIVERS immutable financial artifacts —
over ports that fail closed, with retries that are deterministic, outcomes
that are events, archives that prove themselves, and dead letters that
operators (and only operators) can revive — while settlement and documents
remain bit-identically untouched, meter-verified. On approval, authorize
**M-IP6-4 — Operations & Fiscal Close** per the ratified roadmap, and please
ratify the per-milestone commit cadence (risk 6).

---

*Engineering stops at this artifact. No M-IP6-4 work has begun.*
