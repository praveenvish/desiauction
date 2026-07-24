import { defineConfig } from "@playwright/test";

// The E2E harness (IP-0_DESIGN §22). The webServer loads the repo-root
// .env.local (Next only auto-loads the app-dir one); CI provides env directly.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Local runs share one on-demand `next dev` compiler; more workers overload
  // it into moving 30s timeouts (M-IP2-4 sweep). At PX-5 the suite crossed 70
  // tests and even 2 workers rotate long-journey flakes (compiler + shared-DB
  // contention); single-worker runs are ~6 min and fully deterministic.
  // CI keeps Playwright's default (pre-compiled service containers).
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
  reporter: [["list"]],
  use: {
    // localhost (not 127.0.0.1): WebAuthn rpID must suffix-match the host.
    baseURL: "http://localhost:3050",
  },
  webServer: [
    {
      command:
        "node --env-file-if-exists=../../.env.local node_modules/next/dist/bin/next dev --port 3050",
      url: "http://127.0.0.1:3050/healthz",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      // Raise the dev-server heap ceiling: across the full 25-spec suite the
      // default heap fills and Next restarts the worker mid-test ("approaching
      // memory threshold, restarting"), which ECONNRESETs in-flight requests and
      // cascades into failures/flakes. A larger heap keeps one stable server for
      // the whole run. (CI uses a pre-compiled server and is unaffected.)
      env: {
        ...process.env,
        NODE_OPTIONS: "--max-old-space-size=4096",
        // Its OWN build directory: sharing .next with a developer's server on
        // :3000 corrupts the webpack pack cache for both.
        NEXT_DIST_DIR: ".next-e2e",
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
