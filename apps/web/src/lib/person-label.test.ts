import { describe, expect, it } from "vitest";

import { personContact, personInitials, personLabel } from "./person-label";

describe("personLabel", () => {
  it("prefers the name they gave", () => {
    expect(personLabel({ name: "Ravi Kumar", phone: "+919876543210" })).toBe("Ravi Kumar");
  });

  it("falls back to the phone, as every screen used to", () => {
    expect(personLabel({ name: null, phone: "+919876543210" })).toBe("+919876543210");
  });

  it("falls back to the EMAIL when there is no phone", () => {
    // The case 0062 created. Without this the row renders empty — a blank line
    // in a settlement register beside real money.
    expect(personLabel({ name: null, phone: null, email: "a@b.test" })).toBe("a@b.test");
  });

  it("treats a whitespace-only name as no name", () => {
    expect(personLabel({ name: "   ", phone: "+919876543210" })).toBe("+919876543210");
  });

  it("says the projection is incomplete rather than inventing a person", () => {
    // `people_reachable_check` guarantees one of the two exists, so reaching
    // here means a caller selected neither — a bug in the query, not a real
    // account, and the label should not read like a real answer.
    expect(personLabel({ name: null, phone: null, email: null })).toBe("Unnamed account");
  });
});

describe("personContact", () => {
  it("groups the phone the way every contact line already did", () => {
    expect(personContact({ phone: "+919876543210", email: "a@b.test" })).toBe("+91 98765 43210");
  });

  it("shows the email when the account has no phone", () => {
    expect(personContact({ phone: null, email: "a@b.test" })).toBe("a@b.test");
  });

  it("renders a dash rather than an empty cell", () => {
    expect(personContact({ phone: null, email: null })).toBe("—");
  });
});

describe("personInitials", () => {
  it("takes the first code point of up to two words of the name", () => {
    expect(personInitials({ name: "Ravi Kumar Singh" })).toBe("RK");
  });

  it("falls back through the same ladder as the name beside it", () => {
    expect(personInitials({ name: null, phone: "+919876543210" })).toBe("+");
    expect(personInitials({ name: null, phone: null, email: "ravi@b.test" })).toBe("R");
  });

  it("handles a non-latin name without splitting a surrogate pair", () => {
    expect(personInitials({ name: "रवि कुमार" })).toBe("रक");
  });
});
