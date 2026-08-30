import path from "node:path";

import { defineConfig } from "vitest/config";

// Same reason as apps/web/vitest.config.ts: `.env.local` is what the running
// system reads, so the tests have to read it too or they address a different
// database than the one under test.
try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env.local"));
} catch {
  // No .env.local (CI, or a fresh clone) — the fallback below is correct there.
}

export default defineConfig({
  test: {
    // env.ts is fail-closed at import (§11); tests get the local docker-compose
    // URL (non-secret) so modules load. CI overrides with its service container.
    env: {
      DATABASE_URL:
        process.env["DATABASE_URL"] ??
        "postgres://desiauction:desiauction@localhost:5433/desiauction",
    },
  },
});
