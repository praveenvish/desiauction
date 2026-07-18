import * as Sentry from "@sentry/node";

import { checkDb, db } from "./db.js";
import { AuctionEngine } from "./engine-core.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { buildServer } from "./server.js";

if (env.SENTRY_DSN !== undefined) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.APP_VERSION,
    tracesSampleRate: 0.1,
  });
}

// A dead process is safer than a lying one (§28, C-9 single-writer semantics).
async function die(reason: string, error: unknown): Promise<never> {
  logger.fatal({ err: error }, reason);
  await Sentry.flush(2000).catch(() => undefined);
  process.exit(1);
}

process.on("unhandledRejection", (error) => {
  void die("unhandled rejection", error);
});
process.on("uncaughtException", (error) => {
  void die("uncaught exception", error);
});

const engine = new AuctionEngine({
  db,
  logger,
  onSnapshot: (auctionId, serialized, version) => {
    hub.broadcast(auctionId, serialized, version);
  },
});

const { server, hub } = buildServer({
  logger,
  version: env.APP_VERSION,
  checkDb,
  engine,
  engineSecret: env.ENGINE_SECRET,
  nodeEnv: env.NODE_ENV,
});

// The watchdog cadence: 250ms timer authority (lot expiry, closing-soon),
// 10s WS heartbeats, 30s deep verification of every touched auction.
const TICK_MS = 250;
const tickTimer = setInterval(() => {
  const before = Date.now();
  engine.tick();
  const drift = Date.now() - before;
  if (drift > 1_000) {
    logger.warn({ driftMs: drift }, "watchdog tick ran long — possible stall/clock drift");
  }
}, TICK_MS);
const heartbeatTimer = setInterval(() => {
  hub.heartbeat();
}, 10_000);

server.addHook("onClose", (_instance, done) => {
  clearInterval(tickTimer);
  clearInterval(heartbeatTimer);
  done();
});

// PX-11 reliability: graceful shutdown. On a deploy the orchestrator sends
// SIGTERM; without a handler the process is hard-killed after the grace period,
// dropping WebSocket clients abruptly. (The snapshot-recovery model tolerates a
// hard kill — proven by the restart-mid-auction e2e — so this is a clean drain,
// not a correctness fix.) server.close() fires the onClose hook that clears the
// timers; then flush Sentry and exit 0 so the platform records a clean stop.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "shutting down — draining connections");
    void server
      .close()
      .catch((error: unknown) => {
        logger.error({ err: error }, "error during close");
      })
      .finally(() => Sentry.flush(2000).catch(() => undefined))
      .finally(() => {
        process.exit(0);
      });
  });
}

server.listen({ host: "0.0.0.0", port: env.PORT }).catch((error: unknown) => {
  void die("engine failed to bind", error);
});

logger.info({ port: env.PORT }, "auction engine online — single writer, server time only");
