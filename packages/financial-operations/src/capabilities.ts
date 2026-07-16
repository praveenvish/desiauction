/**
 * The finops capability engine (IP-6_ARCHITECTURE §19, ADR-5) — the THIRD
 * parallel partition over identity's `grants` substrate.
 *
 * The frozen `Capability` union and the frozen settlement module are both
 * untouched. All three engines expand the others' sets to NOTHING, in all six
 * directions — money-mouth authority (documents, dispatch, close) is an
 * explicit, per-person, per-org act of trust distinct from money authority
 * itself.
 */

import type { GrantLike, Scope } from "@desiauction/core";

export type FinopsCapability =
  // read registers, snapshots, boards
  | "finops.view"
  // profile and series lifecycle
  | "finops.manage"
  // issue receipts/invoices/corrections (commands arrive with M-IP6-2)
  | "finops.document"
  // request/resend deliveries
  | "finops.dispatch"
  // request exports
  | "finops.export"
  // run/acknowledge operations: attest days, note exceptions, recover, rewind
  | "finops.operate"
  // seal a fiscal year
  | "finops.close"
  // the high-friction power: reopen a sealed year
  | "finops.override";

export type FinopsCapabilitySet = "finops:clerk" | "finops:accountant" | "finops:controller";

const SETS: Record<FinopsCapabilitySet, readonly FinopsCapability[]> = {
  "finops:clerk": ["finops.view", "finops.document", "finops.dispatch"],
  "finops:accountant": [
    "finops.view",
    "finops.document",
    "finops.dispatch",
    "finops.export",
    "finops.operate",
    "finops.manage",
  ],
  "finops:controller": [
    "finops.view",
    "finops.document",
    "finops.dispatch",
    "finops.export",
    "finops.operate",
    "finops.manage",
    "finops.close",
    "finops.override",
  ],
};

export const FINOPS_CAPABILITY_SETS: readonly FinopsCapabilitySet[] = [
  "finops:clerk",
  "finops:accountant",
  "finops:controller",
];

export function isFinopsCapabilitySet(value: string): value is FinopsCapabilitySet {
  return (FINOPS_CAPABILITY_SETS as readonly string[]).includes(value);
}

/** Upholds: unknown sets — frozen and settlement ones included — expand to nothing. */
export function finopsCapabilitiesOf(set: string): readonly FinopsCapability[] {
  return isFinopsCapabilitySet(set) ? SETS[set] : [];
}

/** Upholds: only ACTIVE grants on the EXACT scope confer finops capabilities. */
export function hasFinopsCapability(
  grants: readonly GrantLike[],
  scope: Scope,
  capability: FinopsCapability,
): boolean {
  return grants.some(
    (grant) =>
      grant.revokedAt === null &&
      grant.scopeType === scope.scopeType &&
      grant.scopeId === scope.scopeId &&
      finopsCapabilitiesOf(grant.capabilitySet).includes(capability),
  );
}
