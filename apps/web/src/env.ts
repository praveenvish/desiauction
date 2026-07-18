import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_VERSION: z.string().min(1).default("dev"),
  DATABASE_URL: z.string().startsWith("postgres"),
  // PRP-1 §1 two-role recipe: DATABASE_URL carries the non-BYPASSRLS app role;
  // the system pool serves ONLY the named pre-tenant token paths (invite
  // preview/accept — ops/db/create-app-role.sql). Unset = same URL (local dev).
  SYSTEM_DATABASE_URL: z.string().startsWith("postgres").optional(),
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
  // OTP delivery (PX-3): "dev" writes to /dev/inbox; "msg91" sends real SMS.
  // Production deploys MUST set msg91 + credentials (beta checklist §B) —
  // the dev sender is structurally invisible outside development.
  OTP_PROVIDER: z.enum(["dev", "msg91"]).default("dev"),
  MSG91_AUTH_KEY: z.string().min(1).optional(),
  MSG91_TEMPLATE_ID: z.string().min(1).optional(),
  // PX-5 SEO: absolute origin for canonical URLs, Open Graph and the sitemap.
  PUBLIC_BASE_URL: z.url().default("http://localhost:3000"),
  // PX-8: the finops artifact + outbox root (IP-6 §22 — everything injected).
  // Web, the runner and the seed MUST agree on one root: `finopsDeps`'s own
  // default is `os.tmpdir()`, and a web tier reading a different root than the
  // runner wrote to reports a FALSE "exports failed" on the ops board forever.
  // Production replaces this with the S3-compatible store (IP-6 freeze §pre-deploy).
  // The default is relative to the PROCESS cwd, and every local process (web,
  // seed, runner) starts one directory deep — so all three land on the same
  // repo-root `.local/finops-artifacts`. Deployments set an absolute path.
  FINOPS_STORAGE_DIR: z.string().min(1).default("../../.local/finops-artifacts"),
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
  // Fail-closed pairing: selecting the real provider without credentials is a
  // misconfiguration, refused at boot rather than discovered at first login.
  if (
    result.data.OTP_PROVIDER === "msg91" &&
    (result.data.MSG91_AUTH_KEY === undefined || result.data.MSG91_TEMPLATE_ID === undefined)
  ) {
    throw new Error(
      "web refused to start — OTP_PROVIDER=msg91 requires MSG91_AUTH_KEY and MSG91_TEMPLATE_ID",
    );
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
