import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().startsWith("postgres"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  /** Tick cadence. Polling is the TRUTH mechanism (ADR-3); short by default. */
  RUNNER_TICK_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `finops-runner refused to start — invalid environment (IP-0_DESIGN §11):\n${issues}`,
    );
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
