# PX-8 — FINANCIAL OPERATIONS WORKSPACE · IMPLEMENTATION REPORT

## DesiAuction NEXT · 2026-07-17 · Engineering · **Status:** COMPLETE (incl. issuance completion) — awaiting Founder ratification

PX-8 exposes the certified IP-6 Financial Operations platform through an
operations console. It introduces **zero accounting logic, zero reconciliation
rules and zero financial calculations**. Every figure on every screen is a
snapshot the platform already derives; every action is an existing writer. The
platform remains the financial authority.

---

## 1 · What was built

### Surfaces

| Route | Screen | Scope |
|-------|--------|-------|
| `/org/[slug]/money` | **Financial Operations dashboard** — health lamps (7 components), collections awaiting/issued, exceptions (the ranked attention queue with its resolving action), today's activity, documents register with saved views + search | §1 (PX-1 F1) |
| `/org/[slug]/money/deliveries` | **Delivery workspace** — the four lanes (Queued · Processing · Succeeded · Failed), retry status with attempts and backoff, dead-letter queue with requeue, cancel/confirm-by-hand | §2 |
| `/org/[slug]/money/reconciliation` | **Reconciliation workspace** — fresh certification (6 checks), ingest frontier, investigation queue, evidence register (every seal re-verified live), resolution history with forged-claim detection, posture | §3 |
| `/org/[slug]/money/documents/[docId]` | **Operations detail** — the transaction, its live reproduction verdict, the settlement reference it was made from, delivery history + retry, audit timeline | §4 (PX-1 F2) |
| `/org/[slug]/money` | **Issuance** (completion) — finance profile (declare/amend/auto-receipt), numbering series (open, next-number preview), receipt candidates → issue | CTO completion §1–§5 |
| `/org/[slug]` | **Finance authority** — issue/revoke finance roles | enabling |

### Server layer (thin by mandate)

- `server/financial-operations/actions.ts` — `"use server"` wrappers. Resolve
  session → resolve tenant → check a finops capability → call the platform.
  Commands map 1:1 onto existing writers: `retryDispatch`, `cancelDispatch`,
  `confirmDispatchManually`, `requeueDeadJob`, `runFollower`, `rewindFollower`,
  `issueFinopsGrant`, `revokeFinopsGrant`, and — completing PX-8 —
  `declareProfile`, `amendProfile`, `openSeries` (`finops.manage`),
  `issueReceipt`, `issueInvoice`, `issueCorrection` (`finops.document`).
  **`issueDueReceipts` is deliberately NOT exposed**: the follower already calls
  it, and the policy stays authoritative.
- `server/financial-operations/views.ts` — read composition over
  `operationsDashboardSnapshot`, `complianceQueueSnapshot`, `complianceSnapshot`,
  `certificationSnapshot` (+register), `evidenceRegisterSnapshot`,
  `dispatchSnapshot`, `documentSnapshot`, `issuanceSnapshot`, `retrySnapshot`,
  `followerHealthSnapshot`, `runnerHealthSnapshot`, `watermarkSnapshot`.
- `server/financial-operations/{deliveries,register}.ts` — pure filter/label
  contracts. `deps.ts` — the one configured `finopsDeps` (see decision 1).

### Navigation & search

Finance destinations in the palette (dashboard · deliveries · reconciliation),
keyworded for transactions, settlements, deliveries, payment references and
cases; section labels for every finance segment; org-page link gated by
`finops.view`.

---

## 2 · What was verified

Fresh, against live Postgres 17 and a real browser. Nothing cached.

| Gate | Result |
|------|--------|
| TypeScript | ✅ clean |
| Lint (`--max-warnings 0`) | ✅ clean |
| Prettier | ✅ clean |
| Dependency boundaries | ✅ no violations (702 modules, 2561 deps) |
| Unit | ✅ 6/6 packages |
| Integration | ✅ **383/383** web · **64/64** engine |
| Playwright | ✅ **3/3** PX-8 specs (incl. the fresh-org founder demo) · full-suite note below |
| Accessibility (axe) | ✅ zero violations on every new surface |
| Production build | ✅ all four PX-8 routes emitted |

**Integration note (honest).** A clean full run is green. The finops delivery
suite (`M-IP6-3 · Delivery`) still flakes intermittently under load — the
PX-4/PX-7 finding, shared dev-DB residue — and did so on two earlier runs in this
session; it passes 134/134 in isolation. Not PX-8's doing.

**Full-suite note (honest).** An 11.5-minute single-worker run of all 80 e2e
tests finished 71 passed / 4 flaky (green on retry) / 1 failed —
`organizer-workspace`'s founder demo, the same long multi-actor journey that
flaked in PX-7's run. Re-run with the PX-8 spec, the two specs went **6/6** (one
OTP-timing flake, green on retry). The run was also degraded by my own doing: I
executed the integration suite against the same database concurrently. This is
the shared dev-compiler/DB jitter the Playwright config documents, not a PX-8
regression.

### Permanent regression suite

**`financial-operations-experience.regression.test.ts` — 57 tests, live PG**, on
a REAL auction settled through the frozen IP-5 writer and receipted through the
certified IP-6 writer, with a scriptable hostile provider.

Its load-bearing property is the CTO's demand — **projections identical to
platform calculations**: the board's health `toEqual`s
`operationsDashboardSnapshot`'s, the queue `toEqual`s
`complianceQueueSnapshot`'s, the document `toEqual`s `documentSnapshot`'s, the
certification digest and checks `toEqual` `certificationSnapshot`'s.

Coverage: permissions (the third partition, six ways) · finance authority ·
ops board · delivery lifecycle Queued→Processing→Succeeded · provider failure ·
retry · dead letters · the dispatch→job join · operations detail · settlement
reference · audit timeline · reconciliation · search & saved views ·
client-bundle layering · operator copy vs the platform's own reason set.

**Issuance (completion) — 18 further tests.** Profile declaration · amendment ·
series creation · next-number derivation · receipt/invoice/correction issuance ·
**follower auto-issuance** · idempotency · register/dashboard/reconciliation
updates. Attacks: issue with no profile · declare twice · GSTIN without
registration · registration without GSTIN · amend with no reason · clerk
attempting `finops.manage` · **duplicate numbering** (structurally impossible —
one lane per kind+FY, forever) · invalid fiscal year · empty prefix · receipt the
same payment twice · receipt a payment settlement never captured.

**Attacks:** retry a delivery that has not failed · retry an unknown delivery ·
requeue as a clerk (no `finops.operate`) · requeue a live job · requeue an
unknown job · mint a grant without `grant.issue` · mint an unrecognised set ·
read another org's document · read another org's board.

---

## 3 · Engineering decisions

1. **One configured artifact root — and the defect that forced it.**
   `finopsDeps` defaults artifacts to `os.tmpdir()`. The seed passed
   `.local/finops-artifacts`; the runner and web took the default. **The runner
   GENERATES export artifacts and the web tier VERIFIES them**, so on any
   multi-process deployment (web and runner are separate Fly machines) they
   resolve different roots, `verifyExport` cannot find the bytes, and the ops
   board reports a permanent **false `exports: failed` → `overall: failed`**,
   with a `regenerateExportArtifact` action that can never clear it.
   Measured on the seeded org: `overall: failed`, certification **false**.
   With one root: `overall: healthy`, certification **true**, all 6 checks pass.
   Fixed by `FINOPS_STORAGE_DIR` (web + runner env, one default) and
   `server/financial-operations/deps.ts`. Configuration, not platform change —
   IP-6 §22 injects everything; production swaps in the S3 store.

2. **Finance grants ship with PX-8** (the PX-7 precedent). The frozen grants UI
   offers only frozen sets and the settlement panel only settlement sets, so
   without this panel the workspace is unreachable. Uses the sanctioned
   `issueFinopsGrant`/`revokeFinopsGrant` (gated by the frozen `grant.issue`),
   never the frozen `issueGrantAction`, which writes an unvalidated set with no
   finance audit. It is a SIBLING of the settlement panel, not a merge: two
   partitions, two writers, two acts of trust.

3. **The pure modules sit BELOW the server composition.** `deliveries.ts` is
   imported by a client panel; a *value* import from `views.ts` dragged
   `@desiauction/financial-operations/server` — and `node:fs`/`node:os` — into
   the browser bundle and failed the production build. Typecheck cannot see it.
   The lanes now live in the pure module and `views` imports them upward;
   a regression test scans the import statements to pin it.

4. **Gate first, then stream** (the PX-7 rule, applied). Every finance page
   resolves a cheap `financeGate` and `notFound()`s before rendering, then
   streams the expensive work (health derivation, double-derived certification,
   re-verifying every seal) under an in-page `<Suspense>`. No route-level
   `loading.tsx`: a boundary above the gate commits a 200 and destroys the 404.

5. **The attention queue's action is shown verbatim.** The platform names each
   item's resolving action (`retryDispatch`, `runFollower / rewindFollower`,
   `regenerateExportArtifact`…). The console renders that string rather than
   guessing a remedy — including for actions PX-8 does not surface (exports).

6. **"Collected" means what the platform means.** §1's outstanding/completed
   collections read `issuanceSnapshot`: captured payments *awaiting a receipt*
   vs *documents issued*. That is the finops pipeline's own view of collections;
   settlement's rupees are PX-7's desk, and are not re-totalled here.

7. **`rewindFollower` is total, and says so.** The platform takes no seq: it
   drops the org's cursors and re-consumes. The UI offers exactly that, gated on
   `finops.operate`, confirmed in a dialog, and immediately re-runs the follower
   so the operator is not left staring at zero. No precision is invented.

8. **Capability checks run inside the tenant boundary.** Self-review caught
   `runFollowerAction`/`rewindFollowerAction` checking `canFinops` against the
   ambient `dbHandle.db` rather than the request's `withTenantDb` connection;
   `command()` now hands the scoped `db` to every caller.

9. **Issuance exposes the entrance, and stops there (completion).** The
   certification found the whole lifecycle dammed behind exactly two
   `finops.manage` commands: `assembleIssue` refuses `profile_missing` without a
   profile, and the follower's auto-issue skips every candidate with
   `no_open_receipt_series` (`seriesForQuote` does not auto-open, despite §8.2's
   "or first-issue policy"). Opening those two gates lets the certified POLICY
   carry everything else. `issueDueReceipts` is therefore **not** an operator
   command — exposing it would have duplicated a policy the follower already
   runs. The manual `issueReceipt` remains for the case that cannot wait, and
   `issueInvoice`/`issueCorrection` because policy never does those by design.

10. **The viewer names capabilities, it does not infer them.** The first draft
    proxied `finops.manage` as "operate ∨ close" and `finops.document` as
    "dispatch". Both happen to hold for today's sets — and would break the moment
    the platform recomposes them. `viewerOf` now asks for all seven by name.

11. **Operator copy is checked against the platform's own source.** The error map
   had invented keys and missed real ones (`finops_unfoldable`,
   `document_not_reproducible`, `regeneration_digest_mismatch`…), which would
   have shown an operator a raw code at exactly the wrong moment. A regression
   test now reads the platform's writer/pipelines, extracts every `reason:` it
   can return, and fails if any lacks copy. The console's only asset is being
   readable; that is now enforced rather than intended.

---

## 4 · UX decisions

- **Health is a lamp, not a number.** Seven components, each with the platform's
  own status and detail, colour-coded on the left edge. `overall` is the
  platform's verdict, never a client-side roll-up.
- **The lanes are the channel's real lifecycle.** In-app confirms on send;
  WhatsApp rests in Processing until a provider callback. The console shows the
  truth rather than a uniform fiction.
- **A retry is a new delivery, and the toast says so.** A failed dispatch is
  terminal; the platform clones it. History is never rewritten by a later success.
- **Failure codes are shown raw** (`recipient_opted_out`), not euphemised — an
  operator needs the provider's word to act on it.
- **Confirm-by-hand is recorded as a human note**, never as provider truth, and
  demands what you saw. Cancel demands why.
- **Pending is not lost.** The ingest frontier is explained as "settlement has
  recorded it, finance has not consumed it yet" — the single most misread state
  in a follower architecture.
- **Nothing is a stored flag.** Every verdict says how it was derived — "re-read
  on every load", "re-derived twice from replay" — because a finance console's
  only asset is being believed.
- **The URL is the view**: lanes, saved views, filters and search are all links.
- **360px verified** with zero horizontal overflow on all three consoles.

---

## 5 · Remaining risks

| # | Risk | Severity | Note |
|---|------|----------|------|
| 1 | ~~No issuance surface~~ | **CLOSED** | Resolved by this completion. A fresh org now declares its profile, opens a series, and the follower issues receipts by itself — proven end-to-end in a browser with no seed. |
| 2 | **Exports are visible but not actionable.** | Medium | The exports health component and its `regenerateExportArtifact` action appear in the queue (they are existing projections, and §1 demands exceptions), but "no accounting exports" put the action out of scope. An operator can see an export problem and not fix it from the product. |
| 2b | **Fiscal close has no surface.** | Medium | `openPeriod`/`attestDay`/`noteException`/`closePeriod`/`reopenPeriod` (`finops.operate`/`close`/`override`) exist and are unreachable — the same shape of gap this certification closed for issuance. The board reads the period; nothing drives it. PX-1 §F1 lists them ("fiscal periods (open/attest/close)"); your PX-8 directive put GST/fiscal close out of scope. Flagged, not built. |
| 3 | **`FINOPS_STORAGE_DIR` is a local filesystem path.** | Medium | Correct for one host; web and runner on separate machines need the shared S3-compatible store (IP-6 pre-deploy). The env knob is the seam — decision 1 makes the misconfiguration impossible to hit silently *locally*, not in production. |
| 4 | **The older finance e2e still reads the demo seed.** | Low | `financial-operations.spec.ts` predates the issuance surface and reads `demo-club` (hence `pnpm seed:demo` in the nightly workflow). The NEW `financial-issuance.spec.ts` is fully self-provisioning. The old spec could now be rebuilt on a fresh org too; kept as-is because it covers the seeded exemplar's richer state (invoice, export, sealed FY). Seeded phones are fixed and OTP allows 5/hour, so it signs in once. |
| 5 | **The dashboard folds the whole org on load.** | Medium | Certification double-derives every stream and re-verifies every seal. Correct, and streamed behind a skeleton, but it is O(history). Fine at beta scale; needs a cadence or a cached certification before large orgs. |
| 6 | **My own suite's teardown corrupted the demo org once.** | Fixed | `delete(finopsPeriodDays)` without a `where` wiped every org's attested days. Caught because **the ops board reported the resulting projection divergence** — the console detected real corruption I introduced. Scoped to `orgId` like every sibling suite. |

---

## 6 · Founder demonstration

**A fresh organization. No demo seed. No SQL. No engineering assistance.**
`pnpm dev`, sign in as a brand-new person:

1. **Fresh org** — create it; you are its owner.
2. **Grant yourself the two authorities** — Settlement controller and Finance
   controller. (Owning the org gives you neither: three partitions, three acts
   of trust.)
3. **No finance profile** — Finance opens on *"Nothing can be issued yet."*
   There is no series card and no candidates card: the lifecycle is shut.
4. **Declare the profile** — legal name, tax posture, auto-receipt on. → **v1**.
5. **Open the receipt series** — the platform shows the next number it will
   issue: `RCT/2026-27/000001`. Nothing on screen generated it.
6. **Conduct an auction** — teams, players, approve, close registration, create,
   paddles, queue, open, complete.
7. **Complete settlement** — open case, verify, compute obligations.
8. **Capture a payment** — record ₹50,000, then **attest** it. Collected rises.
9. **Finance names it** — "Awaiting a receipt: 1", against the team's name.
10. **The follower issues the receipt ITSELF** — no issue button is pressed. Run
    ingest (what the runner does on a tick, offered to a human on
    Reconciliation).
11. **The receipt appears in the register** — Awaiting 0, Issued 1, and the lane
    advances to `000002`. Dense, no gap.
12. **It reproduces** — open it: re-renders to its sealed digest, carries the
    settlement watermark it was made from, and its timeline shows the issue.
13. **Financial Operations is healthy** — every component green; Reconciliation
    says **matched**.

Automated as `e2e/financial-issuance.spec.ts` ("founder demo"), green — 29.7s,
axe-clean at every step. The seeded journey (`financial-operations.spec.ts`,
richer state: invoice, export, sealed FY) stays green alongside it.

---

## 7 · Final recommendation

**RATIFY PX-8.**

The certification you ordered found the gap precisely, and this completion closes
it: the entire financial lifecycle was dammed behind two `finops.manage`
commands. They are now reachable, and the certified **policy** — not a screen —
carries everything downstream. A brand-new organization can declare who it is,
open a numbering lane, run an auction, settle it, and watch the platform issue,
number, dispatch and prove its own receipt, without a seed, a script, or an
engineer.

Nothing was redesigned. No backend changed. No writer was added. No rule was
invented. The console reads 14 certified snapshots and calls 14 existing writers;
`issueDueReceipts` stayed unexposed so the policy remains authoritative, and the
regression suite asserts that what the screens show is byte-identical to what the
platform derived.

Two gaps of the same shape remain, both named and neither built: exports have no
operator action (risk 2) and fiscal close has no surface at all (risk 2b) —
`openPeriod`/`attestDay`/`closePeriod` are certified, capability-gated and
unreachable, exactly as issuance was. PX-1 §F1 assigns them to this workspace;
your PX-8 directive placed them out of scope. They are the natural subject of the
next authorization, and I have not touched them.

Engineering stops here and returns for final PX-8 certification. **PX-9 is not
begun.**
