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
      // So 8192 stays, and it is a WORKAROUND, not a fix. The dev server really
      // does grow past 8GB compiling ~40 routes across a 111-test run. The next
      // move is not another number: it is the pre-compiled server CI already
      // uses (see e2e/README or the `dev/inbox` note), or a real leak hunt.
      env: {
        ...process.env,
        NODE_OPTIONS: "--max-old-space-size=8192",
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
