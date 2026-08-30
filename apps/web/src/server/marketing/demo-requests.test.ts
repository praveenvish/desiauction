import { describe, expect, it } from "vitest";

import { validateDemoRequest, type DemoRequestInput } from "./demo-requests";

/**
 * What the public form will and will not accept. Every case here is one a real
 * person or a real bot produces: a number typed with spaces, a date in the
 * past, a source that arrived in a query string somebody edited.
 */

const NOW = new Date("2026-09-02T09:00:00.000Z");

const base: DemoRequestInput = {
  name: "Ravi Kumar",
  phone: "98765 43210",
  email: null,
  orgName: "Sunday Warriors PL",
  tournamentSize: "8-16",
  auctionOn: null,
  preferredWindow: "any",
  note: null,
  source: "schedule-demo",
  requestIp: "203.0.113.4",
};

function valid(overrides: Partial<DemoRequestInput> = {}) {
  const result = validateDemoRequest({ ...base, ...overrides }, NOW);
  if (!result.ok) {
    throw new Error(`expected valid, got ${result.field}: ${result.message}`);
  }
  return result.value;
}

describe("validateDemoRequest", () => {
  it("normalises the phone through the same parser sign-in uses", () => {
    expect(valid().phone).toBe("+919876543210");
    expect(valid({ phone: "+91 98765-43210" }).phone).toBe("+919876543210");
    expect(valid({ phone: "09876543210" }).phone).toBe("+919876543210");
  });

  it("refuses a number that is not an Indian mobile", () => {
    const result = validateDemoRequest({ ...base, phone: "12345" }, NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.field).toBe("phone");
  });

  it("treats an empty email as absent rather than invalid", () => {
    expect(valid({ email: "" }).email).toBeNull();
    expect(valid({ email: "  Ravi@Example.COM " }).email).toBe("ravi@example.com");
  });

  it("refuses an email that is present and malformed", () => {
    const result = validateDemoRequest({ ...base, email: "ravi@" }, NOW);
    expect(!result.ok && result.field).toBe("email");
  });

  it("accepts a blank auction date — most people have not fixed one", () => {
    expect(valid({ auctionOn: "" }).auctionOn).toBeNull();
    expect(valid({ auctionOn: "2026-10-15" }).auctionOn).toBe("2026-10-15");
  });

  it("refuses a date in the past, a date that does not exist, and one absurdly far off", () => {
    for (const bad of ["2020-01-01", "2026-02-31", "2099-01-01", "15/10/2026"]) {
      const result = validateDemoRequest({ ...base, auctionOn: bad }, NOW);
      expect(result.ok, `${bad} should be refused`).toBe(false);
      expect(!result.ok && result.field).toBe("auctionOn");
    }
  });

  it("accepts today, which is the boundary somebody in a hurry will hit", () => {
    expect(valid({ auctionOn: "2026-09-02" }).auctionOn).toBe("2026-09-02");
  });

  it("refuses a size or window outside the closed list", () => {
    expect(validateDemoRequest({ ...base, tournamentSize: "loads" }, NOW).ok).toBe(false);
    expect(validateDemoRequest({ ...base, preferredWindow: "3am" }, NOW).ok).toBe(false);
  });

  it("records an unrecognised source as 'other' rather than losing the lead", () => {
    // The value rides a query string on a public page and lands in an admin
    // console. It must never travel as typed, and it must never cost us the
    // request either.
    expect(valid({ source: "<script>" }).source).toBe("other");
    expect(valid({ source: "pricing" }).source).toBe("pricing");
  });

  it("trims and caps the free text, and stores an empty note as absent", () => {
    expect(valid({ note: "   " }).note).toBeNull();
    expect(valid({ note: `  ${"x".repeat(3000)}  ` }).note).toHaveLength(2000);
  });

  it("refuses a name or tournament that is blank or absurd", () => {
    expect(validateDemoRequest({ ...base, name: " " }, NOW).ok).toBe(false);
    expect(validateDemoRequest({ ...base, orgName: "x" }, NOW).ok).toBe(false);
    expect(validateDemoRequest({ ...base, name: "x".repeat(200) }, NOW).ok).toBe(false);
  });
});
