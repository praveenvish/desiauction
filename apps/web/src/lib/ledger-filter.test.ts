import { describe, expect, it } from "vitest";

import { ledgerRowMatches, parseLedgerFilter } from "./ledger-filter";

describe("ledger filter", () => {
  it("reads only the three known filters from the URL", () => {
    expect(parseLedgerFilter("results")).toBe("results");
    expect(parseLedgerFilter("bids")).toBe("bids");
    expect(parseLedgerFilter("all")).toBe("all");
    expect(parseLedgerFilter(undefined)).toBeNull();
    expect(parseLedgerFilter("nonsense")).toBeNull();
  });

  it("results are what happened to a player — never the setup of the night", () => {
    for (const result of [
      "SOLD",
      "UNSOLD",
      "Lot withdrawn",
      "UNDO — lot reopened (compensates #4)",
    ]) {
      expect(ledgerRowMatches("results", result)).toBe(true);
    }
    for (const result of ["Lot prepared", "Owner invited", "Lot queued", "Bid accepted"]) {
      expect(ledgerRowMatches("results", result)).toBe(false);
    }
  });

  it("bids are every bid placed, refused or voided", () => {
    for (const result of ["Bid accepted", "Bid rejected", "Bid voided"]) {
      expect(ledgerRowMatches("bids", result)).toBe(true);
    }
    expect(ledgerRowMatches("bids", "SOLD")).toBe(false);
    expect(ledgerRowMatches("all", "Lot prepared")).toBe(true);
  });
});
