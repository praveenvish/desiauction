import { hasCapability, type Capability } from "@desiauction/core";
import type { Db } from "@desiauction/db";

import { ForbiddenError, grantsFor } from "../orgs/authz";

// IP-3 scope hierarchy (IP-3_DESIGN D4), realized by COMPOSING the frozen pure
// hasCapability — never modifying it. A capability on a competition is conferred
// by either an org-scoped grant (owners/staff run all their org's competitions)
// or a competition-scoped grant (per-competition delegation, issued later). The
// frozen engine still does exact-scope matching; this layer ORs the two scopes.

export interface CompetitionScope {
  orgId: string;
  competitionId?: string;
}

export async function canCompetition(
  db: Db,
  personId: string,
  scope: CompetitionScope,
  capability: Capability,
): Promise<boolean> {
  const held = await grantsFor(db, personId);
  if (hasCapability(held, { scopeType: "org", scopeId: scope.orgId }, capability)) {
    return true;
  }
  if (
    scope.competitionId !== undefined &&
    hasCapability(held, { scopeType: "tournament", scopeId: scope.competitionId }, capability)
  ) {
    return true;
  }
  return false;
}

/** Throws ForbiddenError unless the person holds the capability on org or competition scope. */
export async function requireCompetitionCapability(
  db: Db,
  personId: string,
  scope: CompetitionScope,
  capability: Capability,
): Promise<void> {
  if (!(await canCompetition(db, personId, scope, capability))) {
    throw new ForbiddenError();
  }
}
