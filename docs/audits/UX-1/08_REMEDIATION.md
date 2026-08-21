# UX-1 — Remediation and proof

Eighteen findings fixed, and the nineteenth reduced from Poor to 0.012 over the line. No migration, no schema change, no dependency added,
and shared JavaScript unchanged at 103 kB.

Two remediations, done in sequence: the first pass closed fourteen findings; the
second closed the console half of **F-19**, which only came to light once the
performance gap was measured.

## What was changed

| # | File | Change |
| --- | --- | --- |
| F-1 | `seasons/[slug]/auction/page.tsx` | `import "./auction.css"` — the one line its eight siblings all had |
| F-2 | `auction/live/live-panel.tsx`, `auction/cockpit/cockpit-panel.tsx` | `try`/`catch`/`finally` around all four command paths |
| F-3 | `packages/core/src/auction-copy.ts` | Sentences for `engine_unreachable` and `engine_http_*` |
| F-4 | `components/shell/nav.ts` | Messaging added to `ADMIN_TABS`, `activeAdminTab` and `SECTION_LABELS`; the stale "rail is five, forever" comment corrected |
| F-5 | `auction/replay/replay-panel.tsx` | Fold timing gated behind the existing `hydrated` flag |
| F-6 | `packages/ui/.../toast.module.css` | Dismiss control given a 24×24 box; glyph unmoved |
| F-7 | `app/admin/admin.css` | `overflow-wrap: anywhere` on the two classes that render machine identifiers |
| F-8 | `app/opengraph-image.tsx`, `app/twitter-image.tsx`, `app/c/(directory)/opengraph-image.tsx`, `app/layout.tsx` | A default share card, `metadataBase`, inherited `openGraph` defaults |
| F-9 | `packages/ui/.../app-shell.{module.css,tsx}` | Rail tagline 8→10 px, 45%→62%, and `aria-hidden` |
| F-10 | `c/[slug]/page.tsx` | "All seasons" → "All tournaments" |
| F-11 | `seasons/[slug]/readiness/page.tsx` | Verdict carries the caveat it was hiding |
| F-12 | `c/[slug]/page.tsx` | A "See the squads" action for the closed state |
| F-13 | `home/home.css`, `org/[slug]/org-detail.css` | Five hardcoded hues → tokens |
| F-14 | `auction/board/board.css` | Tokenised duration + a reduced-motion block |
| F-16 | `next.config.mjs` | `/competitions` points at its final destination |
| — | `components/shell/nav.test.ts` | A guard so F-4 cannot recur |
| — | `e2e/organizer-workspace.spec.ts` | Asserts the corrected readiness verdict |

## Two corrections made during self-review

Both on the money path, and both worth recording because the first draft was
plausible and wrong.

**The failure copy over-claimed.** The catch blocks first said *"That didn't
reach the auction"*, and a code comment justified it: "a rejected request never
reached the engine, so nothing was recorded". **That is false.** A rejected
promise means the *answer* did not come back — the server action can reach the
engine and have the reply lost on the way home, in which case the bid **is**
standing. Telling a bidder their bid failed there invites them to bid against
themselves. The messages now state only what is known ("Lost the connection
before the auction answered") and send the reader to the bid feed, which is
server truth.

The same error was in the F-3 copy — "Nothing was recorded" — where
`engine_unreachable` also covers the 2-second timeout. Corrected the same way.

**The first guard test was tautological.** It looped over `ADMIN_TABS` asserting
each entry lit itself, which passes trivially: a route missing from the array is
also missing from the loop. It was run against the re-introduced bug and **did
not catch it**. The defect was never an inconsistency *inside* the model; it was
the model disagreeing with the app directory. The guard now reads
`src/app/admin/` from disk and was re-checked against the re-introduced bug,
which it fails on all three symptoms with the route named.

## F-19 — the second remediation

Found only after the performance gap was closed, and fixed separately.

| File | Change |
| --- | --- |
| `app/@action/default.tsx` | New — renders nothing; the answer for every route with no action |
| `app/@action/{home,orgs,tournaments}/page.tsx` | New — the three actions, each keeping the gate its page used |
| `app/layout.tsx` | Accepts the `action` slot, passes it to the shell |
| `components/shell/product-shell.tsx` | `publishedAction ?? serverAction`; the context channel becomes an override |
| `components/shell/page-action.tsx` | Doc rewritten — it is no longer how the first action arrives |
| `server/competition/tournament-actions.ts` | `capabilitiesOnce()` extracted and `cache`d; `creatableOrgs()` exported |
| `packages/ui/.../app-shell.module.css` | `.page-action:empty { display: none }` |
| `app/home/page.tsx`, `app/orgs/page.tsx` | The superseded `<PageAction>` blocks removed |

**Zero added cost.** `/home`'s slot reads `competitionsView()`, already deduped
per request and already called by the shell. `/tournaments` needed the creatable
org set, so that capability read was extracted into a `cache`d function that
`tournamentsView()` now shares — same query count, one fewer duplicated concept.
Shared JS is still 103 kB.

### Three things that went wrong on the way

- **Two stylesheet fixes were tried before the right one, and both backed out.**
  The first reached CLS 0.000 by squeezing the identity block to zero and taking
  the page title off the screen on mobile. The metric looked right; the screen
  did not.
- **A route slot is always a node.** `default.tsx` renders nothing, but the slot
  value is not `null`, so the shell rendered an empty wrapper — and an empty flex
  item still costs a `gap` step on every actionless console page. Caught by a
  probe that measures whether the slot has *size*, not whether the element
  exists.
- **The first build after adding a slot fails its own type check**, because the
  typecheck runs against the previous build's generated types. It resolved only
  after a stale `.next-e2e/types/routes.d.ts` — which tsconfig also includes, and
  which still declared `"/": never` — was deleted. Three build directories each
  emit a global `routes.d.ts`; a stale one silently poisons the typecheck. Worth
  knowing before the next person spends an hour on it.

### Proof for F-19

| Check | Result |
| --- | --- |
| Action in the server's HTML, **JavaScript disabled** | present on `/home`, `/orgs`, `/tournaments`; absent on every other route |
| Bar height, server-rendered vs hydrated, six widths | **Δ0 at all six** (was Δ106 at 390 px, Δ102 at 768 px) |
| Page title still rendered | 242–291 px wide — the regression the first attempt caused |
| CLS, four console routes | 0.154 / 0.123 / 0.127 / 0.128 → **0.000 / 0.000 / 0.004 / 0.006** |
| All 79 routes still resolve | yes — the two apparent changes are auth redirects, confirmed by hand |

## F-19 — the live surfaces

| File | Change |
| --- | --- |
| `auction/board/board-panel.tsx` | Real franchises rendered while connecting; progress counter always present, `—/—` |
| `auction/purse-board.tsx` | Rows built from `teams` while connecting, figures as em dashes |
| `auction/live-experience.tsx` | `AuctionProgress` renders its own connecting state instead of `return null` |
| `auction/{live,cockpit,spectate}` | The `snapshot !== null` guards around it removed |
| `auction/squad-board.tsx` | The per-team purse LINE is unconditional; only the figure waits |
| `auction/auction.css` | **The stage gets one height** across all six phases (420 px, 460 px below 400 px), and the status ribbon stops changing height (52 px on a phone) |

**A skeleton was the obvious answer and the wrong one.** The row universe — which
franchises are playing — is a server prop on every one of these surfaces, so the
real cards can render from first paint with an em dash where each figure will go.
That reserves the same space a shimmer would *and* tells a filling hall who is
playing. Same pixels, more information.

**The stage number is measured, not chosen.** Per phase and per width
(`scripts/audit/stage-heights.mjs`): connecting 326, complete 326–354, sold 366
(406 where the name wraps). The tallest phase — a lot under the hammer — is SOLD
plus one meta line and one gap, computed at 396/436 rather than observed, because
reaching it means opening a lot and mutating the demo auction
(`scripts/audit/stage-parts.mjs`). Nothing is lost by the extra space: the phases
that gain it are exactly the phases with **no bid control on screen**.

One semantic distinction mattered more than the metric: `purseRemaining === null`
already means **the engine sealed this team's money from this viewer**. Before the
socket answers nothing has been sealed — it is not known yet — so the connecting
state prints an em dash, not "sealed".

| Route | Before | After |
| --- | ---: | ---: |
| `/auction/board` | **0.751** | **0.025** |
| `/auction/spectate` | 0.240 | **0.080** |
| `/auction/live` | 0.565 | **0.112** |

### Where it stopped, and why

`/auction/live` is 0.012 over the "good" line. **Three further interventions were
attempted and all three reverted for measurably making it worse** — the last of
them reserving the shell's status slot, which looked obviously right and moved it
0.113 → 0.149. At that point the remaining movement was being tuned against
rather than understood, so the work stopped and said so.

### Three wrong turns, all corrected by measuring

- The residual was assumed to be the conductor-only paddle and conduct panels.
  Measured per role, a **bidder scored 0.496 — worse than the conductor's
  0.449** — with no conduct panel on screen. Backwards.
- An element-height diff reported a status ribbon "collapsing" 2,432 px. It was
  matching elements by document position, so one index named different nodes once
  the DOM changed. Stamping identity once, in the first snapshot only, cut 232
  spurious "changes" to one real one.
- The stage first rendered 466 px where its comment promised 400: this stylesheet
  has no global `box-sizing` reset, so 64 px of padding landed on top of the
  number. `box-sizing: border-box` is now stated in the rule, with the reason.

## Proof

### Fix verification — 16 of 16

`scripts/audit/verify-fixes.mjs`: one assertion per finding, measured the same
way the finding was, in a real browser. All passing, including the three
distinct symptoms of F-1 and the three of F-4.

### Full regression sweep — 109 records, 12 widths, axe at two

| Measure | Before | After |
| --- | --- | --- |
| Routes with horizontal overflow @320 px | 6 | **1** — `/gallery`, dev-only, deliberately left |
| Routes overflowing at any other width | 0 | 0 |
| axe violations (107 routes × 2 widths, 6 tag sets) | 0 | **0** |
| React page errors | 1 (replay hydration) | **0** |
| Public routes emitting `og:image` | 3 / 30 | **30 / 30** |
| **Regressions introduced** | — | **none** |

The regression check compares every record pair on overflow at each of the twelve
widths, axe violation count, page errors and `h1` count. It found nothing.

Two routes (`/pricing`, `/seasons/*/fixtures`) failed to load during the after-
sweep when the dev server hit its documented memory ceiling and restarted. Both
were re-tested individually and return 200 and 307 respectively — harness
artifacts, not regressions.

### Workspace gate

`lint` · `typecheck` · `format:check` · `depcruise` (1,465 modules, 5,880
dependencies, no violations) · **622 unit tests passing** across eight packages,
including the 22 navigation tests with the new guard.

## Not done

- **F-19's last 0.012.** `/auction/live` at 0.112 against a 0.100 threshold.
  No route in the product is Poor any more. Three attempts to close the gap were
  reverted for making it worse; see above.
- **F-15, F-17, F-18** and tablet density — P3, listed open in
  `07_SCORECARD.md`. F-15's *measurable* cost is gone; its row count is a
  layout choice.
- **Screen-reader narration** — the one verification gap left, down from two.
- **The e2e suite was not re-run end to end.** One spec was updated for the
  corrected readiness verdict, and the parallel route was checked by walking all
  79 routes for status changes plus a JavaScript-disabled render test — but the
  80-spec suite itself was not executed.
