import path from "node:path";

import { defineConfig } from "vitest/config";

// The regression suites had the same split brain as the Playwright harness:
// `.env.local` is what the app reads, and the tests never loaded it — they went
// straight to the hardcoded fallback below. When the local database moved off
// 5433, every suite failed with `password authentication failed` and the only
// way to run one was to pass DATABASE_URL by hand on the command line.
try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env.local"));
} catch {
  // No .env.local (CI, or a fresh clone) — the fallback below is correct there.
}

export default defineConfig({
  test: {
    // env.ts is fail-closed at import (§11); tests get the local docker-compose
    // URL (non-secret). CI overrides with its service container.
    env: {
      DATABASE_URL:
        process.env["DATABASE_URL"] ??
        "postgres://desiauction:desiauction@localhost:5433/desiauction",
    },
    // POSTURE SUITES ARE NOT PART OF THIS RUN (PA-1R Phase 0.5).
    //
    // They live under `src/` so they can import real handlers by relative path,
    // which puts them in this config's way. They must not run here: this suite
    // connects as the database OWNER, and the whole point of a posture suite is
    // to connect as `desiauction_app`. Run under the owner, an assertion that a
    // tenant row is INVISIBLE trivially fails, and an `it.fails` marking a known
    // grants defect "passes" and so reports as a failure.
    //
    // They have their own config, their own roles and their own CI step:
    //   pnpm --filter @desiauction/web posture:verify
    exclude: ["**/node_modules/**", "**/*.posture.test.ts"],
    // The settlement/finops regression suites drive the SHARED job queue and
    // event streams in the one dev database; parallel test FILES drain each
    // other's jobs and skew injected-clock assertions (PX-4 finding: the
    // delivery suite is green 5/5 in isolation and flaky only under parallel
    // full-suite runs). Integration files therefore run serially.
    fileParallelism: false,
  },
});
