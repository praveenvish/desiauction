import { hasCapability, type GrantLike } from "@desiauction/core";
import { hasSettlementCapability } from "@desiauction/settlement";
import { describe, expect, it } from "vitest";

import { finopsCapabilitiesOf, hasFinopsCapability } from "./capabilities";

/**
 * THE THREE-WAY PARTITION (IP-6_ARCHITECTURE §19, ADR-5), all six directions:
 * frozen ⇄ settlement ⇄ finops ⇄ frozen. Every engine expands the others'
 * sets to NOTHING — no grant row can ever confer power in a foreign engine.
 */

const ORG = { scopeType: "org" as const, scopeId: "01ORG00000000000000000000A" };

function grant(set: string, revoked = false): GrantLike {
  return {
    scopeType: "org",
    scopeId: ORG.scopeId,
    capabilitySet: set,
    revokedAt: revoked ? new Date() : null,
  };
}

describe("finops capability engine — the third partition", () => {
  it("named sets expand exactly as ratified; unknown sets expand to nothing", () => {
    expect(finopsCapabilitiesOf("finops:clerk")).toEqual([
      "finops.view",
      "finops.document",
      "finops.dispatch",
    ]);
    expect(finopsCapabilitiesOf("finops:controller")).toContain("finops.override");
    expect(finopsCapabilitiesOf("finops:accountant")).not.toContain("finops.close");
    expect(finopsCapabilitiesOf("org:owner")).toEqual([]);
    expect(finopsCapabilitiesOf("settlement:controller")).toEqual([]);
    expect(finopsCapabilitiesOf("finops:superuser")).toEqual([]);
    expect(finopsCapabilitiesOf("")).toEqual([]);
  });

  it("SIX DIRECTIONS: no engine honours a foreign set", () => {
    const frozenGrant = [grant("org:owner")];
    const settlementGrant = [grant("settlement:controller")];
    const finopsGrant = [grant("finops:controller")];

    // finops engine refuses frozen and settlement sets.
    expect(hasFinopsCapability(frozenGrant, ORG, "finops.view")).toBe(false);
    expect(hasFinopsCapability(settlementGrant, ORG, "finops.view")).toBe(false);
    // settlement engine refuses finops sets (and frozen ones — re-proven).
    expect(hasSettlementCapability(finopsGrant, ORG, "settlement.view")).toBe(false);
    expect(hasSettlementCapability(frozenGrant, ORG, "settlement.view")).toBe(false);
    // frozen engine refuses finops sets (and settlement ones — re-proven).
    expect(hasCapability(finopsGrant, ORG, "org.manage")).toBe(false);
    expect(hasCapability(settlementGrant, ORG, "org.manage")).toBe(false);
    // And each engine honours its OWN sets.
    expect(hasFinopsCapability(finopsGrant, ORG, "finops.override")).toBe(true);
    expect(hasSettlementCapability(settlementGrant, ORG, "settlement.override")).toBe(true);
  });

  it("revoked grants and wrong scopes confer nothing", () => {
    expect(hasFinopsCapability([grant("finops:controller", true)], ORG, "finops.view")).toBe(false);
    expect(
      hasFinopsCapability(
        [grant("finops:controller")],
        { scopeType: "org", scopeId: "01ORG00000000000000000000B" },
        "finops.view",
      ),
    ).toBe(false);
    expect(
      hasFinopsCapability(
        [{ ...grant("finops:controller"), scopeType: "competition" }],
        ORG,
        "finops.view",
      ),
    ).toBe(false);
  });

  it("separation of powers: clerk cannot export/operate/close; accountant cannot seal or reopen", () => {
    const clerk = [grant("finops:clerk")];
    const accountant = [grant("finops:accountant")];
    expect(hasFinopsCapability(clerk, ORG, "finops.export")).toBe(false);
    expect(hasFinopsCapability(clerk, ORG, "finops.operate")).toBe(false);
    expect(hasFinopsCapability(clerk, ORG, "finops.close")).toBe(false);
    expect(hasFinopsCapability(accountant, ORG, "finops.close")).toBe(false);
    expect(hasFinopsCapability(accountant, ORG, "finops.override")).toBe(false);
    expect(hasFinopsCapability(accountant, ORG, "finops.operate")).toBe(true);
  });
});
