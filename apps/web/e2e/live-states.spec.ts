import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  firstScoringOver,
  seedScoringFixture,
  startScoring,
  type ScoringFixture,
} from "./scoring-fixtures";

test.use({ serviceWorkers: "block" });
async function liveViewer(browser: Browser, fixture: ScoringFixture) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    serviceWorkers: "block",
  });
  const viewer = await context.newPage();
  await viewer.clock.install();
  await viewer.bringToFront();
  return { context, viewer };
}
async function openLive(viewer: Page, fixture: ScoringFixture) {
  const ping = viewer.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/live/${fixture.fixtureId}/view` &&
      response.status() === 204,
  );
  await viewer.goto(`/c/${fixture.slug}/m/Match%201`);
  await expect(viewer.getByTestId("live-score")).toHaveText("15/2(1)");
  await ping;
  await expect.poll(() => viewer.evaluate(() => document.visibilityState)).toBe("visible");
}

test("a live viewer keeps the score and reports stale play after sixty-one seconds", async ({
  page,
  browser,
}) => {
  const fixture = await seedScoringFixture({ publicDelaySeconds: 0 });
  await startScoring(page, fixture);
  await firstScoringOver(page, fixture);
  const { context, viewer } = await liveViewer(browser, fixture);
  try {
    await openLive(viewer, fixture);
    const seq = await viewer.getByTestId("live-score").getAttribute("data-seq");
    await expect(viewer.getByTestId("live-stale")).not.toBeVisible();
    await viewer.clock.fastForward(61000);
    await expect(viewer.getByTestId("live-stale")).toBeVisible();
    await expect(viewer.getByTestId("live-stale")).toContainText("Last ball");
    await expect(viewer.getByTestId("live-score")).toHaveText("15/2(1)");
    await expect(viewer.getByTestId("live-score")).toHaveAttribute("data-seq", seq ?? "");
    await expect(viewer.getByTestId("live-reconnecting")).not.toBeVisible();
  } finally {
    await context.close();
  }
});

test("two failed polls show reconnecting and a normal successful poll clears it", async ({
  page,
  browser,
}) => {
  const fixture = await seedScoringFixture({ publicDelaySeconds: 0 });
  await startScoring(page, fixture);
  await firstScoringOver(page, fixture);
  const { context, viewer } = await liveViewer(browser, fixture);
  const livePath = `/api/live/${fixture.fixtureId}`;
  let failed = 0;
  await viewer.route(
    (url) => url.pathname === livePath,
    async (route) => {
      if (failed < 2) {
        failed += 1;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: '{"error":"unavailable"}',
        });
      } else await route.continue();
    },
  );
  try {
    await openLive(viewer, fixture);
    await expect(viewer.getByTestId("live-reconnecting")).not.toBeVisible();
    for (const delay of [2000, 4000]) {
      const failure = viewer.waitForResponse(
        (response) => new URL(response.url()).pathname === livePath && response.status() === 500,
      );
      await viewer.clock.fastForward(delay);
      await failure;
    }
    expect(failed).toBe(2);
    await expect(viewer.getByTestId("live-reconnecting")).toBeVisible();
    await expect(viewer.getByTestId("live-score")).toHaveText("15/2(1)");
    const recovered = viewer.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === livePath && [200, 304].includes(response.status()),
    );
    await viewer.clock.fastForward(8000);
    await recovered;
    await expect(viewer.getByTestId("live-reconnecting")).not.toBeVisible();
    await expect(viewer.getByTestId("live-score")).toHaveText("15/2(1)");
  } finally {
    await context.close();
  }
});

test("five hundred independent viewers meet the steady-score polling load targets", async ({
  page,
}) => {
  test.setTimeout(150000);
  const latencyGated = !process.env["CI"];
  const fixture = await seedScoringFixture({ publicDelaySeconds: 0 });
  await startScoring(page, fixture);
  await firstScoringOver(page, fixture);
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("Missing validation server address");
  const target = new URL(`/api/live/${fixture.fixtureId}`, baseURL);
  target.searchParams.set("s", fixture.slug);
  let stdout;
  try {
    ({ stdout } = await promisify(execFile)(
      process.execPath,
      [
        path.resolve("../../scripts/live-load.mjs"),
        target.href,
        "--viewers",
        "500",
        "--duration-seconds",
        "60",
        // The p95 < 300 ms budget gates local and pre-deploy runs. On a shared
        // CI runner the server, the browser and all 500 viewers share two
        // vCPUs, so latency is reported there, not gated (as Lighthouse
        // performance is); every correctness check below still holds.
        ...(latencyGated ? [] : ["--p95-budget-ms", "none"]),
      ],
      { timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
    ));
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string };
    console.log("C34 steady-score load failure", output.stdout, output.stderr);
    throw error;
  }
  console.log("C34 steady-score polling load", stdout);
  await test
    .info()
    .attach("live-load", { body: Buffer.from(stdout), contentType: "application/json" });
  const metrics = JSON.parse(stdout) as {
    viewers: number;
    durationSeconds: number;
    elapsedSeconds: number;
    intervalMs: number;
    staggerMs: number;
    p95Ms: number;
    ratio304: number;
    failures: number;
    timeouts: number;
    statuses: { other: number };
    passed: boolean;
  };
  expect(metrics.viewers).toBe(500);
  expect(metrics.durationSeconds).toBeGreaterThanOrEqual(60);
  expect(metrics.elapsedSeconds).toBeGreaterThanOrEqual(60);
  expect(metrics.intervalMs).toBe(2000);
  expect(metrics.staggerMs).toBe(2000);
  test.info().annotations.push({
    type: "live-load-p95",
    description: `${String(metrics.p95Ms)} ms (${latencyGated ? "gated < 300" : "reported on CI"})`,
  });
  if (latencyGated) expect(metrics.p95Ms).toBeLessThan(300);
  expect(metrics.ratio304).toBeGreaterThan(0.8);
  expect(metrics.failures).toBe(0);
  expect(metrics.timeouts).toBe(0);
  expect(metrics.statuses.other).toBe(0);
  expect(metrics.passed).toBe(true);
});
