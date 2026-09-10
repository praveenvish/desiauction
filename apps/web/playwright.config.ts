import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * THE HALF OF THE SUITE THAT NEVER READ .env.local.
 *
 * The webServer command below loads the repo-root `.env.local` explicitly
 * (`--env-file-if-exists`), and for a long time that looked like enough. It is
 * not: the TEST processes are a different process tree, and they never loaded
 * it. `e2e/otp.ts`, `e2e/global-setup.ts` and `e2e/demo-availability.ts` each
 * fall back to a hardcoded `localhost:5433` when `DATABASE_URL` is unset — so
 * the app under test talked to the database in `.env.local` while the tests
 * talked to whatever happened to be answering on 5433.
 *
 * On a machine where another project had taken 5433, that was a FOREIGN
 * DATABASE, and every spec died in under two seconds with `password
 * authentication failed for user "desiauction"` — which reads like a broken
 * credential and is actually a split-brain harness. Loading it here, before the
 * config is built, makes `.env.local` the one local source of truth for both
 * halves; the hardcoded fallbacks stay as the correct default for a fresh
 * clone and for CI, which sets DATABASE_URL itself.
 */
try {
  // `__dirname` under Playwright's transpiled config; cwd is the honest
  // fallback if that ever changes. Missing file is not an error — CI has none.
  const here = typeof __dirname === "string" ? __dirname : process.cwd();
  process.loadEnvFile(path.resolve(here, "../../.env.local"));
} catch {
  // No .env.local (CI, or a clone that has not made one). The fallbacks apply.
}

// The E2E harness (IP-0_DESIGN §22). The webServer loads the repo-root
// .env.local (Next only auto-loads the app-dir one); CI provides env directly.
//
// PLAYWRIGHT_PRECOMPILED=1 swaps `next dev` for a `next build` + `next start`
// server. This is the actual fix for the memory-threshold restarts documented
// below — a comment here used to say "CI keeps Playwright's default
// (pre-compiled service containers)", which was never true: there is no e2e
// step in CI at all, so nothing has ever run this suite against a compiled
// server. That claim is retracted; this flag is what makes it possible to.
//
// Run it with:
//   cd apps/web
//   NEXT_DIST_DIR=.next-e2e node --env-file-if-exists=../../.env.local \
//     node_modules/next/dist/bin/next build
//   PLAYWRIGHT_PRECOMPILED=1 pnpm exec playwright test
//
// The server half needs `ALLOW_INSECURE_LOCAL_PRODUCTION=1`, which the
// webServer env below now sets for you — see the comment there.
//
// The env file on the BUILD line is load-bearing and was missing from this
// comment (PA-1R Phase 8.2). `pnpm exec next build` skips the package script,
// so nothing loads `.env.local`, and the build dies collecting page data for
// the OG-image and robots routes with "DATABASE_URL: Invalid input" — the env
// guard doing exactly its job. Piped into `tail`, that failure exits 0, and the
// suite then fails at startup with "Could not find a production build", which
// reads like a Playwright problem two steps from its cause.
//
// CI has never had either problem: its e2e job supplies DATABASE_URL,
// NEXT_DIST_DIR and ALLOW_INSECURE_LOCAL_PRODUCTION as JOB-level env, so every
// step inherits them. This is the LOCAL path catching up with the one that
// already worked.
//
// Requires OTP_PROVIDER=dev in the environment (or .env.local) so sign-in
// still writes codes to otp_inbox for `e2e/otp.ts` to read — nothing here
// depends on the dev-only `/dev/inbox` PAGE, only on the DEV OTP PROVIDER,
// which is an independent setting from NODE_ENV.
const PRECOMPILED = process.env["PLAYWRIGHT_PRECOMPILED"] === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Local runs share one on-demand `next dev` compiler; more workers overload
  // it into moving 30s timeouts (M-IP2-4 sweep). At PX-5 the suite crossed 70
  // tests and even 2 workers rotate long-journey flakes (compiler + shared-DB
  // contention); single-worker runs are ~6 min and fully deterministic. A
  // precompiled server has no shared-compiler contention, so it is not held to
  // the same single-worker discipline — but nothing here raises workers for it
  // yet; that is a separate, measured change once the precompiled path itself
  // is proven stable.
  ...(process.env["CI"] ? {} : { workers: 1 }),
  // One retry absorbs first-hit dev-compile latency under parallel load (a fresh
  // retry hits an already-warm server). Not a mask for logic flakes — every spec
  // passes in isolation; this only covers the shared-compiler jitter (M-IP3-2).
  retries: 1,
  // PX-4: the suite grew past 60 tests and the PX-2 shell adds navigation reads
  // to every authenticated SSR; long multi-actor journeys now brush Playwright's
  // 30s default under the shared dev compiler. Same jitter class as above.
  timeout: 60_000,
  globalSetup: "./e2e/global-setup.ts",
  // Stops the finops runner that globalSetup starts (see its comment).
  globalTeardown: "./e2e/global-teardown.ts",
  reporter: [["list"]],
  use: {
    // localhost (not 127.0.0.1): WebAuthn rpID must suffix-match the host.
    baseURL: "http://localhost:3050",
  },
  /*
   * TWO ENGINES, AND UNTIL NOW THERE WERE NONE DECLARED AT ALL.
   *
   * With no `projects` block Playwright runs one unnamed default project, so
   * 135 tests had only ever run on Chromium — `KNOWN_LIMITATIONS.md` lists real
   * cross-browser as an open verification gap, and for a mobile-first product
   * aimed at India, Safari had never been exercised once.
   *
   * The first WebKit run was 95 passed / 6 failed with ZERO product defects:
   * five were harness races Chromium wins by luck (a `goto` issued into an
   * in-flight client navigation; a `loading={busy}` button clicked twice), one
   * was Apple's own Tab default, one was Chromium-only WebAuthn. All seven are
   * fixed or scoped at their source, so WebKit is now green.
   *
   * WEBKIT IS OPT-IN, and deliberately: it doubles a ~5-minute run, and the
   * defects it catches are timing and layout ones that do not appear per
   * commit. `nightly-verify.yml` sets `E2E_WEBKIT=1` so it runs every night
   * against the compiled server; locally, `E2E_WEBKIT=1 pnpm exec playwright
   * test` or `--project=webkit`.
   *
   * Firefox is installed and unexercised. Adding it is one more entry here
   * once somebody has run it and read the failures — not before, because an
   * engine nobody has looked at is a red suite waiting to be ignored.
   */
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(process.env["E2E_WEBKIT"] === "1"
      ? [
          {
            name: "webkit",
            use: { ...devices["Desktop Safari"] },
            /*
             * MORE PATIENCE, NOT DIFFERENT ASSERTIONS.
             *
             * WebKit is meaningfully slower than Chromium here — same machine,
             * same single worker, same compiled server — and a run of specs
             * written against Playwright's 5s default produces failures that
             * are scheduling rather than defects. Raising the wait for THIS
             * project only keeps every assertion identical across engines and
             * avoids sprinkling per-line timeouts into shared specs, which
             * would weaken them for Chromium too.
             *
             * Still bounded, and deliberately: 15s surfaces a genuine
             * WebKit-only hang, it just does not punish a slow paint.
             */
            expect: { timeout: 15_000 },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: PRECOMPILED
        ? // The actual fix. `next start` serves what `next build` already
          // compiled — there is no on-demand compiler to blow the heap, so the
          // whole class of memory-threshold restarts below does not apply.
          // Requires a build to already exist at NEXT_DIST_DIR=.next-e2e (see
          // the flag's doc comment above); this config does not build it,
          // because a webServer command's own timeout is far too short for a
          // full production build and doing it here would hide that cost from
          // whoever is running the suite.
          "node --env-file-if-exists=../../.env.local node_modules/next/dist/bin/next start --port 3050"
        : "node --env-file-if-exists=../../.env.local node_modules/next/dist/bin/next dev --port 3050",
      url: "http://127.0.0.1:3050/healthz",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      // The dev-server heap ceiling, and it went the WRONG WAY twice.
      //
      // It was raised 4096 -> 8192 chasing "Server is approaching the used
      // memory threshold, restarting". Each restart drops in-flight requests,
      // which surfaces as ECONNRESET and a form stuck mid-submit — and reads
      // exactly like an application bug. Seven restarts were observed in one
      // run at 8192.
      //
      // LOWERING IT WAS TRIED AND IS WORSE. 3072 was measured against 8192 on
      // this machine: 8192 gave 7 restarts with tests progressing, 3072 gave 10
      // restarts with nothing passing at all. V8 simply hits a lower ceiling
      // sooner. The idea that a smaller heap would make GC keep up does not
      // survive contact with the numbers, and the measurement is recorded here
      // so nobody spends another afternoon on it.
      //
      // This ceiling only matters for `next dev`, whose on-demand compiler is
      // what grows the heap in the first place — PLAYWRIGHT_PRECOMPILED=1
      // above is the real fix. 8192 stays as the default path's workaround.
      env: {
        ...process.env,
        NODE_OPTIONS: "--max-old-space-size=8192",
        // Its OWN build directory: sharing .next with a developer's server on
        // :3000 corrupts the webpack pack cache for both.
        NEXT_DIST_DIR: ".next-e2e",
        // `next start` boots with NODE_ENV=production, so apps/web's env guard
        // applies its PRODUCTION refinements and refuses to start on twelve of
        // them at once — a localhost PUBLIC_BASE_URL, OTP_PROVIDER=dev, no
        // SENTRY_DSN, and so on. All twelve are correct refusals for a real
        // deploy and none of them is true of a local suite. This is the one
        // named escape hatch for exactly that case (PRODUCTION_CHECKLIST §8):
        // it prints a three-line warning to stderr, is reported by /readyz, and
        // `preflight:production` refuses a deploy that has it set, so it cannot
        // leak into production from here.
        //
        // It lives in the config rather than the doc comment because forgetting
        // it fails 60 seconds later as "Timed out waiting for config.webServer"
        // with the twelve real reasons scrolled off the top (PA-1R Phase 8.2).
        // CI already sets it as job env; spreading process.env first means CI's
        // value wins and this only fills the gap for a local run.
        ...(PRECOMPILED ? { ALLOW_INSECURE_LOCAL_PRODUCTION: "1" } : {}),
      },
    },
    {
      // The live auction engine (M-IP4-2): the same process `pnpm dev` runs.
      command:
        "node --env-file-if-exists=../../.env.local node_modules/tsx/dist/cli.mjs src/index.ts",
      cwd: "../engine",
      url: "http://127.0.0.1:4000/healthz",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
    },
  ],
});
