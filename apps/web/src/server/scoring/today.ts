import {
  isRallyState,
  isRaidState,
  isTimedState,
  isPlacementState,
  isDeliveryState,
  replayScoringState,
  scoringPublicState,
} from "./family-state";
import { sportPack } from "@desiauction/core";
import { type NameBook } from "@desiauction/core/scoring";
import {
  competitions,
  fixtures,
  fixtureLineups,
  fixtureOfficials,
  grounds,
  matches,
  matchEvents,
  people,
  teams,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, gte, inArray, isNull, lt, notInArray, or } from "drizzle-orm";
import { currentSession } from "../auth/actions";
import { canCompetition } from "../competition/authz";
import { nowWallClock } from "../competition/fixtures";
import { resolveMemberCompetition } from "../competition/resolve";
import { dbHandle } from "../db";
import { mayScore } from "./authority";
import { persistedMatchEvent } from "./persisted-event";
import { todayModel, type TodayFixtureFacts } from "./today-model";
export type TodayBoard = NonNullable<Awaited<ReturnType<typeof todayOn>>>;
/** All match data and authority checks stay inside the caller's tenant boundary. */
export async function todayOn(
  db: Db,
  scope: { orgId: string; competitionId: string },
  personId: string,
  now = new Date(),
) {
  if (!(await canCompetition(db, personId, scope, "fixture.manage"))) return null;
  const [competition] = await db
    .select({ name: competitions.name, slug: competitions.slug, sport: competitions.sport })
    .from(competitions)
    .where(and(eq(competitions.id, scope.competitionId), eq(competitions.orgId, scope.orgId)));
  if (!competition || !sportPack(competition.sport)?.scoring) return null;
  const day = nowWallClock(now).slice(0, 10);
  const tomorrow = nowWallClock(new Date(now.getTime() + 86400000)).slice(0, 10);
  const [fixtureRows, teamRows] = await Promise.all([
    db
      .select({ fixture: fixtures, match: matches, ground: grounds.name })
      .from(fixtures)
      .leftJoin(
        matches,
        and(
          eq(matches.fixtureId, fixtures.id),
          eq(matches.orgId, fixtures.orgId),
          eq(matches.competitionId, fixtures.competitionId),
        ),
      )
      .leftJoin(grounds, and(eq(grounds.id, fixtures.groundId), eq(grounds.orgId, fixtures.orgId)))
      .where(
        and(
          eq(fixtures.orgId, scope.orgId),
          eq(fixtures.competitionId, scope.competitionId),
          inArray(fixtures.status, ["published", "in_progress", "completed"]),
          or(
            and(gte(fixtures.kickoffAt, day), lt(fixtures.kickoffAt, tomorrow)),
            and(
              lt(fixtures.kickoffAt, day),
              or(
                inArray(matches.phase, ["live", "stalled"]),
                and(
                  lt(matches.finishedAt, new Date(now.getTime() - 86400000)),
                  notInArray(matches.trustLevel, ["confirmed", "verified"]),
                ),
              ),
            ),
          ),
        ),
      ),
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.orgId, scope.orgId), eq(teams.competitionId, scope.competitionId))),
  ]);
  const fixtureIds = fixtureRows.map((row) => row.fixture.id);
  const facts: TodayFixtureFacts[] = [];
  if (fixtureIds.length) {
    const [eventRows, lineupRows, officialRows] = await Promise.all([
      db
        .select()
        .from(matchEvents)
        .where(
          and(
            eq(matchEvents.orgId, scope.orgId),
            eq(matchEvents.competitionId, scope.competitionId),
            inArray(matchEvents.fixtureId, fixtureIds),
          ),
        )
        .orderBy(asc(matchEvents.seq)),
      db
        .select({ fixtureId: fixtureLineups.fixtureId, teamId: fixtureLineups.teamId })
        .from(fixtureLineups)
        .where(
          and(
            eq(fixtureLineups.orgId, scope.orgId),
            eq(fixtureLineups.competitionId, scope.competitionId),
            inArray(fixtureLineups.fixtureId, fixtureIds),
          ),
        ),
      db
        .select()
        .from(fixtureOfficials)
        .where(
          and(
            eq(fixtureOfficials.orgId, scope.orgId),
            eq(fixtureOfficials.competitionId, scope.competitionId),
            inArray(fixtureOfficials.fixtureId, fixtureIds),
            eq(fixtureOfficials.role, "scorer"),
            isNull(fixtureOfficials.removedAt),
          ),
        ),
    ]);
    const names: NameBook = {
      teams: Object.fromEntries(
        teamRows.map((team) => [
          team.id,
          {
            ...team,
            initials: team.name
              .split(/\s+/)
              .slice(0, 2)
              .map((word) => word[0] ?? "")
              .join(""),
          },
        ]),
      ),
      players: {},
    };
    for (const { fixture, match, ground } of fixtureRows) {
      if (match?.phase === "void") continue;
      const rows = eventRows.filter(
        (event) => event.fixtureId === fixture.id && event.seq <= (match?.lastSeq ?? 0),
      );
      const state = replayScoringState(competition.sport, rows.map(persistedMatchEvent));
      if (match && state.lastSeq !== match.lastSeq)
        throw new Error("Match day canonical sequence mismatch");
      const selected = scoringPublicState(state, names);
      const innings =
        !isDeliveryState(state) || state.currentInnings === null
          ? undefined
          : state.innings[state.currentInnings];
      const score = selected.innings.at(-1);
      const sideName = (id: string | null) =>
        id ? (names.teams[id]?.name ?? "Team") : "Team to be decided";
      const sides = [fixture.homeTeamId, fixture.awayTeamId];
      const missingLineups = sides
        .filter(
          (id) =>
            !id ||
            (state.format
              ? !isDeliveryState(state)
                ? !state.squads[id]?.length
                : !state.lineups[id]?.battingOrder.length
              : !lineupRows.some(
                  (lineup) => lineup.fixtureId === fixture.id && lineup.teamId === id,
                )),
        )
        .map(sideName);
      const appointment = officialRows.find((official) => official.fixtureId === fixture.id);
      const claimed =
        match?.scorerPersonId && (await mayScore(db, match.scorerPersonId, fixture))
          ? match.scorerPersonId
          : null;
      let scorerName = appointment?.displayName ?? null;
      if (claimed) {
        const [person] = await db
          .select({ name: people.name })
          .from(people)
          .where(eq(people.id, claimed));
        scorerName = person?.name ?? scorerName;
      }
      const receipt = rows
        .filter(
          (event) =>
            event.attempt === match?.attempt && (event.type === "ball" || event.type === "rally"),
        )
        .reduce<Date | null>(
          (latest, event) => (!latest || event.receivedAt > latest ? event.receivedAt : latest),
          null,
        );
      facts.push({
        id: fixture.id,
        number: fixture.fixtureNumber,
        kickoffAt: fixture.kickoffAt,
        status: fixture.status,
        home: sideName(fixture.homeTeamId),
        away: sideName(fixture.awayTeamId),
        ground,
        groundId: fixture.groundId,
        phase: match?.phase ?? null,
        finishedAt: match?.finishedAt?.toISOString() ?? null,
        trust: match?.trustLevel ?? null,
        lastReceiptAt: receipt?.toISOString() ?? null,
        startedAt: match?.startedAt?.toISOString() ?? null,
        createdAt: match?.createdAt.toISOString() ?? null,
        playing: isRallyState(state)
          ? state.rubbers.length > 0
          : isRaidState(state)
            ? state.half > 0
            : isTimedState(state)
              ? state.period > 0
              : isPlacementState(state)
                ? state.rounds.length > 0
                : state.innings.length > 0,
        missingLineups,
        scorerAssigned: Boolean(appointment || claimed),
        scorerName,
        viewerPeak: match?.viewerPeak ?? 0,
        score: isPlacementState(state)
          ? `${String(state.rounds.length)}/${String(state.format?.rounds ?? 0)} rounds`
          : isRallyState(state)
            ? (state.rubbers
                .at(-1)
                ?.games.map((game) => `${String(game.points.home)}–${String(game.points.away)}`)
                .join(" · ") ?? null)
            : isRaidState(state) || isTimedState(state)
              ? `${String(state.points.home)}–${String(state.points.away)} ${isTimedState(state) && state.format?.scoreUnits.length === 1 ? "goals" : "points"}`
              : score
                ? `${String(score.runs)}/${String(score.wickets)} (${score.overs})`
                : null,
        conditions: state.format ? selected.conditionsLine : "Conditions not set",
        situation: selected.result ?? selected.situation,
        progress:
          innings?.maxBalls !== null && innings?.maxBalls !== undefined && innings.maxBalls > 0
            ? { value: innings.legalBalls, max: innings.maxBalls }
            : null,
        quota: !innings ? "unavailable" : innings.maxBalls === null ? "unlimited" : "finite",
      });
    }
  }
  return {
    season: competition.name,
    sport: competition.sport,
    slug: competition.slug,
    ...todayModel(facts, competition.slug, nowWallClock(now).slice(0, 10), now),
  };
}
export async function todayForPerson(slug: string, now = new Date()) {
  const session = await currentSession();
  if (!session) return null;
  const competition = await resolveMemberCompetition(session.personId, slug);
  if (!competition) return null;
  return withTenantDb(dbHandle, { personId: session.personId, orgId: competition.orgId }, (db) =>
    todayOn(db, { orgId: competition.orgId, competitionId: competition.id }, session.personId, now),
  );
}
