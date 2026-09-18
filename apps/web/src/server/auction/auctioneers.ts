import { auditLog, grants, newId, orgMembers, people, type Db } from "@desiauction/db";
import { and, asc, eq, isNull } from "drizzle-orm";

/**
 * THE AUCTIONEER — a per-season conduct grant (launch polish, Phase 3).
 *
 * Until now only a club OWNER could run auction night (auction.conduct lives in
 * org:owner). The founder asked for an auctioneer who does not own the club —
 * the commentator, a senior member, a hired host — for ONE season. That is a
 * grant with scope ("tournament", competitionId) and set "auction:conductor"
 * (core capabilities.ts): conduct only; compensating undo stays with owners.
 * canCompetition already ORs the competition scope with the org scope, so every
 * conduct gate (cockpit, live room, engine commands) honours it unchanged.
 *
 * Every function takes a tenant-scoped db for the season's org; migration 0076
 * lets that boundary write a competition-scoped grant for its OWN seasons only.
 */

export const AUCTIONEER_SET = "auction:conductor";
const SCOPE = "tournament";

export interface AuctioneerRow {
  personId: string;
  name: string;
  assignedAt: string;
}

export async function auctioneersOf(db: Db, competitionId: string): Promise<AuctioneerRow[]> {
  const rows = await db
    .select({ personId: grants.personId, name: people.name, at: grants.createdAt })
    .from(grants)
    .innerJoin(people, eq(people.id, grants.personId))
    .where(
      and(
        eq(grants.scopeType, SCOPE),
        eq(grants.scopeId, competitionId),
        eq(grants.capabilitySet, AUCTIONEER_SET),
        isNull(grants.revokedAt),
      ),
    )
    .orderBy(asc(grants.createdAt));
  return rows.map((row) => ({
    personId: row.personId,
    name: row.name ?? "Unnamed member",
    assignedAt: row.at.toISOString(),
  }));
}

/** Club members who could be made auctioneer: anyone in the club not already one. */
export async function auctioneerCandidates(
  db: Db,
  orgId: string,
  competitionId: string,
): Promise<{ personId: string; name: string }[]> {
  const [members, current] = await Promise.all([
    db
      .select({ personId: orgMembers.personId, name: people.name })
      .from(orgMembers)
      .innerJoin(people, eq(people.id, orgMembers.personId))
      .where(eq(orgMembers.orgId, orgId))
      .orderBy(asc(people.name)),
    auctioneersOf(db, competitionId),
  ]);
  const already = new Set(current.map((row) => row.personId));
  return members
    .filter((member) => !already.has(member.personId) && member.name !== null)
    .map((member) => ({ personId: member.personId, name: member.name ?? "" }));
}

export type AssignResult =
  { ok: true } | { ok: false; reason: "not_a_member" | "already_assigned" | "not_assigned" };

export async function assignAuctioneer(
  db: Db,
  input: { orgId: string; competitionId: string; personId: string; actorId: string },
): Promise<AssignResult> {
  const [member] = await db
    .select({ personId: orgMembers.personId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.personId, input.personId)))
    .limit(1);
  // A season's auctioneer is someone the club already knows: invite them to
  // the club first. That keeps the season's page (membership-gated) open to
  // them, and never lets a grant name a stranger.
  if (member === undefined) {
    return { ok: false, reason: "not_a_member" };
  }
  const current = await auctioneersOf(db, input.competitionId);
  if (current.some((row) => row.personId === input.personId)) {
    return { ok: false, reason: "already_assigned" };
  }
  await db.insert(grants).values({
    id: newId(),
    personId: input.personId,
    scopeType: SCOPE,
    scopeId: input.competitionId,
    capabilitySet: AUCTIONEER_SET,
    grantedBy: input.actorId,
  });
  await db.insert(auditLog).values({
    id: newId(),
    actor: input.actorId,
    action: "auction.auctioneer.assigned",
    scopeType: "org",
    scopeId: input.orgId,
    subject: input.competitionId,
    meta: { personId: input.personId },
  });
  return { ok: true };
}

export async function removeAuctioneer(
  db: Db,
  input: { orgId: string; competitionId: string; personId: string; actorId: string },
): Promise<AssignResult> {
  const revoked = await db
    .update(grants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(grants.personId, input.personId),
        eq(grants.scopeType, SCOPE),
        eq(grants.scopeId, input.competitionId),
        eq(grants.capabilitySet, AUCTIONEER_SET),
        isNull(grants.revokedAt),
      ),
    )
    .returning({ id: grants.id });
  if (revoked.length === 0) {
    return { ok: false, reason: "not_assigned" };
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: input.actorId,
    action: "auction.auctioneer.removed",
    scopeType: "org",
    scopeId: input.orgId,
    subject: input.competitionId,
    meta: { personId: input.personId },
  });
  return { ok: true };
}
