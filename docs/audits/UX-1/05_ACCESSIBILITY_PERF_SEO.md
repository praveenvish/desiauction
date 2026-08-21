# UX-1 — Accessibility, performance, SEO

## Accessibility

### axe: zero violations, and the harness was proved before it was believed

107 routes scanned at **390 px and 1440 px**, against `wcag2a`, `wcag2aa`,
`wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice`: **0 violations**.

A clean scan is the result a broken harness also produces, so the harness was
checked against a page with three deliberate failures
(`scripts/audit/axecheck.mjs`) and correctly returned eight violations including
`color-contrast`, `image-alt` and `button-name`. The zero is real.

### Structure — clean across all 109 records

| Check | Result |
| --- | --- |
| Exactly one `<h1>` per page | 109 / 109 |
| Heading levels never skip | 109 / 109 |
| Exactly one `<main>` | 109 / 109 |
| `lang` present | 109 / 109 (`en`) |
| `<img>` without `alt` | 0 |

### What axe does not cover, checked separately

**Contrast in the other theme.** The first sweep ran entirely in `daylight`,
because that is what a fresh browser gets. Re-running in `floodlight` is what
surfaced F-1: an anchor painting the user agent's `#0000EE` on the floodlit
console surface at **1.92:1**. Nothing had ever scanned the dark theme.

**Target size (SC 2.5.8).** `target-size` is not in the `wcag21aa` tag set, so
axe never reports it. Measured by hand: two real failures, both fixed.

**Non-text contrast (SC 1.4.11).** Icon glyphs on coloured chips were suspected
and **cleared** — measured at 4.27:1 against the daylight warning fill. The
suspicion came from arithmetic against the *floodlight* token value; the pixels
disagreed, and the pixels are right.

**Reduced motion.** 21 of 24 animated stylesheets carry a `prefers-reduced-motion`
block. Of the three that did not, two animate only `background` at
`--duration-fast`, which the product's own policy explicitly permits. The third
(F-14) is fixed.

**Announcements.** The product has a live-region `Announcer`, uses `role="alert"`
with `aria-live="assertive"` on field errors, `role="status"` on the paused-bidding
notice, and — subtly — animates toasts by **transform only, never opacity**,
because a fading toast really is unreadable for those frames.

### Keyboard operability — walked, not inferred

**79 routes, 2,559 tab stops**, driven with real key presses against the
production build.

| Check | Result |
| --- | --- |
| Focus order departs from DOM order | **0 routes** |
| Keyboard traps | **none** — every walk terminated by wrapping to its start |
| Routes whose first stop is "Skip to content" | **74 / 79** |
| Controls with no visible focus indicator | **0** — see below |

The five routes not opening on a skip link all explain themselves: `/login`
autofocuses the phone field by design, `/registrations` opens on its row cursor
(the page advertises `j`/`k` shortcuts), `/gallery` is dev-only, and the
projector **board** and OBS **overlay** have **zero focusable elements** — which
is correct for surfaces that are projected and composited, never operated.

Two caveats, stated rather than buried: `/admin/orgs/[slug]` has more than 80
tab stops, so the walk hit its cap and did not observe the wrap — that one route
is not *proven* trap-free. And **screen-reader narration was still not listened
to**; semantics were verified, how a reader speaks them was not.

#### Six focus-indicator flags, all withdrawn

The walk compared `outline` and `box-shadow` focused against blurred, and
flagged six controls. All six were false positives, and the reason is worth
recording: this product puts the focus ring on a **wrapper** via `:focus-within`
— a good pattern, and one that neither of those two properties describes on the
focused element itself.

Settled by pixels. Measured as the share of pixels that change when focus
arrives, against two controls known to be styled correctly as a control group:

| Control | Pixels changed | Verdict |
| --- | ---: | --- |
| Public search bar (`/search`, `/help`) | **17.1%** | strongest indicator in the sample |
| Tournaments search input | 6.7% | fine |
| *Control: login submit button* | 7.5% | — |
| *Control: console rail link* | 7.4% | — |

The "off-screen focus stop" flag was withdrawn the same way: `html` carries
`scroll-behavior: smooth`, so the walk was measuring mid-scroll. Re-measured
after the scroll settles, **0 of 22 stops** are off-screen.

---

## Performance

Measured from a real production build (`next build`), not from `next dev` — dev
timings are compile times and say nothing about what a person experiences.

### Bundle

| Metric | Value | Reading |
| --- | ---: | --- |
| First Load JS shared by all | **103 kB** | good |
| Heaviest route (`/auction/cockpit`) | **144 kB** | good |
| Live auction room | 142 kB | good |
| Registration desk (largest page bundle, 13 kB) | 138 kB | good |
| Landing page | 120 kB | good |
| Marketing / legal / help pages | 103–106 kB | essentially the shared baseline |

Nothing in the product exceeds 144 kB First Load JS. For comparison, Next's own
"needs attention" threshold is 170 kB, and operational dashboards of this
complexity routinely ship two to three times this. There is no bundle problem to
solve.

Contributing decisions already made: fonts are self-hosted via `@fontsource`
(no render-blocking hop to a third-party CDN), the marketing and legal surfaces
are static content from a typed registry rather than a CMS client, and the two
shared chunks total 100 kB of the 103.

### Core Web Vitals — measured

Against the production build at 390 px, throttled to fast 4G and a CPU 4× slower
than this machine — roughly the mid-range Android an owner holds in a hall. INP
is read from the browser's own `event` timing entries after real Playwright
input, not from a synthetic event.

| Metric | Worst route | Threshold | Verdict |
| --- | ---: | ---: | --- |
| **LCP** | 768 ms | 2,500 ms | **good on all 19 routes** |
| **INP** | 104 ms | 200 ms | **good on all 19 routes** |
| **CLS** | 0.112 | 0.100 | **18 of 19 good — none Poor** |

Nothing in the product is close to the LCP or INP thresholds.

CLS was the finding — **F-19** — and it started with six routes failing and two
of them Poor:

| Route | Before | After |
| --- | ---: | ---: |
| `/home` | 0.154 | **0.000** |
| `/tournaments` | 0.123 | **0.000** |
| `/org/*/money` | 0.127 | **0.004** |
| `/admin/audit` | 0.128 | **0.006** |
| `/seasons/*/auction/board` | **0.751** | **0.025** |
| `/seasons/*/auction/spectate` | 0.240 | **0.080** |
| `/seasons/*/auction/live` | 0.565 | **0.112** |

Two different repairs. The four console routes were fixed by moving the page's
primary action into the server render via a Next parallel route. The three live
surfaces were fixed by rendering their real franchises, purses and progress from
first paint with em dashes where the figures go, by giving the auction stage one
height across all six of its phases, and by stopping the status ribbon changing
height when the socket answers.

`/auction/live` remains 0.012 over the "good" line. The residual is a chain of
small snapshot-derived growers — the paddle list, the squad list, the feed
diagnostics — and three further interventions were attempted and **all three
reverted for measurably making it worse**, including one that looked obviously
right. Recorded in F-19; the work stopped at the point where it had become
tuning rather than understanding.

**One measurement was thrown away.** A middle run reported every route green,
worst CLS 0.033 — which was wrong. The server had failed to restart
(`EADDRINUSE`, silently, in a backgrounded command) and was still serving a
build directory whose assets had since been deleted, so the pages rendered with
no CSS at all and had no layout left to shift. It was caught by screenshotting
what was being measured. The numbers above come from a verified-fresh server
whose stylesheet returns 200, and they reproduce the first run almost exactly.

---

## SEO and social

### Titles and description

Every public route has a distinct, human title in a consistent `Page ·
DesiAuction` shape, and every one carries a meta description. Canonicals are
present on the indexable routes and correctly absent from `/search` and `/login`.

`robots.ts` allows the public surface and disallows every console prefix, token
path, `/dev/`, `/gallery` and `/search`.

### Share cards — the gap that was closed

The share-card platform was already built and good: `next/og` renderers for a
competition, a player, pricing and the spectate page, over visibility-gated read
models.

What was missing was a **floor**. `opengraph-image` is inherited down the route
tree, and with none at the root, **27 of 30 public routes emitted no `og:image`
at all** — including the landing page, the single most-forwarded link the product
has, and every help and legal page an organizer sends to a nervous team owner.
In a market whose distribution channel is WhatsApp, that is a grey line of text
next to everything else in the thread.

Fixed (F-8): a root `opengraph-image.tsx` and `twitter-image.tsx` reusing the
`renderShareFallback` card that already existed for this look and was reachable
only as an error path, plus `metadataBase` and inherited `openGraph` defaults on
the root layout.

One route needed its own file: `/c` builds metadata in `generateMetadata`, and a
segment returning its own `openGraph` object does not pick up an *ancestor's*
file convention. That was found by measurement, not by reasoning — after the root
card shipped, 29 of 30 public routes emitted an image and this was the one that
did not.

Verified: the root route returns a real 1200×630 PNG with correct glyphs (no
tofu), `/help` inherits it, `/c` has its own, and `/c/[slug]` still wins with the
richer per-competition card. **30 of 30.**

### Redirect chain

`/competitions` → `/seasons` → `/tournaments?view=seasons` was two permanent
hops, because `/seasons` had itself become a redirect. The bare path now points
at its destination (F-16); the `:path*` rule still targets `/seasons/:path*`,
which are real pages.
