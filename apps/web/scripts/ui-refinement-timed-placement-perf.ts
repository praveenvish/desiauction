/** Matched isolated family responsiveness measurement. --smoke validates the harness only. */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { seedScoringFixture, readScoringFixture, scoringSession } from "../e2e/scoring-fixtures";

for (const name of [
  "DATABASE_URL",
  "APP_DATABASE_URL",
  "SYSTEM_DATABASE_URL",
  "RUNNER_DATABASE_URL",
]) {
  // Validation harness checks all four isolated role URLs before any fixture mutation.
  // eslint-disable-next-line no-restricted-syntax
  const url = new URL(process.env[name] ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "15437" || url.pathname !== "/ls1_c29_clean")
    throw new Error(`Unsafe validation target: ${name}`);
}
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Required validation value unavailable");
  return value;
}
const origin = "http://localhost:3050";
const smoke = process.argv.includes("--smoke");
const count = smoke ? 2 : 100;
const intervalMs = smoke ? 1000 : 12000;
const output = smoke ? "/tmp/ui-e08-performance-smoke" : "/tmp/ui-e08-performance";
await mkdir(output, { recursive: true });
const mode = process.argv[2];
const baseline = ".next-ui-e07",
  candidate = ".next-ui-e08";
const builds = Object.fromEntries(
  await Promise.all(
    [baseline, candidate].map(async (directory) => [
      directory,
      (await readFile(path.join(directory, "BUILD_ID"), "utf8")).trim(),
    ]),
  ),
) as Record<string, string>;
let server: ChildProcess | undefined;
async function stop() {
  if (!server || server.exitCode !== null) return;
  const current = server;
  await new Promise<void>((resolve) => {
    current.once("exit", () => {
      resolve();
    });
    current.kill("SIGTERM");
  });
  server = undefined;
}
async function start(directory: string) {
  await stop();
  let occupied = false;
  try {
    occupied = (await fetch(`${origin}/healthz`)).ok;
  } catch {
    /* No owned listener. */
  }
  if (occupied) throw new Error("Port3050 is already serving; refusing duplicate validation");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3050"], {
    env: {
      // Child server inherits the explicitly checked isolated role environment.
      // eslint-disable-next-line no-restricted-syntax
      ...process.env,
      NEXT_DIST_DIR: directory,
      UI_TREATMENT: "refined",
      EMAIL_PROVIDER: "dev",
      LOGIN_DEFAULT_METHOD: "phone",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", () => {});
  server.stderr?.on("data", (data: Buffer) => process.stderr.write(data));
  await expect
    .poll(
      async () => {
        if (server?.exitCode !== null) throw new Error("Owned preview exited during startup");
        try {
          return (await fetch(`${origin}/healthz`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(200);
}
const browser = await chromium.launch();
let checkpoint: Record<string, unknown> = { mode, builds };
try {
  const conditions: Record<string, unknown> & { windowMs: number } = {
    browser: browser.version(),
    viewport: "390x844",
    reducedMotion: "reduce",
    network: "loopback, no throttle",
    treatmentAssignment: "refined for both source builds",
    theme: "daylight",
    cpu: "no throttle",
    runsPerFamily: 3,
    families: ["timed", "placement"],
    eventsPerRun: count,
    windowMs: smoke ? 2000 : 1200000,
    schedule:
      "Three separate fixture/context replicates per family, serial interleaved activations evenly distributed over each matched twenty-minute window",
    event:
      "Click-handler entry → two animation frames after changed actual points value; local responsiveness proxy excludes prior input delay; acceptance checked separately",
    builds,
    physicalDevice: "PENDING",
    fieldINP: "PENDING",
  };
  await writeFile(
    path.join(output, "measurement-protocol.json"),
    JSON.stringify(conditions, null, 2),
  );
  for (const [directory, treatment] of [
    [baseline, "baseline"],
    [candidate, "refined"],
  ] as const) {
    await start(required(directory));
    const runs = [];
    for (const family of ["timed", "placement"] as const)
      for (let run = 0; run < 3; run++) {
        const fixture = await seedScoringFixture({
          sport: family === "timed" ? "basketball" : "battle_royale",
          formatKey: family === "timed" ? "basketball_40" : "lobby_1",
        });
        const context = await browser.newContext({
          baseURL: origin,
          viewport: { width: 390, height: 844 },
          reducedMotion: "reduce",
        });
        context.setDefaultTimeout(30000);
        await scoringSession(context, fixture.actorToken);
        const setup = await context.newPage();
        await setup.goto(`/score/${fixture.fixtureId}/setup`);
        if (family === "placement")
          await setup.getByRole("spinbutton", { name: "Rounds", exact: true }).fill("100");
        await setup.getByRole("button", { name: "Start match", exact: true }).click();
        await expect(setup.getByTestId(`${family}-pad`)).toBeVisible();
        if (family === "timed")
          await setup.getByRole("button", { name: "Start period 1", exact: true }).click();
        await expect(setup.locator('main > p[role="status"]').first()).toHaveText("Saved");
        await setup.close();
        const page = await context.newPage();
        await page.addInitScript(() => {
          localStorage.setItem("ls1:theme", "daylight");
          const stats = { samples: [] as number[], cls: 0, errors: 0 };
          Object.assign(window, { __uiPilot: stats });
          window.addEventListener("error", () => {
            stats.errors++;
          });
          new PerformanceObserver((list) => {
            for (const item of list.getEntries() as (PerformanceEntry & {
              hadRecentInput: boolean;
              value: number;
            })[])
              if (!item.hadRecentInput) stats.cls += item.value;
          }).observe({ type: "layout-shift", buffered: true });
        });
        const session = await context.newCDPSession(page);
        await session.send("Performance.enable");
        await page.goto(`/score/${fixture.fixtureId}`);
        await expect(page.getByTestId(`${family}-pad`)).toBeVisible();
        await expect(page.locator('main > p[role="status"]').first()).toHaveText("Saved");
        const cold = await page.evaluate(() =>
          performance.getEntriesByType("navigation").map((entry) => entry.toJSON() as unknown),
        );
        await page.reload();
        await expect(page.getByTestId(`${family}-pad`)).toBeVisible();
        await expect(page.locator('main > p[role="status"]').first()).toHaveText("Saved");
        const warm = await page.evaluate(() =>
          performance.getEntriesByType("navigation").map((entry) => entry.toJSON() as unknown),
        );
        const initialMetrics = await session.send("Performance.getMetrics");
        runs.push({ family, context, page, fixture, cold, warm, session, initialMetrics });
      }
    const startAt = Date.now();
    for (let delivery = 0; delivery < count; delivery++) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, startAt + delivery * intervalMs - Date.now())),
      );
      for (const run of runs) {
        checkpoint = {
          mode,
          builds,
          treatment,
          fixtureId: run.fixture.fixtureId,
          family: run.family,
          event: delivery + 1,
        };
        await expect(run.page.locator('main > p[role="status"]').first()).toHaveText("Saved");
        const control = run.page.getByRole("button", {
          name: run.family === "timed" ? "+ 3 points" : "Save round",
          exact: true,
        });
        await control.evaluate((element) => {
          element.setAttribute("data-ui-perf-control", "active");
        });
        const controlId = "active";
        await run.page.evaluate(
          ({ controlId, family }) => {
            const control = document.querySelector(`[data-ui-perf-control="${controlId}"]`);
            if (!control) throw new Error("Run control missing");
            control.addEventListener(
              "click",
              () => {
                const started = performance.now();
                const home = document.querySelector(
                  family === "timed"
                    ? '[data-testid="timed-home-points"]'
                    : '[data-testid="live-score"]',
                );
                const away = document.querySelector(
                  family === "timed"
                    ? '[data-testid="timed-away-points"]'
                    : '[data-testid="live-score"]',
                );
                if (!home || !away) throw new Error("Scoring feedback missing");
                const before = `${home.textContent}:${away.textContent}`;
                const observer = new MutationObserver(() => {
                  if (`${home.textContent}:${away.textContent}` === before) return;
                  observer.disconnect();
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                      const stats = (window as unknown as { __uiPilot: { samples: number[] } })
                        .__uiPilot;
                      stats.samples.push(performance.now() - started);
                    }),
                  );
                });
                observer.observe(home, {
                  attributes: true,
                  childList: true,
                  characterData: true,
                  subtree: true,
                });
                observer.observe(away, {
                  childList: true,
                  characterData: true,
                  subtree: true,
                });
              },
              { once: true, capture: true },
            );
          },
          { controlId, family: run.family },
        );
        await control.click();
        await expect(run.page.locator('main > p[role="status"]').first()).toHaveText("Saved");
        await expect
          .poll(() =>
            run.page.evaluate(
              () =>
                (window as unknown as { __uiPilot: { samples: number[] } }).__uiPilot.samples
                  .length,
            ),
          )
          .toBe(delivery + 1);
      }
      const partial = await Promise.all(
        runs.map(async (run) => ({
          fixtureId: run.fixture.fixtureId,
          stats: await run.page.evaluate(
            () => (window as unknown as { __uiPilot: unknown }).__uiPilot,
          ),
        })),
      );
      await writeFile(
        path.join(output, `${treatment}-checkpoint.json`),
        JSON.stringify({ checkpoint, conditions, partial }, null, 2),
      );
      if (delivery % 10 === 0)
        process.stdout.write(
          `${treatment}: ${String(delivery + 1)}/${String(count)} accepted in each of three runs per family`,
        );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, startAt + conditions.windowMs - Date.now())),
    );
    const results = [];
    for (const [index, run] of runs.entries()) {
      const stats = await run.page.evaluate(
        () =>
          (window as unknown as { __uiPilot: { samples: number[]; cls: number; errors: number } })
            .__uiPilot,
      );
      expect(stats.samples).toHaveLength(count);
      expect(stats.errors).toBe(0);
      expect(stats.cls).toBeLessThanOrEqual(0.1);
      const canonical = await readScoringFixture(run.fixture.fixtureId);
      expect(
        canonical.events.filter(
          (event) => event.type === (run.family === "timed" ? "score" : "lobby_round"),
        ),
      ).toHaveLength(count);
      const sorted = [...stats.samples].sort((a, b) => a - b);
      const finalMetrics = await run.session.send("Performance.getMetrics");
      results.push({
        initialMetrics: run.initialMetrics,
        finalMetrics,
        run: index + 1,
        ...stats,
        p50: sorted[Math.ceil(count * 0.5) - 1],
        p95: sorted[Math.ceil(count * 0.95) - 1],
        cold: run.cold,
        warm: run.warm,
        acceptedFamilyEvents: count,
        family: run.family,
        failures: 0,
      });
      await run.context.close();
    }
    await writeFile(
      path.join(output, `${required(treatment)}-performance.json`),
      JSON.stringify({ conditions, results }, null, 2),
    );
  }
} catch (error) {
  await writeFile(
    path.join(output, `${mode ?? "unknown"}-failure.json`),
    JSON.stringify(
      { checkpoint, error: error instanceof Error ? error.stack : String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await stop();
}
