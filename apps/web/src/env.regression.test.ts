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
  // PRR P1-1: the two-role recipe must be in effect and the roles distinct.
  SYSTEM_DATABASE_URL: "postgres://system:pass@localhost:5433/desiauction",
  OTP_PROVIDER: "msg91",
  MSG91_AUTH_KEY: "key",
  MSG91_TEMPLATE_ID: "template",
  // Absent until now, which meant this "fully configured production
  // environment" silently carried `ws://localhost:4000/ws` — a plaintext socket
  // a page served over https refuses to open. Only preflight ever looked.
  ENGINE_PUBLIC_WS_URL: "wss://engine.desiauction.in/ws",
  MEDIA_STORAGE: "bucket",
  MEDIA_PUBLIC_BASE: "https://media.desiauction.in",
  // PI-1 P5 (D1): the media bucket signer's credential set.
  MEDIA_S3_ENDPOINT: "https://s3.ap-south-1.amazonaws.com",
  MEDIA_S3_REGION: "ap-south-1",
  MEDIA_S3_BUCKET: "desiauction-media",
  MEDIA_S3_ACCESS_KEY_ID: "AKIA",
  MEDIA_S3_SECRET_ACCESS_KEY: "secret",
  // PRR P1-4: the shared finops artifact store, with its S3 credentials.
  FINOPS_ARTIFACT_STORE: "bucket",
  FINOPS_S3_ENDPOINT: "https://s3.ap-south-1.amazonaws.com",
  FINOPS_S3_REGION: "ap-south-1",
  FINOPS_S3_BUCKET: "desiauction-finops",
  FINOPS_S3_ACCESS_KEY_ID: "AKIA",
  FINOPS_S3_SECRET_ACCESS_KEY: "secret",
  // PRR P1-6: error tracking is mandatory in production.
  SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0",
  ENGINE_SECRET: "x".repeat(48),
  DEMO_TOKEN_SECRET: "d".repeat(48),
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
    // MEDIA_PUBLIC_BASE is no longer in this table: it is DERIVED from the
    // endpoint and the bucket, so leaving it out is now correct rather than
    // fatal. The derivation is asserted below instead.
    // PI-1 P5 (D1): bucket mode without its signer credentials must refuse.
    ["MEDIA_S3 credentials", { MEDIA_S3_BUCKET: undefined }, /MEDIA_S3_BUCKET/],
    ["ENGINE_SECRET default", { ENGINE_SECRET: "dev-engine-secret" }, /ENGINE_SECRET/],
    ["ENGINE_SECRET short", { ENGINE_SECRET: "short-but-eight" }, /at least 32 characters/],
    ["PUBLIC_BASE_URL", { PUBLIC_BASE_URL: "http://localhost:3000" }, /localhost/],
    ["RP_ID", { RP_ID: "localhost" }, /RP_ID/],
    ["RP_ORIGINS", { RP_ORIGINS: "http://localhost:3000" }, /RP_ORIGINS/],
    // PRR P1-1 / P1-4 / P1-6: the boot guards added in the remediation pass.
    ["SYSTEM_DATABASE_URL unset", { SYSTEM_DATABASE_URL: undefined }, /SYSTEM_DATABASE_URL/],
    [
      "SYSTEM_DATABASE_URL equals app",
      { SYSTEM_DATABASE_URL: "postgres://user:pass@localhost:5433/desiauction" },
      /DIFFERENT role/,
    ],
    [
      "FINOPS_ARTIFACT_STORE filesystem",
      { FINOPS_ARTIFACT_STORE: "filesystem" },
      /FINOPS_ARTIFACT_STORE/,
    ],
    ["FINOPS bucket missing config", { FINOPS_S3_BUCKET: undefined }, /FINOPS_S3/],
    ["SENTRY_DSN unset", { SENTRY_DSN: undefined }, /SENTRY_DSN/],
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

/**
 * WHAT THE DOMAIN DECIDES, DECIDED ONCE.
 *
 * Four settings were `PUBLIC_BASE_URL` and `MEDIA_S3_ENDPOINT` written out
 * again in another shape, and typing a fact twice is how two valid values come
 * to disagree. `RP_ID` was the dangerous one: nothing compared it to the URL
 * being served — here or in `preflight:production`, where the only test was
 * "not localhost" — so a domain typo deployed green and silently stopped every
 * enrolled passkey from verifying.
 */
describe("web env — values the domain already decides", () => {
  it("derives RP_ID and RP_ORIGINS from the URL actually served", () => {
    const env = parseEnv(raw({ ...PROD_OK, RP_ID: undefined, RP_ORIGINS: undefined }));
    expect(env.RP_ID).toBe("desiauction.in");
    expect(env.RP_ORIGINS).toEqual(["https://desiauction.in"]);
  });

  it("takes the HOSTNAME, never the host — a port in RP_ID is rejected by browsers", () => {
    const env = parseEnv(
      raw({
        ...PROD_OK,
        ALLOW_INSECURE_LOCAL_PRODUCTION: "1",
        PUBLIC_BASE_URL: "https://desiauction.in:8443",
        RP_ID: undefined,
      }),
    );
    expect(env.RP_ID).toBe("desiauction.in");
  });

  it("derives the media public base and the finops endpoint from the one MinIO", () => {
    const env = parseEnv(
      raw({ ...PROD_OK, MEDIA_PUBLIC_BASE: undefined, FINOPS_S3_ENDPOINT: undefined }),
    );
    expect(env.MEDIA_PUBLIC_BASE).toBe("https://s3.ap-south-1.amazonaws.com/desiauction-media");
    expect(env.FINOPS_S3_ENDPOINT).toBe("https://s3.ap-south-1.amazonaws.com");
  });

  it("never overrides a value the operator set", () => {
    // Derivation is a default, not a policy. The two settings were kept apart
    // because they may legitimately differ.
    const env = parseEnv(raw({ ...PROD_OK, FINOPS_S3_ENDPOINT: "https://other.example.in" }));
    expect(env.FINOPS_S3_ENDPOINT).toBe("https://other.example.in");
  });

  it("treats an empty string as unset — a blank line in an env file is not a value", () => {
    const env = parseEnv(raw({ ...PROD_OK, RP_ID: "   " }));
    expect(env.RP_ID).toBe("desiauction.in");
  });

  it("REFUSES an RP_ID that is not the host being served", () => {
    // The check that did not exist. Individually valid, mutually wrong, and
    // undetectable from any log.
    expect(() => parseEnv(raw({ ...PROD_OK, RP_ID: "desiauction.com" }))).toThrow(/RP_ID/);
  });

  it("ALLOWS a parent domain, which is how one credential covers subdomains", () => {
    expect(() =>
      parseEnv(
        raw({
          ...PROD_OK,
          PUBLIC_BASE_URL: "https://app.desiauction.in",
          RP_ID: "desiauction.in",
          RP_ORIGINS: "https://app.desiauction.in",
        }),
      ),
    ).not.toThrow();
  });

  it("REFUSES RP_ORIGINS that omits the origin the product is served from", () => {
    expect(() => parseEnv(raw({ ...PROD_OK, RP_ORIGINS: "https://www.desiauction.in" }))).toThrow(
      /RP_ORIGINS/,
    );
  });

  it("REFUSES a plaintext engine socket in production", () => {
    // A page served over https cannot open ws://. Live auctions break for
    // everyone; every other surface looks perfect.
    expect(() =>
      parseEnv(raw({ ...PROD_OK, ENGINE_PUBLIC_WS_URL: "ws://engine.desiauction.in/ws" })),
    ).toThrow(/wss:\/\//);
  });

  it("leaves development alone — nothing sets PUBLIC_BASE_URL locally", () => {
    /*
     * Load-bearing. `RP_ORIGINS` defaults to BOTH localhost ports and the e2e
     * suite runs on the second one, so deriving unconditionally would have
     * quietly dropped :3050 and broken the passkey specs.
     */
    const env = parseEnv(raw({ ...DEV }));
    expect(env.RP_ORIGINS).toContain("http://localhost:3050");
  });
});
