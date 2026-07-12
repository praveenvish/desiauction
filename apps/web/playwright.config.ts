import { defineConfig } from "@playwright/test";

// The E2E harness (IP-0_DESIGN §22): one smoke test in IP-0; the six Golden
// Journeys build on this from IP-3.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
  },
  webServer: {
    command: "pnpm exec next dev --port 3100",
    url: "http://127.0.0.1:3100/healthz",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
