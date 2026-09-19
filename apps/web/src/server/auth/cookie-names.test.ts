import { describe, expect, it } from "vitest";

import { SESSION_COOKIE, challengeCookieName, sessionCookieName } from "./sessions";

describe("cookie names (security review, launch Phase 5)", () => {
  it("uses the __Host- prefix wherever the cookie is Secure", () => {
    // The browser then refuses the cookie unless it is Secure, host-only and
    // Path=/ — no sibling subdomain can plant a session under this name.
    expect(sessionCookieName(true)).toBe("__Host-da_session");
    expect(challengeCookieName(true)).toBe("__Host-da_pk_challenge");
  });

  it("keeps the plain names where cookies cannot be Secure", () => {
    // Browsers reject a __Host- cookie without Secure outright: on local http
    // and the WebKit rehearsal harness the prefix would sign nobody in.
    expect(sessionCookieName(false)).toBe(SESSION_COOKIE);
    expect(challengeCookieName(false)).toBe("da_pk_challenge");
  });
});
