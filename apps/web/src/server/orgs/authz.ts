import { hasCapability, type Capability, type GrantLike, type Scope } from "@desiauction/core";
import { grants, type Db } from "@desiauction/db";
import { eq } from "drizzle-orm";

// The permission evaluation engine (IP-2_DESIGN D6). Business code asks
// "does this identity hold this capability?" — never "is this an admin?".
// Evaluation is core's pure hasCapability; this module only fetches grants.

export class ForbiddenError extends Error {
  constructor() {
    super("forbidden");
    this.name = "ForbiddenError";
  }
}

export async function grantsFor(db: Db, personId: string): Promise<GrantLike[]> {
  return db
    .select({
      scopeType: grants.scopeType,
      scopeId: grants.scopeId,
      capabilitySet: grants.capabilitySet,
      revokedAt: grants.revokedAt,
    })
    .from(grants)
    .where(eq(grants.personId, personId));
}

/** Throws ForbiddenError unless the person holds the capability on the scope. */
export async function requireCapability(
  db: Db,
  personId: string,
  scope: Scope,
  capability: Capability,
): Promise<void> {
  const held = await grantsFor(db, personId);
  if (!hasCapability(held, scope, capability)) {
    throw new ForbiddenError();
  }
}

export async function can(
  db: Db,
  personId: string,
  scope: Scope,
  capability: Capability,
): Promise<boolean> {
  return hasCapability(await grantsFor(db, personId), scope, capability);
}
