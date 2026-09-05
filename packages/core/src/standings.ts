/**
 * THE LEAGUE TABLE, DERIVED.
 *
 * Pure: results in, table out. There is no standings table in the database and
 * there should not be — a stored table drifts from the results beneath it the
 * first time somebody amends a scorecard, and then two screens disagree about
 * who is top. Deriving costs one pass over a season's fixtures.
 *
 * SPORT-AGNOSTIC SINCE SP-1 PHASE 2. This module used to speak cricket: it
 * summed `runs` and `balls` by name and hard-wired net run rate as the only
 * tiebreak. It now accumulates whatever score components the caller names and
 * applies whatever tiebreakers the caller supplies, so a football table breaks
 * ties on goal difference and a cricket table still breaks them on NRR — same
 * function, no branch on sport anywhere in it.
 *
 * IT TAKES RULES, IT DOES NOT IMPORT A PACK. `sports/cricket.ts` already reads
 * `DEFAULT_POINTS` from here; importing a pack back would close a cycle the
 * `no-circular` gate refuses, and rightly — the league table is arithmetic, and
 * arithmetic should not know what a sport is. The pack passes its rules in.
 */

export type ResultOutcome = "home_win" | "away_win" | "tie" | "no_result" | "abandoned";

/** Per-side score components, keyed by the sport's score-field keys. */
export type ScoreRecord = Readonly<Record<string, number | null | undefined>>;

export interface FixtureResultInput {
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly outcome: ResultOutcome;
  readonly homeScore?: ScoreRecord;
  readonly awayScore?: ScoreRecord;
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

/** What a team scored, and what was scored against it, summed over the season. */
export interface SideTotals {
  readonly scored: Readonly<Record<string, number>>;
  readonly conceded: Readonly<Record<string, number>>;
}

/**
 * One ordered tiebreak after points.
 *
 * `compute` returns null when the number cannot be formed at all — NOT zero.
 * Zero is a real net run rate and a real goal difference: a team exactly level
 * has one, and returning it for "has not played" would place a brand-new team
 * level with a team that genuinely broke even.
 */
export interface TiebreakerSpec {
  readonly key: string;
  /** The column heading a table shows: "NRR", "GD". */
  readonly label: string;
  /** Higher is better. Null sorts below every real number. */
  readonly compute: (totals: SideTotals) => number | null;
  /** Digits when displayed — NRR wants 3, goal difference wants 0. */
  readonly precision: number;
}

export interface StandingsRules {
  readonly points: PointsPolicy;
  /** The score components this sport accumulates, e.g. runs, balls | goals. */
  readonly scoreFields: readonly string[];
  /** Applied in order, after points. */
  readonly tiebreakers: readonly TiebreakerSpec[];
}

export interface StandingsRow {
  readonly teamId: string;
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly tied: number;
  readonly noResult: number;
  readonly points: number;
  /** Summed score components, so every tiebreak below is checkable by eye. */
  readonly scored: Readonly<Record<string, number>>;
  readonly conceded: Readonly<Record<string, number>>;
  /** Tiebreak values by key, in the rules' order. Null = not computable. */
  readonly tiebreakers: Readonly<Record<string, number | null>>;
}

interface Mutable {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  noResult: number;
  points: number;
  scored: Record<string, number>;
  conceded: Record<string, number>;
}

function zeroed(fields: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of fields) {
    out[field] = 0;
  }
  return out;
}

function addInto(
  target: Record<string, number>,
  source: ScoreRecord | undefined,
  fields: readonly string[],
): void {
  for (const field of fields) {
    target[field] = (target[field] ?? 0) + (source?.[field] ?? 0);
  }
}

/**
 * Build the table.
 *
 * `abandoned` fixtures are EXCLUDED entirely — not played, no points, no effect
 * on any rate. A no-result is different: it was played, and both sides take the
 * no-result points. Collapsing the two is the most common way a league table
 * comes out wrong.
 */
export function buildStandings(
  teamIds: readonly string[],
  results: readonly FixtureResultInput[],
  rules: StandingsRules,
): StandingsRow[] {
  const { points: policy, scoreFields, tiebreakers } = rules;
  const rows = new Map<string, Mutable>();
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
      scored: zeroed(scoreFields),
      conceded: zeroed(scoreFields),
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
     * The innings, halves or sets that were actually played count, whatever the
     * outcome. A no-result often has one complete innings and a rained-off
     * reply; counting the first and not the second is right, and a scheme that
     * needed both would throw away real cricket.
     *
     * A side bowled out short of its full overs is deliberately NOT credited
     * with the full quota here. That is a genuine variation between leagues,
     * and inventing one silently would make the table subtly wrong for the
     * clubs using the other. It belongs in the rules the day somebody asks.
     */
    addInto(home.scored, result.homeScore, scoreFields);
    addInto(home.conceded, result.awayScore, scoreFields);
    addInto(away.scored, result.awayScore, scoreFields);
    addInto(away.conceded, result.homeScore, scoreFields);
  }

  return [...rows.values()]
    .map((row) => {
      const totals: SideTotals = { scored: row.scored, conceded: row.conceded };
      const computed: Record<string, number | null> = {};
      for (const tiebreaker of tiebreakers) {
        computed[tiebreaker.key] = tiebreaker.compute(totals);
      }
      return { ...row, tiebreakers: computed };
    })
    .sort((a, b) => compareStandings(a, b, tiebreakers));
}

/**
 * Points, then each tiebreak in the sport's own order, then wins, then team id.
 *
 * The last key is not decoration: without a total order the table's row order
 * depends on insertion, so two equal teams could swap places between page
 * loads. A stable, arbitrary tiebreak is honest; a flickering one is not.
 *
 * A null tiebreak sorts BELOW any real one — a team that has not played cannot
 * be placed above one that has by virtue of having no number.
 */
export function compareStandings(
  a: StandingsRow,
  b: StandingsRow,
  tiebreakers: readonly TiebreakerSpec[],
): number {
  if (a.points !== b.points) {
    return b.points - a.points;
  }
  for (const tiebreaker of tiebreakers) {
    const av = a.tiebreakers[tiebreaker.key] ?? null;
    const bv = b.tiebreakers[tiebreaker.key] ?? null;
    if (av === bv) {
      continue;
    }
    if (av === null) {
      return 1;
    }
    if (bv === null) {
      return -1;
    }
    return bv - av;
  }
  if (a.won !== b.won) {
    return b.won - a.won;
  }
  return a.teamId.localeCompare(b.teamId);
}

/**
 * A per-unit rate, or null when the denominator is absent.
 *
 * Shared by the tiebreakers a pack declares: cricket multiplies runs-per-ball
 * by six to get an over rate, football divides nothing at all and simply takes
 * a difference. Exported because a pack's `compute` is where that choice
 * belongs, not here.
 */
export function ratePer(numerator: number, denominator: number, per = 1): number | null {
  return denominator === 0 ? null : (numerator / denominator) * per;
}
