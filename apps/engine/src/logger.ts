import { scrubError } from "@desiauction/core";
import { pino, stdSerializers } from "pino";

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
  serializers: {
    // Path redaction does nothing for an error's free text, and a constraint
    // violation spells the value out (`Key (phone)=(+91…)`). The runner has
    // scrubbed its errors since PA-1; this logger and the web tier's did not.
    // `errorCode` survives, because `*.code` above censors the one field that
    // says what actually failed (core/scrub.ts).
    err: (error: Error) => scrubError(stdSerializers.err(error)),
  },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});
