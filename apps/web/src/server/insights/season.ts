import { persistRaidSeasonAwards } from "../scoring/raid-season-awards";
import { currentAward } from "../scoring/awards";
import { requireCompetitionCapability } from "../competition/authz";
import {
  pickSeasonAwards,
  seasonPlayers,
  replayMatch,
  playerLines,
  scoreMatch,
  formatByKey,
  type SeasonMatch,
} from "@desiauction/core/scoring";
import {
  competitions,
  matchAwards,
  auditLog,
  newId,
  fixtures,
  fixtureResults,
  matches,
  matchEvents,
  registrations,
  people,
  teams,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { persistedMatchEvent } from "../scoring/persisted-event";
import { eligibleSeasonScorers } from "./scorers";
import { wholeMatchConditions } from "./season-conditions";
import type { InsightFilter } from "./sample";

/** Read-only canonical computation; omitted emerging/best-N options keep the agreed defaults. */
export async function seasonAwardComputation(
  db: Db,
  competitionId: string,
  filter: InsightFilter = {},
) {
  const [competition] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, competitionId));
  if (!competition || !["cricket", "box_cricket"].includes(competition.sport)) return null;
  const completed = await db
    .select({ fixture: fixtures, match: matches })
    .from(fixtures)
    .innerJoin(
      matches,
      and(
        eq(matches.fixtureId, fixtures.id),
        eq(matches.orgId, fixtures.orgId),
        eq(matches.competitionId, fixtures.competitionId),
      ),
    )
    .innerJoin(
      fixtureResults,
      and(
        eq(fixtureResults.fixtureId, fixtures.id),
        eq(fixtureResults.orgId, fixtures.orgId),
        eq(fixtureResults.competitionId, fixtures.competitionId),
      ),
    )
    .where(
      and(
        eq(fixtures.competitionId, competitionId),
        eq(fixtures.orgId, competition.orgId),
        eq(fixtures.status, "completed"),
        eq(fixtureResults.source, "scored"),
        inArray(matches.trustLevel, ["verified", "confirmed"]),
        isNotNull(matches.finishedAt),
        inArray(matches.phase, ["finished", "final", "no_result", "abandoned", "walkover"]),
      ),
    )
    .orderBy(fixtures.id)
    .for("share", { of: matches });
  const canonical: SeasonMatch[] = [];
  const sixes = new Map<string, number>();
  for (const { fixture, match } of completed) {
    const events = await db
      .select()
      .from(matchEvents)
      .where(and(eq(matchEvents.fixtureId, fixture.id), eq(matchEvents.orgId, competition.orgId)))
      .orderBy(matchEvents.seq);
    const state = replayMatch(events.map(persistedMatchEvent));
    const frozenKey = (match.format as { key?: unknown } | undefined)?.key;
    if (
      state.lastSeq !== match.lastSeq ||
      state.attempt !== match.attempt ||
      !state.finished ||
      !state.format ||
      typeof frozenKey !== "string" ||
      !formatByKey(frozenKey) ||
      state.format.key !== frozenKey ||
      match.awardVersion !== `cricket-v1/${frozenKey}`
    )
      throw new Error("Season award match revision is inconsistent");
    if (!wholeMatchConditions(state, filter)) continue;
    const lines = playerLines(state);
    for (const [id, line] of lines)
      sixes.set(id, (sixes.get(id) ?? 0) + (line.batting?.sixes ?? 0));
    const keepers = new Map<string, { catches: number; stumpings: number; byes: number }>();
    for (const innings of state.innings) {
      if (innings.superOver) continue;
      const keeperId = state.lineups[innings.bowlingTeamId]?.keeperId;
      if (!keeperId) continue;
      const keeper = keepers.get(keeperId) ?? { catches: 0, stumpings: 0, byes: 0 };
      keeper.byes += innings.extras.byes;
      for (const over of innings.overs)
        for (const ball of over.balls) {
          const wicket = ball.wicket;
          if (!wicket?.fielderIds.includes(keeperId)) continue;
          if (wicket.kind === "caught") keeper.catches++;
          if (wicket.kind === "stumped") keeper.stumpings++;
        }
      keepers.set(keeperId, keeper);
    }
    canonical.push({
      fixtureId: fixture.id,
      trust: match.trustLevel,
      completed: true,
      teamIds: [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => id !== null),
      formatKey: state.format.key,
      players: lines,
      scores: scoreMatch(lines, state, state.format.key),
      keepers,
    });
  }
  const players = seasonPlayers(canonical);
  const scorers = await eligibleSeasonScorers(db, competitionId);
  return {
    competition,
    players,
    picks: pickSeasonAwards(players, { scorers }),
    scorers,
    sixes: Object.fromEntries(sixes),
    matchCount: canonical.length,
  };
}

/** Labels and selected append-only awards remain inside the caller's tenant. */
export async function seasonAwardDisplay(
  db: Db,
  competitionId: string,
  eligibleScorerIds: string[] = [],
) {
  const labels = await db
    .select({
      id: registrations.id,
      team: teams.name,
      name: sql<string | null>`coalesce(${registrations.enteredName}, ${people.name})`,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(eq(registrations.competitionId, competitionId));
  const history = await db
    .select()
    .from(matchAwards)
    .where(and(eq(matchAwards.competitionId, competitionId), eq(matchAwards.scope, "season")));
  const selected = new Map<string, (typeof history)[number]>();
  for (const row of history) {
    const prior = selected.get(row.kind);
    if (
      !prior ||
      row.createdAt > prior.createdAt ||
      (row.createdAt.getTime() === prior.createdAt.getTime() && row.id > prior.id)
    )
      selected.set(row.kind, row);
  }
  const personIds = [
    ...new Set([
      ...eligibleScorerIds,
      ...[...selected.values()].flatMap((row) =>
        [row.winnerPersonId, row.computedPersonId].filter((id): id is string => id !== null),
      ),
    ]),
  ];
  const scorers = personIds.length
    ? await db
        .select({ id: people.id, name: people.name })
        .from(people)
        .where(inArray(people.id, personIds))
    : [];
  return {
    teamNames: Object.fromEntries(labels.map((row) => [row.id, row.team])),
    names: Object.fromEntries(labels.map((row) => [row.id, row.name ?? "Player"])),
    scorerNames: Object.fromEntries(scorers.map((row) => [row.id, row.name ?? "Scorer"])),
    selected: [...selected.values()],
  };
}

/** Append-only season picks; caller supplies its tenant transaction. */
export async function persistSeasonAwards(
  db: Db,
  competitionId: string,
  actorId: string,
  now = new Date(),
) {
  const [competition] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .for("update");
  if (!competition) throw new Error("Award season is missing");
  if (competition.sport === "kabaddi")
    return persistRaidSeasonAwards(db, competitionId, actorId, now);
  if (!["cricket", "box_cricket"].includes(competition.sport)) return [];
  await requireCompetitionCapability(
    db,
    actorId,
    { orgId: competition.orgId, competitionId },
    "fixture.manage",
  );
  const computation = await seasonAwardComputation(db, competitionId);
  if (!computation) return [];
  const picks = computation.picks;
  const selected = [
    {
      kind: "season_mvp",
      registrationId: picks.season_mvp?.registrationId ?? null,
      personId: null,
      score: picks.season_mvp?.points,
    },
    {
      kind: "best_batter",
      registrationId: picks.best_batter?.registrationId ?? null,
      personId: null,
      score: picks.best_batter?.runs,
    },
    {
      kind: "best_bowler",
      registrationId: picks.best_bowler?.registrationId ?? null,
      personId: null,
      score: picks.best_bowler?.wickets,
    },
    {
      kind: "best_fielder",
      registrationId: picks.best_fielder?.registrationId ?? null,
      personId: null,
      score: picks.best_fielder?.fieldingPoints,
    },
    {
      kind: "best_keeper",
      registrationId: picks.best_keeper?.registrationId ?? null,
      personId: null,
      score: picks.best_keeper?.keeperDismissals,
    },
    {
      kind: "emerging",
      registrationId: picks.emerging?.registrationId ?? null,
      personId: null,
      score: picks.emerging?.points,
    },
    {
      kind: "scorer_of_season",
      registrationId: null,
      personId: picks.scorer_of_season?.personId ?? null,
      score: picks.scorer_of_season?.completedVerifiedMatches,
    },
  ] as const;
  const stored = [];
  for (const pick of selected) {
    const [override] = await db
      .select({ id: matchAwards.id })
      .from(matchAwards)
      .where(
        and(
          eq(matchAwards.competitionId, competitionId),
          eq(matchAwards.orgId, competition.orgId),
          eq(matchAwards.scope, "season"),
          eq(matchAwards.kind, pick.kind),
          eq(matchAwards.source, "organizer"),
        ),
      )
      .limit(1);
    if (override) continue;
    const previous = await currentAward(db, { competitionId }, pick.kind);
    const score = pick.score?.toFixed(2) ?? null;
    if (
      previous?.source === "auto" &&
      previous.computedRegistrationId === pick.registrationId &&
      previous.winnerRegistrationId === pick.registrationId &&
      previous.computedPersonId === pick.personId &&
      previous.winnerPersonId === pick.personId &&
      previous.score === score
    )
      continue;
    const [row] = await db
      .insert(matchAwards)
      .values({
        id: newId(),
        fixtureId: null,
        orgId: competition.orgId,
        competitionId,
        scope: "season",
        kind: pick.kind,
        source: "auto",
        computedRegistrationId: pick.registrationId,
        winnerRegistrationId: pick.registrationId,
        computedPersonId: pick.personId,
        winnerPersonId: pick.personId,
        score,
        actorPersonId: actorId,
        createdAt: new Date(
          Math.max(now.getTime(), previous ? previous.createdAt.getTime() + 1 : now.getTime()),
        ),
      })
      .returning();
    if (!row) throw new Error("Season award was not stored");
    stored.push(row);
    await db.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "match.award.computed",
      scopeType: "org",
      scopeId: competition.orgId,
      subject: competitionId,
      meta: {
        awardId: row.id,
        kind: pick.kind,
        scope: "season",
        computedRegistrationId: pick.registrationId,
        computedPersonId: pick.personId,
        score,
      },
      at: now,
    });
  }
  return stored;
}
