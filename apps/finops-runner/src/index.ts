import { resolve } from "node:path";

import { createDb } from "@desiauction/db";
import {
  bucketArtifactStoreFromEnv,
  finopsDeps,
  followAllOrgs,
  runnerTick,
} from "@desiauction/financial-operations/server";
import * as Sentry from "@sentry/node";

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

// PRR P1-6: error tracking + last-resort crash handlers, mirroring the engine.
// The runner ran with neither, so an unhandled rejection or a bad config left
// no signal anywhere; the restart policy would just loop silently.
if (env.SENTRY_DSN !== undefined) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.APP_VERSION,
    tracesSampleRate: 0.1,
  });
}

async function die(reason: string, error: unknown): Promise<never> {
  logger.fatal({ err: error }, reason);
  Sentry.captureException(error);
  await Sentry.flush(2000).catch(() => undefined);
  process.exit(1);
}

process.on("unhandledRejection", (error) => {
  void die("unhandled rejection", error);
});
process.on("uncaughtException", (error) => {
  void die("uncaught exception", error);
});

const handle = createDb(env.DATABASE_URL);
// PRR P1-4: the shared S3 store when configured, so what this process writes the
// web tier can read. Falls back to the filesystem store (same-host / local).
const artifactStore = bucketArtifactStoreFromEnv(env) ?? undefined;
const deps = finopsDeps(handle.db, {
  storageDir: resolve(process.cwd(), env.FINOPS_STORAGE_DIR),
  ...(artifactStore === undefined ? {} : { artifacts: artifactStore }),
});

let stopping = false;

async function tick(): Promise<void> {
  const startedAt = Date.now();
  try {
    const followed = await followAllOrgs(deps);
    /**
     * Report the orgs the follower could not serve, one line each.
     *
     * These used to abort the whole loop, so they were never reported at all —
     * they simply became "every org after this one was skipped", logged as a
     * healthy tick. Now they are isolated, which means the ONLY way anybody
     * learns about a persistently failing org is this line and the Sentry event
     * beside it.
     */
    for (const failure of followed.failures) {
      logger.error({ err: failure.error, orgId: failure.orgId }, "runner.follower_failed");
      Sentry.captureException(failure.error, { tags: { orgId: failure.orgId } });
    }
    const drained = await runnerTick(deps);
    if (drained.claimed > 0 || followed.consumed > 0 || followed.failures.length > 0) {
      logger.info(
        {
          consumed: followed.consumed,
          followerFailures: followed.failures.length,
          ...drained,
          tookMs: Date.now() - startedAt,
        },
        "runner.tick",
      );
    }
  } catch (error) {
    // A failed tick is retried on the next one; jobs and cursors carry state.
    // But a tick that keeps failing is invisible without this — surface it.
    logger.error({ err: error }, "runner.tick_failed");
    Sentry.captureException(error);
  }
}

async function main(): Promise<void> {
  logger.info({ tickMs: env.RUNNER_TICK_MS }, "finops-runner started");
  while (!stopping) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, env.RUNNER_TICK_MS));
  }
  await handle.sql.end({ timeout: 5 });
  await Sentry.flush(2000).catch(() => undefined);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    logger.info({ signal }, "finops-runner stopping");
  });
}

void main();
