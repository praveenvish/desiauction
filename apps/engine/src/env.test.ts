import { describe, expect, it } from "vitest";

import { parseEnv } from "./env.js";

const validEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5433/desiauction",
};

describe("parseEnv", () => {
  it("applies safe defaults over a minimal valid environment", () => {
    const env = parseEnv(validEnv);
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(4000);
    expect(env.APP_VERSION).toBe("dev");
  });

  it("refuses to start without DATABASE_URL (fail-closed, §11)", () => {
    expect(() => parseEnv({})).toThrow(/invalid environment/);
  });

  it("refuses malformed values instead of guessing", () => {
    expect(() => parseEnv({ ...validEnv, PORT: "not-a-port" })).toThrow(/invalid environment/);
    expect(() => parseEnv({ ...validEnv, LOG_LEVEL: "loud" })).toThrow(/invalid environment/);
  });

  /*
   * PRODUCTION REFUSES AN OPEN SPECTATE DOOR.
   *
   * A ticket authorises an AUCTION, not a PAGE. With no origin allowlist the
   * engine accepts a socket from anywhere as long as the ticket is valid, so a
   * scraped ticket works from a hostile page. Unset was previously a silent
   * "do not check" in production — every other dev-default is boot-refused, and
   * this one now is too (matched by the preflight's ENGINE_ALLOWED_ORIGINS gate).
   */
  const productionEnv: NodeJS.ProcessEnv = {
    ...validEnv,
    NODE_ENV: "production",
    ENGINE_SECRET: "x".repeat(32),
    SENTRY_DSN: "https://key@o0.ingest.sentry.io/0",
    TRUSTED_PROXY_COUNT: "1",
  };

  it("REFUSES production without an origin allowlist", () => {
    expect(() => parseEnv(productionEnv)).toThrow(/ENGINE_ALLOWED_ORIGINS/);
  });

  it("starts in production once the allowlist is pinned", () => {
    const env = parseEnv({
      ...productionEnv,
      ENGINE_ALLOWED_ORIGINS: "https://desiauction.in, https://www.desiauction.in",
    });
    expect(env.ENGINE_ALLOWED_ORIGINS).toEqual([
      "https://desiauction.in",
      "https://www.desiauction.in",
    ]);
  });

  it("leaves development free to run without one", () => {
    expect(parseEnv(validEnv).ENGINE_ALLOWED_ORIGINS).toEqual([]);
  });

  /*
   * GO-LIVE GATE P1-3 / P3. The web tier refused to boot without a Sentry DSN
   * and the engine did not; and behind Caddy a zero proxy count keys every
   * socket on Caddy's address, turning the per-client cap into one global cap.
   */
  const pinned: NodeJS.ProcessEnv = {
    ...productionEnv,
    ENGINE_ALLOWED_ORIGINS: "https://desiauction.in",
  };
  const without = (source: NodeJS.ProcessEnv, ...keys: string[]): NodeJS.ProcessEnv =>
    Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));

  it("REFUSES production without a Sentry DSN", () => {
    expect(() => parseEnv(without(pinned, "SENTRY_DSN"))).toThrow(/SENTRY_DSN/);
  });

  it("REFUSES production with no trusted proxy in front", () => {
    expect(() => parseEnv({ ...pinned, TRUSTED_PROXY_COUNT: "0" })).toThrow(/TRUSTED_PROXY_COUNT/);
    expect(() => parseEnv(without(pinned, "TRUSTED_PROXY_COUNT"))).toThrow(/TRUSTED_PROXY_COUNT/);
  });

  it("the rehearsal escape relaxes only those two — never the secret or the origins", () => {
    const rehearsal = {
      ...without(pinned, "SENTRY_DSN", "TRUSTED_PROXY_COUNT"),
      ALLOW_INSECURE_LOCAL_PRODUCTION: "1",
    };
    expect(parseEnv(rehearsal).TRUSTED_PROXY_COUNT).toBe(0);
    expect(() => parseEnv({ ...rehearsal, ENGINE_ALLOWED_ORIGINS: "" })).toThrow(
      /ENGINE_ALLOWED_ORIGINS/,
    );
    expect(() => parseEnv({ ...rehearsal, ENGINE_SECRET: "short-secret" })).toThrow(
      /ENGINE_SECRET/,
    );
  });

  it("development needs neither", () => {
    expect(parseEnv(validEnv).TRUSTED_PROXY_COUNT).toBe(0);
  });
});
