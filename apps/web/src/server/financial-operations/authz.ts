import {
  hasFinopsCapability,
  isFinopsCapabilitySet,
  type FinopsCapability,
  type FinopsCapabilitySet,
} from "@desiauction/financial-operations";
import type { FinopsActor } from "@desiauction/financial-operations/server";
import { auditLog, grants, newId, type Db } from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

import { ForbiddenError, grantsFor, requireCapability } from "../orgs/authz";

/**
 * Financial-operations authorization (IP-6_ARCHITECTURE §19, ADR-5). Identity
 * is NOT modified: finops grants are ordinary rows in the frozen `grants`
 * table whose capability set names a finops set. THREE evaluation engines now
 * partition the capability space — frozen, settlement, finops — and each
 * expands the others' sets to nothing (certified in all six directions).
 * Trusting someone with the money's MOUTH (documents, dispatch, close) is its
 * own visible act, distinct from trusting them with the books.
 */

/** The actor a finops command runs as: identity + the grants it actually holds. */
export async function finopsActor(db: Db, personId: string, orgId: string): Promise<FinopsActor> {
  return { personId, orgId, grants: await grantsFor(db, personId) };
}

export async function canFinops(
  db: Db,
  personId: string,
  orgId: string,
  capability: FinopsCapability,
): Promise<boolean> {
  const held = await grantsFor(db, personId);
  return hasFinopsCapability(held, { scopeType: "org", scopeId: orgId }, capability);
}

export async function requireFinopsCapability(
  db: Db,
  personId: string,
  orgId: string,
  capability: FinopsCapability,
): Promise<void> {
  if (!(await canFinops(db, personId, orgId, capability))) {
    throw new ForbiddenError();
  }
}

export type FinopsGrantResult =
  { ok: true; grantId: string } | { ok: false; reason: "unknown_set" | "forbidden" };

/**
 * ISSUE a finops grant — IP-6's one sanctioned cross-context write (the exact
 * IP-5 §20 precedent): gated by the FROZEN `grant.issue`, refusing unknown
 * sets at creation, audited in-transaction. Identity remains the storage and
 * policy owner; finops owns only its own vocabulary.
 */
export async function issueFinopsGrant(
  db: Db,
  actorId: string,
  orgId: string,
  personId: string,
  capabilitySet: string,
): Promise<FinopsGrantResult> {
  try {
    await requireCapability(db, actorId, { scopeType: "org", scopeId: orgId }, "grant.issue");
  } catch {
    return { ok: false, reason: "forbidden" };
  }
  // Nothing mints an unexpandable grant (the IP-2 invites discipline).
  if (!isFinopsCapabilitySet(capabilitySet)) {
    return { ok: false, reason: "unknown_set" };
  }
  const grantId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(grants).values({
      id: grantId,
      personId,
      scopeType: "org",
      scopeId: orgId,
      capabilitySet: capabilitySet satisfies FinopsCapabilitySet,
      grantedBy: actorId,
    });
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "grant.issued",
      scopeType: "org",
      scopeId: orgId,
      subject: personId,
      meta: { capabilitySet, domain: "financial-operations" },
    });
  });
  return { ok: true, grantId };
}

/** REVOKE a finops grant — gated by the frozen `grant.revoke`, always audited. */
export async function revokeFinopsGrant(
  db: Db,
  actorId: string,
  orgId: string,
  grantId: string,
): Promise<FinopsGrantResult> {
  try {
    await requireCapability(db, actorId, { scopeType: "org", scopeId: orgId }, "grant.revoke");
  } catch {
    return { ok: false, reason: "forbidden" };
  }
  const [row] = await db
    .select({ id: grants.id, capabilitySet: grants.capabilitySet, personId: grants.personId })
    .from(grants)
    .where(and(eq(grants.id, grantId), eq(grants.scopeId, orgId), isNull(grants.revokedAt)))
    .limit(1);
  if (row === undefined || !isFinopsCapabilitySet(row.capabilitySet)) {
    // A finops action revokes finops grants only; every other domain keeps its
    // own revocation path.
    return { ok: false, reason: "unknown_set" };
  }
  await db.transaction(async (tx) => {
    await tx.update(grants).set({ revokedAt: new Date() }).where(eq(grants.id, grantId));
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "grant.revoked",
      scopeType: "org",
      scopeId: orgId,
      subject: row.personId,
      meta: { capabilitySet: row.capabilitySet, domain: "financial-operations" },
    });
  });
  return { ok: true, grantId };
}
