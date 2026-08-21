# UX-1 — Product experience audit and remediation

**2026-08-21 · `feat/ui-redesign` · 79 routes · 12 widths · 2 themes**

---

## Executive summary

### What the brief asked for

A first-principles redesign, on the stated premise that the interface was
roughly **2/10** and that nothing — navigation, page names, hierarchy,
components, typography, colour, motion — should be assumed correct.

### What was actually there

That premise did not survive contact with the repository, and the evidence is
worth stating before anything else:

- **Zero axe violations** across 107 routes, scanned at 390 px and 1440 px
  against six WCAG tag sets. The harness was proved against a deliberately
  broken page before the zero was believed.
- **Perfect document structure** on all 109 records: exactly one `<h1>`, no
  heading-level skips, exactly one `<main>`, `lang` everywhere, no image
  without `alt`.
- **Eleven of twelve target widths clean** — no horizontal overflow anywhere in
  the product except at 320 px, on six routes.
- **A real design system**: a DTCG token pipeline through `style-dictionary`,
  59 primitives and 56 semantic tokens per theme, generated files committed and
  CI-checked for drift, exercised on a live reference page.
- **103 kB of shared JavaScript**, with the heaviest route in the entire product
  at 144 kB First Load JS.
- A navigation model that is pure data, unit-tested, and documents its own
  reasoning — including the corrections it has been through.

Tearing that down and rebuilding it would have replaced working design with
different design. The scope was re-agreed with the founder as **audit first,
then fix what the audit finds**.

### What the audit found

**Nineteen findings — three P1, ten P2, six P3 — and thirteen suspicions
withdrawn** after measurement contradicted them. Eighteen are fixed.

The findings cluster, and the pattern is the interesting part. This is not a
product with a design problem; it is a product with **blind spots in its
verification**, and every serious defect was sitting in one:

| Blind spot | What was hiding in it |
| --- | --- |
| Nothing had ever scanned the **dark theme** | A link painting the browser's default `#0000EE` at **1.92:1** on the floodlit console |
| Nothing asserts a **computed style** | An entire stylesheet never imported on one route, leaving a whole panel unstyled — blue link, 19 px target, and the 320 px page overflow, all one missing line |
| axe does not check **target size** | A 19×20 dismiss button on the toast that covers the bid area on a phone |
| Nothing tests a **rejected request** | A bid whose request failed left the button dead for the rest of the session and said nothing |
| A route was added and **not registered** in the nav model | `/admin/messaging`: no tab, the *wrong* tab highlighted, and a title repeating its own breadcrumb |
| `opengraph-image` is **inherited**, so nobody noticed there was no root | 27 of 30 public routes — including the landing page — shared as bare grey text |

### What changed

Fourteen findings fixed. Measured, not asserted:

| | Before | After |
| --- | --- | --- |
| Routes overflowing at 320 px | 6 | **1** (dev-only `/gallery`, deliberately left) |
| axe violations, 107 routes × 2 widths | 0 | **0** |
| React page errors | 1 | **0** |
| Public routes with a share card | 3 / 30 | **30 / 30** |
| Regressions introduced | — | **none** |

Plus **16 of 16** targeted fix assertions passing, and the whole workspace green:
lint, typecheck, format, dependency-cruiser, **622 unit tests**.

The single highest-value change is one line — `import "./auction.css"` — which
closed three separately-reported symptoms at once.

The one that matters most in the room is `try/catch/finally` around the auction
command path, so that a bidder on a patchy connection gets their button back and
an honest sentence — the answer is missing, check the feed — instead of tapping a
dimmed rectangle forever.

### Then both verification gaps were closed

The first pass ended amber because two of the brief's twelve categories had been
measured by proxy rather than directly. Both were then done properly, and they
came back differently:

- **Keyboard: clean.** 79 routes, **2,559 tab stops**, driven with real key
  presses. Zero focus-order breaks, zero traps, a skip link first on 74 of 79.
  Six suspected missing focus indicators — **all withdrawn** once measured in
  pixels; the ring lives on a wrapper via `:focus-within`, which the detector
  could not see.
- **Core Web Vitals: LCP and INP good on all 19 routes** (worst 768 ms and
  104 ms, against thresholds of 2,500 and 200). **CLS failed on six** — that is
  **F-19** — and **no route is Poor any more.** The four console routes were
  fixed by moving the page's primary action into the server render via a Next
  parallel route; the three live auction surfaces by rendering their real
  franchises from first paint, giving the auction stage one height across all six
  of its phases, and stopping the status ribbon changing height. The projector
  board went **0.751 → 0.025**, the spectator view 0.240 → 0.080, and the live
  room 0.565 → 0.112.

One measurement was thrown away along the way: a run that reported every route
green turned out to be measuring pages with no CSS, because a backgrounded
server restart had failed silently and the build directory it was serving had
been deleted. Caught by screenshotting what was being measured.

### Verdict

## 🟡 GO WITH MINOR FIXES

Amber for a small margin: `/auction/live` measures CLS **0.112** against a 0.100
threshold. Everything else in the product is good. Three further attempts to
close that gap were **reverted for measurably making it worse** — including one
that looked obviously right — and the work stopped there rather than tune against
a metric it no longer understood.

Eighteen of nineteen findings are closed, and the nineteenth is 0.012 away.

Nowhere near red. Full reasoning in [`07_SCORECARD.md`](07_SCORECARD.md).

---

## The documents

| File | Contents |
| --- | --- |
| [`00_METHOD.md`](00_METHOD.md) | The five probes, what each can and cannot see, **and the one that was wrong** |
| [`01_FINDINGS.md`](01_FINDINGS.md) | All 18 findings with file and line, plus the seven withdrawn |
| [`02_INVENTORY.md`](02_INVENTORY.md) | 79 routes, the navigation model, roles, and the renaming pass |
| [`03_DESIGN_SYSTEM.md`](03_DESIGN_SYSTEM.md) | Tokens, type, spacing, components, motion — as built |
| [`04_RESPONSIVE.md`](04_RESPONSIVE.md) | All twelve widths, before and after |
| [`05_ACCESSIBILITY_PERF_SEO.md`](05_ACCESSIBILITY_PERF_SEO.md) | axe, the gaps axe leaves, bundles, share cards |
| [`06_CONTENT.md`](06_CONTENT.md) | Every string changed, and the vocabulary deliberately kept |
| [`07_SCORECARD.md`](07_SCORECARD.md) | 17 categories before/after, what is still open, the verdict |
| [`08_REMEDIATION.md`](08_REMEDIATION.md) | Every change, the two corrections self-review caught, and the proof |

## Reproducing it

The probes are committed under `apps/web/scripts/audit/`. With the stack up
(`docker compose up -d`, engine on :4000, web on :3100) and the demo seed loaded:

```bash
node scripts/audit/login.mjs && node scripts/audit/sweep.mjs
```

`verify-fixes.mjs` is the regression gate for this remediation — one assertion
per finding, measured the same way the finding was.
