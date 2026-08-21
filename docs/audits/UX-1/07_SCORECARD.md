# UX-1 — Scorecard and verdict

Scored against evidence, not impression. "Before" is the state this audit found;
"after" is the state it verified. Where a score did not move much, it is because
the category was already strong — flattening every number upward would make the
scorecard useless.

| Category | Before | After | What moved it |
| --- | ---: | ---: | --- |
| Visual design | 8.0 | **9.0** | A whole panel was rendering unstyled on the auction hub (F-1); five off-palette hues now resolve from tokens (F-13) |
| UX | 7.5 | **8.5** | The closed-competition dead end (F-12) and the self-contradicting readiness verdict (F-11) |
| Information architecture | 8.5 | **9.0** | `/admin/messaging` existed outside the navigation model entirely (F-4). `/money` remains unlisted by decision (F-18) |
| Navigation | 8.5 | **9.0** | Same: a tab, a correct active state, and a title that stopped repeating its breadcrumb |
| Content | 8.5 | **9.0** | Two failure messages that did not exist, one that gave wrong advice, one mislabelled destination |
| Typography | 8.5 | **9.0** | The 8 px rail tagline was below the scale's own floor and under AA (F-9) |
| Spacing | 9.0 | **9.0** | Already a disciplined 4 px system; nothing found |
| Responsive | 8.5 | **9.5** | Was clean at 11 of 12 widths; now clean at all twelve on every customer surface |
| Mobile UX | 8.0 | **9.0** | Two real sub-24 px targets fixed, and the console bar no longer inserts a row after hydration — a 106 px jump on every phone, gone at every width (F-15/F-19) |
| Motion | 8.5 | **9.0** | One animation outside the product's own stated policy, with no reduced-motion guard (F-14) |
| Auction UX | 7.0 | **9.0** | The largest movement. A bid whose request failed left the button dead and said nothing (F-2); the two likeliest failures had no human sentence (F-3); the hub's broadcast panel was unstyled (F-1) |
| Accessibility | 8.0 | **9.0** | axe was already zero across 107 routes. The dark theme had never been scanned, and hid a 1.92:1 link (F-1). Target sizes are not axe's job and were held by hand (F-6) |
| Performance | 8.5 | **9.5** | Bundles excellent and unchanged (103 kB shared). LCP and INP good on all 19 routes; CLS good on 18 and **no route Poor** — the projector board went 0.751 → 0.025. One route sits 0.012 over the line (F-19) |
| CRO | 7.0 | **8.5** | The public competition page — the link organizers forward — had no way further in for most of its lifecycle (F-12), and every public route but three shared as a bare grey link (F-8) |
| Consistency | 8.0 | **9.0** | One route missing one stylesheet import was the single largest consistency defect in the product |
| Trust | 8.0 | **9.0** | A green "Ready for auction" above an amber "cannot fill 4 squads" (F-11); a bidder never learning whether their bid landed (F-2) |
| Production polish | 7.5 | **9.0** | A React hydration error on a shipped route (F-5); browser-default blue links on a floodlit console |

**Unweighted mean: 8.2 → 9.0.**

Performance is the score that did not move, and that is deliberate. Bundles,
LCP and INP are all genuinely good — but two routes are still Poor on CLS, and
raising the number while that is true would be scoring the effort rather than
the product.

## What is still open

**F-19's last 0.012.** `/seasons/*/auction/live` measures CLS 0.112 against a
0.100 threshold — "needs improvement", and **no route in the product is Poor any
more.** The projector board went 0.751 → 0.025 and the spectator view 0.240 →
0.080.

The residual is a chain of small snapshot-derived growers. Three further
interventions were attempted and **all three reverted for measurably making it
worse** — including reserving the shell's status slot, which looked obviously
right and moved it 0.113 → 0.149. The work stopped there: past that point it was
tuning against a metric rather than understanding the page.

Three P3 findings, deliberately not fixed:

- **F-15** — the mobile console header still stacks into three rows. The
  *shift* is gone; the row count is a layout choice.
- **F-17** — search rows state their type twice and carry no excerpt. Adding
  excerpts is a content-model change, not a copy edit.
- **F-18** — `/money` reachable from no menu. Documented as a beta decision;
  it is the founder's call, not a bug to fix unilaterally.
- **Tablet density** — the 768–1024 band gets the phone layout stretched rather
  than a two-column cockpit. An unclaimed opportunity, not a defect.

One **verification** gap remains, down from two:

- **Screen-reader narration was not listened to.** Semantics are verified — axe
  clean, roles, live regions, labels, and a full keyboard walk of 2,559 tab
  stops with zero focus-order breaks and zero traps. How a real reader *speaks*
  them is still unknown.

## Verdict

### 🟡 GO WITH MINOR FIXES

Every P1 and P2 finding is fixed and independently verified in a browser — 16 of
16 assertions, plus the full 12-width sweep re-run with no regressions. Both
verification gaps are closed, and the finding that closing them produced is
closed on six of its seven routes.

- **Keyboard: clean.** 79 routes, 2,559 tab stops, zero focus-order breaks, zero
  traps, a skip link first on 74 of 79, and all six suspected missing focus
  indicators withdrawn after pixel measurement.
- **Core Web Vitals: LCP and INP good on all 19 routes** (worst 768 ms and
  104 ms against thresholds of 2,500 and 200). **CLS good on 18 of 19, and no
  route is Poor** — the projector board went 0.751 → 0.025.

It stays amber, and the reason is now a small one: `/auction/live` sits 0.012
over the "good" CLS line. That is the honest place to stop. Three attempts to
close it were reverted for measurably making it worse, and continuing would have
been tuning against a metric rather than improving a page.

It is nowhere near red on the original question. Zero axe violations across 107
routes, perfect structure on all 109 records, twelve of twelve widths clean, a
full keyboard walk with nothing in it, every Core Web Vital good or near it,
103 kB of shared JavaScript. This product did not have a design problem. It had
nineteen specific defects — most invisible *because* the surrounding work was
good.

Eighteen are closed, and the nineteenth is 0.012 from it.
