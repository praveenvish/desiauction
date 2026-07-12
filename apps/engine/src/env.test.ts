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
});
