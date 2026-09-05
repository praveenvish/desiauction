import {
  hasSettlementCapability,
  isSettlementCapabilitySet,
  type SettlementCapability,
  type SettlementCapabilitySet,
} from "@desiauction/settlement";
import { auditLog, grants, newId, type Db } from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

import { ForbiddenError, grantsFor, requireCapability } from "../orgs/authz";
import type { SettlementActor } from "./writer";
import { logger } from "../logger";

/**
 * Settlement authorization (IP-5_ARCHITECTURE §19/§20). Identity is NOT modified:
 * settlement grants are ordinary rows in the frozen `grants` table whose
 * capability set names a settlement set. The two evaluation engines partition
 * the capability space — the frozen one expands settlement sets to nothing, and
 * this one expands frozen sets to nothing — so `org:owner` confers no money
 * powers, and a settlement grant confers no auction powers. Deliberate: trusting
 * someone with the books is its own visible act.
 */

/** The actor a settlement command runs as: identity + the grants it actually holds. */
export async function settlementActor(
  db: Db,
  personId: string,
  orgId: string,
): Promise<SettlementActor> {
  return { personId, orgId, grants: await grantsFor(db, personId) };
}

export async function canSettlement(
  db: Db,
  personId: string,
  orgId: string,
  capability: SettlementCapability,
): Promise<boolean> {
  const held = await grantsFor(db, personId);
  return hasSettlementCapability(held, { scopeType: "org", scopeId: orgId }, capability);
}

export async function requireSettlementCapability(
  db: Db,
  personId: string,
  orgId: string,
  capability: SettlementCapability,
): Promise<void> {
  if (!(await canSettlement(db, personId, orgId, capability))) {
    throw new ForbiddenError();
  }
}

export type GrantResult =
  { ok: true; grantId: string } | { ok: false; reason: "unknown_set" | "forbidden" };

/**
 * ISSUE a settlement grant — the one sanctioned cross-context write (§20).
 *
 * The frozen invite path refuses unknown capability sets by design, so no
 * existing path can mint a settlement grant. This one can, and it is gated by
 * the FROZEN `grant.issue` capability: the power to hand out money authority
 * rests exactly where the platform already vests the power to hand out
 * authority. Identity remains the storage and policy owner (its RLS write check
 * applies unchanged); settlement owns only its own vocabulary.
 */
export async function issueSettlementGrant(
  db: Db,
  actorId: string,
  orgId: string,
  personId: string,
  capabilitySet: string,
): Promise<GrantResult> {
  try {
    await requireCapability(db, actorId, { scopeType: "org", scopeId: orgId }, "grant.issue");
  } catch (error: unknown) {
    // A refusal is the right ANSWER here — `requireCapability` throws when the
    // grant is absent, and fail-closed is correct. But it also throws when the
    // database is unreachable, and that used to be indistinguishable from "you
    // may not": an operator saw "not authorized" for an outage (PA-1 §15).
    logger().warn({ err: error }, "settlement.capability_check_refused");
    return { ok: false, reason: "forbidden" };
  }
  // Nothing mints an unexpandable grant (the IP-2 invites discipline).
  if (!isSettlementCapabilitySet(capabilitySet)) {
    return { ok: false, reason: "unknown_set" };
  }
  const grantId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(grants).values({
      id: grantId,
      personId,
      scopeType: "org",
      scopeId: orgId,
      capabilitySet: capabilitySet satisfies SettlementCapabilitySet,
      grantedBy: actorId,
    });
    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "grant.issued",
      scopeType: "org",
      scopeId: orgId,
      subject: personId,
      meta: { capabilitySet, domain: "settlement" },
    });
  });
  return { ok: true, grantId };
}

/** REVOKE a settlement grant — gated by the frozen `grant.revoke`, always audited. */
export async function revokeSettlementGrant(
  db: Db,
  actorId: string,
  orgId: string,
  grantId: string,
): Promise<GrantResult> {
  try {
    await requireCapability(db, actorId, { scopeType: "org", scopeId: orgId }, "grant.revoke");
  } catch (error: unknown) {
    // A refusal is the right ANSWER here — `requireCapability` throws when the
    // grant is absent, and fail-closed is correct. But it also throws when the
    // database is unreachable, and that used to be indistinguishable from "you
    // may not": an operator saw "not authorized" for an outage (PA-1 §15).
    logger().warn({ err: error }, "settlement.capability_check_refused");
    return { ok: false, reason: "forbidden" };
  }
  const [row] = await db
    .select({ id: grants.id, capabilitySet: grants.capabilitySet, personId: grants.personId })
    .from(grants)
    .where(and(eq(grants.id, grantId), eq(grants.scopeId, orgId), isNull(grants.revokedAt)))
    .limit(1);
  if (row === undefined || !isSettlementCapabilitySet(row.capabilitySet)) {
    // A settlement action revokes settlement grants only; identity's own grants
    // stay with identity's own path.
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
      meta: { capabilitySet: row.capabilitySet, domain: "settlement" },
    });
  });
  return { ok: true, grantId };
}
