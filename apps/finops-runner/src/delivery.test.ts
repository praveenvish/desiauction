import type { Db } from "@desiauction/db";
import { finopsDeps } from "@desiauction/financial-operations/server";
import { describe, expect, it } from "vitest";

import { mailConfigFor, runnerDelivery } from "./delivery";
import { parseEnv } from "./env";

/**
 * THE RUNNER DELIVERS FOR REAL, OR DOES NOT BOOT.
 *
 * The runner is the process that drains `dispatch.send`, and it built its
 * finops deps with the certified package's development adapters — a no-op
 * in-app and a filesystem email outbox — so every production receipt was
 * "delivered" to a file. These pin both halves of the fix without a database:
 * a production environment gets the real adapters, and a production
 * environment that would get the file adapter is refused at boot.
 */

const PROD: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://runner@db/desiauction",
  SENTRY_DSN: "https://key@sentry.example/1",
  FINOPS_ARTIFACT_STORE: "bucket",
  EMAIL_API_ENDPOINT: "https://api.resend.com/emails",
  EMAIL_API_KEY: "re_test",
  EMAIL_FROM: "DesiAuction <no-reply@mail.desiauction.in>",
};

/** PROD minus some settings — what an operator who forgot them deploys. */
function without(...keys: string[]): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(PROD).filter(([key]) => !keys.includes(key)));
}

/** Never queried: the assertions below stop before any adapter sends. */
const db = {} as Db;

/**
 * Which adapter a channel resolved to, told apart by behaviour the ports
 * expose: only the HTTP mailer can verify a provider's callback, and the
 * platform's file outbox and no-op in-app adapter confirm inline without one.
 */
function isHttpMailer(port: ReturnType<ReturnType<typeof finopsDeps>["delivery"]>): boolean {
  return port !== null && port.channel === "email" && typeof port.verifyCallback === "function";
}

describe("the runner's delivery map", () => {
  it("uses the HTTP mailer and the person-scoped in-app adapter under a production env", () => {
    const env = parseEnv(PROD);
    const overrides = runnerDelivery(db, env);
    const deps = finopsDeps(db, { storageDir: "/nonexistent", delivery: overrides });
    expect(isHttpMailer(deps.delivery("email")), "email is the provider, not a file").toBe(true);
    // The very objects the runner injected — not the package defaults.
    expect(deps.delivery("email")).toBe(overrides.email);
    expect(deps.delivery("in-app")).toBe(overrides["in-app"]);
  });

  it("keeps the file outbox only where it belongs: dev mode, or no credentials outside production", () => {
    const local = parseEnv({ DATABASE_URL: PROD["DATABASE_URL"] });
    expect(mailConfigFor(local)).toBeNull();
    const devMode = parseEnv({ ...PROD, NODE_ENV: "development", EMAIL_PROVIDER: "dev" });
    expect(mailConfigFor(devMode), "dev means dev even with live keys").toBeNull();
    const deps = finopsDeps(db, { delivery: runnerDelivery(db, devMode) });
    expect(isHttpMailer(deps.delivery("email"))).toBe(false);
  });
});

describe("the runner's production boot refuses the file adapter", () => {
  it("refuses a production env with no mail provider", () => {
    expect(() => parseEnv(without("EMAIL_API_KEY"))).toThrow(/EMAIL_PROVIDER.*receipts need/s);
  });

  it("refuses EMAIL_PROVIDER=dev in production even with credentials", () => {
    expect(() => parseEnv({ ...PROD, EMAIL_PROVIDER: "dev" })).toThrow(/EMAIL_PROVIDER/);
  });

  it("refuses EMAIL_PROVIDER=http without credentials anywhere", () => {
    expect(() => parseEnv({ DATABASE_URL: PROD["DATABASE_URL"], EMAIL_PROVIDER: "http" })).toThrow(
      /EMAIL_PROVIDER=http needs/,
    );
  });

  it("lets the local production rehearsal boot on the outbox, through the named escape", () => {
    const bare = without("EMAIL_API_KEY", "SENTRY_DSN");
    const env = parseEnv({ ...bare, ALLOW_INSECURE_LOCAL_PRODUCTION: "1" });
    expect(mailConfigFor(env)).toBeNull();
  });
});
