# 57 — Performance Budgets

> Canon: C-17, C-24 · v1.0 · 2026-07-11

## Reference device & network (the honest baseline)

Budgets are measured on a **₹12k Android (mid-2022 class) over throttled 4G (1.6Mbps, 150ms RTT)** — the spectator's and player's reality (C-24) — and a mid-range laptop on hall Wi-Fi for Console/Cockpit. Lab numbers on M-series MacBooks are not evidence (69).

## Page budgets (p75 RUM, CI-gated by Lighthouse on the reference profile)

| Surface | LCP | INP | CLS | JS (gz) |
|---------|-----|-----|-----|---------|
| **Stage** (spectator phone) | < 1.8s | < 200ms | < 0.05 | < 150KB |
| **Owner Room** | < 2.0s | < 150ms (bid tap!) | < 0.05 | < 200KB |
| Registration form | < 1.8s | < 200ms | < 0.05 | < 130KB |
| Results (public) | < 1.5s | < 200ms | < 0.05 | < 100KB |
| Console | < 2.5s | < 200ms | < 0.1 | < 300KB (route-split) |
| Cockpit | < 2.5s | < 100ms (conduct keys) | < 0.05 | < 250KB |

INP on Owner Room's bid control and Cockpit's gavel is the product's most important frontend number — a laggy bid tap is money anxiety (04 beat 2/3).

## Live-path budgets (engine, pair with 56 SLOs)

Bid validate+append < 20ms p99 server-side; snapshot build < 150ms for a 400-lot auction; fan-out to 5,000 concurrent Stage clients < 500ms p95; engine restart→recovered (replay + re-arm timers) < 10s for the largest realistic auction (61).

## Capacity targets (V1, load-tested per 58)

5,000 concurrent public viewers per auction; 32 concurrent bidding owners; 10 concurrent live auctions per region cell; 200 registrations/minute burst. Beyond these: documented scaling levers (54 CDN offload, engine cells), not promises.

## Enforcement

- **CI gates (59):** bundle-size limits per app entry (fails the build), Lighthouse CI on the four public surfaces against the reference profile, size-limit report on every PR touching `apps/*`.
  - **Lighthouse as it actually runs (SEO-1 Phase 3, 2026-09-30).** Until then this line described a gate that did not exist. `apps/web/lighthouserc.json` now runs in the CI e2e job on `/`, `/pricing`, `/c` and `/help/getting-started`, with Lighthouse's default mobile emulation (slow 4G, 4× CPU).
    - The **SEO category is enforced** (score 100).
    - **Performance is reported, not gated**: LCP ≤ 2.5s, CLS ≤ 0.05 and TBT ≤ 300ms are warnings.
    - First baseline (local, simulated): LCP **3.6–3.9s** on all four pages. CLS ≤ 0.004, TBT ≤ 16ms, accessibility and best practices 100.
    - LCP is over budget, which is SEO-1 Phase 8's work. The warning becomes an error once CI has a stable baseline, then it ratchets down.
  - **Phase 8 finding (2026-10-01):** that lab LCP is Lighthouse's *simulation* (Lantern). In the unthrottled trace, the largest paint **is** the first paint on all four pages (72–231 ms observed). The simulation counts every request made before LCP, including all JavaScript. Inlining the CSS (`experimental.inlineCss`) was measured and rejected: FCP improved about 150ms, LCP didn't move, and every page would carry 50–70 KB more HTML.
  - **Field measurement exists now.** One page load in ten reports LCP, INP, CLS, FCP and TTFB (`components/web-vitals-reporter.tsx`, via `sendBeacon`) to `/api/vitals`, which writes a `web_vitals` log line. The line has no user, session or query string, and long path segments are redacted. **The p75 budgets above are judged on those lines.** An `/admin/health` panel over them is a follow-up (it needs somewhere to aggregate beyond logs).
- **RUM guards:** p75 regressions > 10% week-over-week open an automatic defect (56).
- Budget changes are PRs against this file with justification — budgets are ratcheted (down) after wins, never quietly raised.

## Standing tactics (so budgets survive feature growth)

Server components / minimal client JS on public surfaces; route-level code splitting everywhere; zero third-party scripts on live surfaces (analytics via our collector, 51); media: player photos pre-sized variants + lazy (53); fonts: three families subsetted, preloaded, swap (09); animations compositor-only (11).
