import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * THE SUITE THAT RUNS AS THE PRODUCTION ROLES.
 *
 * Every other suite in this repository — unit, integration, e2e — connects as
 * the database OWNER. Postgres exempts the owner from row-level security, so
 * all 46 FORCE-RLS policies evaluate to "visible" and every grant is irrelevant.
 * Code that reaches a pool without setting `app.org_id`, or writes a table its
 * role has no INSERT on, therefore behaves perfectly in every environment the
 * team can observe and fails for the first time on real infrastructure.
 *
 * That is not hypothetical: audit PA-1 found three such paths, two of which
 * would have broken the money and consent paths on the first live event.
 *
 * This config is the answer. It points the app at `desiauction_app`
 * (NOBYPASSRLS) and `desiauction_system` (BYPASSRLS, four writable tables),
 * exactly as production does, and the tests then exercise real handlers. Test
 * FIXTURES still need owner rights — creating a tenant is not something a
 * tenant-scoped role can do — so seeding uses OWNER_DATABASE_URL on a separate
 * connection, and only the code under test runs as the app.
 *
 * Prerequisite: the four roles must exist. Create them with
 *   psql -v ON_ERROR_STOP=1 -v app_password=… -v system_password=… \
 *        -v engine_password=… -v runner_password=… -f ops/db/create-app-role.sql
 * (CI does this already for grants:verify and rls:verify.)
 *
 * Run: pnpm --filter @desiauction/web posture:verify
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env.local"));
} catch {
  // No .env.local (CI, or a fresh clone) — the fallbacks below are correct there.
}

const host = process.env["POSTURE_DB_HOST"] ?? "localhost";
const port = process.env["POSTURE_DB_PORT"] ?? process.env["DB_PORT"] ?? "5433";
const database = process.env["POSTURE_DB_NAME"] ?? "desiauction";
const url = (role: string, password: string): string =>
  `postgres://${role}:${password}@${host}:${port}/${database}`;

export default defineConfig({
  test: {
    include: ["src/**/*.posture.test.ts"],
    // These suites share one database and assert on role-level failures; running
    // them in parallel would let one file's seed satisfy another file's
    // "should not exist" assertion.
    fileParallelism: false,
    env: {
      // The app under test: the non-BYPASSRLS role, exactly as production.
      DATABASE_URL:
        process.env["APP_DATABASE_URL"] ??
        url("desiauction_app", process.env["APP_DB_PASSWORD"] ?? "local-app"),
      SYSTEM_DATABASE_URL:
        process.env["SYSTEM_DATABASE_URL_POSTURE"] ??
        url("desiauction_system", process.env["SYSTEM_DB_PASSWORD"] ?? "local-system"),
      // Fixtures only. Never handed to application code.
      OWNER_DATABASE_URL:
        process.env["OWNER_DATABASE_URL"] ??
        process.env["DATABASE_URL"] ??
        url("desiauction", "desiauction"),
      // The fail-closed webhook doors need a secret or they 404 before reaching
      // any database work, and the test would pass by never running the code.
      SMS_INBOUND_SECRET: "posture-inbound-secret-0123456789",
      DELIVERY_CALLBACK_SECRET: "posture-delivery-secret-0123456789",
      // The gateway must be CONFIGURED for the callback path to exist at all
      // (an unset secret 404s the route by design), so the posture suite can
      // reach the handler even though beta collects manually (decision D1).
      RAZORPAY_WEBHOOK_SECRET: "posture-razorpay-secret-0123456789",
      RAZORPAY_KEY_ID: "rzp_test_posture",
      RAZORPAY_KEY_SECRET: "posture-razorpay-key-secret",
    },
  },
});
