import { describe, expect, it } from "vitest";

import { capabilitiesOf, hasCapability, isCapabilitySet } from "./capabilities";

const ORG = { scopeType: "org" as const, scopeId: "org_1" };

function grant(overrides: Partial<Parameters<typeof hasCapability>[0][number]> = {}) {
  return {
    scopeType: "org",
    scopeId: "org_1",
    capabilitySet: "org:owner",
    revokedAt: null,
    ...overrides,
  };
}

describe("capabilitiesOf", () => {
  it("expands named sets; owner strictly contains staff", () => {
    const owner = capabilitiesOf("org:owner");
    const staff = capabilitiesOf("org:staff");
    expect(staff.every((cap) => owner.includes(cap))).toBe(true);
    expect(owner.length).toBeGreaterThan(staff.length);
  });

  it("unknown sets expand to NOTHING — fail closed", () => {
    expect(capabilitiesOf("org:superadmin")).toEqual([]);
    expect(capabilitiesOf("")).toEqual([]);
    expect(isCapabilitySet("org:superadmin")).toBe(false);
  });

  it("viewer holds no capabilities", () => {
    expect(capabilitiesOf("viewer")).toEqual([]);
  });
});

describe("hasCapability", () => {
  it("grants confer their set's capabilities on the exact scope", () => {
    expect(hasCapability([grant()], ORG, "org.members.invite")).toBe(true);
    expect(hasCapability([grant({ capabilitySet: "org:staff" })], ORG, "player.verify")).toBe(true);
  });

  it("staff lacks owner capabilities (no escalation via set)", () => {
    const grants = [grant({ capabilitySet: "org:staff" })];
    expect(hasCapability(grants, ORG, "grant.issue")).toBe(false);
    expect(hasCapability(grants, ORG, "org.members.invite")).toBe(false);
  });

  it("revoked grants confer nothing", () => {
    expect(hasCapability([grant({ revokedAt: new Date() })], ORG, "org.manage")).toBe(false);
  });

  it("scope must match exactly — no cross-org, no cross-type bleed", () => {
    expect(hasCapability([grant()], { ...ORG, scopeId: "org_2" }, "org.manage")).toBe(false);
    expect(
      hasCapability([grant()], { scopeType: "tournament", scopeId: "org_1" }, "org.manage"),
    ).toBe(false);
  });

  it("empty grant lists confer nothing", () => {
    expect(hasCapability([], ORG, "org.manage")).toBe(false);
  });
});
