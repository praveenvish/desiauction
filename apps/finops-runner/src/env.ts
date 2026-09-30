import { mailerConfigured } from "@desiauction/messaging/mail-provider-config";
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
  /**
   * THE MAILER THAT SENDS RECEIPTS — the same four settings as apps/web/src/env.ts.
   *
   * This process drains `dispatch.send`, so it is the tier that actually emails
   * a receipt, invoice or correction. It used to read none of these and ran the
   * platform's filesystem outbox in production: every document was "delivered"
   * to a `.txt` file on the runner's disk and nobody received one.
   *
   *   · auto — the real mailer when configured, the file outbox when not.
   *   · ses  — Amazon SES (SES_*), and boot is refused without its settings.
   *   · zeptomail — ZeptoMail / Zoho CPaaS (ZEPTOMAIL_*), likewise.
   *   · resend / http — Resend (EMAIL_API_*), likewise refused half-set.
   *   · dev  — the file outbox even with credentials (a local suite whose
   *            .env.local carries live keys must not mail test addresses).
   *
   * Production refuses `dev` and refuses a missing setting (below). The values
   * must match the web tier's: its provider callback route confirms what this
   * process sent.
   */
  EMAIL_PROVIDER: z.enum(["auto", "dev", "http", "resend", "ses", "zeptomail"]).default("auto"),
  EMAIL_API_ENDPOINT: z.url().optional(),
  EMAIL_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  /**
   * The site's address, for the logo and links in a receipt's branded part
   * (email programme PR10). Production's by default — the runner needs no new
   * setting to send it; a staging runner points at its own host.
   */
  PUBLIC_BASE_URL: z.url().default("https://desiauction.in"),
  // Amazon SES — the same values as web.env (docs/EMAIL_INFRASTRUCTURE.md).
  SES_REGION: z
    .string()
    .regex(/^[a-z]{2}(-[a-z]+)+-\d$/, "an AWS region such as ap-south-1")
    .optional(),
  SES_ACCESS_KEY_ID: z.string().min(16).optional(),
  SES_SECRET_ACCESS_KEY: z.string().min(20).optional(),
  SES_CONFIGURATION_SET: z.string().min(1).optional(),
  SES_FEEDBACK_ADDRESS: z.email().optional(),
  // ZeptoMail — the same values as web.env (docs/EMAIL_INFRASTRUCTURE.md).
  ZEPTOMAIL_API_KEY: z.string().min(16).optional(),
  ZEPTOMAIL_ENDPOINT: z.url().optional(),
});

/**
 * A real mailer is selected — what "configured" means in both tiers
 * (mail-provider-config.ts). `dev` is never configured.
 */
export function mailConfigured(v: Parameters<typeof mailerConfigured>[0]): boolean {
  return mailerConfigured(v);
}

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
  })
  // Asked for the real mailer and not given one: in any environment that is a
  // misconfiguration, not a reason to fall back to writing files.
  .refine((v) => v.EMAIL_PROVIDER !== "http" || mailConfigured(v), {
    message: "EMAIL_PROVIDER=http needs EMAIL_API_ENDPOINT, EMAIL_API_KEY and EMAIL_FROM",
    path: ["EMAIL_PROVIDER"],
  })
  .refine((v) => v.EMAIL_PROVIDER !== "resend" || mailConfigured(v), {
    message: "EMAIL_PROVIDER=resend needs EMAIL_API_ENDPOINT, EMAIL_API_KEY and EMAIL_FROM",
    path: ["EMAIL_PROVIDER"],
  })
  .refine((v) => v.EMAIL_PROVIDER !== "ses" || mailConfigured(v), {
    message:
      "EMAIL_PROVIDER=ses needs SES_REGION, SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY and EMAIL_FROM",
    path: ["EMAIL_PROVIDER"],
  })
  .refine((v) => v.EMAIL_PROVIDER !== "zeptomail" || mailConfigured(v), {
    message: "EMAIL_PROVIDER=zeptomail needs ZEPTOMAIL_API_KEY and EMAIL_FROM",
    path: ["EMAIL_PROVIDER"],
  })
  // THE FILE OUTBOX IS NOT A PRODUCTION CHANNEL. Without this a production
  // runner boots, drains every dispatch, records each as delivered and writes
  // it to its own disk — the defect this refinement exists to make impossible.
  // The rehearsal escape keeps serving() false, exactly as for SENTRY_DSN.
  .refine((v) => !serving(v) || mailConfigured(v), {
    message:
      "receipts need a configured mailer in production (EMAIL_PROVIDER=zeptomail with ZEPTOMAIL_API_KEY, ses with SES_*, or resend with EMAIL_API_ENDPOINT and EMAIL_API_KEY — each with EMAIL_FROM; not dev) — otherwise every financial document is written to a file on the runner's disk instead of being emailed",
    path: ["EMAIL_PROVIDER"],
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
