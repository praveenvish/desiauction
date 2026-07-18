import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // env.ts is fail-closed at import (§11); tests get the local docker-compose
    // URL (non-secret). CI overrides with its service container.
    env: {
      DATABASE_URL:
        process.env["DATABASE_URL"] ??
        "postgres://desiauction:desiauction@localhost:5433/desiauction",
    },
    // The settlement/finops regression suites drive the SHARED job queue and
    // event streams in the one dev database; parallel test FILES drain each
    // other's jobs and skew injected-clock assertions (PX-4 finding: the
    // delivery suite is green 5/5 in isolation and flaky only under parallel
    // full-suite runs). Integration files therefore run serially.
    fileParallelism: false,
  },
});
