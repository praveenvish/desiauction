/** Distinguish rejected speculative preloads from executable chunk loading. */
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import {
  seedScoringFixture,
  startScoring,
  sent,
  scoringSession,
  runBall,
  readScoringFixture,
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
    throw new Error(`Unsafe target: ${name}`);
}
const output = "/tmp/ui-e04-pilot-evidence";
await mkdir(output, { recursive: true });
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Required validation value unavailable");
  return value;
}
const origin = "http://localhost:3050";
const browser = await chromium.launch();
let server: ChildProcess | undefined;
async function stop() {
  if (server && server.exitCode === null)
    await new Promise<void>((resolve) => {
      required(server).once("exit", () => {
        resolve();
      });
      required(server).kill("SIGTERM");
    });
}
const results: unknown[] = [];
try {
  for (const [directory, treatment] of [
    [".next-e2e", "baseline"],
    [".next-ui-refined", "refined"],
  ] as const) {
    await stop();
    let occupied = false;
    try {
      occupied = (await fetch(`${origin}/healthz`)).ok;
    } catch {
      /* No listener. */
    }
    if (occupied) throw new Error("Refusing occupied3050");
    server = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "--port", "3050"],
      {
        env: {
          // Child server inherits the explicitly checked isolated role environment.
          // eslint-disable-next-line no-restricted-syntax
          ...process.env,
          NEXT_DIST_DIR: directory,
          UI_TREATMENT: treatment,
          EMAIL_PROVIDER: "dev",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout?.on("data", () => {});
    server.stderr?.on("data", (data: Buffer) => process.stderr.write(data));
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${origin}/healthz`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(200);
    const manifest = JSON.parse(
      await readFile(`${directory}/react-loadable-manifest.json`, "utf8"),
    ) as Record<string, { files: string[] }>;
    const entry = required(manifest["app/score/[fixtureId]/families/pad-entries.tsx -> ../pad"]);
    const chunks = entry.files
      .filter((file) => file.endsWith(".js"))
      .map((file) => `${origin}/_next/${file}`);
    expect(chunks.length).toBeGreaterThan(0);
    const fixture = await seedScoringFixture();
    const setupContext = await browser.newContext({ baseURL: origin });
    const setup = await setupContext.newPage();
    await startScoring(setup, fixture);
    await sent(setup);
    const device = await setup.evaluate(() => localStorage.getItem("ls1:device"));
    await setupContext.close();
    const context = await browser.newContext({ baseURL: origin });
    await scoringSession(context, fixture.actorToken);
    await context.addInitScript((id) => {
      localStorage.setItem("ls1:device", id ?? "");
    }, device);
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send("Network.enable");
    await session.send("Debugger.enable");
    const requests = new Map<
      string,
      {
        requestId: string;
        url: string;
        initiator: unknown;
        blockedReason?: string;
        error?: string;
        status?: number;
      }
    >();
    const parsed: string[] = [],
      errors: string[] = [];
    session.on(
      "Network.requestWillBeSent",
      (event: { requestId: string; request: { url: string }; initiator: unknown }) => {
        if (chunks.includes(event.request.url))
          requests.set(event.requestId, {
            requestId: event.requestId,
            url: event.request.url,
            initiator: event.initiator,
          });
      },
    );
    session.on(
      "Network.loadingFailed",
      (event: { requestId: string; blockedReason?: string; errorText: string }) => {
        const request = requests.get(event.requestId);
        if (request)
          Object.assign(request, { blockedReason: event.blockedReason, error: event.errorText });
      },
    );
    session.on(
      "Network.responseReceived",
      (event: { requestId: string; response: { status: number } }) => {
        const request = requests.get(event.requestId);
        if (request) request.status = event.response.status;
      },
    );
    session.on("Debugger.scriptParsed", (event: { url: string }) => {
      if (chunks.includes(event.url)) parsed.push(event.url);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(`/score/${fixture.fixtureId}`);
    await expect(page.getByTestId("pad-run-0")).toBeEnabled();
    await runBall(page);
    await sent(page);
    await page.getByTestId("pad-menu").click();
    await expect(page.getByTestId("menu-theme")).toBeVisible();
    await page.keyboard.press("Escape");
    const elements = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
          "script[src],link[rel=preload]",
        ),
      ).map((element) => ({
        tag: element.tagName,
        url: "src" in element ? element.src : element.href,
        nonce: Boolean(element.nonce),
        as: "as" in element ? element.as : null,
      })),
    );
    const canonical = await readScoringFixture(fixture.fixtureId);
    const row = {
      directory,
      build: (await readFile(`${directory}/BUILD_ID`, "utf8")).trim(),
      chunks,
      requests: [...requests.values()],
      parsed,
      elements,
      errors,
      documentHeaders: await required(response).allHeaders(),
      acceptedBalls: canonical.events.filter((event) => event.type === "ball").length,
    };
    results.push(row);
    await writeFile(`${output}/csp-execution.json`, JSON.stringify(results, null, 2));
    expect(row.documentHeaders["content-security-policy"]).toContain("'strict-dynamic'");
    expect(row.documentHeaders["content-security-policy"]).toContain("'nonce-");
    expect(errors).toEqual([]);
    expect(row.acceptedBalls).toBe(1);
    for (const chunk of chunks) {
      expect(parsed).toContain(chunk);
      expect(
        row.requests.some(
          (request) => request.url === chunk && request.status === 200 && !request.error,
        ),
      ).toBe(true);
      for (const failed of row.requests.filter(
        (request) => request.url === chunk && request.blockedReason,
      )) {
        expect(failed.blockedReason).toBe("csp");
        expect(failed.initiator).toMatchObject({ type: "parser" });
        expect(
          elements.some(
            (element) =>
              element.tag === "LINK" &&
              element.url === chunk &&
              element.as === "script" &&
              !element.nonce,
          ),
        ).toBe(true);
      }
    }
    await context.close();
    process.stdout.write(
      `${treatment}: fresh-cache executable chunks parsed, actual delivery/menu PASS; preload initiators retained`,
    );
  }
} catch (error) {
  await writeFile(
    `${output}/csp-execution-failure.json`,
    JSON.stringify(
      { results, error: error instanceof Error ? error.stack : String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await stop();
}
