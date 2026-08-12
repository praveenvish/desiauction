/**
 * THE LEAGUE TABLE, DERIVED.
 *
 * Pure: results in, table out. There is no standings table in the database and
 * there should not be — a stored table drifts from the results beneath it the
 * first time somebody amends a scorecard, and then two screens disagree about
 * who is top. Deriving costs one pass over a season's fixtures.
 *
 * OVERS ARE BALLS THROUGHOUT. `4.5` overs is four overs and five balls, and net
 * run rate computed on that decimal is wrong by roughly eight percent per
 * fractional over — quietly, all season, in the number that decides who
 * qualifies. Every rate here divides runs by BALLS and multiplies by six.
 */

export type ResultOutcome = "home_win" | "away_win" | "tie" | "no_result" | "abandoned";

export interface FixtureResultInput {
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly outcome: ResultOutcome;
  readonly homeRuns?: number | null;
  readonly homeBalls?: number | null;
  readonly awayRuns?: number | null;
  readonly awayBalls?: number | null;
}

/**
 * Points, as leagues actually award them.
 *
 * Defaulted to the standard limited-overs scheme (2 / 1 / 0) with a no-result
 * sharing a point, because that is what a club running a T20 league expects to
 * see without configuring anything. It is an input rather than a constant so a
 * competition that awards differently is a value, not a fork.
 */
export interface PointsPolicy {
  readonly win: number;
  readonly tie: number;
  readonly loss: number;
  readonly noResult: number;
}

export const DEFAULT_POINTS: PointsPolicy = { win: 2, tie: 1, loss: 0, noResult: 1 };

export interface StandingsRow {
  readonly teamId: string;
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly tied: number;
  readonly noResult: number;
  readonly points: number;
  /** Runs scored and balls faced, for the rate. Shown so the rate is checkable. */
  readonly runsFor: number;
  readonly ballsFaced: number;
  readonly runsAgainst: number;
  readonly ballsBowled: number;
  /**
   * Net run rate, or null when it cannot be computed rather than zero.
   *
   * Zero is a real NRR — a team exactly level on rate has one — so returning it
   * for "no completed matches yet" would put a brand-new team level with a team
   * that has genuinely broken even, and sort them together.
   */
  readonly netRunRate: number | null;
}

function rate(runs: number, balls: number): number | null {
  return balls === 0 ? null : (runs / balls) * 6;
}

/**
 * Build the table.
 *
 * `abandoned` fixtures are EXCLUDED entirely — not played, no points, no effect
 * on run rate. A no-result is different: it was played, and both sides take the
 * no-result points. Collapsing the two is the most common way a league table
 * comes out wrong.
 */
export function buildStandings(
  teamIds: readonly string[],
  results: readonly FixtureResultInput[],
  policy: PointsPolicy = DEFAULT_POINTS,
): StandingsRow[] {
  const rows = new Map<
    string,
    {
      teamId: string;
      played: number;
      won: number;
      lost: number;
      tied: number;
      noResult: number;
      points: number;
      runsFor: number;
      ballsFaced: number;
      runsAgainst: number;
      ballsBowled: number;
    }
  >();
  // Every team gets a row, including one that has not played. A league table
  // that omits the team who has yet to play its first match reads as if they
  // are not in the competition.
  for (const teamId of teamIds) {
    rows.set(teamId, {
      teamId,
      played: 0,
      won: 0,
      lost: 0,
      tied: 0,
      noResult: 0,
      points: 0,
      runsFor: 0,
      ballsFaced: 0,
      runsAgainst: 0,
      ballsBowled: 0,
    });
  }

  for (const result of results) {
    if (result.outcome === "abandoned") {
      continue;
    }
    const home = rows.get(result.homeTeamId);
    const away = rows.get(result.awayTeamId);
    if (home === undefined || away === undefined) {
      // A result naming a team that is not in this competition. Skipped rather
      // than invented: the table describes the teams it was given.
      continue;
    }
    home.played += 1;
    away.played += 1;

    if (result.outcome === "home_win") {
      home.won += 1;
      away.lost += 1;
      home.points += policy.win;
      away.points += policy.loss;
    } else if (result.outcome === "away_win") {
      away.won += 1;
      home.lost += 1;
      away.points += policy.win;
      home.points += policy.loss;
    } else if (result.outcome === "tie") {
      home.tied += 1;
      away.tied += 1;
      home.points += policy.tie;
      away.points += policy.tie;
    } else {
      home.noResult += 1;
      away.noResult += 1;
      home.points += policy.noResult;
      away.points += policy.noResult;
    }

    /*
     * Run rate takes the innings that were actually bowled, whatever the
     * outcome. A no-result often has one complete innings and a rained-off
     * reply; counting the first and not the second is right, and a scheme that
     * needed both would throw away real cricket.
     *
     * A side bowled out short of its full overs is deliberately NOT credited
     * with the full quota here. That is a genuine variation between leagues,
     * and inventing one silently would make the table subtly wrong for the
     * clubs using the other. It belongs in the policy the day somebody asks.
     */
    const hr = result.homeRuns ?? 0;
    const hb = result.homeBalls ?? 0;
    const ar = result.awayRuns ?? 0;
    const ab = result.awayBalls ?? 0;
    home.runsFor += hr;
    home.ballsFaced += hb;
    home.runsAgainst += ar;
    home.ballsBowled += ab;
    away.runsFor += ar;
    away.ballsFaced += ab;
    away.runsAgainst += hr;
    away.ballsBowled += hb;
  }

  return [...rows.values()]
    .map((row) => {
      const scored = rate(row.runsFor, row.ballsFaced);
      const conceded = rate(row.runsAgainst, row.ballsBowled);
      return {
        ...row,
        netRunRate: scored === null || conceded === null ? null : scored - conceded,
      };
    })
    .sort(compareStandings);
}

/**
 * Points, then net run rate, then wins, then team id.
 *
 * The last key is not decoration: without a total order the table's row order
 * depends on insertion, so two equal teams could swap places between page
 * loads. A stable, arbitrary tiebreak is honest; a flickering one is not.
 *
 * A null rate sorts BELOW any real one — a team that has not played cannot be
 * placed above one that has by virtue of having no number.
 */
export function compareStandings(a: StandingsRow, b: StandingsRow): number {
  if (a.points !== b.points) {
    return b.points - a.points;
  }
  const ar = a.netRunRate;
  const br = b.netRunRate;
  if (ar !== br) {
    if (ar === null) {
      return 1;
    }
    if (br === null) {
      return -1;
    }
    return br - ar;
  }
  if (a.won !== b.won) {
    return b.won - a.won;
  }
  return a.teamId.localeCompare(b.teamId);
}

/** Balls → the "4.5" cricket writes. Display only; never arithmetic. */
export function oversOf(balls: number): string {
  return `${String(Math.floor(balls / 6))}.${String(balls % 6)}`;
}

/** "4.5" → 29 balls. Returns null for anything that is not a legal over count. */
export function ballsOf(overs: string): number | null {
  const match = /^(\d{1,3})(?:\.([0-5]))?$/.exec(overs.trim());
  if (match === null) {
    return null;
  }
  // `.6` is rejected by the pattern above rather than folded to the next over:
  // somebody typing 4.6 has made a mistake, and silently reading it as 5.0
  // hides it inside a number nobody re-checks.
  return Number(match[1]) * 6 + Number(match[2] ?? 0);
}
