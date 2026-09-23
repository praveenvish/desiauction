import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_VERSION: z.string().min(1).default("dev"),
  DATABASE_URL: z.string().startsWith("postgres"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  // PRR P1-6: the runner had no error tracking at all — a crash vanished. A
  // missing DSN is a silent no-op, so production REFUSES to boot without one
  // (below), exactly as apps/web does.
  SENTRY_DSN: z.url().optional(),
  /**
   * The web tier's one door out of the production boot checks, mirrored so the
   * local production rehearsal can run a `NODE_ENV=production` runner without a
   * Sentry project. `preflight:production` fails any environment carrying it.
   */
  ALLOW_INSECURE_LOCAL_PRODUCTION: z
    .enum(["1", "true"])
    .optional()
    .transform((value) => value !== undefined),
  /** Tick cadence. Polling is the TRUTH mechanism (ADR-3); short by default. */
  RUNNER_TICK_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  /** The finops artifact + outbox root (IP-6 §22). The runner GENERATES the
   * export artifacts the web tier VERIFIES, so both must resolve the SAME root
   * — `finopsDeps`'s own `os.tmpdir()` default silently gives them different
   * ones and the ops board then reports a permanent, false "exports failed".
   * Deployments set an absolute path (S3-compatible store, IP-6 pre-deploy). */
  FINOPS_STORAGE_DIR: z.string().min(1).default("../../.local/finops-artifacts"),
  /**
   * The shared artifact store (PRR P1-4). The runner WRITES artifacts the web
   * tier reads, so on separate hosts the filesystem store cannot work — both
   * must point at the same S3/MinIO/R2 bucket. Must match the web tier's config.
   */
  FINOPS_ARTIFACT_STORE: z.enum(["filesystem", "bucket"]).default("filesystem"),
  FINOPS_S3_ENDPOINT: z.url().optional(),
  FINOPS_S3_REGION: z.string().min(1).optional(),
  FINOPS_S3_BUCKET: z.string().min(1).optional(),
  FINOPS_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  FINOPS_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
});

/**
 * PRR P1-4 (split-brain guard): the web tier refuses to boot in production on the
 * filesystem store. The runner must fail-closed the SAME way, or an operator who
 * sets the web tier to bucket but forgets the runner leaves the runner writing
 * artifacts to its own disk that the web tier can never read — every export then
 * verifies "unhealthy" forever, silently. Both tiers now require bucket together.
 */
/** A real production process — not a dev run, and not the rehearsal escape. */
function serving(v: z.infer<typeof envSchema>): boolean {
  return v.NODE_ENV === "production" && !v.ALLOW_INSECURE_LOCAL_PRODUCTION;
}

const productionSchema = envSchema
  .refine((v) => v.NODE_ENV !== "production" || v.FINOPS_ARTIFACT_STORE === "bucket", {
    message:
      "FINOPS_ARTIFACT_STORE=filesystem cannot be shared with the web tier on a separate host — set FINOPS_ARTIFACT_STORE=bucket (it must match the web tier)",
    path: ["FINOPS_ARTIFACT_STORE"],
  })
  // The runner is the process nobody watches: no port, no page, no user who
  // notices it stopped. Without a DSN its crash loop is a restart counter and
  // nothing else, so a production runner without one is refused at boot.
  .refine((v) => !serving(v) || (v.SENTRY_DSN !== undefined && v.SENTRY_DSN !== ""), {
    message:
      "SENTRY_DSN must be set in production so runner failures are captured (a missing DSN is silent)",
    path: ["SENTRY_DSN"],
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = productionSchema.safeParse(raw);
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
