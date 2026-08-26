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
});
