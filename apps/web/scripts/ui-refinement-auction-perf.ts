/** Actual accepted owner bids, three matched replicates per compiled source. */
import { chromium, expect, type Page } from "@playwright/test";
import { canonical, settled, stage } from "../e2e/ui-auction-fixtures";
import { buildIds, candidate, ownedServices, prior, record } from "./ui-auction-validation";

const smoke = process.argv.includes("--smoke");
const count = smoke ? 2 : 100;
const intervalMs = smoke ? 500 : 12000;
const windowMs = smoke ? 2000 : 1200000;
const output = smoke
  ? "/tmp/ui-e09-money-final-performance-instrumented-smoke"
  : "/tmp/ui-e09-money-final-performance-instrumented";
const builds = await buildIds();
const services = ownedServices(output);
const browser = await chromium.launch();
const results: Array<{
  build: string;
  run: number;
  samples: number[];
  p95: number;
  cls: number;
  cumulativeShift: number;
  shiftPages: unknown;
  errors: string[];
  taskDuration: number;
  heapDelta: number;
  canonicalBids: number;
  navigation: unknown;
}> = [];
const conditions = {
  browser: browser.version(),
  viewport: "390x844",
  network: "loopback, no throttle",
  cpu: "no throttle",
  theme: "daylight",
  reducedMotion: "reduce",
  runs: 3,
  events: count,
  windowMs,
  intervalMs,
  schedule:
    "Three synthetic real auctions, serial interleaved bid activations between two actual claimed owners, evenly distributed over each twenty-minute observation window",
  event:
    "Native click capture → two animation frames after actual accepted price/leader change; accepted engine broadcast included, HTTP command settlement checked separately, prior input delay excluded; canonical acceptance counted separately",
  auctionTimerSeconds: 600,
  baselineTreatment: "refined",
  candidateTreatment: "refined",
  builds,
  physicalDevice: "PENDING",
  fieldINP: "PENDING",
  layoutMetric:
    "Update-window CLS per page: largest session sum with <1s gap and <5s duration; worst page per replicate. Every raw shift and cumulative sum retained. Not lifetime/field CLS.",
};
async function instrument(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "daylight");
    const stats = {
      samples: [] as number[],
      cls: 0,
      cumulativeShift: 0,
      presentation: [] as unknown[],
      shifts: [] as Array<{
        startTime: number;
        value: number;
        hadRecentInput: boolean;
        sources: unknown[];
      }>,
    };
    let previousPresentation = "";
    const capturePresentation = {
      run() {
        const status = document.querySelector('[data-testid="auction-command-status"]');
        const state = JSON.stringify({
          presentation: status?.getAttribute("data-presentation") ?? null,
          commands: status?.getAttribute("data-command-states") ?? null,
          recovery:
            document.querySelector('[data-testid="auction-command-recovery"]')?.textContent ?? null,
        });
        if (state === previousPresentation) return;
        previousPresentation = state;
        stats.presentation.push({
          time: performance.now(),
          state: JSON.parse(state) as unknown,
          mainTop: document.getElementById("live-top")?.getBoundingClientRect().top ?? null,
          scrollY,
        });
      },
    };
    new MutationObserver(() => {
      capturePresentation.run();
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-presentation", "data-command-states"],
    });
    capturePresentation.run();
    let sessionStart = 0,
      lastShift = 0,
      sessionValue = 0;
    (window as unknown as { __auctionPerf: typeof stats }).__auctionPerf = stats;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources: Array<{
            node: Element | null;
            previousRect: DOMRectReadOnly;
            currentRect: DOMRectReadOnly;
          }>;
        };
        stats.shifts.push({
          startTime: shift.startTime,
          value: shift.value,
          hadRecentInput: shift.hadRecentInput,
          sources: shift.sources.map((source) => ({
            node: source.node
              ? {
                  tag: source.node.tagName,
                  id: source.node.id,
                  className: source.node.getAttribute("class"),
                  testId: source.node.getAttribute("data-testid"),
                }
              : null,
            previousRect: source.previousRect.toJSON() as unknown,
            currentRect: source.currentRect.toJSON() as unknown,
          })),
        });
        if (shift.hadRecentInput) continue;
        stats.cumulativeShift += shift.value;
        if (
          sessionValue > 0 &&
          shift.startTime - lastShift < 1000 &&
          shift.startTime - sessionStart < 5000
        )
          sessionValue += shift.value;
        else {
          sessionStart = shift.startTime;
          sessionValue = shift.value;
        }
        lastShift = shift.startTime;
        stats.cls = Math.max(stats.cls, sessionValue);
      }
    }).observe({ type: "layout-shift", buffered: false });
  });
}
try {
  await services.engine();
  for (const dist of [prior, candidate]) {
    await services.web(dist);
    const runs = [];
    try {
      for (let replicate = 0; replicate < 3; replicate++) {
        const fixture = await stage(browser, false, 600);
        const other = await fixture.conductorContext.newPage();
        await other.goto(`/seasons/${fixture.data.slug}/auction/live`);
        await expect(other.getByTestId("live-panel")).toHaveAttribute("data-hydrated", "true");
        const claim = other.getByTestId("claim-paddle");
        if (await claim.isVisible()) {
          await other.getByLabel("Team", { exact: true }).selectOption({ label: "LS1 Strikers" });
          await claim.click();
          await expect(other.getByTestId("my-paddle")).toBeVisible();
          await settled(other);
        }
        const errors: string[] = [];
        const pages = [fixture.owner, other];
        for (const page of pages) page.on("pageerror", (error) => errors.push(error.message));
        const sessions = await Promise.all(pages.map((page) => page.context().newCDPSession(page)));
        const navigation = [];
        const initial = [];
        for (const [index, page] of pages.entries()) {
          const session = sessions[index];
          if (!session) throw new Error("Missing measured browser session");
          await session.send("Network.enable");
          await session.send("Network.clearBrowserCache");
          await page.reload();
          await settled(page);
          const httpCacheCold = await page.evaluate(() =>
            performance.getEntriesByType("navigation").map((entry) => entry.toJSON() as unknown),
          );
          await page.reload();
          await settled(page);
          const warm = await page.evaluate(() =>
            performance.getEntriesByType("navigation").map((entry) => entry.toJSON() as unknown),
          );
          navigation.push({
            owner: index + 1,
            protocol: "HTTP-cache cold reload then warm reload; existing loopback connection",
            httpCacheCold,
            warm,
          });
          await instrument(page);
          await session.send("Performance.enable");
          initial.push(await session.send("Performance.getMetrics"));
        }
        runs.push({ fixture, other, sessions, initial, errors, navigation });
      }
      const started = Date.now();
      for (let event = 0; event < count; event++) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, started + event * intervalMs - Date.now())),
        );
        for (const run of runs) {
          const page = event % 2 === 0 ? run.fixture.owner : run.other;
          const button = page.getByTestId("bid-next");
          await expect(button).toBeEnabled();
          await button.evaluate((control) => {
            control.addEventListener(
              "click",
              () => {
                const began = performance.now();
                const price = document.querySelector('[data-testid="leading-bid"]');
                if (!price) throw new Error("Actual price missing");
                const region = price.closest(".owner-price");
                if (!region) throw new Error("Actual price and leader region missing");
                const before = region.textContent;
                const observer = new MutationObserver(() => {
                  if (region.textContent === before) return;
                  observer.disconnect();
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                      (
                        window as unknown as { __auctionPerf: { samples: number[] } }
                      ).__auctionPerf.samples.push(performance.now() - began);
                    }),
                  );
                });
                observer.observe(region, { subtree: true, childList: true, characterData: true });
              },
              { once: true, capture: true },
            );
          });
          await button.click();
          await settled(page);
          await expect
            .poll(async () => (await canonical(run.fixture.auctionId)).bids.length)
            .toBe(event + 1);
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  (window as unknown as { __auctionPerf: { samples: number[] } }).__auctionPerf
                    .samples.length,
              ),
            )
            .toBe(Math.floor(event / 2) + 1);
        }
        if (event % 10 === 0)
          process.stdout.write(
            `${dist}: ${String(event + 1)}/${String(count)} accepted bids in each replicate\n`,
          );
        await record(output, `${dist}-progress.json`, {
          conditions,
          event: event + 1,
          elapsedMs: Date.now() - started,
        });
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, started + windowMs - Date.now())),
      );
      const captured = [];
      for (const [index, run] of runs.entries()) {
        const stats = await Promise.all(
          [run.fixture.owner, run.other].map((page) =>
            page.evaluate(
              () =>
                (
                  window as unknown as {
                    __auctionPerf: {
                      samples: number[];
                      cls: number;
                      cumulativeShift: number;
                      shifts: unknown[];
                    };
                  }
                ).__auctionPerf,
            ),
          ),
        );
        const samples = stats.flatMap((value) => value.samples).sort((a, b) => a - b);
        await record(output, `${dist}-replicate-${String(index + 1)}-raw.json`, {
          conditions,
          samples,
          pages: stats,
          errors: run.errors,
        });
        captured.push({ run, index, stats, samples });
      }
      for (const { run, index, stats, samples } of captured) {
        expect(samples).toHaveLength(count);
        expect(run.errors).toEqual([]);
        const cls = Math.max(...stats.map((value) => value.cls));
        expect(cls).toBeLessThanOrEqual(0.1);
        let taskDuration = 0,
          heapDelta = 0;
        for (const [sessionIndex, session] of run.sessions.entries()) {
          const current = await session.send("Performance.getMetrics");
          const old = run.initial[sessionIndex];
          const value = (metrics: typeof current, key: string) =>
            metrics.metrics.find((metric: { name: string; value: number }) => metric.name === key)
              ?.value ?? 0;
          if (!old) throw new Error("Missing initial metrics");
          taskDuration += value(current, "TaskDuration") - value(old, "TaskDuration");
          heapDelta += value(current, "JSHeapUsedSize") - value(old, "JSHeapUsedSize");
        }
        const canonicalBids = (await canonical(run.fixture.auctionId)).bids.length;
        expect(canonicalBids).toBe(count);
        const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
        if (p95 === undefined) throw new Error("Missing measured p95");
        results.push({
          build: dist,
          run: index + 1,
          samples,
          p95,
          cls,
          cumulativeShift: Math.max(...stats.map((value) => value.cumulativeShift)),
          shiftPages: stats,
          errors: run.errors,
          taskDuration,
          heapDelta,
          canonicalBids,
          navigation: run.navigation,
        });
      }
      await record(output, `${dist}-results.json`, {
        conditions,
        results: results.filter((result) => result.build === dist),
      });
    } finally {
      for (const run of runs) {
        await run.fixture.conductorContext.close();
        await run.fixture.ownerContext.close();
      }
    }
  }
  const comparison = [1, 2, 3].map((run) => {
    const before = results.find((result) => result.build === prior && result.run === run);
    const after = results.find((result) => result.build === candidate && result.run === run);
    if (!before || !after) throw new Error("Missing matched replicate");
    const increase = (after.p95 / before.p95 - 1) * 100;
    expect(increase).toBeLessThanOrEqual(10);
    return { run, priorP95: before.p95, candidateP95: after.p95, increasePercent: increase };
  });
  await record(output, "comparison.json", {
    conditions,
    comparison,
    results,
    status: smoke ? "HARNESS-SMOKE" : "PASS",
  });
  process.stdout.write("Matched actual-bid measurements PASS\n");
} finally {
  await browser.close();
  await services.stop();
}
