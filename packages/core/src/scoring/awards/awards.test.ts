import { describe, expect, it } from "vitest";
import { initialState, batterLine, type InningsState, type BallSummary } from "../delivery/state";
import type { PlayerLine, DerivedResult } from "../types";
import { scoreMatch } from "./cricket-v1";
import { pickMatchAwards, type AwardCandidate } from "./pick";
import { seasonPlayers, pickSeasonAwards, type SeasonMatch } from "./season";

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error("Missing test fixture value");
  return value;
}

function inning(overrides: Partial<InningsState> = {}): InningsState {
  return {
    scoreTrace: [],
    miscountedOvers: {},
    completedOvers: 0,
    ballsInOver: 0,
    targetMethod: null,
    no: 1,
    superOver: false,
    battingTeamId: "away",
    bowlingTeamId: "home",
    runs: 312,
    wickets: 2,
    legalBalls: 230,
    maxBalls: null,
    target: null,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 },
    strikerId: null,
    nonStrikerId: null,
    bowlerId: null,
    batters: {},
    bowlers: {},
    battedOrder: [],
    outIds: [],
    retiredHurt: [],
    absentBatterIds: [],
    overs: [],
    fallOfWickets: [],
    freeHitNext: false,
    closed: null,
    lastBowlerOfPreviousOver: null,
    conditionsAtBall: {},
    retirePromptDue: null,
    ...overrides,
  };
}
function ball(
  seq: number,
  kind: "caught" | "bowled" | "run_out" = "caught",
  fielders = ["f"],
  unknown = 0,
): BallSummary {
  return {
    eventId: `e${String(seq)}`,
    seq,
    legal: true,
    total: 0,
    over: "0",
    clientRecordedAt: "2026-10-09T00:00:00Z",
    conditions: {},
    strikerId: `victim${String(seq)}`,
    nonStrikerId: "other",
    bowlerId: "p",
    runsBat: 0,
    extras: { wides: 0, byes: 0, legByes: 0 },
    wicket: {
      kind,
      playerOutId: `victim${String(seq)}`,
      fielderIds: fielders,
      ...(unknown ? { unknownFielderCount: unknown } : {}),
    },
  };
}
function player(id = "p", teamId = "home"): PlayerLine {
  return {
    registrationId: id,
    teamId,
    appeared: true,
    batting: { ...batterLine(1), runs: 58, balls: 37, fours: 6, sixes: 3 },
    bowling: { legalBalls: 18, maiden: 0, runs: 27, wickets: 2, dots: 6, wides: 0, noBalls: 0 },
  };
}
function candidate(id: string, team: string, points: number, discipline = points): AwardCandidate {
  return {
    registrationId: id,
    teamId: team,
    points,
    lines: [{ code: "runs", label: "Translated label", qty: 1, points: discipline }],
  };
}
const win: DerivedResult = {
  outcome: "home_win",
  winnerTeamId: "home",
  marginText: "Won",
  method: null,
};

describe("cricket-v1 points", () => {
  it("reproduces every line of the required 127.6 example without stacking milestones", () => {
    const state = initialState();
    state.innings = [
      inning({
        batters: { victim1: batterLine(2), victim2: batterLine(5) },
        overs: [{ bowlerId: "p", balls: [ball(1), ball(2)] }],
      }),
    ];
    const score = required(scoreMatch(new Map([["p", player()]]), state, "t20").get("p"));
    expect(Object.fromEntries(score.lines.map((line) => [line.code, line.points]))).toEqual({
      runs: 58,
      fours: 6,
      sixes: 6,
      milestone_50: 8,
      pace_vs_match: 3.9,
      wickets: 40,
      top_order_bonus: 4,
      dots: 3,
      economy_vs_match: -1.3,
    });
    expect(score.points).toBe(127.6);
  });
  it.each(["t20", "odi", "t10", "six_over", "tennis_gully", "box_6"])(
    "applies format caps, wicket/haul and maiden values: %s",
    (format) => {
      const state = initialState();
      state.innings = [inning({ runs: 0, legalBalls: 100 })];
      const line = player();
      required(line.batting).runs = 200;
      required(line.bowling).wickets = 5;
      required(line.bowling).maiden = 1;
      required(line.bowling).runs = 100;
      const score = required(scoreMatch(new Map([["p", line]]), state, format).get("p"));
      const points = Object.fromEntries(score.lines.map((item) => [item.code, item.points]));
      const long = format === "t20" || format === "odi";
      const box = format === "box_6";
      expect(points.pace_vs_match).toBe(long ? 10 : box ? 6 : 8);
      expect(points.economy_vs_match).toBe(long ? -10 : box ? -6 : -8);
      expect(points.wickets).toBe(box ? 75 : 100);
      expect(points.haul).toBe(long ? 16 : 8);
      expect(points.maidens).toBe(long ? 8 : 12);
    },
  );
  it("uses inclusive minimum balls and penalizes only dismissed qualifying ducks", () => {
    const state = initialState();
    state.innings = [inning()];
    const line = player();
    line.batting = { ...batterLine(7), balls: 9, out: true, notOut: false };
    required(line.bowling).legalBalls = 11;
    const score = () => required(scoreMatch(new Map([["p", line]]), state, "t20").get("p"));
    expect(score().lines.map((value) => value.code)).not.toContain("pace_vs_match");
    expect(score().lines.map((value) => value.code)).not.toContain("economy_vs_match");
    expect(score().lines.find((value) => value.code === "duck")?.points).toBe(-2);
    line.batting.balls = 10;
    required(line.bowling).legalBalls = 12;
    expect(score().lines.map((value) => value.code)).toEqual(
      expect.arrayContaining(["pace_vs_match", "economy_vs_match"]),
    );
    line.batting.out = false;
    expect(score().lines.map((value) => value.code)).not.toContain("duck");
    line.batting.out = true;
    line.batting.position = 8;
    expect(score().lines.map((value) => value.code)).not.toContain("duck");
  });
  it("counts two-participant assists including anonymous partners, excludes larger groups and super overs", () => {
    const state = initialState();
    state.innings = [
      inning({
        overs: [
          {
            bowlerId: "p",
            balls: [
              ball(1, "run_out", ["f", "g"]),
              ball(2, "run_out", ["f"], 1),
              ball(3, "run_out", ["f", "g", "h"]),
              ball(4, "run_out", ["f", "g"], 1),
            ],
          },
        ],
      }),
      inning({
        superOver: true,
        runs: 999,
        overs: [{ bowlerId: "p", balls: [ball(5, "run_out", ["f", "g"])] }],
      }),
    ];
    const line: PlayerLine = {
      registrationId: "f",
      teamId: "home",
      appeared: true,
      fielding: { catches: 1, stumpings: 1, runOutsDirect: 1, runOutsAssisted: 4 },
    };
    const score = required(scoreMatch(new Map([["f", line]]), state, "t20").get("f"));
    expect(score.lines.find((value) => value.code === "run_out_assist")).toMatchObject({
      qty: 2,
      points: 10,
    });
    expect(score.points).toBe(38);
  });
  it("credits bowled and set-batter bonuses from the effective dismissal record", () => {
    const state = initialState();
    const prior = ball(1);
    prior.runsBat = 20;
    delete prior.wicket;
    const dismissed = ball(2, "bowled");
    required(dismissed.wicket).playerOutId = "victim1";
    state.innings = [
      inning({
        batters: { victim1: { ...batterLine(5), runs: 20 } },
        overs: [{ bowlerId: "p", balls: [prior, dismissed] }],
      }),
    ];
    const score = required(scoreMatch(new Map([["p", player()]]), state, "t20").get("p"));
    expect(score.lines.find((value) => value.code === "bowled_lbw_bonus")?.points).toBe(4);
    expect(score.lines.find((value) => value.code === "top_order_bonus")?.points).toBe(4);
  });
});

describe("match picks", () => {
  it("chooses the highest winning player in the top three and excludes PoM from Fighter", () => {
    const picks = pickMatchAwards(
      [candidate("a", "away", 100), candidate("b", "away", 90), candidate("c", "home", 80)],
      win,
    );
    expect(picks.player_of_match?.registrationId).toBe("c");
    expect(picks.fighter_of_match?.registrationId).toBe("a");
    expect(
      pickMatchAwards(
        [
          candidate("a", "away", 100),
          candidate("b", "away", 90),
          candidate("c", "away", 80),
          candidate("d", "home", 70),
        ],
        win,
      ).player_of_match?.registrationId,
    ).toBe("a");
  });
  it("breaks ties by winner, single discipline and lexical ID independently of input order", () => {
    const candidates = [
      candidate("z", "away", 100),
      candidate("b", "home", 100, 50),
      candidate("c", "home", 100, 60),
      candidate("a", "home", 100, 60),
    ];
    expect(pickMatchAwards(candidates, win).player_of_match?.registrationId).toBe("a");
    expect(pickMatchAwards(candidates.reverse(), win).player_of_match?.registrationId).toBe("a");
  });
  it("has no Fighter without a losing side and no awards before a result", () => {
    for (const outcome of ["tie", "no_result", "abandoned"] as const)
      expect(
        pickMatchAwards([candidate("p", "home", 1)], { ...win, outcome, winnerTeamId: null })
          .fighter_of_match,
      ).toBeNull();
    expect(pickMatchAwards([candidate("p", "home", 1)], null)).toEqual({
      player_of_match: null,
      fighter_of_match: null,
    });
  });
});

function match(
  id: string,
  players: PlayerLine[],
  overrides: Partial<SeasonMatch> = {},
): SeasonMatch {
  return {
    fixtureId: id,
    trust: "verified",
    completed: true,
    teamIds: ["home", "away"],
    formatKey: "t20",
    players: new Map(players.map((line) => [line.registrationId, line])),
    scores: new Map(players.map((line) => [line.registrationId, { points: 10, lines: [] }])),
    ...overrides,
  };
}
describe("season awards", () => {
  it("filters trust/completion, deduplicates fixtures, and applies the inclusive 50% MVP rule", () => {
    const a = match("a", [player()]);
    const b = match("b", []);
    const rows = seasonPlayers([
      a,
      a,
      b,
      match("u", [player()], { trust: "self_scored" }),
      match("live", [player()], { completed: false }),
    ]);
    expect(rows[0]).toMatchObject({ matches: 1, teamMatches: 2, points: 10, mvpEligible: true });
    expect(pickSeasonAwards(rows).season_mvp?.registrationId).toBe("p");
    const more = seasonPlayers([a, b, match("c", [])]);
    expect(pickSeasonAwards(more).season_mvp).toBeNull();
    expect(
      pickSeasonAwards(more, { emergingEligible: new Set(["p"]) }).emerging?.registrationId,
    ).toBe("p");
  });
  it.each(["t20", "t10", "box_6"])(
    "exposes qualification remaining counts and qualifies at boundaries: %s",
    (formatKey) => {
      const line = player();
      required(line.batting).balls = 20;
      required(line.bowling).legalBalls = formatKey === "t20" ? 20 : 10;
      const row = required(
        seasonPlayers([match("a", [line], { formatKey }), match("b", [line], { formatKey })])[0],
      );
      expect(row.strikeRate).toMatchObject({ qualified: false, remaining: 20 });
      expect(row.battingAverage).toMatchObject({ qualified: false, remaining: 1, value: null });
      expect(row.economy.remaining).toBe(formatKey === "t20" ? 20 : 10);
      required(line.batting).out = true;
      const qualified = required(
        seasonPlayers([
          match("a", [line], { formatKey }),
          match("b", [line], { formatKey }),
          match("c", [line], { formatKey }),
        ])[0],
      );
      expect(qualified.strikeRate.qualified).toBe(true);
      expect(qualified.economy.qualified).toBe(true);
      expect(qualified.battingAverage.qualified).toBe(true);
      expect(qualified.bowlingAverage.qualified).toBe(true);
    },
  );
  it("keeps runs/wickets primary, compares qualified metrics next, and uses IDs last", () => {
    const a = player("a");
    const b = player("b");
    required(a.batting).balls = 60;
    required(b.batting).balls = 59;
    const rows = seasonPlayers([match("a", [a, b])]);
    expect(pickSeasonAwards(rows).best_batter?.registrationId).toBe("a");
    required(b.batting).runs++;
    expect(pickSeasonAwards(seasonPlayers([match("a", [a, b])])).best_batter?.registrationId).toBe(
      "b",
    );
    expect(pickSeasonAwards(rows.reverse()).best_bowler?.registrationId).toBe("a");
  });
  it("supports best-N totals, designated keeper stats, and prefiltered scorer counts", () => {
    const line = player();
    const matches = [
      match("a", [line], { keepers: new Map([["p", { catches: 2, stumpings: 1, byes: 3 }]]) }),
      match("b", [line]),
    ];
    const rows = seasonPlayers(matches, { bestN: 1 });
    expect(rows[0]).toMatchObject({ points: 10, perMatch: 5, keeperDismissals: 3, keeperByes: 3 });
    const awards = pickSeasonAwards(rows, {
      scorers: [
        { personId: "z", completedVerifiedMatches: 2 },
        { personId: "a", completedVerifiedMatches: 2 },
        { personId: "empty", completedVerifiedMatches: 0 },
      ],
    });
    expect(awards.best_keeper?.registrationId).toBe("p");
    expect(awards.scorer_of_season?.personId).toBe("a");
    expect(() => seasonPlayers(matches, { bestN: 0 })).toThrow();
  });
});
