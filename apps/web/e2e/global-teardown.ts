import { existsSync, readFileSync, rmSync } from "node:fs";

import { RUNNER_PID_FILE } from "./global-setup";

/**
 * Stop the finops runner the setup started.
 *
 * It is a `while (!stopping)` poll loop that only exits on SIGINT/SIGTERM, so
 * leaving it behind means a stray process holding a Postgres connection after
 * every run. Killed by process GROUP (negative pid) because it was spawned
 * detached, and tolerantly — a runner that already died is not a failure worth
 * turning a green suite red over.
 */
export default function globalTeardown(): void {
  if (!existsSync(RUNNER_PID_FILE)) {
    return;
  }
  const pid = Number.parseInt(readFileSync(RUNNER_PID_FILE, "utf8").trim(), 10);
  if (Number.isFinite(pid)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Already gone, or never started. Either way there is nothing to stop.
    }
  }
  rmSync(RUNNER_PID_FILE, { force: true });
}
