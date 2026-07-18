/**
 * The platform capability engine (PX-1 01 §2.4, 02 G1) — the FOURTH parallel
 * partition over identity's `grants` substrate.
 *
 * The frozen `Capability` union in @desiauction/core is UNTOUCHED, as are the
 * settlement and finops engines. All four engines expand the others' sets to
 * NOTHING, in all twelve directions. `org:owner` — the most powerful set the
 * product can issue through its own UI — confers ZERO platform capabilities,
 * and `platform:admin` confers ZERO org, money or finance powers. Seeing the
 * whole platform is therefore an explicit act of trust, distinct from every
 * operational authority, and it can never be reached by accumulating them.
 *
 * Two further locks make the platform grant unforgeable from inside the product:
 *
 *   1. SCOPE. The platform is a SINGLETON scope — one well-known row, not a
 *      tenant. Both `scope_type` and `scope_id` are pinned below, so a grant on
 *      any org/tournament/team scope can never be mistaken for a platform grant.
 *
 *   2. RLS. `grants_tenant`'s WITH CHECK (migration 0004) constrains every write
 *      to `scope_type = 'org'`. No connection using the application role can
 *      insert a platform-scoped grant AT ALL — not the invite path, not the
 *      settlement/finops grant issuers, not a compromised action. The grant is
 *      installable only out-of-band, on the RLS-exempt system pool, by the
 *      seed script. PX-9 deliberately ships NO UI that issues it.
 *
 * This module is pure: no IO, no db, no environment — the same shape as the
 * three engines it sits beside.
 */

import type { GrantLike } from "@desiauction/core";

/**
 * PX-1 01 §2.4 names exactly one: `platform.admin`. Administration is an
 * observation surface, so the vocabulary stays one word wide — there is no
 * write to tier, and inventing tiers here would be the "new governance model"
 * PX-9 puts out of scope.
 */
export type PlatformCapability = "platform.admin";

export type PlatformCapabilitySet = "platform:admin";

const SETS: Record<PlatformCapabilitySet, readonly PlatformCapability[]> = {
  "platform:admin": ["platform.admin"],
};

export const PLATFORM_CAPABILITY_SETS: readonly PlatformCapabilitySet[] = ["platform:admin"];

/** The singleton scope. `scope_id` is char(26); this is the nil ULID. */
export const PLATFORM_SCOPE_TYPE = "platform";
export const PLATFORM_SCOPE_ID = "00000000000000000000000000";

export function isPlatformCapabilitySet(value: string): value is PlatformCapabilitySet {
  return (PLATFORM_CAPABILITY_SETS as readonly string[]).includes(value);
}

/** Upholds: unknown sets — the frozen, settlement and finops ones included — expand to nothing. */
export function platformCapabilitiesOf(set: string): readonly PlatformCapability[] {
  return isPlatformCapabilitySet(set) ? SETS[set] : [];
}

/**
 * Upholds: only an ACTIVE grant on the EXACT singleton platform scope confers a
 * platform capability. Scope type and scope id are both pinned — an `org:owner`
 * grant, or any grant on any tenant scope, is structurally unable to match.
 */
export function hasPlatformCapability(
  grants: readonly GrantLike[],
  capability: PlatformCapability,
): boolean {
  return grants.some(
    (grant) =>
      grant.revokedAt === null &&
      grant.scopeType === PLATFORM_SCOPE_TYPE &&
      grant.scopeId === PLATFORM_SCOPE_ID &&
      platformCapabilitiesOf(grant.capabilitySet).includes(capability),
  );
}
