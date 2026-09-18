import {
  auditLog,
  fixtureLineups,
  fixtures,
  newId,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { shownName } from "./shown-name";

/**
 * WHO PLAYED EACH MATCH (launch polish, Phase 3) — the domain half.
 *
 * Every function takes a tenant-scoped `db` (the caller opens the boundary) and
 * a competition it has already resolved and gated. A lineup is a SET per team
 * per fixture: saving replaces the team's set, so "unticked" is recorded as
 * surely as "ticked", and a second save is a correction, not an append.
 */

export interface LineupSide {
  teamId: string;
  teamName: string;
  /** True once this team's lineup has been saved at least once. */
  recorded: boolean;
  players: {
    registrationId: string;
    name: string;
    role: string | null;
    isCaptain: boolean;
    played: boolean;
  }[];
}

export interface LineupFixture {
  id: string;
  number: string;
  round: number | null;
  kickoffAt: string | null;
  status: string;
  home: { id: string; name: string };
  away: { id: string; name: string };
  /** Players recorded per side, or null when that side is not recorded. */
  recorded: { home: number | null; away: number | null };
}

/** Two-sided fixtures only: a lobby's lineups are a later question. */
export async function lineupFixtures(db: Db, competitionId: string): Promise<LineupFixture[]> {
  const [rows, teamRows, counts] = await Promise.all([
    db
      .select({
        id: fixtures.id,
        number: fixtures.fixtureNumber,
        round: fixtures.round,
        kickoffAt: fixtures.kickoffAt,
        status: fixtures.status,
        homeTeamId: fixtures.homeTeamId,
        awayTeamId: fixtures.awayTeamId,
      })
      .from(fixtures)
      .where(and(eq(fixtures.competitionId, competitionId), isNotNull(fixtures.homeTeamId)))
      .orderBy(asc(fixtures.kickoffAt), asc(fixtures.seq)),
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.competitionId, competitionId)),
    db
      .select({ fixtureId: fixtureLineups.fixtureId, teamId: fixtureLineups.teamId })
      .from(fixtureLineups)
      .where(eq(fixtureLineups.competitionId, competitionId)),
  ]);
  const teamName = new Map(teamRows.map((team) => [team.id, team.name]));
  const tally = new Map<string, number>();
  for (const row of counts) {
    const key = `${row.fixtureId}:${row.teamId}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return rows.flatMap((row) => {
    if (row.homeTeamId === null || row.awayTeamId === null) return [];
    return [
      {
        id: row.id,
        number: row.number,
        round: row.round,
        kickoffAt: row.kickoffAt,
        status: row.status,
        home: { id: row.homeTeamId, name: teamName.get(row.homeTeamId) ?? "Home" },
        away: { id: row.awayTeamId, name: teamName.get(row.awayTeamId) ?? "Away" },
        recorded: {
          home: tally.get(`${row.id}:${row.homeTeamId}`) ?? null,
          away: tally.get(`${row.id}:${row.awayTeamId}`) ?? null,
        },
      },
    ];
  });
}

/** Both squads of one fixture, each player marked with whether they played. */
export async function lineupSides(
  db: Db,
  competitionId: string,
  fixture: LineupFixture,
): Promise<LineupSide[]> {
  const [squad, played] = await Promise.all([
    db
      .select({
        registrationId: registrations.id,
        teamId: registrations.teamId,
        name: shownName,
        role: registrations.role,
        isCaptain: registrations.isCaptain,
      })
      .from(registrations)
      .innerJoin(people, eq(people.id, registrations.personId))
      .where(
        and(
          eq(registrations.competitionId, competitionId),
          eq(registrations.status, "approved"),
          inArray(registrations.teamId, [fixture.home.id, fixture.away.id]),
        ),
      )
      .orderBy(asc(shownName)),
    db
      .select({ registrationId: fixtureLineups.registrationId, teamId: fixtureLineups.teamId })
      .from(fixtureLineups)
      .where(eq(fixtureLineups.fixtureId, fixture.id)),
  ]);
  const playedIds = new Set(played.map((row) => row.registrationId));
  const recordedTeams = new Set(played.map((row) => row.teamId));
  return [fixture.home, fixture.away].map((side) => ({
    teamId: side.id,
    teamName: side.name,
    recorded: recordedTeams.has(side.id),
    players: squad
      .filter((row) => row.teamId === side.id)
      .map((row) => ({
        registrationId: row.registrationId,
        name: row.name ?? "Unnamed player",
        role: row.role,
        isCaptain: row.isCaptain,
        played: playedIds.has(row.registrationId),
      })),
  }));
}

export type SaveLineupResult =
  { ok: true; played: number } | { ok: false; reason: "not_found" | "not_a_side" | "not_in_squad" };

/**
 * Replace one team's lineup for one fixture.
 *
 * Refuses rather than filters: a registration that is not an approved member
 * of THIS team's squad in THIS season is a tampered or stale request, and
 * silently dropping it would record a lineup nobody chose.
 */
export async function saveLineup(
  db: Db,
  input: {
    competitionId: string;
    orgId: string;
    fixtureId: string;
    teamId: string;
    registrationIds: readonly string[];
    actorId: string;
  },
): Promise<SaveLineupResult> {
  const [fixture] = await db
    .select({ homeTeamId: fixtures.homeTeamId, awayTeamId: fixtures.awayTeamId })
    .from(fixtures)
    .where(and(eq(fixtures.id, input.fixtureId), eq(fixtures.competitionId, input.competitionId)))
    .limit(1);
  if (fixture === undefined) {
    return { ok: false, reason: "not_found" };
  }
  if (fixture.homeTeamId !== input.teamId && fixture.awayTeamId !== input.teamId) {
    return { ok: false, reason: "not_a_side" };
  }
  const wanted = [...new Set(input.registrationIds)];
  if (wanted.length > 0) {
    const eligible = await db
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          inArray(registrations.id, wanted),
          eq(registrations.competitionId, input.competitionId),
          eq(registrations.teamId, input.teamId),
          eq(registrations.status, "approved"),
        ),
      );
    if (eligible.length !== wanted.length) {
      return { ok: false, reason: "not_in_squad" };
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(fixtureLineups)
      .where(
        and(eq(fixtureLineups.fixtureId, input.fixtureId), eq(fixtureLineups.teamId, input.teamId)),
      );
    if (wanted.length > 0) {
      await tx.insert(fixtureLineups).values(
        wanted.map((registrationId) => ({
          fixtureId: input.fixtureId,
          registrationId,
          teamId: input.teamId,
          orgId: input.orgId,
          competitionId: input.competitionId,
          recordedBy: input.actorId,
        })),
      );
    }
    await tx.insert(auditLog).values({
      id: newId(),
      actor: input.actorId,
      action: "fixture.lineup.recorded",
      scopeType: "org",
      scopeId: input.orgId,
      subject: input.fixtureId,
      meta: { teamId: input.teamId, played: wanted.length },
    });
  });
  return { ok: true, played: wanted.length };
}
