import { defineConfig } from "@playwright/test";

// The E2E harness (IP-0_DESIGN §22). The webServer loads the repo-root
// .env.local (Next only auto-loads the app-dir one); CI provides env directly.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Local runs share one on-demand `next dev` compiler; more workers overload
  // it into moving 30s timeouts (M-IP2-4 sweep). CI keeps Playwright's default.
  ...(process.env["CI"] ? {} : { workers: 2 }),
  globalSetup: "./e2e/global-setup.ts",
  reporter: [["list"]],
  use: {
    // localhost (not 127.0.0.1): WebAuthn rpID must suffix-match the host.
    baseURL: "http://localhost:3050",
  },
  webServer: {
    command:
      "node --env-file-if-exists=../../.env.local node_modules/next/dist/bin/next dev --port 3050",
    url: "http://127.0.0.1:3050/healthz",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
