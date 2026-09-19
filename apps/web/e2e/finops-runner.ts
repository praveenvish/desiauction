import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * HOLD THE FINOPS RUNNER STILL FOR A MOMENT A TEST MUST OBSERVE.
 *
 * globalSetup starts the runner with a one-second tick, and every tick runs the
 * issuance follower. A spec that proves "a captured payment is AWAITING a
 * receipt, then the policy issues it" raced that tick: when it landed between
 * the capture and the Finance page load, the receipt already existed, the
 * awaiting list was empty, and the spec failed looking for it (seen once in CI
 * on #15; its retry passed).
 *
 * SIGSTOP freezes the runner's whole process group (it is spawned detached, as
 * a group leader) and SIGCONT resumes it — no pause switch in product code.
 * The pid file is named for the Playwright main process, which is this
 * worker's parent. Without one (no runner started), the body just runs.
 */
export async function withRunnerHeld<T>(fn: () => Promise<T>): Promise<T> {
  const pidFile = join(
    fileURLToPath(new URL(".", import.meta.url)),
    `.finops-runner.${String(process.ppid)}.pid`,
  );
  const pid = existsSync(pidFile) ? Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10) : NaN;
  if (!Number.isFinite(pid)) {
    return fn();
  }
  process.kill(-pid, "SIGSTOP");
  try {
    return await fn();
  } finally {
    process.kill(-pid, "SIGCONT");
  }
}
