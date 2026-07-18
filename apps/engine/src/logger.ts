import { pino } from "pino";

import { env } from "./env.js";

// DPDP: identity data never reaches logs; this list grows with IP-2 (§27).
// PX-11 hardening: also censor secrets and one-time codes wherever they might
// surface, plus the engine's own shared-secret header — defence in depth on top
// of `disableRequestLogging` (the engine never auto-logs headers or bodies).
const redactPaths = [
  "phone",
  "*.phone",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "code",
  "*.code",
  "req.headers.authorization",
  'req.headers["x-engine-secret"]',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: "engine", env: env.NODE_ENV, version: env.APP_VERSION },
  redact: { paths: redactPaths, censor: "[redacted]" },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});
