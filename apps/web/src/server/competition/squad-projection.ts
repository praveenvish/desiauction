import { registrations, teams, type Db } from "@desiauction/db";
import { and, eq, sql } from "drizzle-orm";

/**
 * THE squad read model (DA-09).
 *
 * Squad size used to be derived three different ways: Teams counted
 * `registrations.team_id`, the season overview counted sold lots plus icons,
 * and the broadcast board counted sold lots alone. For one team at one moment
 * they reported 1/15, 16/15 and 15 — including a fraction above its own
 * maximum, which is how you know none of them was authoritative.
 *
 * There is one definition now, and it is the column the sale writes (DA-01):
 * a squad is every registration pointing at the team. That covers players won
 * at auction and pre-signed icons alike, because both occupy a place in the XI
 * — which is also why icons count toward `squadMax`. A team with an icon buys
 * one fewer at auction; that is the rule the interface has always claimed.
 */
export interface TeamSquad {
  teamId: string;
  /** Auction wins plus pre-signed players — everyone who occupies a slot. */
  size: number;
  /** Pre-signed (icon) players, already inside `size`. */
  preSigned: number;
}

export async function squadSizes(db: Db, competitionId: string): Promise<Map<string, TeamSquad>> {
  const rows = await db
    .select({
      teamId: registrations.teamId,
      size: sql<number>`count(*)::int`,
      preSigned: sql<number>`count(*) filter (where ${registrations.isIcon})::int`,
    })
    .from(registrations)
    .where(
      and(eq(registrations.competitionId, competitionId), sql`${registrations.teamId} is not null`),
    )
    .groupBy(registrations.teamId);
  const byTeam = new Map<string, TeamSquad>();
  for (const row of rows) {
    if (row.teamId === null) {
      continue;
    }
    byTeam.set(row.teamId, { teamId: row.teamId, size: row.size, preSigned: row.preSigned });
  }
  return byTeam;
}

/**
 * Teams short of `squadMin`. Every team in the competition counts, including
 * the ones that never bid — a team with nobody is the shortest squad there is.
 */
export async function teamsBelowSquadMin(
  db: Db,
  competitionId: string,
  squadMin: number,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teams)
    .where(
      and(
        eq(teams.competitionId, competitionId),
        sql`(
          select count(*) from ${registrations}
          where ${registrations.teamId} = ${teams.id}
        ) < ${squadMin}`,
      ),
    );
  return row?.count ?? 0;
}
