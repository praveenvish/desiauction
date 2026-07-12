import { pino } from "pino";

import { env } from "./env.js";

// DPDP: identity data never reaches logs; this list grows with IP-2 (§27).
const redactPaths = ["phone", "*.phone", "token", "*.token", "req.headers.authorization"];

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: "engine", env: env.NODE_ENV, version: env.APP_VERSION },
  redact: { paths: redactPaths, censor: "[redacted]" },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});
