import { describe, expect, it } from "vitest";

import {
  SUPPRESSION_SCOPES,
  isSuppressionScope,
  liftNeedsConfirmation,
  parseSuppressionContact,
} from "./suppression-contact";

describe("parseSuppressionContact — the stored shape, exactly", () => {
  it("normalizes every way a mobile is typed to E.164, on the SMS row", () => {
    for (const typed of ["9876543210", "+91 98765 43210", "919876543210", "09876543210"]) {
      expect(parseSuppressionContact(typed)).toEqual({
        ok: true,
        contact: "+919876543210",
        channel: "sms",
      });
    }
  });

  it("lowercases and trims an address, on the email row", () => {
    expect(parseSuppressionContact("  Asha@Example.COM ")).toEqual({
      ok: true,
      contact: "asha@example.com",
      channel: "email",
    });
  });

  it("refuses what cannot be either — no partial matches", () => {
    expect(parseSuppressionContact("").ok).toBe(false);
    expect(parseSuppressionContact("gmail").ok).toBe(false);
    expect(parseSuppressionContact("@example.com").ok).toBe(false);
    expect(parseSuppressionContact("a@b").ok).toBe(false);
    expect(parseSuppressionContact("12345").ok).toBe(false);
    expect(parseSuppressionContact("%").ok).toBe(false);
  });
});

describe("suppression scopes and confirmation", () => {
  it("offers global and the topics, never sign-in", () => {
    expect(SUPPRESSION_SCOPES[0]).toBe("global");
    expect(isSuppressionScope("registration")).toBe(true);
    expect(isSuppressionScope("login")).toBe(false);
    expect(isSuppressionScope("anything")).toBe(false);
  });

  it("asks for confirmation to lift what the person said, not what a mailbox did", () => {
    expect(liftNeedsConfirmation("stop")).toBe(true);
    expect(liftNeedsConfirmation("complaint")).toBe(true);
    expect(liftNeedsConfirmation("bounce")).toBe(false);
    expect(liftNeedsConfirmation("manual")).toBe(false);
  });
});
