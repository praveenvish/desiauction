import { sportPack } from "@desiauction/core";
import {
  lobbyFormat,
  parseSeasonScoringRules,
  type Conditions,
  type PlacementFormat,
} from "@desiauction/core/scoring";
import {
  competitions,
  fixtures,
  fixtureParticipants,
  matches,
  registrations,
  teams,
  teamManagers,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { mayScore, authorityKind } from "./authority";
import { scoringNames, matchAgeDate } from "./live-state";
export async function placementSetup(db: Db, fixtureId: string, personId: string) {
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture || fixture.homeTeamId !== null || fixture.awayTeamId !== null) return null;
  const [season] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, fixture.competitionId));
  const pack = season ? sportPack(season.sport) : null;
  if (
    !season ||
    pack?.scoring?.family !== "placement" ||
    !pack.standings.lobby ||
    !(await mayScore(db, personId, fixture))
  )
    return null;
  const [match] = await db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
  if (
    !["published", "in_progress"].includes(fixture.status) &&
    !(fixture.status === "completed" && match && match.phase !== "void")
  )
    return null;
  const scheduled = await db
    .select({ teamId: fixtureParticipants.teamId })
    .from(fixtureParticipants)
    .where(
      and(
        eq(fixtureParticipants.fixtureId, fixtureId),
        eq(fixtureParticipants.orgId, fixture.orgId),
        eq(fixtureParticipants.competitionId, fixture.competitionId),
      ),
    );
  const ids = scheduled.map((row) => row.teamId);
  if (ids.length < 2 || ids.length > 25) return null;
  const names = await scoringNames(
    db,
    fixture.competitionId,
    matchAgeDate(fixture.kickoffAt, match?.startedAt ?? new Date()),
  );
  const players = await db
    .select({ id: registrations.id, teamId: registrations.teamId })
    .from(registrations)
    .where(
      and(
        eq(registrations.orgId, fixture.orgId),
        eq(registrations.competitionId, fixture.competitionId),
        eq(registrations.status, "approved"),
        inArray(registrations.teamId, ids),
      ),
    );
  const teamRows = await db
    .select({ id: teams.id, color: teams.primaryColor })
    .from(teams)
    .where(
      and(
        eq(teams.orgId, fixture.orgId),
        eq(teams.competitionId, fixture.competitionId),
        inArray(teams.id, ids),
      ),
    );
  const managed = await db
    .select({ teamId: teamManagers.teamId })
    .from(teamManagers)
    .where(
      and(
        eq(teamManagers.orgId, fixture.orgId),
        eq(teamManagers.competitionId, fixture.competitionId),
        eq(teamManagers.personId, personId),
        inArray(teamManagers.teamId, ids),
        isNull(teamManagers.revokedAt),
      ),
    );
  const format = (match?.format ?? lobbyFormat(1, pack.standings.lobby)) as PlacementFormat;
  return {
    family: "placement" as const,
    sport: season.sport,
    fixtureId,
    fixtureNumber: fixture.fixtureNumber,
    competitionSlug: season.slug,
    visibility: season.visibility,
    kickoffAt: fixture.kickoffAt,
    groundName: "Lobby",
    conditions: {} as Conditions,
    shotMap: parseSeasonScoringRules(season.scoringRules).shotMap,
    organiser: (await authorityKind(db, personId, fixture)) === "a",
    teams: ids.map((id) => ({
      id,
      name: names.teams[id]?.name ?? "Squad",
      color: teamRows.find((row) => row.id === id)?.color ?? null,
      players: players
        .filter((row) => row.teamId === id)
        .map((row) => ({
          id: row.id,
          name: names.players[row.id]?.name ?? "Player",
          photoUrl: names.players[row.id]?.photoUrl ?? null,
          isCaptain: false,
          keeper: false,
          style: "",
          battingHand: null,
          bowlingStyle: null,
        })),
      selectedIds: players.filter((row) => row.teamId === id).map((row) => row.id),
    })),
    representedTeamIds: managed.map((row) => row.teamId),
    phase: match?.phase ?? null,
    umpires: 0,
    format,
    formats: [format],
  };
}
