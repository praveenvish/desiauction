import {
  competitions,
  fixtures,
  fixtureLineups,
  registrations,
  people,
  teams,
  teamManagers,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { currentSession } from "../auth/actions";
import { dbHandle } from "../db";
import { publicCompetitionBySlug } from "../competition/resolve";
import { canCompetition } from "../competition/authz";
import { shownName } from "../competition/shown-name";
import { publicName } from "../scoring/public-name";
import { can } from "../entitlements";
import { batterInsights, slowestBowlingMatchup } from "./batter";
import { bowlerInsights } from "./bowler";

export async function captainBriefIn(
  db: Db,
  personId: string,
  competitionId: string,
  fixtureId: string,
  now = new Date(),
) {
  const [row] = await db
    .select({ fixture: fixtures, tier: competitions.tier, sport: competitions.sport })
    .from(fixtures)
    .innerJoin(
      competitions,
      and(eq(competitions.id, fixtures.competitionId), eq(competitions.orgId, fixtures.orgId)),
    )
    .where(and(eq(fixtures.id, fixtureId), eq(fixtures.competitionId, competitionId)))
    .limit(1);
  if (
    !row ||
    !row.fixture.homeTeamId ||
    !row.fixture.awayTeamId ||
    !["cricket", "box_cricket"].includes(row.sport)
  )
    return null;
  const fixture = row.fixture;
  const sides = [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => id !== null);
  const organizer = await canCompetition(
    db,
    personId,
    { orgId: fixture.orgId, competitionId },
    "fixture.manage",
  );
  const managed = organizer
    ? []
    : await db
        .select({ teamId: teamManagers.teamId })
        .from(teamManagers)
        .where(
          and(
            eq(teamManagers.orgId, fixture.orgId),
            eq(teamManagers.competitionId, competitionId),
            eq(teamManagers.personId, personId),
            inArray(teamManagers.teamId, sides),
            isNull(teamManagers.revokedAt),
          ),
        );
  if (!organizer && managed.length === 0) return null;
  if (!can(row, "captain_brief")) return { locked: true as const };
  const opponentIds =
    organizer || managed.length === 2
      ? sides
      : sides.filter((id) => !managed.some((manager) => manager.teamId === id));
  const opponentTeams = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(
      and(
        eq(teams.orgId, fixture.orgId),
        eq(teams.competitionId, competitionId),
        inArray(teams.id, opponentIds),
      ),
    );
  const players = await db
    .select({
      id: registrations.id,
      personId: registrations.personId,
      teamId: registrations.teamId,
      name: shownName,
      dob: registrations.dateOfBirth,
    })
    .from(fixtureLineups)
    .innerJoin(
      registrations,
      and(
        eq(registrations.id, fixtureLineups.registrationId),
        eq(registrations.orgId, fixture.orgId),
        eq(registrations.competitionId, competitionId),
        eq(registrations.teamId, fixtureLineups.teamId),
      ),
    )
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(
      and(
        eq(fixtureLineups.fixtureId, fixtureId),
        eq(fixtureLineups.orgId, fixture.orgId),
        eq(fixtureLineups.competitionId, competitionId),
        eq(registrations.status, "approved"),
        inArray(fixtureLineups.teamId, opponentIds),
      ),
    );
  const cards = [];
  for (const player of players) {
    if (!player.personId) continue;
    const scope = { kind: "self" as const, personId: player.personId };
    const [batting, bowling] = await Promise.all([
      batterInsights(db, scope, { excludeFixtureId: fixtureId }, now),
      bowlerInsights(db, scope, { excludeFixtureId: fixtureId }, now),
    ]);
    cards.push({
      id: player.id,
      teamId: player.teamId,
      name: publicName({ name: player.name }, { dateOfBirth: player.dob }, now).name,
      batting,
      bowling,
      matchup: slowestBowlingMatchup(batting),
    });
  }
  return {
    locked: false as const,
    fixtureNumber: fixture.fixtureNumber,
    kickoffAt: fixture.kickoffAt,
    teams: opponentTeams,
    players: cards,
  };
}
export async function captainBrief(slug: string, fixtureId: string) {
  const session = await currentSession();
  if (!session) return null;
  const identity = await publicCompetitionBySlug(slug);
  if (!identity) return null;
  return withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: identity.orgId },
    async (db) => {
      const [current] = await db
        .select({ id: competitions.id })
        .from(competitions)
        .where(
          and(
            eq(competitions.id, identity.id),
            eq(competitions.slug, slug),
            eq(competitions.orgId, identity.orgId),
          ),
        );
      return current ? captainBriefIn(db, session.personId, current.id, fixtureId) : null;
    },
  );
}
