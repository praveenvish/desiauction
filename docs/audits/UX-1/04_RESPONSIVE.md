# UX-1 — Responsive audit

Every route was loaded and re-measured at all twelve target widths, signed-out
and signed-in — 109 records, 1,308 width measurements.

## Document overflow — does the page scroll sideways?

| Width | Before | After |
| ---: | --- | --- |
| 320 | **6 routes overflow** (5–28 px) | clean |
| 360 | clean | clean |
| 375 | clean | clean |
| 390 | clean | clean |
| 414 | clean | clean |
| 430 | clean | clean |
| 768 | clean | clean |
| 834 | clean | clean |
| 1024 | clean | clean |
| 1280 | clean | clean |
| 1440 | clean | clean |
| 1920 | clean | clean |

Eleven of twelve widths were already clean across the entire product — a better
starting result than most shipped applications return, and worth stating before
the exceptions.

### The six at 320 px, and what each was

| Route | Was | Cause |
| --- | ---: | --- |
| `/seasons/*/auction` (×2) | 334 px | F-1 — `auction.css` never loaded, so `.broadcast-url { overflow-wrap: anywhere }` was absent and a long board URL could not break |
| `/admin`, `/admin/health` | 337 px | F-7 — a 26-character ULID plus a reason string in `.admin-attention-subject`, no wrapping rule |
| `/admin/messaging` | 348 px | F-7 — `MSG91_TEMPLATE_REGISTRATION_WAITLISTED` in a `<code class="admin-meta">` |
| `/gallery` | 325 px | the theme toggle in the dev-only token reference — not a customer surface, left alone |

All five customer-facing cases now measure `doc=320 vw=320`.

## Layout behaviour, reviewed by eye

Screenshots at 390 / 768 / 1440 for every route were reviewed.

**Mobile (320–430).** The console collapses correctly: the rail becomes a
four-item bottom tab bar, contextual tabs become a horizontal scroller inside
their own strip (the strip scrolls — the page does not), stat grids go 2-up,
tables become cards or gain their own `overflow-x: auto` region with
`role="region"` and a label. The registration desk, finance console and case
review all stay usable one-handed.

One defect remains open: **F-15**, a wasted header row on `/home` when a page
supplies a shell action — identity, then a full-width CTA, then a third row
holding only three right-aligned icons.

**Tablet (768–1024).** No overflow and no broken layout, but this is the weakest
band — by judgement rather than by measurement. At 768 the auctioneer's cockpit
is a single column: the SOLD card takes ~380 px of height for four lines while
Conduct, Bid feed and Purses stack beneath it. A tablet propped beside a laptop
in the room wants density; it gets the phone layout stretched. Nothing is
broken. The opportunity is unclaimed, and it is recorded as such rather than
fixed, because a two-column cockpit is a design decision, not a repair.

**Desktop (1280–1920).** Containers are capped and centred; no line lengths run
away; consoles use the width for genuine columns rather than stretched tables.
At 1920 the marketing pages hold their measure.

## Touch targets

Measured at 390 px across every route: a median of 9 interactive elements below
the 44 px comfort target, and 156 measurements below the 24 px WCAG 2.2 AA floor.

**Most of those are not defects, and the audit says so rather than inflating the
count.** The great majority are breadcrumb and inline text links whose effective
target is the row or the sentence, plus checkbox inputs measuring 16×16 or 20×20
that are wrapped in a `<label>` carrying `min-height: 24px` or `44px` — the label
is the target, and it passes. That was checked in source, not assumed.

Two real defects came out of the 156, and both are fixed:

- the toast dismiss button at 19×20 → now 24×24 (F-6)
- "Open board" at 19 px tall because its stylesheet never loaded → now 62 px (F-1)
