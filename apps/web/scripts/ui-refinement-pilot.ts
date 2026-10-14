/** Isolated local UI performance and queue/asset rollback rehearsal. */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import {
  seedScoringFixture,
  startScoring,
  runBall,
  nextBowler,
  sent,
  readyOffline,
  committedQueue,
  persistedQueue,
  readScoringFixture,
  scoringSession,
} from "../e2e/scoring-fixtures";

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
const output = "/tmp/ui-e04-pilot-evidence";
await mkdir(output, { recursive: true });
const mode = process.argv[2];
const baseline = ".next-e2e",
  candidate = ".next-ui-refined";
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
async function start(directory: string, treatment: string) {
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
      UI_TREATMENT: treatment,
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
async function retained(page: Page, fixtureId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("IDB request failed"));
      };
    });
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const transaction = database.transaction("keyval", "readonly");
        const result: Record<string, unknown> = {};
        for (const key of [
          "da:scoring-epoch",
          "ls1:device",
          "ls1:actor",
          `ls1:queue:${id}`,
          `ls1:prepared:${id}`,
        ]) {
          const request = transaction.objectStore("keyval").get(key);
          request.onsuccess = () => {
            result[key] = request.result;
          };
        }
        transaction.oncomplete = () => {
          resolve(result);
        };
        transaction.onerror = () => {
          reject(transaction.error ?? new Error("IDB transaction failed"));
        };
      });
    } finally {
      database.close();
    }
  }, fixtureId);
}
let checkpoint: Record<string, unknown> = { mode, builds };
try {
  if (mode === "rollback") {
    const rehearsal = Date.now();
    const rollbackDir = `.next-ui-rollback-${String(rehearsal)}`;
    const forwardDir = `.next-ui-forward-${String(rehearsal)}`;
    // Preserve both immutable builds; rehearsal copies retain both asset sets.
    for (const [base, extra, destination] of [
      [baseline, candidate, rollbackDir],
      [candidate, baseline, forwardDir],
    ]) {
      await cp(required(base), required(destination), {
        recursive: true,
        filter: (source) =>
          !source.includes(`${path.sep}cache${path.sep}`) &&
          !source.endsWith(`${path.sep}cache`) &&
          !source.includes(`${path.sep}standalone${path.sep}`) &&
          !source.endsWith(`${path.sep}standalone`),
      });
      await cp(path.join(required(extra), "static"), path.join(required(destination), "static"), {
        recursive: true,
        force: false,
      });
    }
    await start(rollbackDir, "baseline");
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 390, height: 844 },
    });
    const pageErrors: string[] = [],
      assetFailures: {
        url: string;
        reason: string | undefined;
        resource: string;
        page: string;
        documentId: number;
        stage: unknown;
      }[] = [],
      assetHttpErrors: { url: string; status: number }[] = [];
    const documents = new Map<Page, number>();
    context.on("page", (page) => {
      const documentId = documents.size + 1;
      documents.set(page, documentId);
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("requestfailed", (request) => {
        if (new URL(request.url()).pathname.startsWith("/_next/"))
          assetFailures.push({
            url: request.url(),
            reason: request.failure()?.errorText,
            resource: request.resourceType(),
            page: page.url(),
            documentId,
            stage: checkpoint.stage,
          });
      });
      page.on("response", (response) => {
        if (new URL(response.url()).pathname.startsWith("/_next/") && response.status() >= 400)
          assetHttpErrors.push({ url: response.url(), status: response.status() });
      });
    });
    const manifests = await Promise.all(
      [baseline, candidate].map(async (directory) => {
        const manifest = JSON.parse(
          await readFile(`${directory}/react-loadable-manifest.json`, "utf8"),
        ) as Record<string, { files: string[] }>;
        return required(manifest["app/score/[fixtureId]/families/pad-entries.tsx -> ../pad"])
          .files.filter((file) => file.endsWith(".js"))
          .map((file) => `${origin}/_next/${file}`);
      }),
    );
    const knownChunks = new Set(manifests.flat());
    const loading: {
      page: Page;
      documentId: number;
      stage: unknown;
      requests: Map<
        string,
        {
          url: string;
          initiator: { type: string };
          blockedReason?: string;
          error?: string;
          status?: number;
          failureStage?: unknown;
        }
      >;
      parsed: Set<string>;
    }[] = [];
    async function observedPage() {
      const page = await context.newPage();
      const session = await context.newCDPSession(page);
      const row = {
        page,
        documentId: required(documents.get(page)),
        stage: checkpoint.stage,
        requests: new Map<
          string,
          {
            url: string;
            initiator: { type: string };
            blockedReason?: string;
            error?: string;
            status?: number;
            failureStage?: unknown;
          }
        >(),
        parsed: new Set<string>(),
      };
      loading.push(row);
      await session.send("Network.enable");
      await session.send("Debugger.enable");
      session.on(
        "Network.requestWillBeSent",
        (event: { requestId: string; request: { url: string }; initiator: { type: string } }) => {
          if (new URL(event.request.url).pathname.startsWith("/_next/"))
            row.requests.set(event.requestId, {
              url: event.request.url,
              initiator: event.initiator,
            });
        },
      );
      session.on(
        "Network.loadingFailed",
        (event: { requestId: string; blockedReason?: string; errorText: string }) => {
          const request = row.requests.get(event.requestId);
          if (request)
            Object.assign(request, {
              blockedReason: event.blockedReason,
              error: event.errorText,
              failureStage: checkpoint.stage,
            });
        },
      );
      session.on(
        "Network.responseReceived",
        (event: { requestId: string; response: { status: number } }) => {
          const request = row.requests.get(event.requestId);
          if (request) request.status = event.response.status;
        },
      );
      session.on("Debugger.scriptParsed", (event: { url: string }) => {
        row.parsed.add(event.url);
      });
      return page;
    }
    const old = await observedPage();
    const fixture = await seedScoringFixture();
    await startScoring(old, fixture);
    await runBall(old, 1);
    await readyOffline(old, fixture.fixtureId);
    const before = await readScoringFixture(fixture.fixtureId);
    await context.setOffline(true);
    await runBall(old);
    const ids = await committedQueue(old, fixture.fixtureId, ["ball"]);
    const snapshot = await retained(old, fixture.fixtureId);
    expect(snapshot["ls1:actor"]).toBe(fixture.actorId);
    expect(snapshot["ls1:device"]).toBe(before.match?.scorerDeviceId);
    expect(snapshot["da:scoring-epoch"]).toEqual(expect.any(String));
    expect(snapshot[`ls1:prepared:${fixture.fixtureId}`]).toMatchObject({
      fixtureId: fixture.fixtureId,
      bootstrap: { actorId: fixture.actorId },
    });
    const oldUrl = old.url();
    checkpoint = { mode, builds, fixtureId: fixture.fixtureId, ids, stage: "forward" };
    await context.route(`**/api/score/${fixture.fixtureId}/events`, (route) =>
      route.abort("internetdisconnected"),
    );
    await start(forwardDir, "refined");
    // No reload of the active scoring tab; only a deliberate second-tab open.
    await context.setOffline(false);
    const refined = await observedPage();
    await refined.goto(`/score/${fixture.fixtureId}`);
    await expect(refined.locator("html")).toHaveAttribute("data-ui-treatment", "refined");
    await expect(refined.getByTestId("pad-sync")).toHaveAttribute("data-pending", "1");
    expect(
      (await persistedQueue(refined, fixture.fixtureId)).map((item) => item.event.eventId),
    ).toEqual(ids);
    const forward = await retained(refined, fixture.fixtureId);
    for (const key of ["da:scoring-epoch", "ls1:device", "ls1:actor"])
      expect(forward[key]).toEqual(snapshot[key]);
    await expect(old.locator("html")).not.toHaveAttribute("data-ui-treatment", "refined");
    const refinedUrl = refined.url();
    await context.setOffline(true);
    const offline = await context.newPage();
    await offline.goto(`/score/${fixture.fixtureId}`);
    await expect(offline).toHaveURL(`/score/shell#${fixture.fixtureId}`);
    await expect(offline.getByTestId("pad-run-0")).toBeEnabled();
    await expect(offline.getByTestId("pad-score")).toHaveText("1/0");
    expect(
      (await persistedQueue(offline, fixture.fixtureId)).map((item) => item.event.eventId),
    ).toEqual(ids);
    await offline.close();
    checkpoint = { ...checkpoint, stage: "rollback", offlineBootstrap: "PASS" };
    await start(rollbackDir, "baseline");
    await context.setOffline(false);
    const restored = await observedPage();
    await restored.goto(`/score/${fixture.fixtureId}`);
    expect(await restored.content()).toContain(builds[baseline]);
    await expect(restored.locator("html")).not.toHaveAttribute("data-ui-treatment", "refined");
    await expect(refined.locator("html")).toHaveAttribute("data-ui-treatment", "refined");
    expect(old.url()).toBe(oldUrl);
    expect(refined.url()).toBe(refinedUrl);
    await expect(restored.getByTestId("pad-sync")).toHaveAttribute("data-pending", "1");
    expect(
      (await persistedQueue(restored, fixture.fixtureId)).map((item) => item.event.eventId),
    ).toEqual(ids);
    const backward = await retained(restored, fixture.fixtureId);
    for (const key of ["da:scoring-epoch", "ls1:device", "ls1:actor"])
      expect(backward[key]).toEqual(snapshot[key]);
    await context.unroute(`**/api/score/${fixture.fixtureId}/events`);
    await sent(restored);
    const after = await readScoringFixture(fixture.fixtureId);
    expect(after.match?.scorerPersonId).toEqual(before.match?.scorerPersonId);
    expect(after.match?.scorerDeviceId).toEqual(before.match?.scorerDeviceId);
    expect(after.match?.lastSeq).toBe(required(before.match).lastSeq + 1);
    expect(
      after.events.filter((event) => ids.includes(event.eventId)).map((event) => event.eventId),
    ).toEqual(ids);
    expect(pageErrors).toEqual([]);
    await writeFile(
      path.join(output, "rollback-assets.json"),
      JSON.stringify({ pageErrors, assetFailures, assetHttpErrors, checkpoint }, null, 2),
    );
    const frameworkPreloads: {
      stage: unknown;
      page: string;
      documentId: number;
      url: string;
      initiator: { type: string };
      blockedReason?: string;
      error?: string;
      status?: number;
    }[] = [];
    for (const row of loading) {
      const elements = await row.page.evaluate(() =>
        Array.from(
          document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="script"]'),
        ).map((link) => ({ url: link.href, nonce: Boolean(link.nonce) })),
      );
      const requests = [...row.requests.values()];
      for (const failed of requests.filter((request) => request.error !== undefined)) {
        expect(knownChunks.has(failed.url)).toBe(true);
        expect(failed.blockedReason).toBe("csp");
        expect(failed.initiator.type).toBe("parser");
        expect(elements.some((link) => link.url === failed.url && !link.nonce)).toBe(true);
        expect(row.parsed.has(failed.url)).toBe(true);
        expect(
          requests.some(
            (request) =>
              request.url === failed.url && request.status === 200 && request.error === undefined,
          ),
        ).toBe(true);
        frameworkPreloads.push({
          stage: failed.failureStage,
          page: row.page.url(),
          documentId: row.documentId,
          ...failed,
        });
      }
    }
    const unclassifiedFailures = assetFailures.filter(
      (failure) =>
        !frameworkPreloads.some(
          (preload) =>
            preload.url === failure.url &&
            preload.documentId === failure.documentId &&
            preload.page === failure.page &&
            preload.stage === failure.stage &&
            failure.reason === "csp" &&
            failure.resource === "script",
        ),
    );
    await writeFile(
      path.join(output, "rollback-assets.json"),
      JSON.stringify(
        {
          pageErrors,
          assetFailures,
          assetHttpErrors,
          frameworkPreloads,
          unclassifiedFailures,
          loading: loading.map((row) => ({
            stage: row.stage,
            documentId: row.documentId,
            page: row.page.url(),
            requests: [...row.requests.values()],
            parsed: [...row.parsed],
          })),
          checkpoint,
        },
        null,
        2,
      ),
    );
    expect(assetHttpErrors).toEqual([]);
    expect(unclassifiedFailures).toEqual([]);
    await writeFile(
      path.join(output, "rollback.json"),
      JSON.stringify(
        {
          builds,
          ids,
          before: before.match,
          after: after.match,
          pageErrors,
          assetFailures,
          offlineBootstrap: "PASS",
          evidence:
            "Same origin, active old document retained, fresh refined and pinned-baseline documents, dual asset retention, interrupted connectivity, unchanged epoch/device/actor, one accepted queued event",
        },
        null,
        2,
      ),
    );
    await context.close();
    process.stdout.write("Old → refined → pinned baseline queue/claim rehearsal PASS\n");
  } else if (mode === "performance") {
    const conditions: Record<string, unknown> & { windowMs: number } = {
      browser: browser.version(),
      viewport: "390x844",
      reducedMotion: "reduce",
      network: "loopback, no throttle",
      cpu: "no throttle",
      runs: 3,
      eventsPerRun: 100,
      windowMs: 1200000,
      schedule:
        "Three separate fixture/context replicates, serial interleaved activations evenly distributed over each matched twenty-minute window",
      event:
        "Click-handler entry → two animation frames after changed pending/overs value; local responsiveness proxy excludes prior input delay; acceptance checked separately",
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
      await start(required(directory), required(treatment));
      const runs = [];
      for (let run = 0; run < 3; run++) {
        const fixture = await seedScoringFixture({ formatKey: "t20" });
        const setupContext = await browser.newContext({ baseURL: origin });
        const setupPage = await setupContext.newPage();
        await startScoring(setupPage, fixture);
        await sent(setupPage);
        const device = await setupPage.evaluate(() => localStorage.getItem("ls1:device"));
        expect(device).toEqual(expect.any(String));
        await setupContext.close();
        const context = await browser.newContext({
          baseURL: origin,
          viewport: { width: 390, height: 844 },
          reducedMotion: "reduce",
        });
        await scoringSession(context, fixture.actorToken);
        // Restore this test device identity only; HTTP/SW caches remain fresh.
        await context.addInitScript((id) => {
          localStorage.setItem("ls1:device", id ?? "");
        }, device);
        const page = await context.newPage();
        await page.addInitScript(() => {
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
        await expect(page.getByTestId("pad-run-0")).toBeEnabled();
        await sent(page);
        const cold = await page.evaluate(() =>
          performance.getEntriesByType("navigation").map((entry) => entry.toJSON() as unknown),
        );
        await page.reload();
        await expect(page.getByTestId("pad-run-0")).toBeEnabled();
        await sent(page);
        const warm = await page.evaluate(() =>
          performance.getEntriesByType("navigation").map((entry) => entry.toJSON() as unknown),
        );
        const initialMetrics = await session.send("Performance.getMetrics");
        runs.push({ context, page, fixture, cold, warm, session, initialMetrics });
      }
      const startAt = Date.now();
      for (let delivery = 0; delivery < 100; delivery++) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, startAt + delivery * 12000 - Date.now())),
        );
        for (const run of runs) {
          checkpoint = {
            mode,
            builds,
            treatment,
            fixtureId: run.fixture.fixtureId,
            event: delivery + 1,
          };
          if (delivery > 0 && delivery % 6 === 0)
            await nextBowler(
              run.page,
              required(run.fixture.awayNames[Math.floor(delivery / 6) % 5]),
            );
          await sent(run.page);
          await run.page.evaluate(() => {
            const control = document.querySelector('[data-testid="pad-run-0"]');
            if (!control) throw new Error("Run control missing");
            control.addEventListener(
              "click",
              () => {
                const started = performance.now();
                const sync = document.querySelector('[data-testid="pad-sync"]');
                const overs = document.querySelector('[data-testid="pad-overs"]');
                if (!sync || !overs) throw new Error("Scoring feedback missing");
                const before = `${sync.getAttribute("data-pending") ?? ""}:${overs.textContent}`;
                const observer = new MutationObserver(() => {
                  if (`${sync.getAttribute("data-pending") ?? ""}:${overs.textContent}` === before)
                    return;
                  observer.disconnect();
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                      const stats = (window as unknown as { __uiPilot: { samples: number[] } })
                        .__uiPilot;
                      stats.samples.push(performance.now() - started);
                    }),
                  );
                });
                observer.observe(sync, {
                  attributes: true,
                  childList: true,
                  subtree: true,
                });
                observer.observe(overs, {
                  childList: true,
                  subtree: true,
                });
              },
              { once: true, capture: true },
            );
          });
          await runBall(run.page);
          await sent(run.page);
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
            `${treatment}: ${String(delivery + 1)}/100 accepted in each of three runs`,
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
        expect(stats.samples).toHaveLength(100);
        expect(stats.errors).toBe(0);
        expect(stats.cls).toBeLessThanOrEqual(0.1);
        const canonical = await readScoringFixture(run.fixture.fixtureId);
        expect(canonical.events.filter((event) => event.type === "ball")).toHaveLength(100);
        const sorted = [...stats.samples].sort((a, b) => a - b);
        const finalMetrics = await run.session.send("Performance.getMetrics");
        results.push({
          initialMetrics: run.initialMetrics,
          finalMetrics,
          run: index + 1,
          ...stats,
          p50: sorted[49],
          p95: sorted[94],
          cold: run.cold,
          warm: run.warm,
          acceptedBalls: 100,
          failures: 0,
        });
        await run.context.close();
      }
      await writeFile(
        path.join(output, `${required(treatment)}-performance.json`),
        JSON.stringify({ conditions, results }, null, 2),
      );
    }
  } else throw new Error("Specify rollback or performance");
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
