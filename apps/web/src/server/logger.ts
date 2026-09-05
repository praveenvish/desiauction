import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { pino, type Logger } from "pino";

import { env } from "../env";

/**
 * THE WEB TIER HAD NO LOGGER AT ALL.
 *
 * Not "thin logging" — none. Five `console.*` calls in 109,000 lines, three of
 * them in server code (audit PA-1 §20). Every server action, every sign-in,
 * every money mutation and every RLS refusal in the largest of the three
 * services produced no line anywhere, while `docs/56-monitoring.md` claimed
 * "structured pino JSON in all three services". The engine and the runner did;
 * the tier holding auth and the money surfaces did not.
 *
 * The consequence is not lost logs, it is lost incidents: with no DSN and no
 * logs, the first production problem is diagnosed from row counts. Everything
 * else in Phase 4 — and the `no-empty` rule deferred from Phase 0.7, which
 * cannot land until a swallowed error has somewhere to go — depends on this
 * file existing.
 *
 * Deliberately the same shape as `apps/engine/src/logger.ts`: same level
 * variable, same base fields, same redaction, so one aggregator reads all three
 * services identically.
 */

/**
 * DPDP: identity never reaches logs, and neither do credentials.
 *
 * A superset of the engine's list, because this tier handles things the engine
 * never sees — one-time codes, session tokens, invite and demo tokens, and the
 * webhook secrets three routes authenticate with. `*.` covers one level of
 * nesting, which is where these actually appear (`{ err }`, `{ input }`).
 */
const redactPaths = [
  "phone",
  "*.phone",
  "email",
  "*.email",
  "code",
  "*.code",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "password",
  "*.password",
  "apiKey",
  "*.apiKey",
  "signature",
  "*.signature",
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-engine-secret"]',
  'req.headers["x-razorpay-signature"]',
  'req.headers["x-inbound-secret"]',
  'req.headers["x-callback-secret"]',
];

const base = pino({
  level: env.LOG_LEVEL,
  base: { app: "web", env: env.NODE_ENV, version: env.APP_VERSION },
  redact: { paths: redactPaths, censor: "[redacted]" },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

/**
 * The request id, carried without threading it through every signature.
 *
 * Next.js server actions have no request object to hang context on, and passing
 * an id down through read models and writers would touch hundreds of
 * signatures to serve logging alone. `AsyncLocalStorage` keeps it ambient for
 * the duration of one request, which is the one case ambient state is the right
 * answer rather than the lazy one.
 */
const context = new AsyncLocalStorage<{ requestId: string }>();

/**
 * Run one request's work with a correlation id.
 *
 * Prefers an id the edge already assigned — Vercel's `x-vercel-id`, or an
 * `x-request-id` from any proxy — so a line here can be joined to the platform's
 * own record of the same request. Falls back to a fresh UUID.
 */
export function withRequestId<T>(headers: Headers | null, run: () => Promise<T>): Promise<T> {
  const supplied =
    headers?.get("x-request-id") ?? headers?.get("x-vercel-id") ?? headers?.get("x-amzn-trace-id");
  return context.run({ requestId: supplied ?? randomUUID() }, run);
}

/** The current request's id, when there is one. */
export function requestId(): string | undefined {
  return context.getStore()?.requestId;
}

/**
 * The logger, with the current request id attached when one exists.
 *
 * A function rather than a constant because the id is per-request: a module
 * constant would capture whichever request happened to import it first.
 */
export function logger(): Logger {
  const id = requestId();
  return id === undefined ? base : base.child({ requestId: id });
}
