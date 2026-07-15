/**
 * The settlement capability engine (IP-5_ARCHITECTURE §20).
 *
 * The frozen `Capability` union in @desiauction/core is UNTOUCHED — that growth
 * path closed at ip4-frozen. Settlement owns its own vocabulary instead, stored
 * as ordinary rows in identity's `grants` table (whose `capability_set` is
 * unconstrained text by design).
 *
 * The load-bearing property is the PARTITION, and it is symmetrical:
 *   • the frozen engine expands an unknown set to nothing, so a settlement
 *     grant confers ZERO frozen capabilities;
 *   • this engine recognises only settlement sets, so `org:owner` / `org:staff`
 *     confer ZERO settlement capabilities.
 * Neither engine can be tricked into honouring the other's sets. Money powers
 * are therefore always an explicit, per-person, per-org act of trust.
 */

import type { GrantLike, Scope } from "@desiauction/core";

export type SettlementCapability =
  // read the desk, cases, statements, wallets
  | "settlement.view"
  // case lifecycle: open, verify, compute, settle, close
  | "settlement.manage"
  // record money in (attestations; gateway collection arrives with M-IP5-2)
  | "settlement.collect"
  // the high-friction powers: waive, adjust, reopen, void, reverse, exit discrepancy
  | "settlement.override"
  | "settlement.export";

export type SettlementCapabilitySet = "settlement:officer" | "settlement:controller";

const SETS: Record<SettlementCapabilitySet, readonly SettlementCapability[]> = {
  "settlement:officer": [
    "settlement.view",
    "settlement.manage",
    "settlement.collect",
    "settlement.export",
  ],
  "settlement:controller": [
    "settlement.view",
    "settlement.manage",
    "settlement.collect",
    "settlement.export",
    "settlement.override",
  ],
};

export const SETTLEMENT_CAPABILITY_SETS: readonly SettlementCapabilitySet[] = [
  "settlement:officer",
  "settlement:controller",
];

export function isSettlementCapabilitySet(value: string): value is SettlementCapabilitySet {
  return (SETTLEMENT_CAPABILITY_SETS as readonly string[]).includes(value);
}

/** Upholds: unknown sets — the frozen ones included — expand to nothing. */
export function settlementCapabilitiesOf(set: string): readonly SettlementCapability[] {
  return isSettlementCapabilitySet(set) ? SETS[set] : [];
}

/** Upholds: only ACTIVE grants on the EXACT scope confer settlement capabilities. */
export function hasSettlementCapability(
  grants: readonly GrantLike[],
  scope: Scope,
  capability: SettlementCapability,
): boolean {
  return grants.some(
    (grant) =>
      grant.revokedAt === null &&
      grant.scopeType === scope.scopeType &&
      grant.scopeId === scope.scopeId &&
      settlementCapabilitiesOf(grant.capabilitySet).includes(capability),
  );
}
