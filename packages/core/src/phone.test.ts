import { describe, expect, it } from "vitest";

import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("normalizes every common Indian input shape to E.164", () => {
    for (const input of [
      "9876543210",
      "+91 98765 43210",
      "91 9876543210",
      "098765-43210",
      "98765 43210",
    ]) {
      expect(normalizePhone(input)).toEqual({ ok: true, phone: "+919876543210" });
    }
  });

  it("rejects non-mobiles, short numbers and junk as a value", () => {
    for (const input of ["12345", "5876543210", "abcdefghij", "", "+1 555 0100"]) {
      expect(normalizePhone(input)).toEqual({ ok: false, reason: "invalid" });
    }
  });
});
