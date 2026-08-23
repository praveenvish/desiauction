import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

/**
 * THE WEB TIER'S PRODUCTION BOOT CHECKS.
 *
 * `apps/engine/src/env.ts` has refused the dev secret in production since IP-4
 * and has a test to prove it. This file had none, and no production refinement
 * either — so every dev-only default (OTP to a table, media to local disk, the
 * published engine secret, a localhost base URL) would boot a production web
 * tier that reported healthy and was silently broken. Found in the 2026-08-22
 * production rehearsal; these tests are the fence.
 */

/**
 * `NodeJS.ProcessEnv` is augmented in this app to require NODE_ENV, which is
 * exactly the variable these cases vary — so the fixtures are plain records and
 * the cast happens once, at the boundary parseEnv actually accepts.
 */
type RawEnv = Parameters<typeof parseEnv>[0];
type Raw = Record<string, string | undefined>;
const raw = (value: Raw): RawEnv => value as RawEnv;

const DEV: Raw = {
  DATABASE_URL: "postgres://user:pass@localhost:5433/desiauction",
};

const PROD_OK: Raw = {
  ...DEV,
  NODE_ENV: "production",
  OTP_PROVIDER: "msg91",
  MSG91_AUTH_KEY: "key",
  MSG91_TEMPLATE_ID: "template",
  MEDIA_STORAGE: "bucket",
  MEDIA_PUBLIC_BASE: "https://media.desiauction.in",
  ENGINE_SECRET: "x".repeat(48),
  PUBLIC_BASE_URL: "https://desiauction.in",
  RP_ID: "desiauction.in",
  RP_ORIGINS: "https://desiauction.in",
};

describe("web env — development stays effortless", () => {
  it("boots on DATABASE_URL alone, with the local defaults", () => {
    const env = parseEnv(raw(DEV));
    expect(env.NODE_ENV).toBe("development");
    expect(env.OTP_PROVIDER).toBe("dev");
    expect(env.MEDIA_STORAGE).toBe("local");
  });

  it("still refuses a missing DATABASE_URL", () => {
    expect(() => parseEnv(raw({}))).toThrow(/invalid environment/);
  });
});

describe("web env — production refuses every dev-only default", () => {
  it("accepts a fully configured production environment", () => {
    expect(() => parseEnv(raw(PROD_OK))).not.toThrow();
  });

  const CASES: [string, Raw, RegExp][] = [
    ["OTP_PROVIDER", { OTP_PROVIDER: "dev" }, /OTP_PROVIDER=dev/],
    ["MEDIA_STORAGE", { MEDIA_STORAGE: "local" }, /MEDIA_STORAGE=local/],
    ["MEDIA_PUBLIC_BASE", { MEDIA_PUBLIC_BASE: undefined }, /MEDIA_PUBLIC_BASE/],
    ["ENGINE_SECRET default", { ENGINE_SECRET: "dev-engine-secret" }, /ENGINE_SECRET/],
    ["ENGINE_SECRET short", { ENGINE_SECRET: "short-but-eight" }, /at least 32 characters/],
    ["PUBLIC_BASE_URL", { PUBLIC_BASE_URL: "http://localhost:3000" }, /localhost/],
    ["RP_ID", { RP_ID: "localhost" }, /RP_ID/],
    ["RP_ORIGINS", { RP_ORIGINS: "http://localhost:3000" }, /RP_ORIGINS/],
  ];

  it.each(CASES)("refuses to serve production with %s", (_name, override, message) => {
    expect(() => parseEnv(raw({ ...PROD_OK, ...override }))).toThrow(message);
  });
});

describe("web env — the two doors that must stay open", () => {
  it("lets `next build` compile: production NODE_ENV, none of the deploy's variables", () => {
    // The build runs with NODE_ENV=production by design and cannot be given the
    // deployment's secrets. Refusing here would make the app uncompilable.
    expect(() =>
      parseEnv(raw({ ...DEV, NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })),
    ).not.toThrow();
  });

  it("lets the local production rehearsal run behind its named escape", () => {
    expect(() =>
      parseEnv(raw({ ...DEV, NODE_ENV: "production", ALLOW_INSECURE_LOCAL_PRODUCTION: "1" })),
    ).not.toThrow();
    // …and the escape is off unless it is explicitly set.
    expect(() => parseEnv(raw({ ...DEV, NODE_ENV: "production" }))).toThrow(/invalid environment/);
  });
});
