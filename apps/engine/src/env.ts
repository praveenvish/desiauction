import { z } from "zod";

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
  return result.data;
}

export const env: Env = parseEnv(process.env);
