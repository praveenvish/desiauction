import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// Full-season simulation against an already-running rehearsal server
// (next start on :3000 + engine on :4000). No webServer: we own the servers.
process.loadEnvFile(path.resolve(process.cwd(), "../../.env.local"));

export default defineConfig({
  testDir: "./e2e-sim",
  workers: 1,
  retries: 0,
  timeout: 45 * 60_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env["SIM_BASE"] ?? "http://localhost:3000",
    actionTimeout: 20_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  expect: { timeout: 15_000 },
  outputDir: process.env["SIM_OUT"] ?? "test-results-sim",
});
