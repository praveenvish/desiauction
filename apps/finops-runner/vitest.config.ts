import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // env.ts is fail-closed at import (§11); tests get the local docker-compose
    // URL (non-secret) so the module loads. Every assertion about the
    // environment parses its OWN object, never this process's. CI overrides
    // the URL with its service container.
    env: {
      DATABASE_URL:
        process.env["DATABASE_URL"] ??
        "postgres://desiauction:desiauction@localhost:5433/desiauction",
    },
  },
});
