import { capabilitiesOf, hasCapability, type GrantLike } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import {
  SETTLEMENT_CAPABILITY_SETS,
  hasSettlementCapability,
  isSettlementCapabilitySet,
  settlementCapabilitiesOf,
} from "./capabilities";

const ORG = { scopeType: "org" as const, scopeId: "01ORG00000000000000000000A" };
const OTHER_ORG = { scopeType: "org" as const, scopeId: "01ORG00000000000000000000B" };

function grant(capabilitySet: string, scopeId = ORG.scopeId, revoked = false): GrantLike {
  return {
    scopeType: "org",
    scopeId,
    capabilitySet,
    revokedAt: revoked ? new Date("2026-01-01") : null,
  };
}

describe("Settlement capabilities — the partition, proven in BOTH directions", () => {
  it("a settlement grant confers ZERO frozen capabilities", () => {
    for (const set of SETTLEMENT_CAPABILITY_SETS) {
      // The frozen engine, unmodified, expands an unknown set to nothing.
      expect(capabilitiesOf(set)).toEqual([]);
      expect(hasCapability([grant(set)], ORG, "auction.conduct")).toBe(false);
      expect(hasCapability([grant(set)], ORG, "org.manage")).toBe(false);
      expect(hasCapability([grant(set)], ORG, "grant.issue")).toBe(false);
    }
  });

  it("a frozen grant confers ZERO settlement capabilities — org:owner is not a treasurer", () => {
    for (const set of ["org:owner", "org:staff", "viewer"]) {
      expect(settlementCapabilitiesOf(set)).toEqual([]);
      expect(hasSettlementCapability([grant(set)], ORG, "settlement.view")).toBe(false);
      expect(hasSettlementCapability([grant(set)], ORG, "settlement.manage")).toBe(false);
      expect(hasSettlementCapability([grant(set)], ORG, "settlement.override")).toBe(false);
    }
  });

  it("expands the ratified sets, and only those", () => {
    expect(settlementCapabilitiesOf("settlement:officer")).toEqual([
      "settlement.view",
      "settlement.manage",
      "settlement.collect",
      "settlement.export",
    ]);
    expect(settlementCapabilitiesOf("settlement:controller")).toContain("settlement.override");
    expect(isSettlementCapabilitySet("settlement:auditor")).toBe(false);
    expect(settlementCapabilitiesOf("settlement:auditor")).toEqual([]);
  });

  it("separates the powers: collecting money is not forgiving it", () => {
    const officer = [grant("settlement:officer")];
    expect(hasSettlementCapability(officer, ORG, "settlement.collect")).toBe(true);
    expect(hasSettlementCapability(officer, ORG, "settlement.manage")).toBe(true);
    expect(hasSettlementCapability(officer, ORG, "settlement.override")).toBe(false);

    const controller = [grant("settlement:controller")];
    expect(hasSettlementCapability(controller, ORG, "settlement.override")).toBe(true);
  });

  it("fails closed on revocation, on the wrong scope, and on no grants at all", () => {
    expect(
      hasSettlementCapability(
        [grant("settlement:controller", ORG.scopeId, true)],
        ORG,
        "settlement.view",
      ),
    ).toBe(false);
    expect(
      hasSettlementCapability(
        [grant("settlement:controller", OTHER_ORG.scopeId)],
        ORG,
        "settlement.view",
      ),
    ).toBe(false);
    expect(
      hasSettlementCapability(
        [
          {
            scopeType: "tournament",
            scopeId: ORG.scopeId,
            capabilitySet: "settlement:controller",
            revokedAt: null,
          },
        ],
        ORG,
        "settlement.view",
      ),
    ).toBe(false);
    expect(hasSettlementCapability([], ORG, "settlement.view")).toBe(false);
  });
});
