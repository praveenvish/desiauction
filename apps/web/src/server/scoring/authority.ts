import {
  auditLog,
  fixtureParticipants,
  fixtureOfficials,
  teamManagers,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { canCompetition } from "../competition/authz";
import { grantsFor } from "../orgs/authz";

export interface ScoringFixture {
  id: string;
  orgId: string;
  competitionId: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
}

/** Strongest current AUTH-1 arm, evaluated within the fixture's tenant transaction. */
export async function authorityKind(
  db: Db,
  personId: string,
  fixture: ScoringFixture,
): Promise<"a" | "b" | "c" | "d" | null> {
  if (await canCompetition(db, personId, fixture, "fixture.manage")) return "a";
  const held = await grantsFor(db, personId);
  if (
    held.some(
      (grant) =>
        grant.revokedAt === null &&
        grant.scopeType === "tournament" &&
        grant.scopeId === fixture.competitionId &&
        grant.capabilitySet === "fixture:scorer",
    )
  )
    return "b";
  const officials = await db
    .select({ id: fixtureOfficials.id })
    .from(fixtureOfficials)
    .where(
      and(
        eq(fixtureOfficials.fixtureId, fixture.id),
        eq(fixtureOfficials.orgId, fixture.orgId),
        eq(fixtureOfficials.competitionId, fixture.competitionId),
        eq(fixtureOfficials.personId, personId),
        eq(fixtureOfficials.role, "scorer"),
        isNull(fixtureOfficials.removedAt),
      ),
    );
  for (const official of officials) {
    const [delegation] = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.scopeType, "org"),
          eq(auditLog.scopeId, fixture.orgId),
          eq(auditLog.subject, fixture.id),
          eq(auditLog.action, "match.claim.handover_redeemed"),
          sql`${auditLog.meta}->>'officialId' = ${official.id}`,
          sql`${auditLog.meta}->>'inheritedAuthority' = 'd'`,
        ),
      )
      .limit(1);
    if (!delegation) return "c";
  }
  if (officials.length > 0) return "d";
  const sides = [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => id !== null);
  if (sides.length === 0) {
    const lobby = await db
      .select({ teamId: fixtureParticipants.teamId })
      .from(fixtureParticipants)
      .where(
        and(
          eq(fixtureParticipants.fixtureId, fixture.id),
          eq(fixtureParticipants.orgId, fixture.orgId),
          eq(fixtureParticipants.competitionId, fixture.competitionId),
        ),
      );
    sides.push(...lobby.map((row) => row.teamId));
  }
  if (sides.length === 0) return null;
  const [manager] = await db
    .select({ id: teamManagers.id })
    .from(teamManagers)
    .where(
      and(
        eq(teamManagers.personId, personId),
        eq(teamManagers.orgId, fixture.orgId),
        eq(teamManagers.competitionId, fixture.competitionId),
        inArray(teamManagers.teamId, sides),
        isNull(teamManagers.revokedAt),
      ),
    )
    .limit(1);
  return manager ? "d" : null;
}

export async function mayScore(
  db: Db,
  personId: string,
  fixture: ScoringFixture,
): Promise<boolean> {
  return (await authorityKind(db, personId, fixture)) !== null;
}
