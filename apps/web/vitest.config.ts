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
  },
});
