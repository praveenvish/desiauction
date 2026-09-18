import { describe, expect, it } from "vitest";

import { CHALLENGE_TTL_MS, openChallenge, sealChallenge } from "./challenge-cookie";

const KEY = "test-key-that-is-long-enough";

describe("passkey challenge cookie", () => {
  it("opens a challenge this server sealed", () => {
    expect(openChallenge(KEY, sealChallenge(KEY, "abc123"))).toBe("abc123");
  });

  it("refuses a bare challenge an attacker copied out of a captured assertion", () => {
    // The old cookie format: the challenge alone, which anyone can set.
    expect(openChallenge(KEY, "abc123")).toBeNull();
  });

  it("refuses a challenge with a forged or altered MAC", () => {
    const sealed = sealChallenge(KEY, "abc123");
    const [, expiry, mac] = sealed.split(".");
    expect(openChallenge(KEY, `zzz999.${expiry ?? ""}.${mac ?? ""}`)).toBeNull();
    expect(openChallenge("another-servers-key-000", sealed)).toBeNull();
  });

  it("refuses a challenge past its five minutes", () => {
    const now = 1_000_000;
    const sealed = sealChallenge(KEY, "abc123", now);
    expect(openChallenge(KEY, sealed, now + CHALLENGE_TTL_MS - 1)).toBe("abc123");
    expect(openChallenge(KEY, sealed, now + CHALLENGE_TTL_MS)).toBeNull();
  });
});
