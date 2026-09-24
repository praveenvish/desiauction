import { hasCapability, type Capability, type GrantLike, type Scope } from "@desiauction/core";
import { grants, type Db } from "@desiauction/db";
import { eq } from "drizzle-orm";

import { logAuthzRefused } from "../logger";
import { sharedPerRender } from "../render-memo";

// The permission evaluation engine (IP-2_DESIGN D6). Business code asks
// "does this identity hold this capability?" — never "is this an admin?".
// Evaluation is core's pure hasCapability; this module only fetches grants.

export class ForbiddenError extends Error {
  constructor() {
    super("forbidden");
    this.name = "ForbiddenError";
  }
}

/**
 * ONE GRANTS READ PER PERSON PER PAGE RENDER.
 *
 * Every permission helper in the product (`can`, `requireCapability`,
 * `canCompetition`, the settlement and finance gates) comes through here, and a
 * page asked the same question many times over: /org/[slug] read this person's
 * grants 16 times in one render, /home 10, a season's Teams tab 8 — one of every
 * six or seven queries those pages sent.
 *
 * Shared through `sharedPerRender` (render-memo.ts): only inside a server
 * render. In a server action, a route handler, a job or a test the read runs
 * exactly as before — which is what keeps this correct: every grant write
 * (createOrg, issueGrant, acceptInvite, the desk grants, erasure…) is an
 * action, and an action's own transaction must see the grant it just wrote. A
 * render never writes grants.
 *
 * Why any transaction's answer serves every other: the read filters on
 * `person_id` itself, and `grants_tenant` always admits a person's own rows
 * whatever org the transaction is scoped to — so the same rows come back under
 * every tenant context this person's pages run in.
 */
const grantsShared = sharedPerRender<GrantLike[]>();

export function grantsFor(db: Db, personId: string): Promise<GrantLike[]> {
  return grantsShared([personId], () => readGrants(db, personId));
}

async function readGrants(db: Db, personId: string): Promise<GrantLike[]> {
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
    await logAuthzRefused({ personId, scope: `${scope.scopeType}:${scope.scopeId}`, capability });
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
