import { describe, expect, it } from "vitest";

import {
  ballsOf,
  buildStandings,
  oversOf,
  type FixtureResultInput,
  type StandingsRow,
} from "./standings";

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
    const rows = buildStandings(TEAMS, []);
    expect(rows).toHaveLength(3);
    expect(rowFor(rows, C).played).toBe(0);
    expect(rowFor(rows, C).netRunRate, "no innings is not a rate of zero").toBeNull();
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
    const rows = buildStandings(TEAMS, results);
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
          homeRuns: 180,
          homeBalls: 120,
          awayRuns: 150,
          awayBalls: 120,
        },
      ],
    );
    expect(rowFor(rows, A).netRunRate).toBeCloseTo(1.5, 10);
    expect(rowFor(rows, B).netRunRate).toBeCloseTo(-1.5, 10);
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
          homeRuns: 149,
          homeBalls: 120,
          awayRuns: 150,
          awayBalls: ballsOf("18.3") ?? 0,
        },
      ],
    );
    expect(rowFor(rows, B).ballsFaced).toBe(111);
    expect(rowFor(rows, B).netRunRate).toBeCloseTo((150 / 111) * 6 - (149 / 120) * 6, 10);
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
        homeRuns: 200,
        homeBalls: 120,
        awayRuns: 100,
        awayBalls: 120,
      },
      {
        homeTeamId: B,
        awayTeamId: C,
        outcome: "home_win",
        homeRuns: 150,
        homeBalls: 120,
        awayRuns: 140,
        awayBalls: 120,
      },
    ];
    const rows = buildStandings(TEAMS, results);
    expect(
      rows.map((row) => row.teamId),
      "equal points, A ahead on rate",
    ).toEqual([A, B, C]);
    // Deterministic across runs and across input order.
    expect(buildStandings(TEAMS, [...results].reverse()).map((row) => row.teamId)).toEqual([
      A,
      B,
      C,
    ]);
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
          homeRuns: 10,
          homeBalls: 60,
          awayRuns: 90,
          awayBalls: 60,
        },
      ],
    );
    expect(rowFor(rows, A).netRunRate).toBeLessThan(0);
    expect(rows[0]?.teamId, "a real negative rate outranks none at all").toBe(B);
  });

  it("ignores a result naming a team outside the competition", () => {
    const rows = buildStandings(
      [A, B],
      [{ homeTeamId: A, awayTeamId: "ghost", outcome: "home_win" }],
    );
    expect(rowFor(rows, A).played, "the table describes the teams it was given").toBe(0);
    expect(rows).toHaveLength(2);
  });
});
