/**
 * Grants, not roles (C-8): a Grant = (person, scope, capability set). Named
 * sets exist for ergonomics only — business code asks about CAPABILITIES,
 * never set names. This module is the pure evaluation engine every surface
 * and the engine itself will consume; it knows nothing about storage.
 */

export type Capability =
  | "org.manage"
  | "org.members.invite"
  | "org.members.remove"
  | "grant.issue"
  | "grant.revoke"
  | "tournament.create"
  | "tournament.manage"
  | "player.verify"
  | "auction.conduct"
  // Competition domain (IP-3, additive — the sanctioned closed-union growth path).
  | "competition.create"
  | "competition.manage"
  | "team.manage"
  | "registration.review"
  // Fixtures & venues (M-IP3-3, same additive path).
  | "venue.manage"
  | "fixture.manage";

export type CapabilitySet = "org:owner" | "org:staff" | "viewer";

const SETS: Record<CapabilitySet, readonly Capability[]> = {
  "org:owner": [
    "org.manage",
    "org.members.invite",
    "org.members.remove",
    "grant.issue",
    "grant.revoke",
    "tournament.create",
    "tournament.manage",
    "player.verify",
    "auction.conduct",
    "competition.create",
    "competition.manage",
    "team.manage",
    "registration.review",
    "venue.manage",
    "fixture.manage",
  ],
  "org:staff": [
    "tournament.manage",
    "player.verify",
    "team.manage",
    "registration.review",
    "venue.manage",
    "fixture.manage",
  ],
  viewer: [],
};

export const CAPABILITY_SETS: readonly CapabilitySet[] = ["org:owner", "org:staff", "viewer"];

export function isCapabilitySet(value: string): value is CapabilitySet {
  return (CAPABILITY_SETS as readonly string[]).includes(value);
}

/** Upholds: unknown sets expand to nothing — fail closed, never open. */
export function capabilitiesOf(set: string): readonly Capability[] {
  return isCapabilitySet(set) ? SETS[set] : [];
}

export type ScopeType = "org" | "tournament" | "team";

export interface Scope {
  scopeType: ScopeType;
  scopeId: string;
}

export interface GrantLike {
  scopeType: string;
  scopeId: string;
  capabilitySet: string;
  revokedAt: Date | null;
}

/**
 * Upholds: only ACTIVE grants on the EXACT scope confer capabilities.
 * (Scope hierarchies — org grants implying tournament access — arrive with
 * tournaments in IP-3, as an explicit rule here, never ad hoc in callers.)
 */
export function hasCapability(
  grants: readonly GrantLike[],
  scope: Scope,
  capability: Capability,
): boolean {
  return grants.some(
    (grant) =>
      grant.revokedAt === null &&
      grant.scopeType === scope.scopeType &&
      grant.scopeId === scope.scopeId &&
      capabilitiesOf(grant.capabilitySet).includes(capability),
  );
}
