import { FORMAT_PRESETS, replayMatch, type MatchEvent } from "@desiauction/core/scoring";
import { describe, expect, it } from "vitest";
import { finalizedBallFacts } from "./ball-facts";
import { wholeMatchConditions } from "../insights/season-conditions";

const fixture = { id: "fixture", orgId: "club", competitionId: "season" };
function event(
  type: MatchEvent["type"],
  payload: unknown,
  seq: number,
  target: string | null = null,
) {
  return {
    type,
    payload,
    seq,
    attempt: 1,
    eventId: `event-${String(seq)}`,
    v: 1,
    targetEventId: target,
    actorPersonId: "scorer",
    clientSeq: seq,
    clientRecordedAt: "2026-10-10T00:00:00.000Z",
  } as MatchEvent;
}
function source() {
  const ball = (extras: object, runsBat = 0) => ({
    bowlerId: "a1",
    strikerId: "h1",
    nonStrikerId: "h2",
    runsBat,
    extras,
  });
  return [
    event(
      "match_started",
      {
        format: FORMAT_PRESETS.t20,
        conditions: {
          ball: { type: "tennis" },
          pitch: "matting",
          ground: "full",
          timeOfDay: "night",
        },
        homeTeamId: "home",
        awayTeamId: "away",
      },
      1,
    ),
    event(
      "lineup_confirmed",
      {
        teamId: "home",
        battingOrder: ["h1", "h2", "h3"],
        captainId: "h1",
        keeperId: "h2",
        substitutes: [],
      },
      2,
    ),
    event(
      "lineup_confirmed",
      {
        teamId: "away",
        battingOrder: ["a1", "a2", "a3"],
        captainId: "a1",
        keeperId: "a2",
        substitutes: [],
      },
      3,
    ),
    event("toss", { winnerTeamId: "home", decision: "bat" }, 4),
    event(
      "innings_started",
      { inningsNo: 1, battingTeamId: "home", strikerId: "h1", nonStrikerId: "h2", bowlerId: "a1" },
      5,
    ),
    event("ball", ball({ noBall: true, byes: 2 }), 6),
    event("ball", ball({ noBall: true, noBallRuns: 3, legByes: 2 }), 7),
    event("ball", ball({ byes: 2 }), 8),
    event("ball", ball({ wides: 3 }), 9),
    event("ball", { ...ball({}, 4), boundary: 4, shot: { zone: "mid_wicket", angle: 180 } }, 10),
  ];
}
describe("D14 primary-extra analytics", () => {
  it("filters whole matches from effective delivery and nondelivery dismissal conditions", () => {
    const original = source();
    const homogeneous = replayMatch(original);
    expect(wholeMatchConditions(homogeneous, { ballType: "tennis", timeOfDay: "night" })).toBe(
      true,
    );
    expect(wholeMatchConditions(homogeneous, { ballType: "leather" })).toBe(false);
    const mixed = replayMatch([
      ...original.slice(0, 6),
      event("conditions_changed", { conditions: { timeOfDay: "day" } }, 7),
      event(
        "ball",
        { bowlerId: "a1", strikerId: "h1", nonStrikerId: "h2", runsBat: 0, extras: {} },
        8,
      ),
    ]);
    expect(wholeMatchConditions(mixed, { timeOfDay: "night" })).toBe(false);
    expect(wholeMatchConditions(mixed, { ballType: "tennis" })).toBe(true);
    expect(wholeMatchConditions(mixed, {})).toBe(true);
    const corrected = replayMatch([
      ...mixed.eventHistory,
      event("amend", { payload: { conditions: { timeOfDay: "night" } } }, 9, "event-7"),
    ]);
    expect(wholeMatchConditions(corrected, { timeOfDay: "night" })).toBe(true);
    const empty = replayMatch(original.slice(0, 5));
    expect(wholeMatchConditions(empty, {})).toBe(true);
    expect(wholeMatchConditions(empty, { timeOfDay: "night" })).toBe(false);
    const retirement = replayMatch([
      ...original.slice(0, 5),
      event("retire", { registrationId: "h2", kind: "out" }, 6),
    ]);
    expect(wholeMatchConditions(retirement, { timeOfDay: "night" })).toBe(true);
    const unknown = replayMatch(
      original.map((item) =>
        item.seq === 1
          ? { ...item, payload: { ...(item.payload as object), conditions: {} } }
          : item,
      ),
    );
    expect(wholeMatchConditions(unknown, { timeOfDay: "night" })).toBe(false);
    expect(wholeMatchConditions(unknown, {})).toBe(true);
  });
  it("attributes only a sole known fielder and credits caught-and-bowled to the bowler", () => {
    const state = replayMatch(source());
    const ball = required(required(required(state.innings[0]).overs[0]).balls[0]);
    ball.wicket = { kind: "caught", playerOutId: "h1", fielderIds: ["a2"] };
    expect(required(finalizedBallFacts(fixture, state, "verified")[0]).fielderId).toBe("a2");
    ball.wicket.fielderIds = ["a2", "a3"];
    expect(required(finalizedBallFacts(fixture, state, "verified")[0]).fielderId).toBeNull();
    ball.wicket.fielderIds = ["a2"];
    ball.wicket.unknownFielderCount = 1;
    expect(required(finalizedBallFacts(fixture, state, "verified")[0]).fielderId).toBeNull();
    ball.wicket = { kind: "caught_and_bowled", playerOutId: "h1", fielderIds: [] };
    expect(required(finalizedBallFacts(fixture, state, "verified")[0]).fielderId).toBe("a1");
  });
  it("mixed extras reconcile grouped bowler concession without pretending to be team totals", () => {
    const state = replayMatch(source());
    const rows = finalizedBallFacts(fixture, state, "verified");
    expect(rows.map((row) => [row.extraKind, row.extras])).toEqual([
      ["no_ball", 1],
      ["no_ball", 3],
      ["bye", 2],
      ["wide", 3],
      [null, 0],
    ]);
    const conceded = rows.reduce(
      (sum, row) =>
        sum + row.runsBat + (["wide", "no_ball"].includes(row.extraKind ?? "") ? row.extras : 0),
      0,
    );
    expect(conceded).toBe(required(required(state.innings[0]).bowlers.a1).runs);
    expect(conceded).toBe(11);
    expect(rows.reduce((sum, row) => sum + row.runsBat + row.extras, 0)).not.toBe(
      required(state.innings[0]).runs,
    );
    expect(
      rows.every(
        (row) => row.ballType === "tennis" && row.pitch === "matting" && row.phase === "powerplay",
      ),
    ).toBe(true);
    expect(rows[4]).toMatchObject({
      boundary: 4,
      zone: "mid_wicket",
      angle: 180,
      overNo: 1,
      ballInOver: 2,
    });
  });
  it("an effective correction changes only the canonical delivery projection", () => {
    const original = source();
    const state = replayMatch([
      ...original,
      event(
        "amend",
        {
          payload: {
            ...(required(original[5]).payload as object),
            extras: { noBall: true, noBallRuns: 2, byes: 3 },
          },
        },
        11,
        "event-6",
      ),
    ]);
    const rows = finalizedBallFacts(fixture, state, "confirmed");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      seq: 6,
      extras: 2,
      extraKind: "no_ball",
      trustLevel: "confirmed",
    });
    expect(
      rows.reduce(
        (sum, row) =>
          sum + row.runsBat + (["wide", "no_ball"].includes(row.extraKind ?? "") ? row.extras : 0),
        0,
      ),
    ).toBe(required(required(state.innings[0]).bowlers.a1).runs);
    expect(required(original[5]).payload).toMatchObject({ extras: { noBall: true, byes: 2 } });
  });
});

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Required test fixture value is missing");
  return value;
}
