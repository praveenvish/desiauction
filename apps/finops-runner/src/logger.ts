import { scrub } from "@desiauction/core";
import { pino, stdSerializers } from "pino";

import { env } from "./env";

/**
 * DPDP: identity data never reaches logs (doc 55), and neither do credentials.
 *
 * The runner logs job/stream identifiers and counts by intent — but intent is
 * not a control. It had NO redaction at all, so the first `logger.error({ err,
 * job })` whose payload carried a dispatch recipient would have written a phone
 * number into Loki verbatim. This is the web tier's list
 * (`apps/web/src/server/logger.ts`) so one aggregator reads all three services
 * under one rule — keep them in step — taken one level deeper, because a
 * runner line nests (`{ job: { payload: { phone } } }`) where a web line
 * rarely does.
 */
const SENSITIVE = [
  "phone",
  "email",
  "code",
  "token",
  "secret",
  "password",
  "apiKey",
  "signature",
] as const;
const redactPaths = SENSITIVE.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);

export const logger = pino({
  level: env.LOG_LEVEL,
  // `version` so a line can be tied to the image that wrote it — the web tier
  // has carried it since the logger existed; the runner never did, which made
  // "did the deploy fix it?" a question the logs could not answer.
  base: { app: "finops-runner", env: env.NODE_ENV, version: env.APP_VERSION },
  redact: { paths: redactPaths, censor: "[redacted]" },
  serializers: {
    // Path redaction does nothing for an error MESSAGE, and a constraint
    // violation spells the offending value out in free text
    // (`Key (phone)=(+91…)`). `scrub` is the same pass Sentry's beforeSend
    // runs, so the log and the error tracker cannot disagree.
    err: (error: Error) => scrub(stdSerializers.err(error)),
  },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});
