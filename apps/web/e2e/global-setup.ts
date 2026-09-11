import { spawn } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createDb, finopsJobs } from "@desiauction/db";
import { and, eq, lt } from "drizzle-orm";

// Warm the dev server's on-demand compiler before parallel workers start —
// first-hit route compiles otherwise inject 10s+ of jitter into early tests.
// Production servers (CI option) are pre-compiled; warming is then a no-op.
//
// WARMING IS BOUNDED, AND THAT IS THE POINT. This used to be one
// `Promise.all` over the whole list, so every route below started compiling at
// the same instant. Next compiles each in its own pass with the full module
// graph in memory, and forty at once blew the dev server's heap before a single
// test ran — the server restarted mid-warm and every early spec failed
// ECONNREFUSED. Those failures looked exactly like application bugs, which is
// how the suite came to be described as "11 of 20 failing".
//
// The heap ceiling was raised twice chasing this (4096 → 8192). It was never a
// heap problem; it was a concurrency problem wearing a heap costume.
const WARM_CONCURRENCY = 4;

const ROUTES = [
  "/login",
  "/c",
  "/c/warmup",
  "/home",
  "/help",
  "/inbox",
  "/money",
  "/account",
  "/orgs",
  "/org/warmup",
  "/join/warmup",
  // /seasons is a redirect now, so warming it compiles nothing: the index it
  // forwards to is the route that has to be warm.
  "/tournaments",
  "/tournaments/warmup",
  "/seasons/warmup",
  "/seasons/warmup/register",
  "/seasons/warmup/registrations",
  "/seasons/warmup/teams",
  "/seasons/warmup/fixtures",
  "/seasons/warmup/standings",
  "/seasons/warmup/auction",
  "/seasons/warmup/auction/live",
  "/seasons/warmup/auction/plan",
  "/seasons/warmup/auction/cockpit",
  "/seasons/warmup/auction/spectate",
  "/seasons/warmup/readiness",
  "/seasons/warmup/money",
  "/org/warmup/settlement",
  "/org/warmup/money",
  "/org/warmup/money/deliveries",
  "/org/warmup/money/reconciliation",
  "/admin",
  "/admin/orgs",
  "/admin/orgs/warmup",
  "/admin/users",
  "/admin/users/warmup",
  "/admin/audit",
  "/admin/health",
  "/admin/messaging",
  "/gallery",
  "/",
];

async function warmRoutes(base: string): Promise<void> {
  const queue = [...ROUTES];
  const worker = async (): Promise<void> => {
    for (;;) {
      const route = queue.shift();
      if (route === undefined) {
        return;
      }
      // Failures are ignored on purpose: a warm is an optimisation, and a route
      // that 404s or redirects has still been compiled, which is the point.
      await fetch(`${base}${route}`, { redirect: "manual" }).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, () => worker()));
}

/**
 * Walk one real sign-in through a real browser, start to finish.
 *
 * A GET fetch, however many routes it hits, never reaches a SERVER ACTION —
 * `requestOtpAction`, `verifyOtpAction`, `updateProfileAction` — because those
 * compile only when a browser posts to them the way React's own client runtime
 * does. Every spec's first login was therefore the first time any of those
 * three ever ran in the process, on top of whichever route redirect landed on
 * next, and that stack of cold compiles routinely blew past the default 5s
 * `expect` timeout on "did we leave /login". It read as an app bug — the
 * button even rendered `disabled`, mid-request — and it was purely that
 * nothing had warmed the action path route warming cannot reach.
 *
 * Best effort, like the routes above: if sign-in is genuinely broken this does
 * not fail setup and say so cryptically — it fails on the first real test,
 * with a real assertion and a real stack trace, which is a better bug report.
 */
async function warmSignIn(base: string): Promise<void> {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: base });
    const phone = `80${String(Date.now()).slice(-8)}`;
    await page.goto("/login");
    await page.getByLabel("Mobile number").fill(phone);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByTestId("login-form").waitFor({ state: "attached" });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="login-form"]')?.getAttribute("data-step") === "code",
      { timeout: 20_000 },
    );
    const { latestOtp } = await import("./otp");
    const code = await latestOtp(phone, 10_000);
    await page.getByLabel("6-digit code").fill(code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
    await page.getByLabel("What should we call you?").fill("Warmup");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/home/, { timeout: 20_000 });
  } catch {
    // See above: a failure here surfaces on the first real test instead.
  } finally {
    await browser.close();
  }
}

/**
 * THE THIRD SERVICE. Production runs web, engine AND the finops runner; the
 * harness ran two.
 *
 * The runner is what drains `finops_jobs` and advances the follower cursor, so
 * without it the money operations board is honestly degraded — "settlement
 * ingest 5 events behind", "job runner: nothing picked up for 26 days" — and
 * `financial-operations` asserting a healthy board could never pass. That was
 * not a wrong assertion; it was a missing service, and the assertion is the
 * only thing that noticed.
 *
 * It cannot go in `webServer` because it has no HTTP port to wait on, so it is
 * spawned here and stopped in global-teardown. Detached + its own process group
 * so the teardown can take the whole tree down; a fast tick because a test suite
 * should not wait fifteen seconds to see a job move.
 */
function startFinopsRunner(): void {
  // `--env-file-if-exists` exactly as the web and engine commands do: the
  // Playwright process does not carry the repo's .env.local, and the runner
  // validates its environment fail-closed at boot — so without this it exits
  // instantly and, with stdio ignored, silently. Its output goes to a file for
  // the same reason: a service that dies invisibly is why a correct assertion
  // looked like a broken test.
  const log = openSync(fileURLToPath(new URL("./.finops-runner.log", import.meta.url)), "a");
  const runner = spawn(
    process.execPath,
    ["--env-file-if-exists=../../.env.local", "node_modules/tsx/dist/cli.mjs", "src/index.ts"],
    {
      cwd: fileURLToPath(new URL("../../finops-runner", import.meta.url)),
      env: {
        ...process.env,
        RUNNER_TICK_MS: "1000",
        DATABASE_URL:
          process.env["DATABASE_URL"] ??
          "postgres://desiauction:desiauction@localhost:5433/desiauction",
      },
      detached: true,
      stdio: ["ignore", log, log],
    },
  );
  runner.unref();
  if (runner.pid !== undefined) {
    writeFileSync(RUNNER_PID_FILE, String(runner.pid), "utf8");
  }
}

/**
 * The runner's own budget for picking work up — the same fifteen minutes the
 * money board calls a stalled queue. A job that has been queued longer than
 * this on a developer's machine is not work in progress; it is litter.
 */
const STALE_AFTER_MS = 15 * 60_000;

/**
 * CLEAR THE DEAD QUEUE, OR THE MONEY BOARD IS DEGRADED BEFORE THE SUITE STARTS.
 *
 * `financial-operations.spec.ts` asserts that the Financial Operations health
 * board reads "healthy", and one of its lamps goes amber when this org's oldest
 * queued job has been waiting past the runner's budget. That assertion is
 * correct and the board was telling the truth — the queue really was stalled —
 * but the reason had nothing to do with the product.
 *
 * A local database accumulates an organization per e2e run and never deletes
 * one: 2,098 of them by the time this was written. Each gets its daily
 * `export.daily` and `ops.attest-day` job enqueued, so a single day's scheduling
 * lands ~2,500 jobs sharing one `not_before_ms`. The runner claims ten per tick
 * and takes several seconds a tick, so draining that is twenty minutes of work
 * that nothing ever asks for — and the demo org's own two jobs sat 97th and
 * 2,062nd in claim order. The spec polls for forty seconds. It could not pass,
 * and it had not been passing.
 *
 * So the litter goes before the runner starts. Deliberately NOT a wipe of
 * `finops_jobs`:
 *
 *   QUEUED ONLY — a `done` row is the record that the work happened, and the
 *   follower and the audit surfaces read it.
 *
 *   OLDER THAN THE RUNNER'S OWN BUDGET — anything newer might belong to a suite
 *   running in another worktree against this same database, which is a thing
 *   that happens here. Fifteen minutes is long past the point where a live test
 *   is still waiting on a job.
 *
 * Jobs re-scheduled DURING the run are left alone and are fresh, so they do not
 * trip the stalled check either. The board then reads healthy because the queue
 * genuinely is.
 */
async function purgeStaleJobs(): Promise<void> {
  const url =
    process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";
  /*
   * A DEVELOPER'S MACHINE, AND NOTHING ELSE. Deleting queued work is the right
   * call for litter and the wrong call for a real backlog, so the one case this
   * cannot be allowed to meet is a database that is not local. Skipped loudly
   * rather than silently: a harness step that quietly does nothing is how the
   * missing runner hid for so long.
   */
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.warn("[e2e] not a local database — leaving finops_jobs alone");
    return;
  }
  const handle = createDb(url);
  try {
    const purged = await handle.db
      .delete(finopsJobs)
      .where(
        and(
          eq(finopsJobs.state, "queued"),
          lt(finopsJobs.createdAt, new Date(Date.now() - STALE_AFTER_MS)),
        ),
      )
      .returning({ id: finopsJobs.id });
    if (purged.length > 0) {
      console.log(`[e2e] cleared ${String(purged.length)} stale queued finops jobs`);
    }
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

/** Where the teardown looks for the runner it has to stop. */
export const RUNNER_PID_FILE = fileURLToPath(new URL("./.finops-runner.pid", import.meta.url));

export default async function globalSetup(): Promise<void> {
  const base = "http://localhost:3050";
  // Before the runner, not after: it claims in `not_before_ms` order, so a
  // runner started first spends its opening ticks on the litter this removes.
  await purgeStaleJobs();
  startFinopsRunner();
  await warmRoutes(base);
  await warmSignIn(base);
}
