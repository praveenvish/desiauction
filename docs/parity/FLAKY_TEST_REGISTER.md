# Flaky Test Register — E2E (charter v9)

> A flaky test is NOT green — it is release debt. Every entry records the failure
> pattern, root cause, mitigation, and status (Investigating | Stabilizing |
> Resolved). Source: full Playwright run #1 (2026-07-22, `next dev`, workers=1):
> **6 failed · 5 flaky · 7 did-not-run · 77 passed (19.5m)**.

## Root-cause finding (updated after run #2 + isolation probes)
Three distinct causes, separated by targeted isolation runs:

1. **Dev-server memory restarts (dominant).** The full 25-spec / ~20-min suite runs
   against one `next dev` server whose heap fills; Next restarts the worker
   mid-test (`⚠ approaching the used memory threshold, restarting…`),
   `ECONNRESET`-ing in-flight requests. Serial specs then **skip** siblings (the
   "did not run"). Run #2 with `--max-old-space-size=4096` STILL showed 10 restarts
   — but that run was **invalid**: `reuseExistingServer:true` reused a stale
   pre-fix server, so the heap bump never applied. The bump must be validated by a
   run started from a **clean** server (kill :3050 first).
2. **Degraded-server reuse.** `primitives.spec.ts` (pure UI, no DB) failed against
   the server left thrashed by a prior full run, then **passed 6/6 on a fresh
   server**. So `reuseExistingServer` reusing a degraded server is itself a cause.
3. **One genuine defect (now FIXED).** `foundation › page boots` failed even on a
   clean server — it was a **stale IP-0 scaffold test** asserting "DesiAuction
   NEXT" + `app-version`, content removed when `/` became the marketing landing
   (`28a11d8`). Rewritten to assert the real landing; now 2/2 green.

Net: the full-suite RED is ~environmental (causes 1+2), plus the single stale test
(3). No product-logic regressions were found — every other failed spec passes in
isolation on a fresh server.

## Register

| ID | Test | Pattern | Freq (run #1) | Root cause | Mitigation | Status |
|---|---|---|---|---|---|---|
| F-1 | `public-registration › organizer publishes` (my share-card assertions) | `page.goto(/opengraph-image)` → `net::ERR_ABORTED` | flaky | Navigating a browser page to a raw PNG aborts | Use `request.get`, not `goto` (`0f82f23`) | **Resolved** — 5/0 in isolation |
| F-2 | `public-registration › player journey` (R-E3) | `context.close()` teardown race in `inSecondBrowser` | flaky | Next HMR socket open at context teardown | `page.goto("about:blank")` before close (`0f82f23`) | **Resolved** — 5/0 in isolation |
| F-3 | `conduct-ceremony › owner workflow…` | 5-min run then fail, pass on retry | flaky | Dev-server memory restart under load | Heap ceiling raised (`0f82f23`) | **Stabilizing** — re-run pending |
| F-4 | `public-experience › every public page renders` | 3-min load then fail, pass on retry | flaky | Dev-server crawl/restart | Heap ceiling raised | **Stabilizing** |
| F-5 | `gallery › axe zero violations` | fail then pass on retry | flaky | Dev-server jitter | Heap ceiling raised | **Stabilizing** |
| F-6 | `organizer-workspace › founder demo … READY` | fail then pass on retry | flaky | Dev-server memory restart | Heap ceiling raised | **Stabilizing** |
| F-7 | `auction-experience › the full night` | failed (incl. retry) | 1 | Heaviest multi-actor spec; server restart mid-run | Heap ceiling raised | **Stabilizing** — re-run pending |
| F-8 | `financial-issuance › founder demo` | failed | 1 | Post-heavy-spec server instability | Heap ceiling raised | **Stabilizing** |
| F-9 | `financial-operations › founder demo` | failed | 1 | Same | Heap ceiling raised | **Stabilizing** |
| F-10 | `foundation › page boots` | failed on a CLEAN server | deterministic | **Genuine stale test** — asserted removed IP-0 content ("DesiAuction NEXT" / `app-version`); `/` is the marketing landing since `28a11d8` | Rewrote to assert the real landing (title + hero h1) | **Resolved** — 2/2 green |
| F-11 | `organizer-workspace › permissions attack` | failed (serial casualty) | 1 | Sibling of F-6 in a serial group | Heap ceiling raised | **Stabilizing** |
| F-12 | `public-registration › attacks` | failed in full suite, **passes in isolation** | 1 | Serial casualty of memory restart | Heap ceiling raised | **Stabilizing** |

## Verification plan
- **F-1, F-2:** verified Resolved (`public-registration.spec.ts` → 5 passed / 0 flaky / 1.0m, was 4/1-flaky/3.4m).
- **F-3…F-12:** the heap-ceiling fix targets the shared root cause; a full-suite
  re-run (#2, with the fix) is the authoritative check. Any spec still red after
  that is a genuine defect and gets its own investigation.

## Standing guidance
E2E is coupled to `next dev` (the OTP `/dev/inbox` route is dev-only, so a
prod-build server is not an option locally). To run the full suite reliably:
1. **Start from a clean server** — `lsof -tnP -iTCP:3050 -iTCP:4000 -sTCP:LISTEN | xargs kill`
   before the run, so `reuseExistingServer` cannot reuse a stale/degraded (or
   pre-config-change) server.
2. **Keep the heap ceiling** (`NODE_OPTIONS=--max-old-space-size=4096`, now in
   `playwright.config.ts`); validate it via a clean-server full run.
3. **If restarts persist on a loaded machine, shard by spec file** (a few files
   per `playwright test` invocation, fresh server each) so no single session
   accumulates enough heap to restart. Reseed (`pnpm seed:demo`) between shards.
4. **CI remains the authoritative gate** — pre-compiled server + ephemeral DB,
   immune to all of the above.
