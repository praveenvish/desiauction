#!/usr/bin/env node
// PX-12 PRODUCTION PREFLIGHT.
//
// Each app validates its OWN boot env (env.ts, fail-closed). This is the
// cross-service gate an operator runs BEFORE a production deploy: it asserts the
// production-COMPLETENESS rules the per-app checks deliberately leave optional
// for local dev, so a misconfiguration is caught on the ground, not at first
// login. It reads process.env (load the production env first) and never boots
// the apps.
//
//   pnpm preflight:production      # with the production env exported/sourced
//
//   # the self-hosted stack keeps one env file PER SERVICE, so read them as such:
//   node scripts/preflight-production.mjs \
//     --env=web.env --engine-env=engine.env --runner-env=runner.env
//
// With the split files, each rule reads the file of the process that actually
// consumes the value. That is not pedantry: the engine keys its per-client
// socket cap on TRUSTED_PROXY_COUNT from engine.env, and a check that read the
// web tier's copy passed while the engine counted every spectator behind Caddy
// as ONE client. `deploy-host.yml` runs this form on the host before migrating.
//
// Exit 0 = every rule passes. Exit 1 = one or more FAILs (printed with the fix).
// Rules are derived from apps/{web,engine,finops-runner}/src/env.ts and the
// PRODUCTION_CHECKLIST. This is release engineering, not business logic — it
// changes nothing at runtime.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A dotenv file as compose reads it: KEY=VALUE per line, `#` comments, optional
 * surrounding quotes. No interpolation — compose does none inside env_file
 * either, so a `$` here is a literal `$` in the container too.
 */
function readEnvFile(path) {
  const out = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, "")
      .trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
const flag = (name) => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
};
const webFile = flag("env");
const engineFile = flag("engine-env");
const runnerFile = flag("runner-env");

// The file wins over the process environment; the process still supplies what
// the IMAGE sets rather than the env file (NODE_ENV, APP_VERSION).
const env = { ...process.env, ...(webFile === undefined ? {} : readEnvFile(webFile)) };
/** The engine's own environment, or — without split files — the one env. */
const engineEnv = engineFile === undefined ? env : { ...process.env, ...readEnvFile(engineFile) };
const runnerEnv = runnerFile === undefined ? env : { ...process.env, ...readEnvFile(runnerFile) };
const results = [];
function check(id, ok, detail, fix) {
  results.push({ id, level: ok ? "pass" : "fail", detail, fix });
}
function warn(id, ok, detail, fix) {
  results.push({ id, level: ok ? "pass" : "warn", detail, fix });
}

const isPostgres = (v) => typeof v === "string" && v.startsWith("postgres");
const isHttps = (v) => typeof v === "string" && v.startsWith("https://");

// --- Identity & database -----------------------------------------------------
check(
  "NODE_ENV",
  env.NODE_ENV === "production",
  `NODE_ENV=${env.NODE_ENV ?? "(unset)"}`,
  "set NODE_ENV=production",
);
check(
  "DATABASE_URL",
  isPostgres(env.DATABASE_URL),
  "the app-role connection",
  "set DATABASE_URL to the desiauction_app (NOBYPASSRLS) role",
);
// /support and /releases quote this to users. The zod default is "dev"; the
// pages suppress the sentence for that value, but a launch should ship a real
// version string rather than silently saying nothing.
warn(
  "APP_VERSION",
  typeof env.APP_VERSION === "string" && env.APP_VERSION !== "" && env.APP_VERSION !== "dev",
  `APP_VERSION=${env.APP_VERSION ?? "(unset)"}`,
  "set APP_VERSION to the release tag so /support and /releases can quote it",
);
check(
  "SYSTEM_DATABASE_URL-distinct",
  isPostgres(env.SYSTEM_DATABASE_URL) && env.SYSTEM_DATABASE_URL !== env.DATABASE_URL,
  "the RLS-exempt system pool must be a DIFFERENT role from the app pool",
  "set SYSTEM_DATABASE_URL to the desiauction_system role (unset/equal = RLS four-role recipe is NOT in effect)",
);

// --- Legal identity ----------------------------------------------------------
// The Legal Centre ships eight well-drafted documents and, until 2026-08-23,
// named no legal entity, no registered address and no grievance officer. An
// India-facing platform that processes personal data and takes payments must
// publish all three — IT Rules 2021 Rule 3(2), DPDP Act 2023 s.13, and Consumer
// Protection (E-Commerce) Rules 2020 Rule 4(3). None of it is derivable from
// this repository, so `apps/web/src/content/company.ts` holds the slots and the
// pages say plainly when they are empty. This is the gate that stops those
// empty slots reaching real users.
{
  const source = readFileSync(join(root, "apps/web/src/content/company.ts"), "utf8");
  const required = [
    "legalName",
    "registeredAddress",
    "grievanceOfficerName",
    "grievanceOfficerEmail",
  ];
  const unset = required.filter((field) => new RegExp(`^\\s*${field}:\\s*null,`, "m").test(source));
  check(
    "legal-identity-published",
    unset.length === 0,
    unset.length === 0
      ? "operator identity and grievance officer are published"
      : `unset: ${unset.join(", ")}`,
    "fill LEGAL_IDENTITY in apps/web/src/content/company.ts — a named grievance officer, the registered legal name and a postal address are required before serving Indian users",
  );
}

// --- The rehearsal escape must never reach a deploy --------------------------
// `apps/web/src/env.ts` refuses to boot in production on any of the dev-only
// defaults, and offers exactly one door out for the local production rehearsal
// PRODUCTION_CHECKLIST §8 requires. That door is closed here: if this script is
// being run against an environment that carries it, the environment is not a
// production environment yet, whatever else it gets right.
// The runner honours the same escape now (its SENTRY_DSN refusal), so its file
// is held to the same rule.
for (const [service, scoped] of [
  ["web", env],
  ["runner", runnerEnv],
]) {
  check(
    service === "web"
      ? "ALLOW_INSECURE_LOCAL_PRODUCTION-absent"
      : `ALLOW_INSECURE_LOCAL_PRODUCTION-absent-${service}`,
    scoped.ALLOW_INSECURE_LOCAL_PRODUCTION === undefined ||
      scoped.ALLOW_INSECURE_LOCAL_PRODUCTION === "" ||
      scoped.ALLOW_INSECURE_LOCAL_PRODUCTION === "0",
    `the local-rehearsal escape is not set (${service})`,
    `unset ALLOW_INSECURE_LOCAL_PRODUCTION in the ${service} env — it disables the production boot checks`,
  );
}

// --- Engine trust ------------------------------------------------------------
const secret = env.ENGINE_SECRET ?? "";
check(
  "ENGINE_SECRET-set",
  secret.length >= 8 && secret !== "dev-engine-secret",
  "shared web↔engine secret",
  "set ENGINE_SECRET to a strong random value (the dev default is refused by the engine in production)",
);
warn(
  "ENGINE_SECRET-strong",
  secret.length >= 32,
  `ENGINE_SECRET is ${String(secret.length)} chars`,
  "use >=32 random chars for the shared secret",
);
check(
  "ENGINE_URL-remote",
  typeof env.ENGINE_URL === "string" &&
    !env.ENGINE_URL.includes("localhost") &&
    !env.ENGINE_URL.includes("127.0.0.1"),
  `ENGINE_URL=${env.ENGINE_URL ?? "(unset)"}`,
  "point ENGINE_URL at the deployed engine, not localhost",
);
check(
  "ENGINE_PUBLIC_WS_URL-wss",
  typeof env.ENGINE_PUBLIC_WS_URL === "string" && env.ENGINE_PUBLIC_WS_URL.startsWith("wss://"),
  `ENGINE_PUBLIC_WS_URL=${env.ENGINE_PUBLIC_WS_URL ?? "(unset)"}`,
  "use a wss:// URL so browsers get a secure WebSocket",
);
// The engine only checks the WS Origin when this is non-empty; unset means
// "accept any origin with a valid ticket", so a scraped ticket opens a socket
// from a hostile page. Required (and https-only) in production.
{
  const origins = (engineEnv.ENGINE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");
  check(
    "ENGINE_ALLOWED_ORIGINS",
    origins.length > 0 && origins.every((o) => o.startsWith("https://")),
    `ENGINE_ALLOWED_ORIGINS=${engineEnv.ENGINE_ALLOWED_ORIGINS ?? "(unset)"}`,
    "set ENGINE_ALLOWED_ORIGINS (in the ENGINE's env) to the https browser origin(s) allowed to open a spectate socket",
  );
}
// Split files: two copies of one secret. The engine refuses every command whose
// header does not match its own, so a mismatch is not a warning — it is every
// bid of every auction answered 401.
if (engineFile !== undefined) {
  check(
    "ENGINE_SECRET-matches-engine",
    typeof engineEnv.ENGINE_SECRET === "string" && engineEnv.ENGINE_SECRET === env.ENGINE_SECRET,
    "web and engine must hold the SAME ENGINE_SECRET",
    "copy ENGINE_SECRET from web.env into engine.env (or rotate both together — SECRET_ROTATION.md)",
  );
}

// --- OTP (login is OTP-first; the dev inbox is gone in production) -----------
//
// TWO PROVIDERS ARE VALID, and this check used to name only one. It asserted
// `OTP_PROVIDER === "msg91"`, so a correctly configured WhatsApp deployment
// would have been REFUSED here — the gate failing the very thing it exists to
// admit. Whichever is selected, the credentials CHECKED are that provider's.
const otpProvider = env.OTP_PROVIDER ?? "(unset)";
check(
  "OTP_PROVIDER",
  otpProvider === "msg91" || otpProvider === "whatsapp",
  `OTP_PROVIDER=${otpProvider}`,
  "set OTP_PROVIDER=whatsapp (Meta Cloud API) or msg91 (SMS) — the dev sender is structurally absent in production, so login would be impossible",
);
const nonEmpty = (value) => typeof value === "string" && value.length > 0;
if (otpProvider === "whatsapp") {
  check(
    "WhatsApp-credentials",
    nonEmpty(env.WHATSAPP_PHONE_NUMBER_ID) &&
      nonEmpty(env.WHATSAPP_ACCESS_TOKEN) &&
      nonEmpty(env.WHATSAPP_TEMPLATE_NAME),
    "WhatsApp Cloud API credentials",
    "set WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN and WHATSAPP_TEMPLATE_NAME",
  );
  // SMS IS DORMANT FOR LAUNCH (founder decision 2026-09-23): WhatsApp is the
  // text channel and MSG91/DLT is deferred, so no MSG91 variable is REQUIRED
  // here. The one case worth a warning is phone-first login with no SMS
  // fallback — then a Meta outage closes the front door, and only the email
  // tab still works. With email as the default door (the launch setting) a
  // WhatsApp outage costs the phone tab, not sign-in, and nothing is said.
  warn(
    "MSG91-fallback",
    env.LOGIN_DEFAULT_METHOD !== "phone" ||
      (nonEmpty(env.MSG91_AUTH_KEY) && nonEmpty(env.MSG91_TEMPLATE_ID)),
    "phone-first login with no SMS fallback",
    "LOGIN_DEFAULT_METHOD=phone and no MSG91: a WhatsApp outage closes the default door — keep LOGIN_DEFAULT_METHOD=email until SMS/DLT is live, or set MSG91_AUTH_KEY + MSG91_TEMPLATE_ID",
  );
  // Every personal text moment rides WhatsApp now; a template Meta has not
  // approved (name unset) means that moment reaches opted-in players by email
  // only. A warning, not a refusal: approvals land one by one after launch.
  const personalTemplates = [
    "AUCTION_SOLD",
    "TEAM_APPOINTED",
    "LINEUP_ANNOUNCED",
    "REGISTRATION_APPROVED",
    "REGISTRATION_WAITLISTED",
    "REGISTRATION_REJECTED",
    "REGISTRATION_WITHDRAWN",
    "REGISTRATION_RESTORED",
    "SECURITY_PHONE_CHANGED",
    "SECURITY_EMAIL_CHANGED",
  ].map((key) => `WHATSAPP_TEMPLATE_${key}`);
  const unapproved = personalTemplates.filter((name) => !nonEmpty(env[name]));
  warn(
    "WhatsApp-templates",
    unapproved.length === 0,
    `${String(personalTemplates.length - unapproved.length)}/${String(personalTemplates.length)} personal templates named`,
    `unset: ${unapproved.join(", ")} — those moments go by email only (docs/messaging/WHATSAPP_TEMPLATES.md)`,
  );
} else {
  check(
    "MSG91-credentials",
    nonEmpty(env.MSG91_AUTH_KEY) && nonEmpty(env.MSG91_TEMPLATE_ID),
    "SMS provider credentials",
    "set MSG91_AUTH_KEY and MSG91_TEMPLATE_ID",
  );
}

// --- WhatsApp callback (opt-outs and delivery receipts) -------------------------
// A number that sends on WhatsApp must be able to hear "STOP": replies land on
// /api/webhooks/whatsapp, which is closed (404) without these two secrets.
// env.ts refuses to boot the same way; this says so before the deploy. Meta
// setup: docs/messaging/WHATSAPP_SETUP.md.
const whatsappSends = nonEmpty(env.WHATSAPP_PHONE_NUMBER_ID) && nonEmpty(env.WHATSAPP_ACCESS_TOKEN);
if (whatsappSends) {
  check(
    "WHATSAPP-webhook",
    (env.WHATSAPP_APP_SECRET ?? "").length >= 16 &&
      (env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "").length >= 16,
    "the WhatsApp callback URL verifies Meta's signature and handshake with these",
    "set WHATSAPP_APP_SECRET (Meta app → Settings → Basic → App secret) and WHATSAPP_WEBHOOK_VERIFY_TOKEN (>=16 random chars, pasted into Meta's webhook form) in web.env — without them STOP replies are dropped",
  );
}

// --- Passkeys (RP mismatch silently breaks WebAuthn) -------------------------
check(
  "RP_ID",
  typeof env.RP_ID === "string" && env.RP_ID.length > 0 && env.RP_ID !== "localhost",
  `RP_ID=${env.RP_ID ?? "(unset)"}`,
  "set RP_ID to the production domain (must suffix-match the browser host)",
);
/*
 * AND THAT IT IS THE HOST ACTUALLY BEING SERVED.
 *
 * The check above only ever asked "is it not localhost", which a domain typo
 * passes. `RP_ID=desiauction.com` while serving `https://desiauction.in`
 * satisfied every gate here, deployed green, and silently stopped every
 * enrolled passkey from verifying — a failure with no error, no log line and no
 * symptom except users who cannot get in.
 *
 * A PARENT DOMAIN IS FINE: `desiauction.in` while serving
 * `app.desiauction.in` is how one credential covers subdomains. The rule is
 * that the served host must sit underneath RP_ID, not that they be identical.
 */
check(
  "RP_ID-matches-host",
  (() => {
    if (typeof env.PUBLIC_BASE_URL !== "string" || typeof env.RP_ID !== "string") return false;
    let host;
    try {
      host = new URL(env.PUBLIC_BASE_URL).hostname;
    } catch {
      return false;
    }
    return host === env.RP_ID || host.endsWith(`.${env.RP_ID}`);
  })(),
  `RP_ID=${env.RP_ID ?? "(unset)"} vs PUBLIC_BASE_URL=${env.PUBLIC_BASE_URL ?? "(unset)"}`,
  "RP_ID must be the host PUBLIC_BASE_URL serves, or a domain it sits under — a mismatch breaks passkeys with no error",
);
check(
  "RP_ORIGINS-https",
  typeof env.RP_ORIGINS === "string" &&
    env.RP_ORIGINS.split(",").every((o) => o.trim().startsWith("https://")),
  `RP_ORIGINS=${env.RP_ORIGINS ?? "(unset)"}`,
  "set RP_ORIGINS to the https origin(s) of the production domain",
);

// --- Public origin & storage -------------------------------------------------
check(
  "PUBLIC_BASE_URL-https",
  isHttps(env.PUBLIC_BASE_URL),
  `PUBLIC_BASE_URL=${env.PUBLIC_BASE_URL ?? "(unset)"}`,
  "set PUBLIC_BASE_URL to the https production origin (canonical URLs, OG, sitemap)",
);
check(
  "FINOPS_STORAGE_DIR",
  typeof env.FINOPS_STORAGE_DIR === "string" &&
    (env.FINOPS_STORAGE_DIR.startsWith("/") || env.FINOPS_STORAGE_DIR.startsWith("s3://")) &&
    !env.FINOPS_STORAGE_DIR.includes(".local/finops-artifacts"),
  `FINOPS_STORAGE_DIR=${env.FINOPS_STORAGE_DIR ?? "(unset)"}`,
  "set FINOPS_STORAGE_DIR to an absolute/durable path shared by web + runner (the local relative default loses artifacts across a multi-host deploy)",
);
check(
  "MEDIA_STORAGE-bucket",
  env.MEDIA_STORAGE === "bucket",
  `MEDIA_STORAGE=${env.MEDIA_STORAGE ?? "(unset → defaults to local)"}`,
  "set MEDIA_STORAGE=bucket — the 'local' default writes uploads to public/_media on the app host (dev-only; not served by a built server and an authenticated-write path surface)",
);
check(
  "MEDIA_PUBLIC_BASE-https",
  env.MEDIA_STORAGE !== "bucket" || isHttps(env.MEDIA_PUBLIC_BASE),
  `MEDIA_PUBLIC_BASE=${env.MEDIA_PUBLIC_BASE ?? "(unset)"}`,
  "set MEDIA_PUBLIC_BASE to the https CDN/bucket base that serves media keys",
);
// PI-1 P5 (D1 closed): the bucket adapter now constructs a real signer, and it
// needs the credential set — without these five the web tier throws at the
// first import of server/media, which reads as a mystery 500 on registration.
check(
  "MEDIA_S3-config",
  env.MEDIA_STORAGE !== "bucket" ||
    (env.MEDIA_S3_ENDPOINT !== undefined &&
      env.MEDIA_S3_REGION !== undefined &&
      env.MEDIA_S3_BUCKET !== undefined &&
      env.MEDIA_S3_ACCESS_KEY_ID !== undefined &&
      env.MEDIA_S3_SECRET_ACCESS_KEY !== undefined),
  `MEDIA_S3_ENDPOINT=${env.MEDIA_S3_ENDPOINT ?? "(unset)"} MEDIA_S3_BUCKET=${env.MEDIA_S3_BUCKET ?? "(unset)"}`,
  "set MEDIA_S3_ENDPOINT, MEDIA_S3_REGION, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID and MEDIA_S3_SECRET_ACCESS_KEY for the media bucket signer",
);
// PRR P1-4: the filesystem finops store cannot be shared across web + runner on
// separate hosts, so exports would verify unhealthy forever. Bucket required.
check(
  "FINOPS_ARTIFACT_STORE-bucket",
  env.FINOPS_ARTIFACT_STORE === "bucket",
  `FINOPS_ARTIFACT_STORE=${env.FINOPS_ARTIFACT_STORE ?? "(unset → defaults to filesystem)"}`,
  "set FINOPS_ARTIFACT_STORE=bucket — the filesystem store cannot be read by the web tier when the runner is on a different host",
);
check(
  "FINOPS_S3-config",
  env.FINOPS_ARTIFACT_STORE !== "bucket" ||
    [
      env.FINOPS_S3_ENDPOINT,
      env.FINOPS_S3_REGION,
      env.FINOPS_S3_BUCKET,
      env.FINOPS_S3_ACCESS_KEY_ID,
      env.FINOPS_S3_SECRET_ACCESS_KEY,
    ].every((v) => typeof v === "string" && v.length > 0),
  "the S3/MinIO/R2 credentials the bucket store needs",
  "set FINOPS_S3_ENDPOINT, FINOPS_S3_REGION, FINOPS_S3_BUCKET, FINOPS_S3_ACCESS_KEY_ID and FINOPS_S3_SECRET_ACCESS_KEY",
);

// --- Observability -----------------------------------------------------------
// PRR P1-6: a launch you cannot diagnose is not a launch. A missing DSN is a
// silent no-op in every app, so this is a hard blocker, not a warning.
for (const [service, scoped, file] of [
  ["web", env, webFile],
  ["engine", engineEnv, engineFile],
  ["runner", runnerEnv, runnerFile],
]) {
  // Without split files all three read the one env, so one check says it all.
  if (service !== "web" && file === undefined) continue;
  check(
    service === "web" ? "SENTRY_DSN" : `SENTRY_DSN-${service}`,
    typeof scoped.SENTRY_DSN === "string" && scoped.SENTRY_DSN.length > 0,
    `error tracking (${service})`,
    `set SENTRY_DSN in the ${service} env so errors are captured (a missing DSN is a silent no-op)`,
  );
}

// --- Content Security Policy ---------------------------------------------------
// A warning and never a failure: the nonce policy ships Report-Only on purpose,
// and enforcing it is a decision taken AFTER a clean production week of
// /api/csp-report, not before the first deploy. What this line prevents is the
// other failure — the week passing and nobody remembering the switch exists.
warn(
  "CSP_ENFORCE",
  env.CSP_ENFORCE === "1" || env.CSP_ENFORCE === "true",
  "the script policy is Report-Only — browsers report violations and block nothing",
  "after one clean production week of /api/csp-report, set CSP_ENFORCE=1 in web.env (unset backs out, no deploy)",
);

// --- Email sign-in -----------------------------------------------------------
// The door that works without DLT. With EMAIL_PROVIDER=auto and no mailer the
// web tier used to fall back to the dev inbox silently; env.ts now refuses to
// boot, and this says so before the deploy rather than at it.
check(
  "EMAIL_MAILER",
  env.EMAIL_PROVIDER !== "dev" &&
    Boolean(env.EMAIL_API_ENDPOINT) &&
    Boolean(env.EMAIL_API_KEY) &&
    Boolean(env.EMAIL_FROM),
  "email sign-in codes and receipts need a real mailer",
  "set EMAIL_API_ENDPOINT, EMAIL_API_KEY and EMAIL_FROM (and leave EMAIL_PROVIDER unset or http)",
);

// --- Per-IP throttles (audit PA-1 §25) ---------------------------------------
// `clientIp` now refuses to read `x-real-ip` unless a trusted proxy is declared,
// because at 0 there is nothing in front to overwrite it and the header is
// whatever the caller typed. That is the safe answer — but it also means every
// per-IP throttle (the 20/hour OTP cap, the demo-request limiter) silently has
// no IP to key on until this is set. Behind Vercel or Fly the value is 1.
check(
  "TRUSTED_PROXY_COUNT",
  Number(env.TRUSTED_PROXY_COUNT ?? "0") > 0,
  "per-IP throttles need a trusted proxy hop count",
  "set TRUSTED_PROXY_COUNT (1 behind the one Caddy) or every per-IP limit keys on nothing",
);
// THE ENGINE READS ITS OWN COPY. Its per-client socket cap keys on the client
// address, and at 0 the only address it can see behind Caddy is Caddy's — so
// every spectator of every live room shares ONE cap of 50 sockets. The web
// check above passing said nothing about this; with split files it is read
// from engine.env, where the engine reads it.
if (engineFile !== undefined) {
  check(
    "TRUSTED_PROXY_COUNT-engine",
    Number(engineEnv.TRUSTED_PROXY_COUNT ?? "0") > 0,
    "the engine's per-client socket cap needs the proxy hop count too",
    "set TRUSTED_PROXY_COUNT=1 in engine.env, or every client behind Caddy counts as one",
  );
}

// --- Scheduled money repair (PRR P1-3) ---------------------------------------
// The settlement catch-up sweep endpoint is fail-closed (404 without a secret),
// so the platform is SAFE without it — but the case↔journal seam then has no
// scheduled repair. A warn, not a blocker: set it and point a scheduler at
// POST /api/jobs/settlement-coordination.
warn(
  "SETTLEMENT_JOB_SECRET",
  typeof env.SETTLEMENT_JOB_SECRET === "string" && env.SETTLEMENT_JOB_SECRET.length >= 16,
  "the settlement catch-up sweep is unreachable without it",
  "set SETTLEMENT_JOB_SECRET (>=16 chars) in web.env — the compose `scheduler` calls POST /api/jobs/settlement-coordination with it",
);
// The same scheduler drains the personal-message outbox and runs the retention
// purge with FEEDBACK_JOB_SECRET, and sends demo reminders with DEMO_JOB_SECRET.
// Unset, each route 404s by design and the scheduler logs it as disabled.
warn(
  "FEEDBACK_JOB_SECRET",
  typeof env.FEEDBACK_JOB_SECRET === "string" && env.FEEDBACK_JOB_SECRET.length >= 16,
  "the outbox drain and retention purge are unscheduled without it",
  "set FEEDBACK_JOB_SECRET (>=16 chars) in web.env — without it a message left pending by a restart is never retried",
);
warn(
  "DEMO_JOB_SECRET",
  typeof env.DEMO_JOB_SECRET === "string" && env.DEMO_JOB_SECRET.length >= 16,
  "demo-call reminders are unscheduled without it",
  "set DEMO_JOB_SECRET (>=16 chars) in web.env",
);

// --- Payments (webhook ingress) ---------------------------------------------
warn(
  "RAZORPAY",
  typeof env.RAZORPAY_KEY_ID === "string" && typeof env.RAZORPAY_WEBHOOK_SECRET === "string",
  "gateway collection is optional at beta (manual capture works without it)",
  "set RAZORPAY_KEY_ID + RAZORPAY_WEBHOOK_SECRET to enable gateway payments",
);

// --- Report ------------------------------------------------------------------
const fails = results.filter((r) => r.level === "fail");
const warns = results.filter((r) => r.level === "warn");
const icon = { pass: "✓", warn: "⚠", fail: "✗" };
console.log("\nPRODUCTION PREFLIGHT\n");
for (const r of results) {
  console.log(`  ${icon[r.level]} ${r.id}${r.level === "pass" ? "" : ` — ${r.detail}`}`);
  if (r.level !== "pass") {
    console.log(`      fix: ${r.fix}`);
  }
}
console.log(
  `\n${results.length - fails.length - warns.length} pass · ${warns.length} warn · ${fails.length} fail\n`,
);
if (fails.length > 0) {
  console.error(`REFUSING: ${String(fails.length)} production blocker(s) above. Do not deploy.`);
  process.exit(1);
}
if (warns.length > 0) {
  console.log("Ready with warnings — confirm each is intended for this beta.");
}
console.log("Preflight passed.");
