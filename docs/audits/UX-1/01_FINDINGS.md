# UX-1 — Findings

Ordered by severity. Every entry names the file and line, the measurement that
found it, and the measurement that confirmed it. Items the audit *considered and
cleared* are at the end, because a finding withdrawn is as useful as one kept.

---

## P1 — fix before beta

### F-1 · The auction hub renders an entire panel unstyled

`apps/web/src/app/seasons/[slug]/auction/page.tsx:10` imports `../../seasons.css`
and nothing else. Its eight sibling routes — `live`, `cockpit`, `spectate`,
`board`, `overlay`, `ledger`, `engine`, `replay` — each import `../auction.css`.
This one does not, and it renders `<BroadcastLinks>`, whose entire visual
definition lives in `auction.css`.

Three separate probes found three symptoms that are all this one cause:

| Symptom | Measured | Rule that never loaded |
| --- | --- | --- |
| "Open board" paints browser-default `#0000EE` — **1.92:1** on the floodlit surface | `pixels.mjs` | `.share-auction-button { color: var(--text-primary) }` (`auction.css:1843`) |
| Same link is **19 px** tall, not the specified 44 | `sweep.mjs` @390 | `min-height: 44px` (`auction.css:1838`) |
| Page **scrolls sideways at 320 px** (334 px document) | `sweep.mjs` @320 | `.broadcast-url { overflow-wrap: anywhere }` (`auction.css:2108`) |

"Copy link" beside it is a bare `<button>` with user-agent chrome, 71×21.

It survived because the panel is behind `viewer.canConduct` — only a conductor
ever sees it — and because nothing in the suite asserts a computed style.

**Fix:** import `../auction.css` in `auction/page.tsx`.

---

### F-2 · A bid that fails to reach the server never comes back

`live/live-panel.tsx:71-85` and `cockpit/cockpit-panel.tsx:85-104`:

```
setPending(key);
const ack = await submitAuctionCommand(...);   // ← no try/catch
setPending(null);
```

`submitAuctionCommand` is a server action. The engine call inside it is fully
defended — `engine-client.ts` has a 2-second `AbortSignal.timeout` and returns
`engine_unreachable` rather than throwing. But the **round trip to the server
action itself** is not: if that request rejects — a phone losing signal in a
hall, a server restart, a proxy error — the promise rejects, `setPending(null)`
never runs, and:

- the RAISE button stays `disabled` for the rest of the session,
- no toast is shown,
- nothing tells the bidder whether their money moved.

`.paddle-raise:disabled` is `opacity: 0.55` (`auction.css:847`) and nothing else,
so the visible result is a permanently dimmed button and silence — on the one
screen where §16 of the brief demands the user *always* know whether the bid
succeeded. The same pattern governs the gavel, pause, undo and complete.

**Fix:** wrap the await; restore `pending` in a `finally`; toast the failure.

---

### F-3 · The two most likely failures have no human sentence

`auction-copy.ts` is exhaustive over `BidRejectionCode` — a new code fails the
build — and its `COMMAND_REFUSAL_COPY` covers 21 lifecycle, paddle and gateway
reasons in plain English. It does **not** cover the two reasons the transport
itself produces:

- `engine_unreachable` (`engine-client.ts:50`)
- `engine_http_<status>` (`engine-client.ts:40`)

Both fall through to `"That didn't go through. Try again."` — the generic
message §34 warns against, and *actively wrong advice*: when the engine is down,
trying again fails identically.

**Fix:** name both, and say what to do instead.

---

### F-4 · `/admin/messaging` is not in the navigation model

Linked from the admin overview (`admin/overview-panel.tsx:148`), shipped, real —
and absent from `ADMIN_TABS` (`nav.ts:223`). Three consequences, all visible in
the 390 px screenshot:

1. `activeAdminTab` (`nav.ts:231`) has no branch for it, so it falls through to
   `return "overview"` — **the tab strip highlights the wrong tab.**
2. `pageIdentity` (`nav.ts:462`) resolves `section` from the same missing tab, so
   `title` falls back to `"Platform admin"` — under a breadcrumb that also reads
   **"Platform admin"**.
3. There is no tab to click to reach the page.

While here: the comment at `nav.ts:220` still asserts "the rail is five, forever"
— a claim the long comment at `nav.ts:78` explicitly retracts, above a four-item
array.

---

## P2 — fix before general availability

### F-5 · Hydration mismatch on the replay viewer

`replay/replay-panel.tsx:73` renders `fold {frame.foldMs.toFixed(1)} ms`, where
`foldMs` comes from `performance.now()` inside a `useMemo` that runs on both
server and client. The two numbers differ, so React discards and re-renders the
subtree on every load. Confirmed: the sweep captured the React hydration error on
this route and no other.

The component already tracks a `hydrated` flag (line 52) for exactly this class
of problem; the timing readout simply is not gated by it.

### F-6 · Toast dismiss is a 19×20 target

`toast.module.css:46` — `padding: 0 var(--space-1)` gives no vertical padding, so
the control is glyph-sized. Below the 24×24 floor of WCAG 2.2 SC 2.5.8 (AA), and
it is the control that clears a toast sitting over the bid area on a phone.

axe does not check this: `target-size` is not in the `wcag21aa` tag set. The
codebase already knows — `finance.css:222` documents the same rule for the
document links it fixed by hand.

### F-7 · Unbreakable tokens overflow the page at 320 px

Independent of F-1: `.admin-attention-subject` (a 26-character ULID plus a
reason) and `.admin-meta` (`MSG91_TEMPLATE_REGISTRATION_WAITLISTED`) have no
wrapping rule, taking `/admin`, `/admin/health` and `/admin/messaging` to
337–348 px against a 320 px viewport.

### F-8 · Nothing shares with an image

27 of the 30 public routes — **including the landing page** — carry no
`og:image`, and most carry no `og:title`. The platform exists and is good:
`opengraph-image.tsx` renders real cards for `/pricing`, `/c/[slug]`,
`/c/[slug]/p/[number]` and the spectate page. There is simply no root default, so
every other link pastes into WhatsApp — this market's distribution channel — as
bare text.

### F-9 · The rail tagline is 8 px at 4.35:1

`app-shell.module.css:395-406`. Two methods agree it fails AA for normal text
(hand arithmetic 4.40:1, painted pixels 4.35:1), and 8 px is below any legibility
floor regardless of ratio. It is decorative — "Bid · Build · Win" — which argues
for `aria-hidden` and a larger, dimmer treatment, not for leaving it.

### F-10 · "All seasons" names the wrong noun

`c/[slug]/page.tsx:134` labels a link to `/c`. That destination is
`<h1>Tournaments</h1>`, titled "Tournaments · DesiAuction", and called "Browse
tournaments" and "All tournaments" by the public header and footer. One of four
labels for one destination uses the *other* domain noun the product deliberately
distinguishes.

### F-11 · The readiness verdict contradicts a gate beside it

`readiness/page.tsx:44` shows a green **"Ready for auction"** whenever
`blockers === 0`, while the row immediately below reads **"Short — 2 players
cannot fill 4 squads of at least 2 (3 needed)"**.

The exclusion is deliberate and well-reasoned (`readiness/page.tsx:75-77`: a
league may knowingly run short). The *presentation* reconciles nothing, on the
one screen whose entire job is to answer "can I start?".

### F-12 · The public competition page's common state has no way forward

`c/[slug]/page.tsx:113-135`. The hero's CTA row holds "Watch the auction live"
when live and "Register as a player" when open. When it is neither — closed
registration, or any finished competition whose link people still forward — the
only control left is a ghost "All seasons" that **navigates away from the page**.
The squads and results are right there below the fold; nothing points at them.

### F-19 · Layout shift — no route is Poor any more

Found by closing the performance gap, so it is not in the original eighteen.

| Route | Before | After | Band now |
| --- | ---: | ---: | --- |
| `/home` | 0.154 | **0.000** | good |
| `/tournaments` | 0.123 | **0.000** | good |
| `/org/*/money` | 0.127 | **0.004** | good |
| `/admin/audit` | 0.128 | **0.006** | good |
| `/seasons/*/auction/board` | 0.751 | **0.025** | good |
| `/seasons/*/auction/spectate` | 0.240 | **0.080** | good |
| `/seasons/*/auction/live` | 0.565 | **0.112** | needs improvement |

Attributed with `LayoutShift.sources`, which names the nodes that moved, and
split into before-interaction and after-interaction. Every one is a **load**
shift; none is caused by scrolling or clicking.

#### The console half — fixed, by getting the action into the server render

`PageAction` published the page's primary button through a React context from a
`useEffect`. Effects do not run on the server, so the first paint had no action
and hydration inserted one. Under 720 px `.page-action { flex-basis: 100% }`
gave it a row of its own; between 720 and 999 px the squeeze-band rule is gated
on `:has(.page-action)`, so the *entire two-row layout* was conditional on the
same late-arriving node. Measured with JavaScript disabled versus hydrated:
**header 65 px → 167 px at 768 px, 65 px → 171 px at 390 px.**

**Two stylesheet fixes were tried first and both were backed out.** Letting the
action share row two with the utility icons reached CLS 0.000 — by squeezing
`.identity` to zero and taking the page's name off the screen on every console
surface. Adding an explicit row break preserved the title and held CLS near
zero, but cost ~56 px of permanently taller sticky header on every console page,
including the many with no action, and made 320 px worse. Neither is a defect
fix; both are product decisions about vertical space.

The fix is the one the framework provides for a page contributing to an ancestor
layout: **a parallel route**. `app/@action/` resolves alongside the page and is
handed to the root layout, so the button is in the server's HTML.

| File | Role |
| --- | --- |
| `app/@action/default.tsx` | Renders nothing — the answer for the ~76 routes with no action |
| `app/@action/{home,orgs,tournaments}/page.tsx` | The three actions, each with the gate its page used |
| `app/layout.tsx` | Accepts the `action` slot and passes it to the shell |
| `product-shell.tsx` | `publishedAction ?? serverAction` — the context channel becomes an override |

Cost: **none.** `/home`'s slot reads `competitionsView()`, already deduped per
request with React `cache` and already called by the shell. `/tournaments` needs
the *creatable* org set — membership is not permission — so that capability read
was extracted into a `cache`d `capabilitiesOnce()` that `tournamentsView()` now
shares, leaving the query count per request unchanged. Shared JS is still 103 kB.

Verified: `scripts/audit/ssr-action.mjs` loads each route **with JavaScript
disabled** and asserts the button is rendered on the three that should have it
and nowhere else; `scripts/audit/header-check.mjs` measures the bar's height
server-rendered versus hydrated at six widths and reports **Δ0 at every one**,
with the page title still 242–291 px wide.

Two traps worth recording, both found the hard way:

- **A route slot is always a node.** `default.tsx` renders nothing, but the slot
  value is not `null`, so the shell cannot tell "no action" from "an action that
  drew nothing" — and the wrapper it rendered was an empty flex item that still
  cost a `gap` step on every actionless console page. `.page-action:empty {
  display: none }` is exact: `:empty` matches only when there are no child nodes.
- **The first build after adding a slot fails its own type check.** Next
  generates `LayoutProps` from the app directory, and the typecheck runs against
  the *previous* build's types. It resolved only after a stale `.next-e2e/types/
  routes.d.ts` — which tsconfig also includes, and which still declared
  `"/": never` — was removed. Three build directories each emit a global
  `routes.d.ts`; a stale one silently poisons the typecheck.

#### The live half — no route is Poor any more

| Route | Before | After | Band |
| --- | ---: | ---: | --- |
| `/auction/board` | 0.751 | **0.025** | good |
| `/auction/spectate` | 0.240 | **0.080** | good |
| `/auction/live` | 0.565 | **0.112** | needs improvement |

None of these shifts had anything to do with the action. Each surface renders a
placeholder and replaces it when the websocket snapshot lands ~400 ms after first
paint. What made them tractable is that **the row universe is a server prop**:
`teamIdentities` / `view.teams` reach the page before the socket does, so only
the FIGURES ever had to wait.

**The repair is not a shimmer.** A skeleton reserves the space and says nothing;
rendering the real rows with an em dash where each figure will go reserves the
same space **and** tells a filling hall which franchises are playing.

| Reserved | Was | Now |
| --- | --- | --- |
| Board standings — real team cards while connecting | 0 cards → 4 | 4 from first paint |
| Board progress counter | absent → present | present, `—/—` |
| `PurseBoard` (live, cockpit, spectate) | **0 px → 289 px** | 289 px from first paint |
| `AuctionProgress` (live, cockpit, spectate) | absent → present | present, `— / — lots` |
| Squad purse lines | absent → 4 lines (~75 px) | present, `—` |
| **The stage** — one height across every phase | 326 → 366 → 406 px | **420 px** (460 below 400 px) |
| **The status ribbon** — chrome that stopped changing height | 20 → 52 px on a phone | **52 px** throughout |

Two of those deserve their reasoning stated.

**The stage.** `CeremonyStage` swaps DOM subtrees as the night moves — connecting,
waiting, a lot on the block, SOLD, unsold, complete — and each phase carries a
different number of lines, so it resized at every transition. Not only on load:
**it resized on every sale, all night.** Measured per phase and per width
(`scripts/audit/stage-heights.mjs`): connecting 326, complete 326–354, sold 366
(406 where the name wraps). The tallest phase is a lot under the hammer, which is
SOLD plus one meta line and one gap — computed at 396/436 rather than observed,
because reaching it means opening a lot and mutating the demo auction. 420 px
clears every phase with headroom; 460 px clears the two-line name a narrow screen
forces. **Nothing is lost by the extra space: the phases that gain it are exactly
the phases with no bid control on screen**, so the button a bidder reaches for is
never pushed down by this.

**One semantic distinction** mattered more than the metric. `purseRemaining ===
null` already means *the engine sealed this team's money from this viewer*.
Before the socket answers nothing has been sealed — it is simply not known — so
the connecting state prints an em dash and never "sealed". Printing the wrong one
would be a false statement about what the product does with a rival's money.

**What is left, and why it was left.** `/auction/live` sits at 0.112, just over
the 0.100 line, and the remaining movement is a chain of small growers — the
paddle list, the squad list, the conduct panel, the feed diagnostics — each of
which is genuinely snapshot-derived. Three further interventions were attempted
and **all three were reverted for measurably making it worse**, including one
that looked obviously right (reserving the shell's status slot: 0.113 → 0.149).
At that point the honest reading is that the remaining movement is being tuned
against rather than understood, and the work stopped.

Three wrong turns on the way here, all corrected by measuring:

- The residual was assumed to be the conductor-only paddle and conduct panels.
  Measured per role, a **bidder scored 0.496 — worse than the conductor's
  0.449**, with no conduct panel on screen. Backwards.
- An element-height diff reported a status ribbon "collapsing" 2,432 px. It was
  matching elements by document position, so one index named different nodes once
  the DOM changed. Stamping identity once cut 232 spurious "changes" to one real.
- The stage height first rendered 466 px where the comment promised 400: this
  stylesheet has no global `box-sizing` reset, so 64 px of padding landed on top
  of the number. Stated explicitly in the rule now.

---

## P3 — polish

- **F-13 · Off-palette colour.** `home.css:52-55` (`#a25cf0`/`#7b45df`,
  `#2bc0b4`/`#149a8f`) and `org-detail.css:263` (`#b48cff`) are the only colours
  in the product with no token, no second theme value and no semantic meaning —
  every sibling chip in the same rule block resolves from tokens. *They pass
  contrast* (measured 5.43:1); this is token discipline, not accessibility.
- **F-14 · One animation outside the motion policy.** `board.css:123`
  `transition: width 0.6s` — hardcoded, longer than `--duration-slow`, and in one
  of only three animated stylesheets with no `prefers-reduced-motion` block,
  against a policy `motion.css:1-5` states explicitly.
- **F-15 · A wasted row in the mobile console header.** At 390 px, when a page
  supplies a shell action, the header stacks into identity / full-width CTA / a
  third row holding only three right-aligned icons. Measurement showed this was
  the same defect as F-19; **the shift is fixed**, but the third row itself is a
  layout choice that remains. It no longer costs anything measurable.
- **F-16 · Chained permanent redirect.** `/competitions` → 308 → `/seasons` →
  307 → `/tournaments?view=seasons`. `next.config.mjs:57` can point the bare path
  at its final destination; the `:path*` rule must stay as it is.
- **F-17 · Search rows say their type twice.** `search/page.tsx:84-86` renders
  `result.hint` ("Help article") and `result.section` ("HELP") on the same row,
  with no excerpt to tell two results apart.
- **F-18 · `/money` is reachable from nothing.** It is a real page — the only
  surface where someone who paid can see their own receipts — and no navigation
  reaches it. This is *documented as deliberate* for the beta (`help.ts:132` tells
  readers to bookmark it), so it is recorded as a product decision to revisit,
  not as a bug.

---

## Considered and cleared

Listed because withdrawing a finding is part of the work.

| Suspected | Verdict |
| --- | --- |
| 16×16 and 20×20 checkboxes on `/fixtures` and `/account` | **Not a defect.** Each is wrapped in a `<label>` with `min-height: 24px` / `44px`; the effective target is the row. |
| White icon glyphs failing 1.4.11 on the chips | **Withdrawn.** Arithmetic against the *floodlight* `--warning-base` gave 2.26:1; the chips render in daylight, and painted pixels measure **4.27:1**. |
| `/about` and `/standings` timing out | **Harness, not product.** `next dev` hit its memory ceiling and restarted; reproduced in the server log. |
| Rival team purses leaking to bidders | **Already sealed**, server-side, via `viewer.canSeeAllPurses` (`live-panel.tsx:330-345`). |
| `Field` swallowing `required`, silent errors to AT | **Already fixed**, with the reasoning recorded in `field.tsx:140-175`. |
| Search capped at 12 results with no way to more | **Wrong.** "Show all 32 results" is present at `search/page.tsx:91`, below the fold. |
| 78 low-contrast elements from `contrast.mjs` | **Instrument error.** Gradient backdrops; see `00_METHOD.md`. |
