import { describe, expect, it } from "vitest";

import { describeGrantTarget, parseGrantTarget } from "./grant-target";

describe("parseGrantTarget", () => {
  it("reads an address as an email, the way sign-in stores it", () => {
    expect(parseGrantTarget("  Founder@Example.COM ")).toEqual({
      kind: "email",
      email: "founder@example.com",
    });
  });

  it("reads anything else as an Indian mobile, in every shape sign-in accepts", () => {
    for (const input of [
      "+919876543210",
      "9876543210",
      "09876543210",
      "919876543210",
      "+91 98765 43210",
    ]) {
      expect(parseGrantTarget(input)).toEqual({ kind: "phone", phone: "+919876543210" });
    }
  });

  it("refuses what can be neither, instead of guessing", () => {
    expect(parseGrantTarget("not-an-address@")).toEqual({
      kind: "invalid",
      input: "not-an-address@",
    });
    expect(parseGrantTarget("12345")).toEqual({ kind: "invalid", input: "12345" });
    expect(parseGrantTarget("+91XXXXXXXXXX").kind).toBe("invalid");
  });

  it("describes a target the way the operator would write it", () => {
    expect(describeGrantTarget({ kind: "email", email: "a@b.in" })).toBe("a@b.in");
    expect(describeGrantTarget({ kind: "phone", phone: "+919876543210" })).toBe("+919876543210");
  });
});
