import { describe, expect, it } from "vitest";

import { detailOf, labelForEvent } from "./inbox-events";

describe("inbox detail — an ALLOWLIST over the ledger's meta column", () => {
  it("renders the two facts a sold player came for, in a fixed order", () => {
    expect(
      detailOf({
        competitionId: "01C",
        competition: "Desi Cup",
        team: "Jaipur XI",
        price: "₹55,000",
      }),
    ).toBe("Jaipur XI · ₹55,000");
    // Order is the allowlist's, not the object's: meta is JSON from the
    // database and its key order is not a contract.
    expect(detailOf({ price: "₹55,000", team: "Jaipur XI" })).toBe("Jaipur XI · ₹55,000");
  });

  it("NEVER leaks a meta key it was not told to show", () => {
    // The person-scoped ledger carries security rows on the same table. Dumping
    // the column would have put request-shaped facts on a page the first time
    // someone added an event type — so anything outside the allowlist is
    // dropped, whatever it is called and whatever it holds.
    expect(
      detailOf({
        ip: "203.0.113.9",
        userAgent: "Mozilla/5.0",
        sessionId: "01SESSION",
        competitionId: "01C",
      }),
    ).toBeNull();
    // A partial row still renders what it legitimately has.
    expect(detailOf({ ip: "203.0.113.9", team: "Jaipur XI" })).toBe("Jaipur XI");
  });

  it("survives the shapes a JSON column actually produces", () => {
    expect(detailOf(null)).toBeNull();
    expect(detailOf(undefined)).toBeNull();
    expect(detailOf("a string row")).toBeNull();
    expect(detailOf({})).toBeNull();
    // Non-strings are not coerced: "team: 42" is a bug upstream, and printing
    // "42" would hide it behind something that looks like a squad name.
    expect(detailOf({ team: 42, price: null })).toBeNull();
    expect(detailOf({ team: "", price: "₹55,000" })).toBe("₹55,000");
  });
});

describe("inbox labels", () => {
  it("names the auction outcomes a player waits for", () => {
    expect(labelForEvent("auction.sold")).toBe("You were sold at auction");
    expect(labelForEvent("auction.unsold")).toBe("The auction finished without a bid for you");
  });

  it("falls back to the raw key rather than hiding an unknown event", () => {
    expect(labelForEvent("some.future.event")).toBe("some.future.event");
  });
});
