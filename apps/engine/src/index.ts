import * as Sentry from "@sentry/node";

import { checkDb } from "./db.js";
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

const server = buildServer({ logger, version: env.APP_VERSION, checkDb });

server.listen({ host: "0.0.0.0", port: env.PORT }).catch((error: unknown) => {
  void die("engine failed to bind", error);
});
