import { pino } from "pino";

import { env } from "./env";

// DPDP: identity data never reaches logs (doc 55). The runner logs job/stream
// identifiers and counts only; nothing personal flows through it.
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: "finops-runner", env: env.NODE_ENV },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});
