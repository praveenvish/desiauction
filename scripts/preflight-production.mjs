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
// Exit 0 = every rule passes. Exit 1 = one or more FAILs (printed with the fix).
// Rules are derived from apps/{web,engine,finops-runner}/src/env.ts and the
// PRODUCTION_CHECKLIST. This is release engineering, not business logic — it
// changes nothing at runtime.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
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
check(
  "ALLOW_INSECURE_LOCAL_PRODUCTION-absent",
  env.ALLOW_INSECURE_LOCAL_PRODUCTION === undefined ||
    env.ALLOW_INSECURE_LOCAL_PRODUCTION === "" ||
    env.ALLOW_INSECURE_LOCAL_PRODUCTION === "0",
  "the local-rehearsal escape is not set",
  "unset ALLOW_INSECURE_LOCAL_PRODUCTION — it disables every production boot check in apps/web",
);

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
  const origins = (env.ENGINE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");
  check(
    "ENGINE_ALLOWED_ORIGINS",
    origins.length > 0 && origins.every((o) => o.startsWith("https://")),
    `ENGINE_ALLOWED_ORIGINS=${env.ENGINE_ALLOWED_ORIGINS ?? "(unset)"}`,
    "set ENGINE_ALLOWED_ORIGINS to the https browser origin(s) allowed to open a spectate socket",
  );
}

// --- OTP (login is OTP-first; the dev inbox is gone in production) -----------
check(
  "OTP_PROVIDER",
  env.OTP_PROVIDER === "msg91",
  `OTP_PROVIDER=${env.OTP_PROVIDER ?? "(unset)"}`,
  "set OTP_PROVIDER=msg91 — the dev sender is structurally absent in production, so login would be impossible",
);
check(
  "MSG91-credentials",
  typeof env.MSG91_AUTH_KEY === "string" &&
    env.MSG91_AUTH_KEY.length > 0 &&
    typeof env.MSG91_TEMPLATE_ID === "string" &&
    env.MSG91_TEMPLATE_ID.length > 0,
  "SMS provider credentials",
  "set MSG91_AUTH_KEY and MSG91_TEMPLATE_ID",
);

// --- Passkeys (RP mismatch silently breaks WebAuthn) -------------------------
check(
  "RP_ID",
  typeof env.RP_ID === "string" && env.RP_ID.length > 0 && env.RP_ID !== "localhost",
  `RP_ID=${env.RP_ID ?? "(unset)"}`,
  "set RP_ID to the production domain (must suffix-match the browser host)",
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
check(
  "SENTRY_DSN",
  typeof env.SENTRY_DSN === "string" && env.SENTRY_DSN.length > 0,
  "error tracking",
  "set SENTRY_DSN so errors are captured (a missing DSN is a silent no-op in every app)",
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
  "set TRUSTED_PROXY_COUNT (1 behind a single Vercel/Fly ingress) or every per-IP limit keys on nothing",
);

// --- Scheduled money repair (PRR P1-3) ---------------------------------------
// The settlement catch-up sweep endpoint is fail-closed (404 without a secret),
// so the platform is SAFE without it — but the case↔journal seam then has no
// scheduled repair. A warn, not a blocker: set it and point a scheduler at
// POST /api/jobs/settlement-coordination.
warn(
  "SETTLEMENT_JOB_SECRET",
  typeof env.SETTLEMENT_JOB_SECRET === "string" && env.SETTLEMENT_JOB_SECRET.length >= 16,
  "the settlement catch-up sweep is unreachable without it",
  "set SETTLEMENT_JOB_SECRET (>=16 chars) and schedule POST /api/jobs/settlement-coordination so a lost journal effect self-heals",
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
