import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_VERSION: z.string().min(1).default("dev"),
  DATABASE_URL: z.string().startsWith("postgres"),
  SENTRY_DSN: z.url().optional(),
  // WebAuthn relying party (M-IP2-2). Defaults serve local dev + e2e; deployed
  // environments set real values (rpID must suffix-match the browser host).
  RP_ID: z.string().min(1).default("localhost"),
  RP_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:3050")
    .transform((value) => value.split(",").map((origin) => origin.trim())),
  // The live Auction Engine (M-IP4-2): web submits commands over HTTP with the
  // shared secret; browsers receive snapshots over the engine's WebSocket.
  ENGINE_URL: z.url().default("http://localhost:4000"),
  ENGINE_PUBLIC_WS_URL: z.string().default("ws://localhost:4000/ws"),
  ENGINE_SECRET: z.string().min(8).default("dev-engine-secret"),
});

export type Env = z.infer<typeof envSchema>;

/** Exported for tests and the env:check script; apps import the singleton. */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`web refused to start — invalid environment (IP-0_DESIGN §11):\n${issues}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
