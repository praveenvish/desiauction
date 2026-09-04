import { describe, expect, it } from "vitest";

import { REDACTED, scrub, scrubText } from "./scrub";

describe("scrub", () => {
  it("redacts a phone number inside an error message", () => {
    // The real one: a unique-violation message carries the value that collided.
    const message =
      'duplicate key value violates unique constraint "people_phone_uq" Key (phone)=(+919999000001) already exists';
    expect(scrubText(message)).not.toContain("9999000001");
    expect(scrubText(message)).toContain("[phone]");
  });

  it("redacts emails and provider keys in free text", () => {
    expect(scrubText("mail to owner@club.example failed")).toContain("[email]");
    expect(scrubText("using rzp_live_ABCDEF123456")).toContain("[key]");
  });

  it("redacts sensitive fields by name, at any depth", () => {
    const scrubbed = scrub({
      ok: true,
      input: { phone: "+919999000002", note: "fine" },
      headers: { authorization: "Bearer abc" },
    }) as Record<string, Record<string, unknown>>;
    expect(scrubbed["input"]?.["phone"]).toBe(REDACTED);
    expect(scrubbed["input"]?.["note"]).toBe("fine");
    expect(scrubbed["headers"]?.["authorization"]).toBe(REDACTED);
  });

  it("keeps the things an incident is actually diagnosed from", () => {
    // A scrub that ate ids and money would make the report useless — the
    // failure mode opposite to the one it exists to prevent.
    const kept = scrub({
      auctionId: "01M1FZ9EN906SRHSH2MVW1EZTN",
      amount: 2_500_000,
      lotNumber: "L001",
    }) as Record<string, unknown>;
    expect(kept["auctionId"]).toBe("01M1FZ9EN906SRHSH2MVW1EZTN");
    expect(kept["amount"]).toBe(2_500_000);
    expect(kept["lotNumber"]).toBe("L001");
  });

  it("survives a cycle rather than throwing on the way to the tracker", () => {
    const a: Record<string, unknown> = { name: "a" };
    a["self"] = a;
    expect(() => scrub(a)).not.toThrow();
  });
});
