import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

describe("every credential change asks for it", () => {
  /**
   * The rule lives in each action, so a new or edited action can forget it —
   * which is how removing a passkey shipped without it (gate P3) while adding
   * one had it. Read the source: each of these bodies must ask.
   */
  const source = readFileSync(resolve(__dirname, "actions.ts"), "utf8");
  function body(name: string): string {
    const start = source.indexOf(`export async function ${name}(`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const next = source.indexOf("\nexport ", start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  }

  it.each(["startPasskeyEnrollmentAction", "finishPasskeyEnrollmentAction", "removePasskeyAction"])(
    "%s checks signedInRecently",
    (name) => {
      expect(body(name)).toContain("signedInRecently(session)");
    },
  );
});
