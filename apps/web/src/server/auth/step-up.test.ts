import { describe, expect, it } from "vitest";

import { STEP_UP_WINDOW_MS, signedInRecently, type SessionInfo } from "./sessions";

function session(signedInAt: number): SessionInfo {
  return {
    sessionId: "s",
    personId: "p",
    phone: null,
    email: null,
    name: null,
    signedInAt: new Date(signedInAt),
  };
}

describe("step-up before adding a way back into the account", () => {
  it("a session signed in moments ago may add a credential", () => {
    const now = 10_000_000;
    expect(signedInRecently(session(now - 60_000), now)).toBe(true);
  });

  it("a session older than the window must sign in again — a stolen cookie cannot plant one", () => {
    const now = 10_000_000;
    expect(signedInRecently(session(now - STEP_UP_WINDOW_MS - 1), now)).toBe(false);
  });
});
