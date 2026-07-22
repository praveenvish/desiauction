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
check(
  "SYSTEM_DATABASE_URL-distinct",
  isPostgres(env.SYSTEM_DATABASE_URL) && env.SYSTEM_DATABASE_URL !== env.DATABASE_URL,
  "the RLS-exempt system pool must be a DIFFERENT role from the app pool",
  "set SYSTEM_DATABASE_URL to the desiauction_system role (unset/equal = RLS four-role recipe is NOT in effect)",
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

// --- Observability -----------------------------------------------------------
warn(
  "SENTRY_DSN",
  typeof env.SENTRY_DSN === "string" && env.SENTRY_DSN.length > 0,
  "error tracking",
  "set SENTRY_DSN so errors are captured (a missing DSN is a silent no-op)",
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
