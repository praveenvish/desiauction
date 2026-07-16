import { createDb } from "@desiauction/db";
import { finopsDeps, followAllOrgs, runnerTick } from "@desiauction/financial-operations/server";

import { env } from "./env";
import { logger } from "./logger";

/**
 * THE FINOPS RUNNER (IP-6_ARCHITECTURE §15, ADR-4) — the first new process
 * since the engine, and the platform's ONE home for scheduled work: the
 * follower poll, the daily reconciliation trigger, the year-end trigger, the
 * job queue and its retry orchestration. No operational cron exists inside the
 * web tier, and none inside settlement.
 *
 * The loop is a THIN SHELL: every decision (due times, retries, leases,
 * checklists) is a pure function in @desiauction/financial-operations, and
 * every mutation goes through the one FinOps Writer. Killing this process at
 * any instant loses nothing — leases expire, derived job keys absorb re-fires,
 * cursors resume, and duplicate commands return their original acks.
 *
 * C-16 holds by construction: there is no money path here. This process holds
 * no write path to settlement or auction truth (dependency-cruiser-enforced;
 * hostile-tested at M-IP6-1 certification).
 */

const handle = createDb(env.DATABASE_URL);
const deps = finopsDeps(handle.db);

let stopping = false;

async function tick(): Promise<void> {
  const startedAt = Date.now();
  try {
    const consumed = await followAllOrgs(deps);
    const drained = await runnerTick(deps);
    if (drained.claimed > 0 || consumed > 0) {
      logger.info({ consumed, ...drained, tookMs: Date.now() - startedAt }, "runner.tick");
    }
  } catch (error) {
    // A failed tick is retried on the next one; jobs and cursors carry state.
    logger.error({ err: error }, "runner.tick_failed");
  }
}

async function main(): Promise<void> {
  logger.info({ tickMs: env.RUNNER_TICK_MS }, "finops-runner started");
  while (!stopping) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, env.RUNNER_TICK_MS));
  }
  await handle.sql.end({ timeout: 5 });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    logger.info({ signal }, "finops-runner stopping");
  });
}

void main();
