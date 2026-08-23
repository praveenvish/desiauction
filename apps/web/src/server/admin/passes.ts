import { tierLabel, type Tier } from "@desiauction/core";
import {
  competitions,
  organizations,
  passUpgradeRequests,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

/**
 * OPEN PASS REQUESTS — a projection, and read-only like every other one.
 *
 * It lives beside `views.ts` and obeys the same rule: no insert, no update, no
 * delete, no raw mutation, no transaction. The runtime proof in
 * `admin-foundation.regression.test.ts` drives it against a database handle
 * whose mutation verbs throw, exactly as it drives the rest of the console.
 *
 * The WRITE that answers a request is `pass-actions.ts`, a separate module
 * behind a separate grant. Keeping them apart is the point: administration
 * still observes, and the one thing it can now change is reachable only by
 * somebody holding `platform:billing`.
 */

export interface OpenPassRequest {
  readonly id: string;
  readonly slug: string;
  readonly seasonName: string;
  readonly orgName: string;
  readonly fromTier: Tier;
  readonly fromTierName: string;
  readonly requestedTier: Tier;
  readonly requestedTierName: string;
  readonly note: string | null;
  readonly requestedByName: string | null;
  readonly requestedByPhone: string | null;
  readonly requestedAt: string;
  /** What the season currently holds, so the answer is not given blind. */
  readonly teams: number;
  readonly players: number;
}

export interface AnsweredPassRequest {
  readonly slug: string;
  readonly seasonName: string;
  readonly fromTier: Tier;
  readonly requestedTier: Tier;
  readonly outcome: "granted" | "declined";
  readonly resolvedAt: string;
  readonly resolvedByName: string | null;
}

export interface PassQueue {
  readonly open: readonly OpenPassRequest[];
  readonly recent: readonly AnsweredPassRequest[];
}

export async function passQueue(db: Db): Promise<PassQueue> {
  const openRows = await db
    .select({
      id: passUpgradeRequests.id,
      competitionId: passUpgradeRequests.competitionId,
      slug: competitions.slug,
      seasonName: competitions.name,
      orgName: organizations.name,
      fromTier: passUpgradeRequests.fromTier,
      requestedTier: passUpgradeRequests.requestedTier,
      note: passUpgradeRequests.note,
      byName: people.name,
      byPhone: people.phone,
      at: passUpgradeRequests.createdAt,
    })
    .from(passUpgradeRequests)
    .innerJoin(competitions, eq(competitions.id, passUpgradeRequests.competitionId))
    .innerJoin(organizations, eq(organizations.id, passUpgradeRequests.orgId))
    .leftJoin(people, eq(people.id, passUpgradeRequests.requestedBy))
    .where(isNull(passUpgradeRequests.resolvedAt))
    .orderBy(asc(passUpgradeRequests.createdAt))
    .limit(50);

  // What the season actually holds, so the answer is not given blind. Counted
  // in one grouped pass rather than per row — and the queue is small by
  // construction anyway: a platform with fifty open pass requests has a
  // commercial problem, not a pagination problem.
  const ids = openRows.map((row) => row.competitionId);
  const [teamCounts, playerCounts] = await Promise.all([
    ids.length === 0
      ? []
      : db
          .select({ competitionId: teams.competitionId, n: sql<number>`count(*)::int` })
          .from(teams)
          .where(inArray(teams.competitionId, ids))
          .groupBy(teams.competitionId),
    ids.length === 0
      ? []
      : db
          .select({ competitionId: registrations.competitionId, n: sql<number>`count(*)::int` })
          .from(registrations)
          .where(
            and(inArray(registrations.competitionId, ids), eq(registrations.status, "approved")),
          )
          .groupBy(registrations.competitionId),
  ]);
  const teamsBy = new Map(teamCounts.map((row) => [row.competitionId, row.n]));
  const playersBy = new Map(playerCounts.map((row) => [row.competitionId, row.n]));

  const open: OpenPassRequest[] = openRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    seasonName: row.seasonName,
    orgName: row.orgName,
    fromTier: row.fromTier,
    fromTierName: tierLabel(row.fromTier),
    requestedTier: row.requestedTier,
    requestedTierName: tierLabel(row.requestedTier),
    note: row.note,
    requestedByName: row.byName,
    requestedByPhone: row.byPhone,
    requestedAt: row.at.toISOString(),
    teams: teamsBy.get(row.competitionId) ?? 0,
    players: playersBy.get(row.competitionId) ?? 0,
  }));

  const recentRows = await db
    .select({
      slug: competitions.slug,
      seasonName: competitions.name,
      fromTier: passUpgradeRequests.fromTier,
      requestedTier: passUpgradeRequests.requestedTier,
      outcome: passUpgradeRequests.outcome,
      resolvedAt: passUpgradeRequests.resolvedAt,
      byName: people.name,
    })
    .from(passUpgradeRequests)
    .innerJoin(competitions, eq(competitions.id, passUpgradeRequests.competitionId))
    .leftJoin(people, eq(people.id, passUpgradeRequests.resolvedBy))
    .where(eq(passUpgradeRequests.outcome, "granted"))
    .orderBy(desc(passUpgradeRequests.resolvedAt))
    .limit(10);

  return {
    open,
    recent: recentRows.flatMap((row) =>
      row.resolvedAt === null || row.outcome === null
        ? []
        : [
            {
              slug: row.slug,
              seasonName: row.seasonName,
              fromTier: row.fromTier,
              requestedTier: row.requestedTier,
              outcome: row.outcome,
              resolvedAt: row.resolvedAt.toISOString(),
              resolvedByName: row.byName,
            },
          ],
    ),
  };
}
