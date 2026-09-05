import {
  auditLog,
  competitions,
  fixtureResults,
  fixtures,
  newId,
  teams,
  type Db,
} from "@desiauction/db";
import {
  buildStandings,
  scoreWithinBounds,
  sportPackFor,
  type SportPack,
  type FixtureResultInput,
  type ResultOutcome,
  type StandingsRow,
} from "@desiauction/core";
import { and, eq, inArray } from "drizzle-orm";

/**
 * RESULTS, AND THE TABLE DERIVED FROM THEM.
 *
 * A fixture could be scheduled, published, started and marked `completed` while
 * the product recorded nothing about how it went. A club could run a whole
 * season through this platform and nothing here could say who won a match, let
 * alone who was top.
 *
 * There is no standings table and there should not be. A stored table drifts
 * from the results beneath it the moment somebody amends a scorecard, and then
 * two screens disagree about who qualifies; deriving costs one pass over a
 * season's fixtures and cannot disagree with itself.
 */

export const RESULT_OUTCOMES: readonly ResultOutcome[] = [
  "home_win",
  "away_win",
  "tie",
  "no_result",
  "abandoned",
];

export function isResultOutcome(value: string): value is ResultOutcome {
  return (RESULT_OUTCOMES as readonly string[]).includes(value);
}

export interface RecordResultInput {
  readonly outcome: ResultOutcome;
  readonly homeRuns?: number | null;
  readonly homeWickets?: number | null;
  readonly homeBalls?: number | null;
  readonly awayRuns?: number | null;
  readonly awayWickets?: number | null;
  readonly awayBalls?: number | null;
  readonly method?: string | null;
  readonly note?: string | null;
}

export type RecordResultOutcome =
  | { ok: true; amended: boolean }
  | {
      ok: false;
      reason: "unknown_fixture" | "not_played" | "impossible_score" | "winner_without_score";
    };

/**
 * Ten wickets, and a score cannot be negative. Cheap, and it catches a typo.
 *
 * The bounds are the SEASON'S pack (SP-1 Phase 1). Phase 0 left this reaching
 * for `DEFAULT_SPORT` with a note that the right pack was the competition's and
 * the compiler would say so once the column existed. It does, and it did.
 */
function plausible(
  pack: SportPack,
  runs?: number | null,
  wickets?: number | null,
  balls?: number | null,
): boolean {
  return scoreWithinBounds(pack, { runs, wickets, balls });
}

/**
 * Record or amend a result.
 *
 * Upsert by fixture, because a result is the CURRENT truth about a match, not a
 * log of guesses. Scorers correct themselves — a misread scoreboard, a late
 * penalty run — and a second row would leave the table asking which to believe.
 * The audit row carries who changed it and when, which is the part worth
 * keeping.
 */
export async function recordFixtureResult(
  db: Db,
  input: {
    orgId: string;
    fixtureId: string;
    actorId: string;
    result: RecordResultInput;
  },
): Promise<RecordResultOutcome> {
  const [fixture] = await db
    .select({
      id: fixtures.id,
      competitionId: fixtures.competitionId,
      status: fixtures.status,
      homeTeamId: fixtures.homeTeamId,
      awayTeamId: fixtures.awayTeamId,
      /* SP-1 Phase 1: the season's sport decides which pack judges the score. */
      sport: competitions.sport,
    })
    .from(fixtures)
    .innerJoin(competitions, eq(competitions.id, fixtures.competitionId))
    .where(and(eq(fixtures.id, input.fixtureId), eq(fixtures.orgId, input.orgId)))
    .limit(1);
  if (fixture === undefined) {
    return { ok: false, reason: "unknown_fixture" };
  }
  /*
   * A result belongs to a match that happened. `draft` and `scheduled` fixtures
   * have not been played, and recording a result against one would put a score
   * on a game nobody turned up to — and then into the table.
   */
  if (
    fixture.status === "draft" ||
    fixture.status === "scheduled" ||
    fixture.status === "cancelled"
  ) {
    return { ok: false, reason: "not_played" };
  }
  const r = input.result;
  const pack = sportPackFor(fixture.sport);
  if (
    !plausible(pack, r.homeRuns, r.homeWickets, r.homeBalls) ||
    !plausible(pack, r.awayRuns, r.awayWickets, r.awayBalls)
  ) {
    return { ok: false, reason: "impossible_score" };
  }
  /*
   * A declared winner needs a score behind it. Without this a fixture could
   * report "home won" with both innings blank, which puts two points on the
   * table and contributes nothing to net run rate — a team could climb on
   * results that say nothing about how they played.
   */
  const decided = r.outcome === "home_win" || r.outcome === "away_win" || r.outcome === "tie";
  if (decided && (r.homeRuns == null || r.awayRuns == null)) {
    return { ok: false, reason: "winner_without_score" };
  }

  const winnerTeamId =
    r.outcome === "home_win"
      ? fixture.homeTeamId
      : r.outcome === "away_win"
        ? fixture.awayTeamId
        : null;

  const [existing] = await db
    .select({ fixtureId: fixtureResults.fixtureId })
    .from(fixtureResults)
    .where(eq(fixtureResults.fixtureId, input.fixtureId))
    .limit(1);
  const amended = existing !== undefined;

  const values = {
    fixtureId: input.fixtureId,
    orgId: input.orgId,
    competitionId: fixture.competitionId,
    outcome: r.outcome,
    winnerTeamId,
    homeRuns: r.homeRuns ?? null,
    homeWickets: r.homeWickets ?? null,
    homeBalls: r.homeBalls ?? null,
    awayRuns: r.awayRuns ?? null,
    awayWickets: r.awayWickets ?? null,
    awayBalls: r.awayBalls ?? null,
    method: r.method ?? null,
    note: r.note ?? null,
    recordedBy: input.actorId,
  };
  await db
    .insert(fixtureResults)
    .values(values)
    .onConflictDoUpdate({
      target: fixtureResults.fixtureId,
      set: { ...values, updatedAt: new Date() },
    });

  await db.insert(auditLog).values({
    id: newId(),
    actor: input.actorId,
    // Amending a result moves a league table, so the two are named apart: "who
    // changed this after it was first recorded" is the question an aggrieved
    // club asks, and one action for both cannot answer it.
    action: amended ? "fixture.result.amended" : "fixture.result.recorded",
    scopeType: "org",
    scopeId: input.orgId,
    subject: input.fixtureId,
    meta: { outcome: r.outcome, homeRuns: r.homeRuns ?? null, awayRuns: r.awayRuns ?? null },
  });
  return { ok: true, amended };
}

export interface ResultRow {
  readonly fixtureId: string;
  readonly outcome: ResultOutcome;
  readonly winnerTeamId: string | null;
  readonly homeRuns: number | null;
  readonly homeWickets: number | null;
  readonly homeBalls: number | null;
  readonly awayRuns: number | null;
  readonly awayWickets: number | null;
  readonly awayBalls: number | null;
  readonly method: string | null;
  readonly note: string | null;
}

/** One fixture's result, or null when it has not been recorded. */
export async function resultOf(db: Db, fixtureId: string): Promise<ResultRow | null> {
  const [row] = await db
    .select()
    .from(fixtureResults)
    .where(eq(fixtureResults.fixtureId, fixtureId))
    .limit(1);
  return row === undefined ? null : toResultRow(row);
}

/** Every recorded result in a competition, keyed by fixture. */
export async function resultsOf(db: Db, competitionId: string): Promise<Map<string, ResultRow>> {
  const rows = await db
    .select()
    .from(fixtureResults)
    .where(eq(fixtureResults.competitionId, competitionId));
  return new Map(rows.map((row) => [row.fixtureId, toResultRow(row)]));
}

function toResultRow(row: typeof fixtureResults.$inferSelect): ResultRow {
  return {
    fixtureId: row.fixtureId,
    outcome: row.outcome,
    winnerTeamId: row.winnerTeamId,
    homeRuns: row.homeRuns,
    homeWickets: row.homeWickets,
    homeBalls: row.homeBalls,
    awayRuns: row.awayRuns,
    awayWickets: row.awayWickets,
    awayBalls: row.awayBalls,
    method: row.method,
    note: row.note,
  };
}

export interface StandingsView {
  readonly rows: readonly (StandingsRow & { readonly teamName: string })[];
  /** How many fixtures have a result, of how many that were played. */
  readonly recorded: number;
  readonly playable: number;
}

/**
 * The table, derived on read.
 *
 * `recorded` and `playable` ride along so the page can say how complete it is.
 * A league table built from three of twenty results is not wrong, but presenting
 * it without saying so invites somebody to read it as the season's standing.
 */
export async function standingsOf(db: Db, competitionId: string): Promise<StandingsView> {
  const [teamRows, resultRows, playedFixtures] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.competitionId, competitionId)),
    db
      .select({
        fixtureId: fixtureResults.fixtureId,
        outcome: fixtureResults.outcome,
        homeRuns: fixtureResults.homeRuns,
        homeBalls: fixtureResults.homeBalls,
        awayRuns: fixtureResults.awayRuns,
        awayBalls: fixtureResults.awayBalls,
      })
      .from(fixtureResults)
      .where(eq(fixtureResults.competitionId, competitionId)),
    db
      .select({
        id: fixtures.id,
        homeTeamId: fixtures.homeTeamId,
        awayTeamId: fixtures.awayTeamId,
      })
      .from(fixtures)
      .where(
        and(
          eq(fixtures.competitionId, competitionId),
          inArray(fixtures.status, ["in_progress", "completed"]),
        ),
      ),
  ]);

  const sides = new Map(playedFixtures.map((row) => [row.id, row]));
  const inputs: FixtureResultInput[] = [];
  for (const result of resultRows) {
    const fixture = sides.get(result.fixtureId);
    if (fixture === undefined) {
      // A result whose fixture has been cancelled or rolled back to scheduled.
      // Excluded rather than counted: the fixture is the authority on whether
      // the match stands, and a stale result must not hold points open.
      continue;
    }
    inputs.push({
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      outcome: result.outcome,
      homeRuns: result.homeRuns,
      homeBalls: result.homeBalls,
      awayRuns: result.awayRuns,
      awayBalls: result.awayBalls,
    });
  }

  const names = new Map(teamRows.map((row) => [row.id, row.name]));
  const rows = buildStandings(
    teamRows.map((row) => row.id),
    inputs,
  ).map((row) => ({ ...row, teamName: names.get(row.teamId) ?? row.teamId }));

  return { rows, recorded: inputs.length, playable: playedFixtures.length };
}
