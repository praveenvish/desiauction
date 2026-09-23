import { z } from "zod";

/**
 * Production, and not a declared rehearsal — the web tier's `serving()`.
 * Gates only the checks a local production rehearsal cannot meet.
 */
function serving(value: { NODE_ENV: string; ALLOW_INSECURE_LOCAL_PRODUCTION: boolean }): boolean {
  return value.NODE_ENV === "production" && !value.ALLOW_INSECURE_LOCAL_PRODUCTION;
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().startsWith("postgres"),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
    APP_VERSION: z.string().min(1).default("dev"),
    SENTRY_DSN: z.url().optional(),
    // Shared secret between the web tier and the engine (M-IP4-2 command API +
    // spectate tickets). The dev default never survives to production.
    //
    // The floor was 8 characters, which is guessable by anything that can send
    // 10^14 requests — and there is no throttle on /command. 32 is the width of
    // the HMAC these secrets key; anything shorter weakens the ticket, not just
    // the header. The dev default is refused OUTSIDE development/test, not only
    // in production: a staging box is on the internet too, and this repository
    // is where the default is written down.
    ENGINE_SECRET: z.string().min(8).default("dev-engine-secret"),
    /**
     * Browser origins allowed to open the spectate WebSocket, comma-separated
     * (e.g. "https://desiauction.in,https://www.desiauction.in").
     *
     * A ticket authorises an AUCTION, not a PAGE, so without this any origin
     * could open a socket with a ticket it scraped and keep it open. Unset
     * means "do not check", which is the right default for local dev and for
     * native clients.
     *
     * In PRODUCTION it is mandatory and enforced twice: the refinement below
     * refuses to boot without it, and `preflight:production` fails on it. Both
     * were added after an audit found the doc claiming the preflight checked
     * this when it did not — leaving the one hole the ticket scope exists to
     * close open by default.
     */
    ENGINE_ALLOWED_ORIGINS: z
      .string()
      .optional()
      .transform((value) =>
        value === undefined
          ? []
          : value
              .split(",")
              .map((origin) => origin.trim())
              .filter((origin) => origin !== ""),
      ),
    /** Max concurrent spectate sockets per auction room (DoS ceiling). */
    WS_MAX_SOCKETS_PER_ROOM: z.coerce.number().int().positive().default(2_000),
    /** Max concurrent spectate sockets from one client address (DoS ceiling). */
    WS_MAX_SOCKETS_PER_IP: z.coerce.number().int().positive().default(50),
    /**
     * Proxy hops in front of the engine (Caddy in production = 1). Without it
     * the per-client socket cap keys on the proxy's address — one cap for the
     * whole platform. Same meaning as the web tier's variable.
     */
    TRUSTED_PROXY_COUNT: z.coerce.number().int().min(0).max(10).default(0),
    /**
     * Per-actor command rate limit (token bucket).
     *
     * Sized to stop SUSTAINED abuse — one participant making the event log grow
     * quadratically for the whole room — not to police normal play. A conductor
     * issues a few commands a second at the gavel; a bidder in a frenzy maybe
     * five. Tunable without a deploy because the right number is an operational
     * fact only a real auction night will teach us.
     */
    ENGINE_RATE_BURST: z.coerce.number().int().positive().default(200),
    ENGINE_RATE_REFILL_PER_SEC: z.coerce.number().int().positive().default(50),
    /**
     * The web tier's rehearsal escape, with the same name and the same meaning
     * (apps/web/src/env.ts): a production BUILD run in a non-production
     * CONTEXT. It relaxes only the two checks below that a laptop cannot
     * satisfy — a Sentry project and a proxy in front — and none of the secret
     * or origin checks above, which a rehearsal can and must meet.
     * `pnpm preflight:production` refuses it outright.
     */
    ALLOW_INSECURE_LOCAL_PRODUCTION: z
      .enum(["1", "true"])
      .optional()
      .transform((value) => value !== undefined),
  })
  .refine(
    (value) =>
      value.NODE_ENV === "development" ||
      value.NODE_ENV === "test" ||
      value.ENGINE_SECRET !== "dev-engine-secret",
    {
      message: "ENGINE_SECRET must be set explicitly outside development",
    },
  )
  .refine((value) => value.NODE_ENV !== "production" || value.ENGINE_SECRET.length >= 32, {
    message: "ENGINE_SECRET must be at least 32 characters in production",
  })
  // A ticket authorises an AUCTION, not a PAGE. Without an origin allowlist any
  // page holding a scraped ticket can open a spectate socket, so production must
  // pin the browser origins that may connect — matched by the preflight check.
  .refine((value) => value.NODE_ENV !== "production" || value.ENGINE_ALLOWED_ORIGINS.length > 0, {
    message: "ENGINE_ALLOWED_ORIGINS must list at least one origin in production",
  })
  // PRR P1-6, as the web tier already enforces it: an engine you cannot
  // diagnose is not shippable, and a missing DSN is a silent no-op (go-live
  // gate P1-3). The engine is where a lost auction night would first show up.
  .refine(
    (value) => !serving(value) || (value.SENTRY_DSN !== undefined && value.SENTRY_DSN !== ""),
    {
      message:
        "SENTRY_DSN must be set in production so errors are captured (a missing DSN is silent)",
      path: ["SENTRY_DSN"],
    },
  )
  // Caddy is in front of the engine in production (ops/deploy). With zero
  // trusted hops every socket's client address is Caddy's, so the per-IP cap
  // of WS_MAX_SOCKETS_PER_IP becomes ONE cap for the whole platform: the 51st
  // spectator anywhere is refused (go-live gate P3).
  .refine((value) => !serving(value) || value.TRUSTED_PROXY_COUNT >= 1, {
    message:
      "TRUSTED_PROXY_COUNT must be at least 1 in production — behind Caddy, 0 turns the per-client socket cap into one global cap",
    path: ["TRUSTED_PROXY_COUNT"],
  });

export type Env = z.infer<typeof envSchema>;

/** Exported for tests; the process-level singleton below is what the app uses. */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`engine refused to start — invalid environment (IP-0_DESIGN §11):\n${issues}`);
  }
  if (result.data.ALLOW_INSECURE_LOCAL_PRODUCTION && result.data.NODE_ENV === "production") {
    // As loud as the web tier's: a warning the operator sees whatever the log
    // level hides.
    process.stderr.write(
      "\n!! ALLOW_INSECURE_LOCAL_PRODUCTION is set: this engine is a PRODUCTION build with no\n" +
        "!! error reporting and no trusted proxy. It is a rehearsal server. It must never\n" +
        "!! serve real people.\n\n",
    );
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
