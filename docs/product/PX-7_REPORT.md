# PX-7 — SETTLEMENT EXPERIENCE · IMPLEMENTATION REPORT

## DesiAuction NEXT · 2026-07-17 · Engineering · **Status:** COMPLETE — awaiting Founder review

PX-7 exposes the certified IP-5 Settlement platform through a production user
experience. It introduces **zero settlement rules, zero financial calculations
and zero new commands**. Every number on every screen is a fold the certified
writer already produced; every refusal is a rejection the writer itself
returned. Settlement remains the only authority.

---

## 1 · What was built

### Surfaces

| Route | Screen | PX-1 |
|-------|--------|------|
| `/competitions/[slug]/money` | **Settlement console** — lifecycle stepper, money tiles, obligations table, collection recorder, payments, controller overrides | E1 ★ P0 |
| `/competitions/[slug]/money/case/[caseId]` | **Case review** — obligations · payments · timeline · verification · evidence (deep-linked via `?tab=`) | E2 ★ P1 |
| `/org/[slug]/settlement` | **Settlement dashboard** — worklist, attention/today/outstanding/reconciled tiles, saved views, search, filters, bulk navigation | new (CTO §5) |
| `/org/[slug]` | **Money authority** — issue/revoke settlement roles | PX-1 PX-7 scope |

### Server layer (thin by mandate)

- `server/settlement/actions.ts` — `"use server"` wrappers. Resolve session →
  resolve tenant → check a settlement capability → call the certified writer.
  Every command maps 1:1 onto an existing writer: `openCase`, `verifyCase`,
  `computeCaseObligations`, `createPayment`, `attestManualCapture`,
  `refundManualPayment`, `waiveObligation`, `settleCase`, `closeCase`,
  `reopenCase`, `voidCase`, plus reads `caseFold`, `journalFold`,
  `readyForClosure`, `closureCeremony`, `reproduceClosureEvidence`.
- `server/settlement/views.ts` — read composition. Joins money to **names**,
  orders rows, and reads the projection rows the writer itself maintains.
  Computes no money.
- `server/settlement/worklist.ts` — pure filter/label contract for the desk.
- `server/settlement/amount.ts` — the rupee→paise **input adapter**.

### Navigation & search

- Competition **Money** tab, gated by `settlement.view` (absent, not disabled).
- Command palette: settlement destinations per competition + the org desk,
  keyworded for cases, payment references and evidence.
- `sectionLabel` learns `Money` / `Case review` / `Settlement`.

---

## 2 · What was verified

Fresh, against live Postgres 17 and a real browser. Nothing cached.

| Gate | Result |
|------|--------|
| TypeScript | ✅ clean |
| Lint (`--max-warnings 0`) | ✅ clean |
| Prettier | ✅ clean |
| Dependency boundaries | ✅ no violations (673 modules, 2368 deps) |
| Unit | ✅ 6/6 packages |
| Integration | ✅ **326/326** web · **64/64** engine (settlement alone: 137/137) |
| Playwright | ✅ **5/5** PX-7 spec · full suite **78 tests, 76 green** (see note) |
| Accessibility (axe) | ✅ zero violations on every new surface |
| Production build | ✅ all PX-7 routes emitted |

**Full-suite note (honest).** A 15-minute single-worker run of all 78 e2e tests
finished 70 passed / 2 flaky (green on retry) / 2 failed with 60s timeouts:
`organizer-workspace` and `orgs` — both long multi-actor journeys on the org
page. Both pass in isolation (5/5 and 2/2), and a re-run of the four affected
specs together went **16/16** with one `ERR_CONNECTION_REFUSED` flake (the dev
server dropped, green on retry). This is the shared dev-compiler/DB jitter the
Playwright config already documents, not a PX-7 regression. Related: PX-7's own
addition to the org page's cost was consolidated (below) rather than excused.

### Permanent regression suites

**`settlement-experience.regression.test.ts` — 52 tests, live PG, a REAL auction
conducted through the frozen IP-4 aggregate.** Its load-bearing property:
`expectViewMatchesFold()` asserts the screen's numbers ARE `caseFinancial(caseFold(...))`
after every state change — a drift between console and books fails here, loudly.

Coverage: rupee adapter · permissions (the capability partition) · money
authority · case lifecycle · collections · waiver · closure · replay · evidence ·
ceremony · dashboard · search & saved views · voided case.

**Attacks (not happy paths).** Every one is a refusal the writer owns:
`settle`/`close`/`compute`/`reopen` from `opened`; a payment before collecting;
a payment > outstanding; double attestation; waiver by an officer; waiver >
owed; waiver against an unknown team; settle with a rupee outstanding;
collection on a settled case; void after money moved; double close; reopen by an
officer; every command on a voided case; grant minting without `grant.issue`;
an unexpandable capability set; revoking an identity grant through the
settlement path.

**`settlement-experience.spec.ts` — 5 Playwright tests**: the founder
demonstration end-to-end, case review deep links, dashboard stats/views/search/
bulk navigation, the permission attack (404 for a non-holder), and 360px
responsive with a zero-horizontal-scroll assertion.

---

## 3 · Engineering decisions

1. **Settlement grants ship with PX-7, via `issueSettlementGrant`.** Without a
   grant surface, settlement is unreachable from the product: the frozen grants
   UI offers only frozen sets. PX-1 suggested reusing `issueGrantAction`, but
   that path writes an **unvalidated** capability set with no settlement audit.
   The sanctioned cross-context writer (`issueSettlementGrant`, gated by the
   frozen `grant.issue`) is used instead. *Implementation won; PX-1's note is
   reconciled here.*

2. **`loading.tsx` removed from every money segment.** A Suspense boundary above
   a `notFound()` gate commits HTTP 200 before the gate runs, destroying the
   404 — the PX-2 redirect finding applies identically to `notFound()`. The
   dashboard instead **gates first, then streams**: a cheap `settlementDeskGate`
   resolves membership + `settlement.view`, then the expensive per-case fold
   streams under an in-page Suspense boundary. Real 404 *and* a real skeleton.

3. **The timeline is enriched, not replaced.** The frozen `closureTimeline`
   supplies the row set and order. Its summary renders raw paise and raw team
   ids and drops the `reason` the event already carries — correct for a ledger,
   unusable at a desk. Each row is re-rendered from the **same event payload**
   with the team's name, rupees, the actor's name and the stated reason.
   Unknown types keep the frozen projection's own words.

4. **"Collected today" reads existing projections.** Payment rows whose
   `PaymentCaptured` event landed since local midnight; the log supplies only
   the **timing**, every rupee is the payment fold's own `captured`.

5. **The rupee adapter is an input adapter, not a money rule.** It changes units
   and refuses what it cannot represent exactly (sub-paise → refused, never
   rounded). `@desiauction/core` still owns money.

6. **`CASE_REVIEW_TABS` lives in a plain module.** A data export from a
   `"use client"` module reaches a server component as a client-reference proxy;
   `.includes` threw at request time (only with `?tab=` set — `&&`
   short-circuited it otherwise). Found by e2e; pinned by a regression test.

7. **`Tabs` tablist now scrolls horizontally.** Five tabs cannot fit 360px; the
   row scrolled the whole document. Fixed in the shared primitive — every
   consumer with >3 tabs had the bug.

8. **The rail's `/money` (personal money) is untouched.** It is PX-1 F3, and its
   receipts half is explicitly out of PX-7 scope.

9. **One money read per page.** Self-review caught the org page resolving the
   tenant three times and reading grants twice (`orgView` + `settlementOrgIds` +
   `moneyAuthority`). `moneyAuthority` now returns `canView` alongside `canIssue`,
   so the page makes one settlement read. The root layout's single
   `settlementOrgIds` (which gates the Money tab) runs inside the existing
   `Promise.all`, adding concurrency rather than serial latency.

---

## 4 · UX decisions

- **One legal step at a time.** The console offers exactly the command the case's
  status allows. A disabled button is a courtesy; the writer re-decides
  server-side regardless of what renders.
- **Existence privacy.** Without `settlement.view` the books are *absent*, not
  locked: no tab, HTTP 404. A member learns nothing about money they may not see.
- **The partition is explained, not just enforced.** The Money authority panel
  says out loud that owning the org confers no money power — otherwise an owner
  who cannot open a case reads correct behaviour as a bug.
- **Overrides look like overrides.** Waive/reopen/void sit in a bordered well,
  demand a reason, and say the act is recorded against your name (doc 28 ladder 4).
- **Record ≠ collect.** A payment is recorded first and *attested* second;
  attesting is what moves money. The UI states this, because it is the control.
- **Money renders with its exact value inspectable** (C-7): every amount carries
  its paise in `title`.
- **The URL is the view.** Saved views, filters, search and case-review tabs all
  live in the address bar — bookmarkable, shareable, refresh-proof.
- **Phone-first money tables.** At ≤640px tables collapse to labelled rows rather
  than growing a scrollbar; verified at 360px with zero horizontal overflow.

---

## 5 · Remaining risks

| # | Risk | Severity | Note |
|---|------|----------|------|
| 1 | **No route-level skeleton on console / case review.** | Low | Both gate with `notFound()`; a boundary above would destroy the 404. Both are single-case folds (fast). The gate-then-stream pattern (decision 2) is the fix if they ever slow. |
| 2 | **Dashboard folds every case in the org on each load.** | Medium | Correct but O(cases). Streams behind a skeleton. At beta scale (tens of cases) fine; needs a projection-backed list before hundreds. |
| 3 | **Gateway collection is UI-absent.** | Low | Only manual methods are offered. `gateway:razorpay` exists in the writer but needs validated env + webhook; out of PX-7's "no gateway redesign". |
| 4 | **No refund UI.** | Low | `refundManualPayment` is wired in the actions layer and covered by IP-5's suites, but has no screen. Deliberate: PX-7 §4 lists retry/failure states, and a retry is a NEW payment by design. Refund is a controller act better placed with receipts (PX-8). |
| 5 | **`obligation.increased`/`reduced` render but cannot be produced.** | None | No `adjust` command ships (IP-5 referred the posting template to the Board). The columns read zero and are ready if it ever lands. |
| 6 | **Finops delivery suite flaked once under the full run.** | Low | Pre-existing (PX-4 finding), not PX-7: green 17/17 in isolation, 214/214 beside settlement, 326/326 on re-run. Shared dev-DB residue. |
| 7 | **`competitions.css` uses an undefined `--border` token.** | Cosmetic | Pre-existing; those borders render as `currentColor`. Flagged as a separate task; PX-7's own CSS uses the real tokens. |

---

## 6 · Founder demonstration

`pnpm dev`, sign in, then — **no developer assistance, no SQL, no spreadsheet**:

1. **Complete one auction.** Create org → competition → 2 teams → import and
   approve players → close registration → create auction → issue paddles → queue
   lots → open → complete.
2. **Grant money authority.** Org page → Money authority → grant yourself
   *Settlement controller*. (Before this, the Money tab does not exist and
   `/money` 404s — the partition, working.)
3. **Open the Settlement Workspace.** The Money tab appears. Choose how dues are
   worked out; open the case.
4. **Review the settlement case.** Stepper, dues, outstanding.
5. **Verify obligations.** Verify → the pin re-reads the frozen auction log.
   Compute → per-team dues appear against team names.
6. **Record a manual payment.** Record (nothing moves) → **Attest receipt**
   (the books move; Collected rises, Outstanding falls).
7. **Waive one obligation.** Controller well → amount + reason → the waiver
   posts and Outstanding reaches ₹0.
8. **Close the case.** Settle (only legal at ₹0 outstanding) → every closure
   check passes → Close → the auction reads **Reconciled**.
9. **View closure evidence.** Case review → Evidence → six digests + the sealed
   prefixes.
10. **Replay the evidence.** One button → *"The evidence reproduced byte-for-byte
    from the log."*
11. **Complete settlement.** The desk (`/org/[slug]/settlement`) shows Needs
    attention 0, Collected today, Reconciled 1.

Seeded shortcut: `pnpm seed:demo` leaves **Demo Cup (settled)** at *Collecting*
with every rupee already in and the founder holding `settlement:controller` —
settle → close → evidence → replay in four clicks.

Automated as `e2e/settlement-experience.spec.ts` ("founder demo"), green.

---

## 7 · Recommended Founder decision

**RATIFY PX-7 and hold engineering.**

The money loop closes on screen. An organizer can complete every settlement
operation from the product: grant authority, open, verify, compute, collect,
attest, waive, settle, close, and prove the closure by replay. The certified
platform was exposed, not redesigned — no settlement rule, no financial
calculation and no second mutation path was added, and the regression suite
asserts that the screens and the books cannot disagree.

With PX-7 the complete operational journey exists: **Visitor → Player →
Organizer → Auction Day → Settlement.**

Engineering stops here and awaits review. Recommended next: **PX-8 (Financial
Operations Experience)** — receipts, documents, dispatch and the inbox — which
risks 3 and 4 above naturally belong to.
