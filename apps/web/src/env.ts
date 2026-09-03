import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_VERSION: z.string().min(1).default("dev"),
  DATABASE_URL: z.string().startsWith("postgres"),
  // PRP-1 §1 two-role recipe: DATABASE_URL carries the non-BYPASSRLS app role;
  // the system pool serves ONLY the named pre-tenant token paths (invite
  // preview/accept — ops/db/create-app-role.sql). Unset = same URL (local dev).
  SYSTEM_DATABASE_URL: z.string().startsWith("postgres").optional(),
  /**
   * Sockets per pool, per process. Unset keeps the driver default (10) — and on
   * a fleet of warm serverless instances that default is multiplied by the
   * instance count AND by the two pools each one opens, which is how a healthy
   * database ends up refusing every connection at `max_connections` while the
   * web tier 500s. Whoever sizes the fleet sizes this.
   */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).optional(),
  /**
   * How many trusted reverse proxies sit in front of this app (PRR P2/F32). It
   * decides which `x-forwarded-for` entry is the real client IP for per-IP
   * throttles; the entries to the left of it are client-supplied and spoofable.
   * 0 (the default) trusts no XFF entry — correct for local/direct. Behind a
   * single Vercel/Fly ingress, set 1.
   */
  TRUSTED_PROXY_COUNT: z.coerce.number().int().min(0).max(10).default(0),
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
  /**
   * The OTP flow's DLT template id, and ONLY the OTP flow's. Its registered
   * text has a code slot; it cannot carry a sentence.
   *
   * It used to be reused for all five registration decision notices, which is
   * both a DLT mismatch — the regime registers one template per message shape —
   * and the reason a decision SMS would have arrived as a mangled OTP. Each
   * decision shape now has its own variable below.
   */
  MSG91_TEMPLATE_ID: z.string().min(1).optional(),
  /**
   * One registered DLT template id per message shape. Optional individually:
   * a shape with no id refuses to send and names the missing variable, which is
   * far better than sending against somebody else's registration. The names
   * are declared on each template in server/messaging/templates.ts and must
   * stay in step with it — a test holds that.
   */
  MSG91_TEMPLATE_REGISTRATION_APPROVED: z.string().min(1).optional(),
  MSG91_TEMPLATE_REGISTRATION_WAITLISTED: z.string().min(1).optional(),
  MSG91_TEMPLATE_REGISTRATION_REJECTED: z.string().min(1).optional(),
  MSG91_TEMPLATE_REGISTRATION_WITHDRAWN: z.string().min(1).optional(),
  MSG91_TEMPLATE_REGISTRATION_RESTORED: z.string().min(1).optional(),
  /**
   * The notice sent to the OUTGOING number when somebody changes the mobile on
   * their account. Unregistered means the change still happens and the old
   * number is never told — so this one is worth registering before launch even
   * though nothing refuses to start without it.
   */
  MSG91_TEMPLATE_SECURITY_PHONE_CHANGED: z.string().min(1).optional(),
  /**
   * Shared secret on the inbound-SMS webhook, which is where a STOP lands.
   *
   * Unset means the endpoint is CLOSED (404), never open. A webhook that
   * accepts anything when it is misconfigured is worse than one that never
   * accepts: the failure is silent and the suppression list fills with
   * forgeries. Long, random, and set out of band on the operator's console.
   */
  SMS_INBOUND_SECRET: z.string().min(16).optional(),
  /**
   * Email over the provider's HTTP API. All three must be set together or the
   * platform keeps the filesystem outbox — a half-configured mailer that
   * silently drops documents is worse than one that visibly writes files.
   *
   * Any provider with an HTTP send endpoint works (SES, Postmark, Resend,
   * Brevo, MSG91). The request shape is the intersection of all of them; a
   * provider needing a different body overrides `buildRequest` at the call
   * site rather than forking the adapter.
   */
  EMAIL_API_ENDPOINT: z.url().optional(),
  EMAIL_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  /**
   * Where a human reply goes. The From address is a no-reply on the sending
   * subdomain, which nobody reads; without this a club organiser hitting
   * Reply on a registration receipt is talking to a wall. Optional, and
   * deliberately NOT one of the three settings that decide whether a
   * provider counts as configured.
   */
  EMAIL_REPLY_TO: z.email().optional(),
  /**
   * Shared secret on the provider delivery-report webhook. Unset closes the
   * endpoint with a 404 — an open callback would let a stranger mark documents
   * delivered, which is worse than never learning they were.
   */
  DELIVERY_CALLBACK_SECRET: z.string().min(16).optional(),
  /**
   * DEMO-1 reminders. The web tier holds NO scheduler — the finops runner is
   * the platform's one home for scheduled work, and demo reminders have no
   * business inside a certified money process. So the sweep is an ENDPOINT that
   * a scheduler calls, not a loop that runs itself.
   *
   * Unset closes it with a 404, the same fail-closed posture as the delivery
   * and SMS callbacks: an open sweep endpoint would let a stranger burn through
   * every pending reminder at once.
   */
  DEMO_JOB_SECRET: z.string().min(16).optional(),
  /**
   * Shared secret on the settlement catch-up sweep (PRR P1-3), the same
   * fail-closed door pattern as DEMO_JOB_SECRET. The sweep re-derives any
   * journal effect lost in a crash between a case commit and its coordination —
   * the repair the money system documents but had no scheduled caller for.
   * Unset closes the endpoint with a 404; an open sweep would let a stranger
   * drive settlement writes. A scheduler calls it; nothing schedules itself,
   * and the certified finops runner stays out of the settlement write path.
   */
  SETTLEMENT_JOB_SECRET: z.string().min(16).optional(),
  /**
   * The key demo booking links are DERIVED from (HMAC over the request id).
   *
   * A random token would be unrecoverable once hashed, which the reminder sweep
   * needs — it has to rebuild a person's manage link a day later, and a
   * plaintext token in the database would give a leaked backup working links to
   * every booking. Deriving them keeps that property (the key lives in the
   * environment, not the table) and makes the link reproducible.
   *
   * It has a development default like `ENGINE_SECRET`, and like `ENGINE_SECRET`
   * that default is refused when actually serving — see the refinements below.
   */
  DEMO_TOKEN_SECRET: z.string().min(8).default("dev-demo-token-secret"),
  /**
   * Razorpay. All three together or the gateway is simply absent and every
   * payment stays on the manual adapters — a half-configured gateway that
   * accepts orders it cannot reconcile is worse than no gateway.
   *
   * The webhook secret is what makes `/api/webhooks/razorpay` exist at all:
   * unset means the route 404s rather than accepting unverifiable callbacks
   * (the same fail-closed posture as the SMS and delivery webhooks).
   */
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(16).optional(),
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
  /**
   * The finops artifact store (PRR P1-4). "filesystem" (default) writes to
   * FINOPS_STORAGE_DIR — correct locally, WRONG across the deployed two-machine
   * topology where web and the runner have separate disks. "bucket" is the
   * shared S3/MinIO/R2 store both tiers read, and is required in production (a
   * refinement below refuses the local default when serving, like MEDIA_STORAGE).
   */
  FINOPS_ARTIFACT_STORE: z.enum(["filesystem", "bucket"]).default("filesystem"),
  FINOPS_S3_ENDPOINT: z.url().optional(),
  FINOPS_S3_REGION: z.string().min(1).optional(),
  FINOPS_S3_BUCKET: z.string().min(1).optional(),
  FINOPS_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  FINOPS_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // Player/team media (parity §3.1). "local" writes under public/_media and is
  // DEV/e2e ONLY (a built server does not serve runtime-written public files —
  // ARCHITECTURE R4); production sets "bucket" + an S3/R2 public base (D1).
  MEDIA_STORAGE: z.enum(["local", "bucket"]).default("local"),
  MEDIA_PUBLIC_BASE: z.url().optional(),
  // PI-1 P5 (D1 closed): the media bucket's own credential set, named like
  // FINOPS_S3_* because they are the same kind of thing and may not be the
  // same bucket — player photos are public-readable behind MEDIA_PUBLIC_BASE,
  // finops artifacts are not.
  MEDIA_S3_ENDPOINT: z.url().optional(),
  MEDIA_S3_REGION: z.string().min(1).optional(),
  MEDIA_S3_BUCKET: z.string().min(1).optional(),
  MEDIA_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  MEDIA_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /**
   * Next's own build/serve phase, read only so the checks below can tell the
   * two apart. `next build` runs with NODE_ENV=production but none of the
   * deployment's real variables — that is the whole point of a build artefact —
   * so refusing there would make the app impossible to compile.
   */
  NEXT_PHASE: z.string().optional(),
  /**
   * THE ONE DOOR OUT OF THE PRODUCTION CHECKS BELOW, AND IT IS LOUD.
   *
   * PRODUCTION_CHECKLIST §8 makes a "local production rehearsal — all three
   * services in prod posture" a release gate, and that rehearsal necessarily
   * runs the DEV adapters: there is no local SMS provider and no local bucket.
   * Without an explicit escape the boot checks would make the repo's own gate
   * unrunnable, and the pressure would go into weakening the checks instead.
   *
   * So: one variable, named for what it actually does, never set by any script
   * or default, echoed at boot on stderr, reported by /readyz, and refused
   * outright by `pnpm preflight:production`. An operator who sets this on a
   * real deployment has to have typed the word "insecure" and then ignored
   * three separate places that say so.
   */
  ALLOW_INSECURE_LOCAL_PRODUCTION: z
    .enum(["1", "true"])
    .optional()
    .transform((value) => value !== undefined),
  /**
   * DEPLOY-TIME KILL SWITCH for "My plan" (WR-1), the owner's private auction
   * plan. Unset = on. Set to `1` to make the plan page 404, the live card
   * vanish and every plan write refuse, everywhere, without a migration or a
   * database row. The per-auction and per-org switches live in
   * `feature_settings`; this is the layer above them (`resolveFeature`).
   */
  MY_PLAN_DISABLED: z
    .enum(["1", "true"])
    .optional()
    .transform((value) => value !== undefined),
});

/**
 * THE DEFAULTS ABOVE ARE LOCAL DEFAULTS, AND THE WEB TIER NEVER SAID SO.
 *
 * `apps/engine/src/env.ts` refuses to boot in production with the dev engine
 * secret. This file had no production refinement of any kind — one cross-field
 * pairing check and nothing else — so a production web tier would start,
 * report healthy, serve traffic and be fundamentally broken in five separate
 * ways, each of them silent:
 *
 *   · OTP_PROVIDER=dev      — codes go to a database table, no SMS is sent, and
 *                             /dev/inbox 404s in a production build. Nobody can
 *                             log in, including the founder.
 *   · MEDIA_STORAGE=local   — uploads are written to the app host's public/
 *                             directory, which a built server does not serve and
 *                             which a redeploy discards. Every player photo is
 *                             lost. (Its own comment already says DEV/e2e ONLY.)
 *   · ENGINE_SECRET default — a published constant used to authenticate every
 *                             conduct command to the engine.
 *   · PUBLIC_BASE_URL       — every canonical URL, OG card, sitemap entry and
 *                             shared registration link points at localhost.
 *   · RP_ID / RP_ORIGINS    — passkeys silently fail against a real hostname.
 *
 * `pnpm preflight:production` checks most of this, but it is a separate script
 * a human has to remember; the boot check is the one that cannot be skipped.
 * These refinements are that, and they are deliberately narrow: they fire only
 * when NODE_ENV is production, and each one names the variable to set.
 */
/** Production, and actually about to serve traffic — not `next build`. */
function serving(v: z.infer<typeof envSchema>): boolean {
  return (
    v.NODE_ENV === "production" &&
    v.NEXT_PHASE !== "phase-production-build" &&
    !v.ALLOW_INSECURE_LOCAL_PRODUCTION
  );
}

const productionSchema = envSchema
  // PRR P1-1: the two-role recipe must be in effect in production. Unset
  // SYSTEM_DATABASE_URL aliases the app pool (server/db.ts), so the ~130
  // RLS-exempt system reads would run under the app role and fail; an equal URL
  // means one role does both jobs and the isolation boundary is fictional. The
  // app-role NOBYPASSRLS property itself is proven at boot by assertTenantIsolation.
  .refine((v) => !serving(v) || v.SYSTEM_DATABASE_URL !== undefined, {
    message:
      "SYSTEM_DATABASE_URL must be set in production — unset aliases the app pool and collapses the two-role recipe",
    path: ["SYSTEM_DATABASE_URL"],
  })
  .refine((v) => !serving(v) || v.SYSTEM_DATABASE_URL !== v.DATABASE_URL, {
    message:
      "SYSTEM_DATABASE_URL must be a DIFFERENT role from DATABASE_URL (app = NOBYPASSRLS, system = BYPASSRLS)",
    path: ["SYSTEM_DATABASE_URL"],
  })
  .refine((v) => !serving(v) || v.OTP_PROVIDER !== "dev", {
    message:
      "OTP_PROVIDER=dev writes codes to a table nobody can read in production — set OTP_PROVIDER=msg91 with credentials",
    path: ["OTP_PROVIDER"],
  })
  .refine((v) => !serving(v) || v.MEDIA_STORAGE === "bucket", {
    message:
      "MEDIA_STORAGE=local writes uploads to the app host and a built server does not serve them — set MEDIA_STORAGE=bucket",
    path: ["MEDIA_STORAGE"],
  })
  .refine((v) => !serving(v) || v.MEDIA_STORAGE !== "bucket" || v.MEDIA_PUBLIC_BASE !== undefined, {
    message:
      "MEDIA_STORAGE=bucket needs MEDIA_PUBLIC_BASE — the public origin uploads are read from",
    path: ["MEDIA_PUBLIC_BASE"],
  })
  // PRR P1-4: the filesystem artifact store cannot span web + runner on separate
  // hosts, so exports would verify "unhealthy" forever. Production must use the
  // shared bucket store.
  .refine(
    (v) =>
      v.MEDIA_STORAGE !== "bucket" ||
      (v.MEDIA_S3_ENDPOINT !== undefined &&
        v.MEDIA_S3_REGION !== undefined &&
        v.MEDIA_S3_BUCKET !== undefined &&
        v.MEDIA_S3_ACCESS_KEY_ID !== undefined &&
        v.MEDIA_S3_SECRET_ACCESS_KEY !== undefined),
    {
      message:
        "MEDIA_STORAGE=bucket needs MEDIA_S3_ENDPOINT, MEDIA_S3_REGION, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID and MEDIA_S3_SECRET_ACCESS_KEY",
      path: ["MEDIA_STORAGE"],
    },
  )
  .refine((v) => !serving(v) || v.FINOPS_ARTIFACT_STORE === "bucket", {
    message:
      "FINOPS_ARTIFACT_STORE=filesystem cannot be shared between web and the runner on separate hosts — set FINOPS_ARTIFACT_STORE=bucket",
    path: ["FINOPS_ARTIFACT_STORE"],
  })
  .refine(
    (v) =>
      v.FINOPS_ARTIFACT_STORE !== "bucket" ||
      (v.FINOPS_S3_ENDPOINT !== undefined &&
        v.FINOPS_S3_REGION !== undefined &&
        v.FINOPS_S3_BUCKET !== undefined &&
        v.FINOPS_S3_ACCESS_KEY_ID !== undefined &&
        v.FINOPS_S3_SECRET_ACCESS_KEY !== undefined),
    {
      message:
        "FINOPS_ARTIFACT_STORE=bucket needs FINOPS_S3_ENDPOINT, FINOPS_S3_REGION, FINOPS_S3_BUCKET, FINOPS_S3_ACCESS_KEY_ID and FINOPS_S3_SECRET_ACCESS_KEY",
      path: ["FINOPS_ARTIFACT_STORE"],
    },
  )
  .refine((v) => !serving(v) || v.ENGINE_SECRET !== "dev-engine-secret", {
    message:
      "ENGINE_SECRET must be set explicitly in production (the engine refuses this value too)",
    path: ["ENGINE_SECRET"],
  })
  .refine((v) => !serving(v) || v.DEMO_TOKEN_SECRET !== "dev-demo-token-secret", {
    message:
      "DEMO_TOKEN_SECRET must be set explicitly in production (demo booking links are derived from it)",
    path: ["DEMO_TOKEN_SECRET"],
  })
  .refine((v) => !serving(v) || v.DEMO_TOKEN_SECRET.length >= 32, {
    message: "DEMO_TOKEN_SECRET must be at least 32 characters in production",
    path: ["DEMO_TOKEN_SECRET"],
  })
  .refine((v) => !serving(v) || v.ENGINE_SECRET.length >= 32, {
    message: "ENGINE_SECRET must be at least 32 characters in production",
    path: ["ENGINE_SECRET"],
  })
  .refine((v) => !serving(v) || !/localhost|127\.0\.0\.1/.test(v.PUBLIC_BASE_URL), {
    message:
      "PUBLIC_BASE_URL still points at localhost — every canonical URL, share card and sitemap entry would too",
    path: ["PUBLIC_BASE_URL"],
  })
  .refine((v) => !serving(v) || v.RP_ID !== "localhost", {
    message: "RP_ID is still 'localhost' — passkeys cannot verify against a real hostname",
    path: ["RP_ID"],
  })
  .refine((v) => !serving(v) || v.RP_ORIGINS.every((o) => !/localhost|127\.0\.0\.1/.test(o)), {
    message: "RP_ORIGINS still contains a localhost origin",
    path: ["RP_ORIGINS"],
  })
  // PRR P1-6: a production tier you cannot diagnose is not shippable. A missing
  // DSN is a silent no-op, so this is the boot check that cannot be forgotten
  // (preflight also fails on it). The rehearsal escape keeps serving() false.
  .refine((v) => !serving(v) || (v.SENTRY_DSN !== undefined && v.SENTRY_DSN !== ""), {
    message:
      "SENTRY_DSN must be set in production so errors are captured (a missing DSN is silent)",
    path: ["SENTRY_DSN"],
  });

export type Env = z.infer<typeof envSchema>;

/** Exported for tests and the env:check script; apps import the singleton. */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = productionSchema.safeParse(raw);
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
  if (result.data.ALLOW_INSECURE_LOCAL_PRODUCTION && result.data.NODE_ENV === "production") {
    // Not a log line the app owns — a warning the operator has to see even if
    // the log level hides everything else.
    process.stderr.write(
      "\n!! ALLOW_INSECURE_LOCAL_PRODUCTION is set: this process is running a PRODUCTION build\n" +
        "!! with development adapters (OTP to a table, media to the local disk, the published\n" +
        "!! engine secret). It is a rehearsal server. It must never serve real people.\n\n",
    );
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
