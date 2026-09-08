import { describe, expect, it } from "vitest";

import {
  buildStandings,
  type FixtureResultInput,
  type ResultOutcome,
  type StandingsRow,
} from "./standings";
import { CRICKET } from "./sports/cricket";
import { ballsOf, oversOf } from "./sports/overs";
import { FOOTBALL } from "./sports/football";
import { KABADDI } from "./sports/kabaddi";
import { VOLLEYBALL } from "./sports/volleyball";
import { standingsRulesOf } from "./sports";

/*
 * SP-1 Phase 2: the table takes RULES now. Cricket's are the pack's, so every
 * assertion below is still about cricket's arithmetic — a change to NRR or to
 * the points scheme fails here exactly as it did before the generalisation.
 */
const CRICKET_RULES = standingsRulesOf(CRICKET);

/**
 * A league table is arithmetic nobody re-checks. It is read as fact, it decides
 * who qualifies, and when it is wrong it is wrong quietly for a whole season —
 * so what is asserted here is the handful of places it actually goes wrong, not
 * that two plus two is four.
 */

const A = "team-a";
const B = "team-b";
const C = "team-c";
const TEAMS = [A, B, C];

function rowFor(rows: StandingsRow[], teamId: string): StandingsRow {
  const row = rows.find((entry) => entry.teamId === teamId);
  if (row === undefined) {
    throw new Error(`no row for ${teamId}`);
  }
  return row;
}

describe("overs and balls", () => {
  it("reads 4.5 as four overs and five balls, not four and a half", () => {
    // The bug this exists to prevent. As a decimal, 4.5 overs is 27 balls; in
    // cricket it is 29. A net run rate built on the decimal is wrong by ~8% per
    // fractional over, silently, in the number that decides qualification.
    expect(ballsOf("4.5")).toBe(29);
    expect(ballsOf("20")).toBe(120);
    expect(ballsOf("0.1")).toBe(1);
    expect(oversOf(29)).toBe("4.5");
    expect(oversOf(120)).toBe("20.0");
  });

  it("refuses .6 rather than folding it to the next over", () => {
    // Somebody typing 4.6 has made a mistake. Reading it as 5.0 hides that
    // inside a number nobody re-checks afterwards.
    expect(ballsOf("4.6")).toBeNull();
    expect(ballsOf("4.9")).toBeNull();
    expect(ballsOf("abc")).toBeNull();
    expect(ballsOf("-1")).toBeNull();
  });

  it("round-trips every ball count in a T20 innings", () => {
    for (let balls = 0; balls <= 120; balls += 1) {
      expect(ballsOf(oversOf(balls)), `${String(balls)} balls`).toBe(balls);
    }
  });
});

describe("the table", () => {
  it("gives a team that has not played a row, not an absence", () => {
    // A table that omits the team yet to play its first match reads as if they
    // are not in the competition at all.
    const rows = buildStandings(TEAMS, [], CRICKET_RULES);
    expect(rows).toHaveLength(3);
    expect(rowFor(rows, C).played).toBe(0);
    expect(
      rowFor(rows, C).tiebreakers["net_run_rate"],
      "no innings is not a rate of zero",
    ).toBeNull();
  });

  it("counts a no-result as PLAYED and shares the point; abandoned counts as nothing", () => {
    /*
     * The distinction leagues actually make, and the most common way a table
     * comes out wrong. A washed-out match that started is a no-result: it was
     * played and both sides take a point. One that never started is abandoned
     * and did not happen — no points, no played, no effect on run rate.
     */
    const results: FixtureResultInput[] = [
      { homeTeamId: A, awayTeamId: B, outcome: "no_result" },
      { homeTeamId: A, awayTeamId: C, outcome: "abandoned" },
    ];
    const rows = buildStandings(TEAMS, results, CRICKET_RULES);
    expect(rowFor(rows, A).played).toBe(1);
    expect(rowFor(rows, A).noResult).toBe(1);
    expect(rowFor(rows, A).points).toBe(1);
    expect(rowFor(rows, B).points).toBe(1);
    expect(rowFor(rows, C).played, "an abandoned match was not played").toBe(0);
    expect(rowFor(rows, C).points).toBe(0);
  });

  it("computes net run rate on BALLS, and both sides of it", () => {
    // A scores 180 in 20 overs, B replies 150 in 20. A's NRR is +1.50, B's is
    // -1.50 — computed as runs/balls*6 on each side, never on a decimal over.
    const rows = buildStandings(
      [A, B],
      [
        {
          homeTeamId: A,
          awayTeamId: B,
          outcome: "home_win",
          homeScore: { runs: 180, balls: 120 },
          awayScore: { runs: 150, balls: 120 },
        },
      ],
      CRICKET_RULES,
    );
    expect(rowFor(rows, A).tiebreakers["net_run_rate"]).toBeCloseTo(1.5, 10);
    expect(rowFor(rows, B).tiebreakers["net_run_rate"]).toBeCloseTo(-1.5, 10);
  });

  it("gets a part-over innings right, where the decimal would not", () => {
    /*
     * B chases 150 and gets there in 18.3 overs — 111 balls. Their rate is
     * 150/111*6 = 8.108…, NOT 150/18.3 = 8.196…. The two differ by enough to
     * reorder a qualification table, and only the first is cricket.
     */
    const rows = buildStandings(
      [A, B],
      [
        {
          homeTeamId: A,
          awayTeamId: B,
          outcome: "away_win",
          homeScore: { runs: 149, balls: 120 },
          awayScore: { runs: 150, balls: ballsOf("18.3") ?? 0 },
        },
      ],
      CRICKET_RULES,
    );
    expect(rowFor(rows, B).scored["balls"]).toBe(111);
    expect(rowFor(rows, B).tiebreakers["net_run_rate"]).toBeCloseTo(
      (150 / 111) * 6 - (149 / 120) * 6,
      10,
    );
  });

  it("orders by points, then run rate, then wins — and never flickers", () => {
    /*
     * The last tiebreak is not decoration. Without a total order two equal
     * teams' places depend on insertion order, so the table can swap them
     * between page loads. A stable arbitrary tiebreak is honest; a flickering
     * one makes the whole table untrustworthy.
     */
    const results: FixtureResultInput[] = [
      {
        homeTeamId: A,
        awayTeamId: C,
        outcome: "home_win",
        homeScore: { runs: 200, balls: 120 },
        awayScore: { runs: 100, balls: 120 },
      },
      {
        homeTeamId: B,
        awayTeamId: C,
        outcome: "home_win",
        homeScore: { runs: 150, balls: 120 },
        awayScore: { runs: 140, balls: 120 },
      },
    ];
    const rows = buildStandings(TEAMS, results, CRICKET_RULES);
    expect(
      rows.map((row) => row.teamId),
      "equal points, A ahead on rate",
    ).toEqual([A, B, C]);
    // Deterministic across runs and across input order.
    expect(
      buildStandings(TEAMS, [...results].reverse(), CRICKET_RULES).map((row) => row.teamId),
    ).toEqual([A, B, C]);
  });

  it("sorts a team with no rate BELOW every team that has one", () => {
    // Including below a team with a NEGATIVE rate: having played and lost badly
    // still outranks not having played, and zero would have tied them.
    const rows = buildStandings(
      [A, B],
      [
        {
          homeTeamId: A,
          awayTeamId: B,
          outcome: "no_result",
          homeScore: { runs: 10, balls: 60 },
          awayScore: { runs: 90, balls: 60 },
        },
      ],
      CRICKET_RULES,
    );
    expect(rowFor(rows, A).tiebreakers["net_run_rate"]).toBeLessThan(0);
    expect(rows[0]?.teamId, "a real negative rate outranks none at all").toBe(B);
  });

  it("ignores a result naming a team outside the competition", () => {
    const rows = buildStandings(
      [A, B],
      [{ homeTeamId: A, awayTeamId: "ghost", outcome: "home_win" }],
      CRICKET_RULES,
    );
    expect(rowFor(rows, A).played, "the table describes the teams it was given").toBe(0);
    expect(rows).toHaveLength(2);
  });
});

/*
 * THE SAME FUNCTION, A DIFFERENT SPORT.
 *
 * Cricket passing after the Phase 2 generalisation only proves nothing broke.
 * These prove the table actually generalised: three points for a win, goal
 * difference then goals scored, and not one branch on sport in `buildStandings`.
 */
describe("the table, in football", () => {
  const RULES = standingsRulesOf(FOOTBALL);

  it("awards THREE points for a win, where cricket awards two", () => {
    const rows = buildStandings(
      [A, B],
      [
        {
          homeTeamId: A,
          awayTeamId: B,
          outcome: "home_win",
          homeScore: { goals: 2 },
          awayScore: { goals: 1 },
        },
      ],
      RULES,
    );
    expect(rowFor(rows, A).points, "3-1-0 is what reshaped how football is played").toBe(3);
    expect(rowFor(rows, B).points).toBe(0);
  });

  it("breaks a tie on goal difference, then on goals scored", () => {
    /*
     * A and C both win once and sit on three points. A wins 5–0 and C wins 1–0,
     * so A is ahead on difference. B and D also tie on points but on the same
     * difference — B scored more, so B is ahead. Both keys are exercised.
     */
    const rows = buildStandings(
      [A, B, C, "team-d"],
      [
        {
          homeTeamId: A,
          awayTeamId: B,
          outcome: "home_win",
          homeScore: { goals: 5 },
          awayScore: { goals: 0 },
        },
        {
          homeTeamId: C,
          awayTeamId: "team-d",
          outcome: "home_win",
          homeScore: { goals: 1 },
          awayScore: { goals: 0 },
        },
      ],
      RULES,
    );
    expect(rows.map((row) => row.teamId).slice(0, 2), "A ahead of C on difference").toEqual([A, C]);
    expect(rowFor(rows, A).tiebreakers["goal_difference"]).toBe(5);
    expect(rowFor(rows, C).tiebreakers["goal_difference"]).toBe(1);
    expect(rowFor(rows, A).tiebreakers["goals_for"]).toBe(5);
  });

  it("has no net run rate to compute, and does not invent one", () => {
    const rows = buildStandings([A, B], [], RULES);
    expect(Object.keys(rowFor(rows, A).tiebreakers)).toEqual(["goal_difference", "goals_for"]);
    expect(rowFor(rows, A).tiebreakers["net_run_rate"]).toBeUndefined();
  });

  it("summarises a side as a goal count, where cricket reads 180/20.0", () => {
    expect(FOOTBALL.standings.summariseSide({ goals: 12 })).toBe("12");
    expect(CRICKET.standings.summariseSide({ runs: 180, balls: 120 })).toBe("180/20.0");
  });

  it("counts a goalless draw as played, with a real zero difference", () => {
    // Zero is a REAL goal difference here — the distinction the null in
    // `compute` exists to protect.
    const rows = buildStandings(
      [A, B],
      [
        {
          homeTeamId: A,
          awayTeamId: B,
          outcome: "tie",
          homeScore: { goals: 0 },
          awayScore: { goals: 0 },
        },
      ],
      RULES,
    );
    expect(rowFor(rows, A).points).toBe(1);
    expect(rowFor(rows, A).tiebreakers["goal_difference"]).toBe(0);
  });
});

/*
 * THE THIRD PACK, which is the one that tests the claim.
 *
 * Cricket built the contract and football forced three additions to it.
 * Kabaddi added nothing — so what these assert is that a pack written entirely
 * against the existing contract simply works: its own points scheme, its own
 * tiebreaks, its own word for the place it is played, and no attributes at all.
 */
describe("the table, in kabaddi", () => {
  const RULES = standingsRulesOf(KABADDI);

  it("breaks a tie on score difference, then on points scored", () => {
    const rows = buildStandings(
      [A, B, C],
      [
        {
          homeTeamId: A,
          awayTeamId: B,
          outcome: "home_win",
          homeScore: { points: 44 },
          awayScore: { points: 30 },
        },
        {
          homeTeamId: C,
          awayTeamId: B,
          outcome: "home_win",
          homeScore: { points: 35 },
          awayScore: { points: 33 },
        },
      ],
      RULES,
    );
    expect(rows.map((row) => row.teamId).slice(0, 2), "A ahead of C on difference").toEqual([A, C]);
    expect(rowFor(rows, A).tiebreakers["score_difference"]).toBe(14);
    expect(rowFor(rows, C).tiebreakers["score_difference"]).toBe(2);
    expect(rowFor(rows, A).tiebreakers["points_for"]).toBe(44);
  });

  it("awards the ordinary club 2/1/0, not the Pro Kabaddi League's scheme", () => {
    const rows = buildStandings(
      [A, B],
      [
        {
          homeTeamId: A,
          awayTeamId: B,
          outcome: "home_win",
          homeScore: { points: 40 },
          awayScore: { points: 20 },
        },
      ],
      RULES,
    );
    // PKL awards 5 for a win with a bonus point for losing within seven. That
    // is a professional competition's rule; encoding it as the default would
    // impose it on every club league that is not PKL. PointsPolicy is a value.
    expect(rowFor(rows, A).points).toBe(2);
    expect(rowFor(rows, B).points).toBe(0);
  });

  it("is played on a Mat — the third distinct answer to one word", () => {
    expect(KABADDI.terms.ground).toBe("Mat");
    expect(FOOTBALL.terms.ground).toBe("Pitch");
    expect(CRICKET.terms.ground).toBe("Ground");
  });

  it("declares no attributes, and the contract takes that", () => {
    // Club kabaddi records no per-player fact comparable to a batting style or
    // a preferred foot. Inventing one would put a field on the registration
    // form nobody can fill. This is the contract's empty case, exercised.
    expect(KABADDI.attributes).toEqual([]);
    expect(standingsRulesOf(KABADDI).scoreFields).toEqual(["points"]);
  });
});

/*
 * VOLLEYBALL — the first pack whose tiebreaks are RATIOS, and the first that
 * can divide by zero. A team that has not lost a set has an infinite set ratio,
 * and every obvious handling of that is wrong in a way nobody notices until the
 * table is. These tests exist because the reasoning alone is not evidence.
 */
describe("the table, in volleyball", () => {
  const RULES = standingsRulesOf(VOLLEYBALL);
  const D = "team-d";

  const match = (home: string, away: string, hs: number, as_: number, hp: number, ap: number) => ({
    homeTeamId: home,
    awayTeamId: away,
    outcome: (hs > as_ ? "home_win" : "away_win") as ResultOutcome,
    homeScore: { sets: hs, points: hp },
    awayScore: { sets: as_, points: ap },
  });

  it("puts an UNDEFEATED team above a beaten one, not below it", () => {
    /*
     * The bug this is written against. A has lost no sets, so its ratio divides
     * by zero. Returning null or 0 for that would sort the only unbeaten team
     * in the league to the BOTTOM of the table — quietly, all season.
     */
    const rows = buildStandings(
      [A, B, C, D],
      [match(A, B, 3, 0, 75, 50), match(C, D, 3, 1, 98, 87)],
      RULES,
    );
    expect(rowFor(rows, A).tiebreakers["set_ratio"]).toBe(Number.POSITIVE_INFINITY);
    expect(rowFor(rows, C).tiebreakers["set_ratio"]).toBe(3);
    expect(rows.map((row) => row.teamId).slice(0, 2), "unbeaten A above C").toEqual([A, C]);
  });

  it("does not go incoherent when TWO teams are unbeaten", () => {
    /*
     * Infinity - Infinity is NaN, and a comparator returning NaN sorts
     * arbitrarily. `compareStandings` catches it with `av === bv` and falls
     * through to the next key — here, point ratio, where A is genuinely ahead.
     */
    const rows = buildStandings(
      [A, C, B, D],
      [match(A, B, 3, 0, 75, 30), match(C, D, 3, 0, 75, 70)],
      RULES,
    );
    expect(rowFor(rows, A).tiebreakers["set_ratio"]).toBe(Number.POSITIVE_INFINITY);
    expect(rowFor(rows, C).tiebreakers["set_ratio"]).toBe(Number.POSITIVE_INFINITY);
    const order = rows.map((row) => row.teamId);
    expect(order.slice(0, 2), "separated on point ratio, not left to chance").toEqual([A, C]);
    // Deterministic: the same input in another order gives the same table.
    expect(
      buildStandings(
        [D, B, C, A],
        [match(C, D, 3, 0, 75, 70), match(A, B, 3, 0, 75, 30)],
        RULES,
      ).map((row) => row.teamId),
    ).toEqual(order);
  });

  it("gives a team that has played nothing NO ratio, and sorts it last", () => {
    // Distinct from an infinite one: no sets either way is genuinely "no
    // ratio", and a team yet to play cannot outrank one that has won.
    const rows = buildStandings([A, B, C], [match(A, B, 3, 1, 98, 87)], RULES);
    expect(rowFor(rows, C).tiebreakers["set_ratio"]).toBeNull();
    expect(rows[rows.length - 1]?.teamId, "the team with no ratio is last").toBe(C);
  });

  it("ranks on SETS before points, which is the whole reason it carries both", () => {
    // B wins more points across the season but fewer sets. Volleyball ranks on
    // sets: a team that steals long sets it loses does not climb on that.
    const rows = buildStandings([A, B], [match(A, B, 3, 2, 100, 110)], RULES);
    expect(rowFor(rows, A).scored["sets"]).toBe(3);
    expect(rowFor(rows, B).scored["points"]).toBeGreaterThan(rowFor(rows, A).scored["points"] ?? 0);
    expect(rows[0]?.teamId, "sets decide it, not points").toBe(A);
  });

  it("is played on a Court — the fourth distinct answer to one word", () => {
    expect(VOLLEYBALL.terms.ground).toBe("Court");
    expect([CRICKET, FOOTBALL, KABADDI].map((p) => p.terms.ground)).toEqual([
      "Ground",
      "Pitch",
      "Mat",
    ]);
  });
});
