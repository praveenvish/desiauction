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
    ENGINE_SECRET: z.string().min(8).default("dev-engine-secret"),
  })
  .refine(
    (value) => value.NODE_ENV !== "production" || value.ENGINE_SECRET !== "dev-engine-secret",
    {
      message: "ENGINE_SECRET must be set explicitly in production",
    },
  );

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
