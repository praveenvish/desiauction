import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { authCodeSecret } from "./auth-secret";

const ENGINE = "e".repeat(40);
const AUTH = "a".repeat(40);

/** What code-digest.ts computes, given the root it is handed. */
const digest = (root: string): string =>
  createHmac("sha256", `short-code-digest:${root}`)
    .update("otp:login +919999000001 123456")
    .digest("hex");

describe("the key sign-in codes are stored under", () => {
  it("is the engine's secret while no separate key is set — so a deploy changes nothing", () => {
    expect(authCodeSecret({ ENGINE_SECRET: ENGINE })).toBe(ENGINE);
    expect(authCodeSecret({ ENGINE_SECRET: ENGINE, AUTH_CODE_SECRET: undefined })).toBe(ENGINE);
    // The digest a code was stored under yesterday is the digest it is checked
    // against today: codes in flight across this deploy still match.
    expect(digest(authCodeSecret({ ENGINE_SECRET: ENGINE }))).toBe(digest(ENGINE));
  });

  it("is its own key once one is set — and the engine's secret then opens nothing", () => {
    const root = authCodeSecret({ ENGINE_SECRET: ENGINE, AUTH_CODE_SECRET: AUTH });
    expect(root).toBe(AUTH);
    expect(digest(root)).not.toBe(digest(ENGINE));
  });
});
