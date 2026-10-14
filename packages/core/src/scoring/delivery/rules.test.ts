import { playerLines } from "./lines";
import { commentaryLine } from "./commentary";
import { overlayProjection } from "../overlay";
import type { BallSummary } from "./state";
import { nextActions } from "./next-actions";
import { deriveResult } from "./result";
import { publicLiveState } from "./public-state";
import { publicScorecard } from "./public-scorecard";
import { publicCharts } from "./public-charts";
import { scoreForResult } from "./nrr";
import { NEW_SEASON_SCORING_RULES } from "../season-rules";
import type { NameBook } from "../types";
import { describe, expect, it } from "vitest";
import { FORMAT_PRESETS } from "../formats";
import type { FormatSpec } from "../formats";
import { BATTING_HANDS } from "../types";
import { CRICKET_BOWLING_STYLE_KEYS } from "../../sports/cricket";
import type { BallPayload, EventType, MatchEvent, PayloadOf, WicketKind } from "../types";
import { applyEvent } from "./apply";
import { resultOf } from "./outcomes";
import { replayMatch, ReplayError } from "./replay";
import { currentInnings, initialState } from "./state";
import type { InningsState, MatchState } from "./state";
import {
  validateBall,
  validateInningsStarted,
  validateLineupConfirmed,
  validateMatchStarted,
} from "./validate";

function event<T extends EventType>(
  type: T,
  payload: PayloadOf<T>,
  seq: number,
  attempt = 1,
): MatchEvent<T> {
  return {
    type,
    payload,
    seq,
    attempt,
    eventId: `event-${String(attempt)}-${String(seq)}`,
    v: 1,
    targetEventId: null,
    actorPersonId: "scorer",
    clientSeq: seq,
    clientRecordedAt: `2026-10-08T12:00:${String(seq).padStart(2, "0")}Z`,
  };
}
function startEvents(): MatchEvent[] {
  return [
    event(
      "match_started",
      {
        format: FORMAT_PRESETS.t20,
        conditions: { timeOfDay: "day" },
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
        substitutes: ["hs"],
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
  ];
}
function innings(state: MatchState): InningsState {
  const value = currentInnings(state);
  if (!value) throw new Error("Test requires an innings");
  return value;
}
function payload(
  state: MatchState,
  runsBat = 0,
  extras: BallPayload["extras"] = {},
  boundary?: 4 | 6,
): BallPayload {
  const current = innings(state);
  return {
    bowlerId: current.bowlerId ?? "a1",
    strikerId: current.strikerId ?? "h1",
    nonStrikerId: current.nonStrikerId,
    runsBat,
    extras,
    ...(boundary ? { boundary } : {}),
  };
}
function apply(state: MatchState, ball: BallPayload): MatchState {
  const result = applyEvent(state, event("ball", ball, state.lastSeq + 1));
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
function fresh(): MatchState {
  return replayMatch(startEvents());
}

function transition<T extends EventType>(
  state: MatchState,
  type: T,
  payload: PayloadOf<T>,
): MatchState {
  const result = applyEvent(state, event(type, payload, state.lastSeq + 1));
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
function deepFreeze(value: unknown): void {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
}

const ONE_OVER: FormatSpec = {
  ...FORMAT_PRESETS.t20,
  oversPerInnings: 1,
  powerplayOvers: 1,
  deathFromOver: 1,
};
function fullMatch(
  format = ONE_OVER,
  superOverTie: "another" | "boundary_count" = "another",
): MatchState {
  const events = startEvents();
  events[0] = event(
    "match_started",
    { format, conditions: {}, homeTeamId: "home", awayTeamId: "away", superOverTie },
    1,
  );
  for (const [index, teamId, prefix] of [
    [1, "home", "h"],
    [2, "away", "a"],
  ] as const) {
    events[index] = event(
      "lineup_confirmed",
      {
        teamId,
        battingOrder: Array.from(
          { length: format.playersPerSide },
          (_, n) => `${prefix}${String(n + 1)}`,
        ),
        captainId: `${prefix}1`,
        keeperId: `${prefix}2`,
        substitutes: [],
      },
      index + 1,
    );
  }
  return replayMatch(events);
}
function startNext(state: MatchState, superOver = false): MatchState {
  const battingTeamId = state.pendingSuperOver[0]?.battingTeamId ?? "away";
  const prefix = battingTeamId === "home" ? "h" : "a";
  return transition(state, "innings_started", {
    inningsNo: state.innings.length + 1,
    battingTeamId,
    strikerId: `${prefix}1`,
    nonStrikerId: `${prefix}2`,
    bowlerId: prefix === "h" ? "a1" : "h1",
    superOver,
  });
}
function dotsToEnd(state: MatchState): MatchState {
  let next = state;
  for (let n = 0; n < 6 && !innings(next).closed; n++) next = apply(next, payload(next));
  return next;
}
function tiedMatch(superOverTie: "another" | "boundary_count" = "another"): MatchState {
  return dotsToEnd(startNext(dotsToEnd(fullMatch(ONE_OVER, superOverTie))));
}

describe("delivery balls and extras", () => {
  it.each([0, 1, 3, 4, 6, 7])("R-01 legal delivery for %i runs", (runs) => {
    const state = fresh();
    const next = innings(apply(state, payload(state, runs)));
    expect(next.runs).toBe(runs);
    expect(next.legalBalls).toBe(1);
    expect(next.batters.h1).toMatchObject({ runs, balls: 1 });
    expect(next.bowlers.a1).toMatchObject({ runs, legalBalls: 1 });
  });

  it("R-01 rebowl flags make wides and no-balls legal only when disabled", () => {
    const state = fresh();
    if (!state.format) throw new Error("Missing format");
    state.format = { ...state.format, wideReBowl: false, noBallReBowl: false };
    const wide = apply(state, payload(state, 0, { wides: 1 }));
    const noBall = innings(apply(wide, payload(wide, 0, { noBall: true })));
    expect(noBall.legalBalls).toBe(2);
    expect(noBall.batters.h1?.balls).toBe(1);
  });

  it.each([1, 5])("R-02 wide of %i counts no ball faced or legal ball", (wides) => {
    const state = fresh();
    const next = innings(apply(state, payload(state, 0, { wides })));
    expect(next).toMatchObject({ runs: wides, legalBalls: 0, extras: { wides }, strikerId: "h1" });
    expect(next.batters.h1).toMatchObject({ runs: 0, balls: 0 });
    expect(next.bowlers.a1).toMatchObject({ runs: wides, wides, legalBalls: 0 });
  });

  it("R-03 no-ball plus four credits bat and bowler but is not legal", () => {
    const state = fresh();
    const next = innings(apply(state, payload(state, 4, { noBall: true }, 4)));
    expect(next).toMatchObject({ runs: 5, legalBalls: 0, strikerId: "h1", extras: { noBalls: 1 } });
    expect(next.batters.h1).toMatchObject({ runs: 4, balls: 1, fours: 1 });
    expect(next.bowlers.a1).toMatchObject({ runs: 5, legalBalls: 0, noBalls: 1 });
  });

  it("R-03 no-ball plus two byes charges only the no-ball to the bowler", () => {
    const state = fresh();
    const next = innings(apply(state, payload(state, 0, { noBall: true, byes: 2 })));
    expect(next).toMatchObject({ runs: 3, legalBalls: 0, extras: { byes: 2, noBalls: 1 } });
    expect(next.batters.h1).toMatchObject({ runs: 0, balls: 1 });
    expect(next.bowlers.a1?.runs).toBe(1);
  });

  it.each(["byes", "legByes"] as const)(
    "R-04 %s are team extras and a ball faced without bowler runs",
    (kind) => {
      const state = fresh();
      const next = innings(apply(state, payload(state, 0, { [kind]: 2 })));
      expect(next).toMatchObject({ runs: 2, legalBalls: 1, extras: { [kind]: 2 } });
      expect(next.batters.h1).toMatchObject({ runs: 0, balls: 1 });
      expect(next.bowlers.a1?.runs).toBe(0);
    },
  );

  it("R-05 balls preserve reserved penalty totals without charging a player", () => {
    const state = fresh();
    const current = innings(state);
    current.runs = 5;
    current.extras.penalty = 5;
    state.penaltyRuns = [{ teamId: "home", runs: 5, inningsNo: 1 }];
    const result = apply(state, payload(state));
    const next = innings(result);
    expect(next).toMatchObject({ runs: 5, extras: { penalty: 5 } });
    expect(next.batters.h1?.runs).toBe(0);
    expect(next.bowlers.a1?.runs).toBe(0);
    expect(result.penaltyRuns).toEqual(state.penaltyRuns);
  });

  it.each([1, 3, 7])("R-06 %i physically run swaps strike", (runs) => {
    const state = fresh();
    expect(innings(apply(state, payload(state, runs))).strikerId).toBe("h2");
  });
  it.each([0, 2, 4, 6])("R-06 %i even runs keeps strike", (runs) => {
    const state = fresh();
    expect(innings(apply(state, payload(state, runs))).strikerId).toBe("h1");
  });
  it("R-06 a wide's penalty is not physically run", () => {
    const state = fresh();
    expect(innings(apply(state, payload(state, 0, { wides: 2 }))).strikerId).toBe("h2");
  });
  it("R-06 odd byes and no-ball batting runs swap strike", () => {
    const state = fresh();
    expect(innings(apply(state, payload(state, 0, { byes: 1 }))).strikerId).toBe("h2");
    expect(innings(apply(state, payload(state, 1, { noBall: true }))).strikerId).toBe("h2");
  });
  it.each([4, 6] as const)(
    "R-06 boundary %i counts a boundary without physical running",
    (boundary) => {
      const state = fresh();
      const next = innings(apply(state, payload(state, boundary, {}, boundary)));
      expect(next.strikerId).toBe("h1");
      expect(next.batters.h1?.[boundary === 4 ? "fours" : "sixes"]).toBe(1);
    },
  );

  it("R-07 six legal balls complete the over, swap ends and require a new bowler", () => {
    let state = fresh();
    for (let i = 0; i < 5; i++) state = apply(state, payload(state));
    state = apply(state, payload(state, 0, { wides: 1 }));
    expect(innings(state).bowlerId).toBe("a1");
    expect(innings(state).legalBalls).toBe(5);
    state = apply(state, payload(state));
    expect(innings(state)).toMatchObject({
      legalBalls: 6,
      strikerId: "h2",
      nonStrikerId: "h1",
      bowlerId: null,
      lastBowlerOfPreviousOver: "a1",
    });
    expect(innings(state).overs[0]?.balls).toHaveLength(7);
    expect(applyEvent(state, event("ball", payload(state), state.lastSeq + 1))).toEqual({
      ok: false,
      reason: "bad_payload",
    });
  });
  it("R-07 an odd run on the sixth ball swaps twice", () => {
    let state = fresh();
    for (let i = 0; i < 5; i++) state = apply(state, payload(state));
    expect(innings(apply(state, payload(state, 1))).strikerId).toBe("h1");
  });
});

describe("innings closures, targets and super overs", () => {
  it("R-15 all out at ten closes without another new-batter action", () => {
    let state = fullMatch(FORMAT_PRESETS.t20);
    for (let n = 0; n < 10; n++) {
      const current = innings(state);
      const id = current.strikerId;
      if (!id) throw new Error("Missing striker");
      state = transition(state, "retire", { registrationId: id, kind: "out" });
      if (n < 9)
        state = transition(state, "new_batter", {
          registrationId: `h${String(n + 3)}`,
          end: "striker",
        });
    }
    expect(innings(state)).toMatchObject({ wickets: 10, closed: "all_out" });
    expect(state.phase).toBe("innings_break");
  });
  it("R-15 quota completion closes the innings and blocks further balls", () => {
    const state = dotsToEnd(fullMatch());
    expect(innings(state)).toMatchObject({ legalBalls: 6, closed: "overs" });
    expect(applyEvent(state, event("ball", payload(state), state.lastSeq + 1))).toMatchObject({
      ok: false,
    });
  });
  it("R-15 a chase closes immediately mid-over when its target is reached", () => {
    const state = startNext(dotsToEnd(fullMatch()));
    const after = apply(state, payload(state, 1));
    expect(innings(after)).toMatchObject({ runs: 1, target: 1, legalBalls: 1, closed: "target" });
    expect(after.phase).toBe("result_reached");
    expect(resultOf(after)).toMatchObject({ winnerTeamId: "away", marginText: "by 10 wickets" });
  });
  it("R-15 no available batter closes a short XI without pretending it is ten out", () => {
    let state = fresh();
    state = transition(state, "retire", { registrationId: "h1", kind: "out" });
    state = transition(state, "new_batter", { registrationId: "h3", end: "striker" });
    state = transition(state, "retire", { registrationId: "h3", kind: "out" });
    expect(innings(state)).toMatchObject({ wickets: 2, closed: "no_more_batters" });
  });
  it("R-16 the chase target includes penalty runs", () => {
    const state = dotsToEnd(
      transition(fullMatch(), "penalty_runs", { teamId: "home", runs: 5, reason: "helmet" }),
    );
    expect(innings(startNext(state)).target).toBe(6);
  });
  it("R-16 penalty runs to the side that batted first raise the chase target mid-chase", () => {
    let state = fullMatch();
    state = apply(state, payload(state, 6, {}, 6));
    state = startNext(dotsToEnd(state));
    expect(innings(state).target).toBe(7);
    state = transition(state, "penalty_runs", { teamId: "home", runs: 5, reason: "fielding" });
    expect(innings(state)).toMatchObject({ target: 12, closed: null });
    state = apply(state, payload(state, 6, {}, 6));
    state = apply(state, payload(state, 1));
    expect(innings(state)).toMatchObject({ runs: 7, closed: null });
    state = dotsToEnd(state);
    expect(resultOf(state)).toMatchObject({ winnerTeamId: "home", marginText: "by 4 runs" });
  });
  it("R-16 a revised target is not moved by later penalty runs", () => {
    let state = fullMatch();
    state = apply(state, payload(state, 6, {}, 6));
    state = startNext(dotsToEnd(state));
    state = transition(state, "revise", {
      inningsNo: 2,
      maxBalls: 6,
      targetRuns: 9,
      method: "dls",
    });
    state = transition(state, "penalty_runs", { teamId: "home", runs: 5, reason: "fielding" });
    expect(innings(state).target).toBe(9);
  });
  it("R-17 a revision sets the quota and manual or DLS target", () => {
    const state = startNext(dotsToEnd(fullMatch()));
    const revised = transition(state, "revise", {
      inningsNo: 2,
      maxBalls: 90,
      targetRuns: 120,
      method: "dls",
    });
    expect(innings(revised)).toMatchObject({ maxBalls: 90, target: 120, targetMethod: "dls" });
    expect(
      innings(
        transition(revised, "revise", {
          inningsNo: 2,
          maxBalls: 60,
          targetRuns: 100,
          method: "manual",
        }),
      ),
    ).toMatchObject({ maxBalls: 60, target: 100, targetMethod: "manual" });
  });
  it("R-17 shortening below balls already faced closes immediately", () => {
    let state = fullMatch();
    for (let n = 0; n < 3; n++) state = apply(state, payload(state));
    expect(
      innings(transition(state, "revise", { inningsNo: 1, maxBalls: 2, method: "manual" })).closed,
    ).toBe("overs");
  });
  it("R-18 a normal tie reaches the result with a super over available", () => {
    const state = tiedMatch();
    expect(state.phase).toBe("result_reached");
    expect(resultOf(state)?.outcome).toBe("tie");
    expect(transition(state, "super_over_started", {}).pendingSuperOver).toEqual([
      { inningsNo: 3, battingTeamId: "away" },
      { inningsNo: 4, battingTeamId: "home" },
    ]);
  });
  it("R-19 a scheduled super over selects openers, reverses sides and derives its winner", () => {
    let state = transition(tiedMatch(), "super_over_started", {});
    expect(resultOf(state)).toBeNull();
    expect(state.innings).toHaveLength(2);
    state = startNext(state, true);
    expect(innings(state)).toMatchObject({
      no: 3,
      battingTeamId: "away",
      maxBalls: 6,
      superOver: true,
    });
    state = dotsToEnd(state);
    state = startNext(state, true);
    expect(innings(state)).toMatchObject({ no: 4, battingTeamId: "home", target: 1 });
    state = apply(state, payload(state, 1));
    expect(resultOf(state)).toMatchObject({
      winnerTeamId: "home",
      method: "super_over",
      marginText: "on super over",
    });
  });
  it("R-19 a super over closes at two wickets", () => {
    let state = startNext(transition(tiedMatch(), "super_over_started", {}), true);
    state = transition(state, "retire", { registrationId: "a1", kind: "out" });
    state = transition(state, "new_batter", { registrationId: "a3", end: "striker" });
    state = transition(state, "retire", { registrationId: "a3", kind: "out" });
    expect(innings(state)).toMatchObject({ wickets: 2, closed: "all_out" });
  });
  it("R-20 a tied super over schedules innings five and six in reversed order", () => {
    let state = transition(tiedMatch(), "super_over_started", {});
    state = dotsToEnd(startNext(state, true));
    state = dotsToEnd(startNext(state, true));
    state = transition(state, "super_over_started", {});
    expect(state.pendingSuperOver).toEqual([
      { inningsNo: 5, battingTeamId: "home" },
      { inningsNo: 6, battingTeamId: "away" },
    ]);
    state = dotsToEnd(startNext(state, true));
    state = apply(startNext(state, true), payload(startNext(state, true), 1));
    expect(innings(state).no).toBe(6);
    expect(resultOf(state)).toMatchObject({ winnerTeamId: "away", method: "super_over" });
  });
  it("R-20 boundary count is applied only after a tied super over", () => {
    let state = fullMatch(ONE_OVER, "boundary_count");
    state = apply(state, payload(state, 4, {}, 4));
    state = dotsToEnd(state);
    state = startNext(state);
    state = apply(state, payload(state, 4));
    state = dotsToEnd(state);
    expect(resultOf(state)?.outcome).toBe("tie");
    state = transition(state, "super_over_started", {});
    state = dotsToEnd(startNext(state, true));
    state = dotsToEnd(startNext(state, true));
    expect(resultOf(state)).toMatchObject({ winnerTeamId: "home", method: "super_over" });
  });
  it("rejects unscheduled, skipped and repeated pending super-over starts", () => {
    const tie = tiedMatch();
    expect(
      applyEvent(
        tie,
        event(
          "innings_started",
          {
            inningsNo: 3,
            battingTeamId: "away",
            strikerId: "a1",
            nonStrikerId: "a2",
            bowlerId: "h1",
            superOver: true,
          },
          tie.lastSeq + 1,
        ),
      ),
    ).toMatchObject({ ok: false });
    const pending = transition(tie, "super_over_started", {});
    expect(applyEvent(pending, event("super_over_started", {}, pending.lastSeq + 1))).toMatchObject(
      { ok: false },
    );
    expect(
      applyEvent(
        pending,
        event(
          "innings_started",
          {
            inningsNo: 4,
            battingTeamId: "home",
            strikerId: "h1",
            nonStrikerId: "h2",
            bowlerId: "a1",
            superOver: true,
          },
          pending.lastSeq + 1,
        ),
      ),
    ).toMatchObject({ ok: false });
    const noSuper = tiedMatch();
    if (!noSuper.format) throw new Error("Missing format");
    noSuper.format = { ...noSuper.format, superOver: false };
    expect(applyEvent(noSuper, event("super_over_started", {}, noSuper.lastSeq + 1))).toMatchObject(
      { ok: false },
    );
  });
  it("last man stands permits the lone batter without end swaps until the sixth wicket", () => {
    let state = fullMatch(FORMAT_PRESETS.box_6);
    for (let n = 0; n < 5; n++) {
      const id = innings(state).strikerId;
      if (!id) throw new Error("Missing striker");
      state = transition(state, "retire", { registrationId: id, kind: "out" });
      if (n < 4)
        state = transition(state, "new_batter", {
          registrationId: `h${String(n + 3)}`,
          end: "striker",
        });
    }
    expect(innings(state)).toMatchObject({
      strikerId: "h2",
      nonStrikerId: null,
      wickets: 5,
      closed: null,
    });
    state = apply(state, payload(state, 1));
    expect(innings(state)).toMatchObject({ strikerId: "h2", nonStrikerId: null, runs: 1 });
    state = transition(state, "retire", { registrationId: "h2", kind: "out" });
    expect(innings(state)).toMatchObject({ wickets: 6, closed: "all_out" });
  });
  it("rejects a null non-striker in ordinary play or while a replacement remains", () => {
    const state = fullMatch();
    expect(
      applyEvent(
        state,
        event("ball", { ...payload(state), nonStrikerId: null }, state.lastSeq + 1),
      ),
    ).toMatchObject({ ok: false });
    const box = transition(fullMatch(FORMAT_PRESETS.box_6), "retire", {
      registrationId: "h2",
      kind: "out",
    });
    expect(
      applyEvent(box, event("ball", { ...payload(box), nonStrikerId: null }, box.lastSeq + 1)),
    ).toMatchObject({ ok: false, reason: "not_batting" });
  });
  it("retire prompt follows a batter reaching twenty-five even after an odd run", () => {
    let state = fullMatch(FORMAT_PRESETS.tennis_gully);
    for (let n = 0; n < 4; n++) state = apply(state, payload(state, 6, {}, 6));
    state = apply(state, payload(state, 1));
    expect(innings(state).retirePromptDue).toBe("h1");
  });
  it("the tie setting defaults and replays from the immutable match event", () => {
    expect(fresh().superOverTie).toBe("another");
    expect(fullMatch(ONE_OVER, "boundary_count").superOverTie).toBe("boundary_count");
    expect(
      validateMatchStarted({
        format: ONE_OVER,
        conditions: {},
        homeTeamId: "home",
        awayTeamId: "away",
        superOverTie: "invalid",
      }).ok,
    ).toBe(false);
  });
});

describe("bowler controls, penalties and styles", () => {
  it("R-08 permits the first bowler, but refuses consecutive overs after six balls", () => {
    let state = transition(fresh(), "bowler_set", { bowlerId: "a1", midOver: false });
    for (let i = 0; i < 6; i++) state = apply(state, payload(state));
    expect(
      applyEvent(state, event("bowler_set", { bowlerId: "a1", midOver: false }, state.lastSeq + 1)),
    ).toEqual({ ok: false, reason: "bowler_consecutive" });
    expect(
      innings(transition(state, "bowler_set", { bowlerId: "a2", midOver: false })).bowlerId,
    ).toBe("a2");
  });
  it("R-08 consecutive overs are allowed only when the format permits them", () => {
    let state = fresh();
    if (!state.format) throw new Error("Missing format");
    state.format = { ...state.format, noConsecutiveOvers: false };
    for (let i = 0; i < 6; i++) state = apply(state, payload(state));
    expect(
      innings(transition(state, "bowler_set", { bowlerId: "a1", midOver: false })).bowlerId,
    ).toBe("a1");
  });
  it("R-09 refuses participation in another official over at quota", () => {
    let state = fresh();
    for (let over = 0; over < 8; over++) {
      if (over > 0)
        state = transition(state, "bowler_set", {
          bowlerId: over % 2 === 0 ? "a1" : "a2",
          midOver: false,
        });
      for (let ball = 0; ball < 6; ball++) state = apply(state, payload(state));
    }
    expect(
      applyEvent(state, event("bowler_set", { bowlerId: "a1", midOver: false }, state.lastSeq + 1)),
    ).toEqual({ ok: false, reason: "bowler_quota" });
    innings(state).bowlerId = "a1";
    expect(applyEvent(state, event("ball", payload(state), state.lastSeq + 1))).toEqual({
      ok: false,
      reason: "bowler_quota",
    });
  });
  it("R-09 a mid-over bowler change keeps each bowler's figures and the over history", () => {
    let state = fresh();
    for (let i = 0; i < 3; i++) state = apply(state, payload(state, 2));
    state = transition(state, "bowler_set", { bowlerId: "a2", midOver: true, reason: "injury" });
    for (let i = 0; i < 3; i++) state = apply(state, payload(state, 4, {}, 4));
    const current = innings(state);
    expect(current.bowlers.a1).toMatchObject({ legalBalls: 3, runs: 6 });
    expect(current.bowlers.a2).toMatchObject({ legalBalls: 3, runs: 12 });
    expect(current.overs[0]?.balls.map((ball) => ball.bowlerId)).toEqual([
      "a1",
      "a1",
      "a1",
      "a2",
      "a2",
      "a2",
    ]);
    expect(current).toMatchObject({
      legalBalls: 6,
      lastBowlerOfPreviousOver: "a2",
      bowlerId: null,
    });
  });
  it("requires a mid-over reason and rejects a player from the batting team", () => {
    const state = fresh();
    const after = apply(state, payload(state));
    expect(
      applyEvent(after, event("bowler_set", { bowlerId: "a2", midOver: true }, 7)),
    ).toMatchObject({ ok: false, reason: "bad_payload" });
    expect(
      applyEvent(after, event("bowler_set", { bowlerId: "a2", midOver: false }, 7)),
    ).toMatchObject({ ok: false, reason: "bad_payload" });
    expect(
      applyEvent(state, event("bowler_set", { bowlerId: "h1", midOver: false }, 6)),
    ).toMatchObject({ ok: false, reason: "bowler_not_fielding" });
  });
  it("R-11 a free hit persists through a wide and clears on the next legal ball", () => {
    let state = fresh();
    state = apply(state, payload(state, 0, { noBall: true }));
    expect(innings(state).freeHitNext).toBe(true);
    state = apply(state, payload(state, 0, { wides: 1 }));
    expect(innings(state).freeHitNext).toBe(true);
    state = apply(state, payload(state, 0, { noBall: true }));
    expect(innings(state).freeHitNext).toBe(true);
    state = apply(state, payload(state));
    expect(innings(state).freeHitNext).toBe(false);
  });
  it("R-11 a format without free hits does not set the flag", () => {
    const state = fresh();
    state.format = { ...FORMAT_PRESETS.tennis_gully };
    expect(innings(apply(state, payload(state, 0, { noBall: true }))).freeHitNext).toBe(false);
  });
  it("R-05 five penalty runs affect team extras but neither player", () => {
    const state = transition(fresh(), "penalty_runs", {
      teamId: "home",
      runs: 5,
      reason: "helmet",
    });
    const current = innings(state);
    expect(current).toMatchObject({ runs: 5, extras: { penalty: 5 }, legalBalls: 0 });
    expect(current.batters.h1?.runs).toBe(0);
    expect(current.bowlers.a1?.runs).toBe(0);
    expect(state.penaltyRuns).toEqual([{ teamId: "home", runs: 5, inningsNo: 1 }]);
  });
  it("R-05 a pre-innings penalty is applied once when that team's innings starts", () => {
    const events = startEvents();
    let state = replayMatch(events.slice(0, 4));
    state = transition(state, "penalty_runs", { teamId: "home", runs: 5, reason: "fielding" });
    state = transition(state, "innings_started", {
      inningsNo: 1,
      battingTeamId: "home",
      strikerId: "h1",
      nonStrikerId: "h2",
      bowlerId: "a1",
    });
    expect(innings(state)).toMatchObject({ runs: 5, extras: { penalty: 5 } });
    expect(state.penaltyRuns).toEqual([{ teamId: "home", runs: 5, inningsNo: 1 }]);
    expect(innings(apply(state, payload(state))).runs).toBe(5);
  });
  it("R-05 penalties for a team that has not batted remain pending", () => {
    const state = transition(fresh(), "penalty_runs", { teamId: "away", runs: 5, reason: "other" });
    expect(innings(state).runs).toBe(0);
    expect(state.penaltyRuns).toEqual([{ teamId: "away", runs: 5, inningsNo: null }]);
    expect(
      applyEvent(state, event("penalty_runs", { teamId: "unknown", runs: 5, reason: "other" }, 7)),
    ).toMatchObject({ ok: false });
  });
  it("R-30 styles merge for known players using canonical pack vocabulary", () => {
    let state = fresh();
    const battingHand = BATTING_HANDS[0];
    const bowlingStyle = CRICKET_BOWLING_STYLE_KEYS[0];
    state = transition(state, "style_set", { registrationId: "h1", battingHand });
    state = transition(state, "style_set", { registrationId: "h1", bowlingStyle });
    expect(state.styles.h1).toEqual({ battingHand, bowlingStyle });
    expect(
      applyEvent(state, event("style_set", { registrationId: "missing", battingHand }, 8)),
    ).toMatchObject({ ok: false, reason: "unknown_player" });
  });
  it("delivery styles retain their snapshot when later styles change", () => {
    let state = fresh();
    state = apply(state, payload(state));
    state = transition(state, "style_set", { registrationId: "h1", battingHand: "left" });
    state = transition(state, "style_set", {
      registrationId: "a1",
      bowlingStyle: CRICKET_BOWLING_STYLE_KEYS[0],
    });
    state = apply(state, payload(state));
    state = transition(state, "style_set", { registrationId: "h1", battingHand: "right" });
    const over = innings(state).overs[0];
    if (!over) throw new Error("Missing delivery snapshot over");
    const balls = over.balls;
    expect(balls[0]).not.toHaveProperty("batterHand");
    expect(balls[0]).not.toHaveProperty("bowlerStyle");
    expect(balls[1]).toMatchObject({
      batterHand: "left",
      bowlerStyle: CRICKET_BOWLING_STYLE_KEYS[0],
    });
    expect(state.styles.h1?.battingHand).toBe("right");
  });
});

describe("wickets, new batters and retirements", () => {
  it("regenerates a non-striker zero-ball dismissal after an effective correction", () => {
    const state = transition(fresh(), "conditions_changed", { conditions: { timeOfDay: "night" } });
    const ball = {
      ...payload(state),
      wicket: {
        kind: "run_out" as const,
        playerOutId: "h2",
        fielderIds: ["a2"],
      },
    };
    const dismissed = apply(state, ball);
    const target = required(dismissed.eventHistory.find((item) => item.type === "ball"));
    expect(playerLines(dismissed).get("h2")?.batting).toMatchObject({
      balls: 0,
      out: true,
      dismissals: [{ inningsNo: 1, seq: target.seq, conditions: { timeOfDay: "night" } }],
    });
    const later = transition(dismissed, "conditions_changed", { conditions: { timeOfDay: "day" } });
    const corrected = correction(later, target, payload(state));
    if (!corrected.ok) throw new Error(corrected.reason);
    expect(playerLines(corrected.state).get("h2")?.batting?.dismissals).toEqual([]);
    expect(innings(corrected.state).batters.h2).toMatchObject({ balls: 0, out: false });
    expect(corrected.state.conditions.timeOfDay).toBe("day");
    expect(playerLines(later).get("h2")?.batting?.dismissals).toEqual([
      { inningsNo: 1, seq: target.seq, conditions: { timeOfDay: "night" } },
    ]);
  });
  it("projects zero-ball retirement at dismissal-time conditions without borrowing later conditions", () => {
    const changed = transition(fresh(), "conditions_changed", {
      conditions: { timeOfDay: "night" },
    });
    const retired = transition(changed, "retire", { registrationId: "h2", kind: "out" });
    const later = transition(retired, "conditions_changed", { conditions: { timeOfDay: "day" } });
    expect(innings(later).batters.h2).toMatchObject({
      balls: 0,
      out: true,
      howOut: "retired_out",
      dismissal: { seq: retired.lastSeq, conditions: { timeOfDay: "night" } },
    });
    expect(playerLines(later).get("h2")?.batting?.dismissals).toEqual([
      { inningsNo: 1, seq: retired.lastSeq, conditions: { timeOfDay: "night" } },
    ]);
    expect(innings(changed).batters.h2?.dismissal).toBeUndefined();
    const hurt = transition(fresh(), "retire", { registrationId: "h2", kind: "hurt" });
    expect(playerLines(hurt).get("h2")?.batting?.dismissals).toEqual([]);
  });
  const kinds: WicketKind[] = [
    "bowled",
    "caught",
    "lbw",
    "stumped",
    "run_out",
    "hit_wicket",
    "obstructing",
    "hit_twice",
    "timed_out",
    "caught_and_bowled",
  ];
  it.each(kinds)("R-10 %s dismissal records the wicket and correct bowler credit", (kind) => {
    const state = fresh();
    const fielderIds = kind === "caught_and_bowled" ? ["a1"] : ["a2"];
    const next = innings(
      apply(state, { ...payload(state), wicket: { kind, playerOutId: "h1", fielderIds } }),
    );
    expect(next).toMatchObject({ wickets: 1, strikerId: null, outIds: ["h1"] });
    expect(next.batters.h1).toMatchObject({ out: true, notOut: false, howOut: kind });
    expect(next.batters.h1?.dismissal).toEqual({
      seq: state.lastSeq + 1,
      conditions: state.conditions,
    });
    const credited = [
      "bowled",
      "caught",
      "caught_and_bowled",
      "lbw",
      "stumped",
      "hit_wicket",
    ].includes(kind);
    expect(next.bowlers.a1?.wickets).toBe(credited ? 1 : 0);
    expect(next.fallOfWickets).toEqual([{ runs: 0, wickets: 1, legalBalls: 1, playerOutId: "h1" }]);
  });

  it.each(["stumped", "run_out", "hit_wicket", "obstructing"] as const)(
    "R-11 %s is allowed on a wide",
    (kind) => {
      const state = fresh();
      const next = innings(
        apply(state, {
          ...payload(state, 0, { wides: 1 }),
          wicket: { kind, playerOutId: "h1", fielderIds: ["a2"] },
        }),
      );
      expect(next).toMatchObject({ runs: 1, wickets: 1, legalBalls: 0 });
    },
  );
  it.each(["run_out", "obstructing", "hit_twice"] as const)(
    "R-11 %s is allowed on a no-ball",
    (kind) => {
      const state = fresh();
      const next = innings(
        apply(state, {
          ...payload(state, 0, { noBall: true }),
          wicket: { kind, playerOutId: "h1", fielderIds: ["a2"] },
        }),
      );
      expect(next).toMatchObject({ runs: 1, wickets: 1, legalBalls: 0 });
      expect(next.bowlers.a1?.wickets).toBe(0);
    },
  );
  it.each([{ wides: 1 }, { noBall: true }] as const)("R-11 caught is refused on %j", (extras) => {
    const state = fresh();
    const ball = {
      ...payload(state, 0, extras),
      wicket: { kind: "caught", playerOutId: "h1", fielderIds: ["a2"] },
    } as const;
    expect(
      applyEvent(
        state,
        event(
          "ball",
          { ...ball, wicket: { ...ball.wicket, fielderIds: [...ball.wicket.fielderIds] } },
          6,
        ),
      ),
    ).toMatchObject({ ok: false, reason: "illegal_wicket_on_extra" });
  });
  it("R-11 free-hit dismissals allow run out and obstructing, refusing bowled", () => {
    const state = fresh();
    innings(state).freeHitNext = true;
    for (const kind of ["run_out", "obstructing", "bowled"] as const) {
      const result = applyEvent(
        state,
        event(
          "ball",
          { ...payload(state), wicket: { kind, playerOutId: "h1", fielderIds: ["a2"] } },
          6,
        ),
      );
      if (kind === "bowled")
        expect(result).toMatchObject({ ok: false, reason: "free_hit_dismissal" });
      else expect(result.ok).toBe(true);
    }
  });
  it("R-12 lbw is refused when disabled by the format", () => {
    const state = fresh();
    state.format = { ...FORMAT_PRESETS.tennis_gully };
    expect(
      applyEvent(
        state,
        event(
          "ball",
          { ...payload(state), wicket: { kind: "lbw", playerOutId: "h1", fielderIds: [] } },
          6,
        ),
      ),
    ).toEqual({ ok: false, reason: "illegal_wicket_on_extra", detail: "lbw_off" });
  });
  it("R-13 a new batter must fill the dismissed end before the next ball", () => {
    const state = fresh();
    const after = apply(state, {
      ...payload(state),
      wicket: { kind: "caught", playerOutId: "h1", fielderIds: ["a2"] },
    });
    expect(applyEvent(after, event("ball", payload(after), 7))).toEqual({
      ok: false,
      reason: "not_batting",
    });
    expect(
      applyEvent(after, event("new_batter", { registrationId: "h1", end: "striker" }, 7)),
    ).toMatchObject({ ok: false });
    const added = applyEvent(
      after,
      event("new_batter", { registrationId: "h3", end: "striker" }, 7),
    );
    if (!added.ok) throw new Error(added.reason);
    expect(innings(added.state).batters.h3).toMatchObject({ position: 3, balls: 0 });
    expect(innings(apply(added.state, payload(added.state, 1))).runs).toBe(1);
  });
  it("R-13 run out empties the dismissed end after completed runs", () => {
    const state = fresh();
    const next = innings(
      apply(state, {
        ...payload(state, 1),
        wicket: { kind: "run_out", playerOutId: "h2", fielderIds: ["a2", "a3"], runsCompleted: 1 },
      }),
    );
    expect(next).toMatchObject({ runs: 1, wickets: 1, strikerId: null, nonStrikerId: "h1" });
    expect(next.bowlers.a1?.wickets).toBe(0);
  });
  it("R-14 retired hurt can resume without a wicket or lost batting figures", () => {
    let state = fresh();
    state = apply(state, payload(state, 4, {}, 4));
    const retired = applyEvent(state, event("retire", { registrationId: "h1", kind: "hurt" }, 7));
    if (!retired.ok) throw new Error(retired.reason);
    expect(innings(retired.state)).toMatchObject({
      wickets: 0,
      strikerId: null,
      retiredHurt: ["h1"],
    });
    const resumed = applyEvent(retired.state, event("resume_batting", { registrationId: "h1" }, 8));
    if (!resumed.ok) throw new Error(resumed.reason);
    expect(innings(resumed.state)).toMatchObject({ wickets: 0, strikerId: "h1", retiredHurt: [] });
    expect(innings(resumed.state).batters.h1).toMatchObject({
      runs: 4,
      retiredHurt: false,
      notOut: true,
    });
  });
  it("R-14 retired out counts a wicket without bowler credit and cannot resume", () => {
    const state = fresh();
    const retired = applyEvent(state, event("retire", { registrationId: "h1", kind: "out" }, 6));
    if (!retired.ok) throw new Error(retired.reason);
    expect(innings(retired.state)).toMatchObject({ wickets: 1, strikerId: null, outIds: ["h1"] });
    expect(innings(retired.state).bowlers.a1?.wickets).toBe(0);
    expect(
      applyEvent(retired.state, event("resume_batting", { registrationId: "h1" }, 7)),
    ).toMatchObject({ ok: false });
  });
  it("refuses unknown fielders, a second wicket and invalid run-out metadata", () => {
    const state = fresh();
    const ball = payload(state);
    expect(
      applyEvent(
        state,
        event(
          "ball",
          { ...ball, wicket: { kind: "caught", playerOutId: "h1", fielderIds: ["h2"] } },
          6,
        ),
      ),
    ).toMatchObject({ ok: false, reason: "unknown_player" });
    expect(
      validateBall({
        ...ball,
        wicket: {
          kind: "bowled",
          playerOutId: "h1",
          fielderIds: [],
          second: { playerOutId: "h2" },
        },
      }).ok,
    ).toBe(false);
    expect(validateBall({ ...ball, wicket: [{ kind: "bowled" }, { kind: "caught" }] }).ok).toBe(
      false,
    );
    expect(
      validateBall({
        ...ball,
        wicket: { kind: "caught", playerOutId: "h1", fielderIds: [], runsCompleted: 0 },
      }).ok,
    ).toBe(false);
    expect(
      applyEvent(
        state,
        event(
          "ball",
          {
            ...ball,
            wicket: { kind: "run_out", playerOutId: "h1", fielderIds: ["a2"], runsCompleted: 1 },
          },
          6,
        ),
      ),
    ).toMatchObject({ ok: false, reason: "bad_payload" });
    expect(
      validateBall({
        ...ball,
        wicket: { kind: "run_out", playerOutId: "h1", fielderIds: ["a2"], where: { x: 2, y: 0 } },
      }).ok,
    ).toBe(false);
  });
});

describe("validation, phase and replay", () => {
  it("R-28 phases follow setup, toss and the first innings", () => {
    const events = startEvents();
    expect(initialState().phase).toBe("not_started");
    expect(replayMatch(events.slice(0, 3)).phase).toBe("not_started");
    expect(replayMatch(events.slice(0, 4)).phase).toBe("toss");
    expect(replayMatch(events).phase).toBe("live");
  });
  it("R-06 manual strike swap changes ends without a delivery", () => {
    const state = fresh();
    const result = applyEvent(state, event("strike_swapped", {}, 6));
    expect(result.ok && innings(result.state)).toMatchObject({ strikerId: "h2", legalBalls: 0 });
  });
  it("rejects 11 runs and a mismatched boundary", () => {
    const state = fresh();
    expect(validateBall(payload(state, 11))).toEqual({ ok: false, reason: "runs_out_of_range" });
    expect(validateBall(payload(state, 3, {}, 4))).toEqual({
      ok: false,
      reason: "boundary_mismatch",
    });
  });
  it.each([
    { extras: { wides: 1, noBall: true } },
    { extras: { byes: 1, legByes: 1 } },
    { runsBat: 1, extras: { byes: 1 } },
    { extras: { wides: -1 } },
    { extras: { noBall: false } },
    { shot: { zone: "cover", angle: 360 } },
    { wicket: { kind: "caught" } },
  ])("rejects malformed delivery %j", (change) => {
    expect(validateBall({ ...payload(fresh()), ...change }).ok).toBe(false);
  });
  it("rejects malformed setup and duplicate lineup ids", () => {
    expect(validateMatchStarted({}).ok).toBe(false);
    expect(
      validateMatchStarted({
        ...startEvents()[0]?.payload,
        format: { ...FORMAT_PRESETS.t20, ballsPerOver: 0 },
      }).ok,
    ).toBe(false);
    expect(
      validateLineupConfirmed({
        teamId: "home",
        battingOrder: ["h1", "h1"],
        captainId: "h1",
        keeperId: "h1",
        substitutes: [],
      }).ok,
    ).toBe(false);
    expect(
      validateInningsStarted({
        inningsNo: 1,
        battingTeamId: "home",
        strikerId: "h1",
        nonStrikerId: "h1",
        bowlerId: "a1",
      }).ok,
    ).toBe(false);
  });
  it("rejects wrong attempts, a wrong striker and a non-fielding bowler", () => {
    const state = fresh();
    expect(applyEvent(state, event("ball", payload(state), 6, 2))).toEqual({
      ok: false,
      reason: "wrong_attempt",
    });
    expect(applyEvent(state, event("ball", { ...payload(state), strikerId: "h3" }, 6))).toEqual({
      ok: false,
      reason: "not_batting",
    });
    expect(applyEvent(state, event("ball", { ...payload(state), bowlerId: "h3" }, 6))).toEqual({
      ok: false,
      reason: "bowler_not_fielding",
    });
  });
  it("sorts by seq and replays deterministically without mutation", () => {
    const events = startEvents();
    const state = replayMatch(events);
    events.push(event("ball", payload(state, 4, {}, 4), 6));
    const shuffled = [...events].reverse();
    deepFreeze(shuffled);
    expect(replayMatch(shuffled)).toEqual(replayMatch(events));
    expect(replayMatch(shuffled)).toEqual(replayMatch(shuffled));
    deepFreeze(state);
    expect(innings(apply(state, payload(state, 1))).runs).toBe(1);
    expect(innings(state).runs).toBe(0);
  });
  it("reports a refused replay event with its seq and reason", () => {
    const events = startEvents();
    events.push(event("ball", payload(fresh(), 11), 6));
    expect(() => replayMatch(events)).toThrow(ReplayError);
    try {
      replayMatch(events);
    } catch (error) {
      expect(error).toMatchObject({ seq: 6, reason: "runs_out_of_range" });
    }
  });
});

function correction(state: MatchState, target: MatchEvent, replacement?: BallPayload) {
  return applyEvent(state, {
    ...(replacement
      ? event("amend", { payload: replacement }, state.lastSeq + 1, state.attempt)
      : event("void", {}, state.lastSeq + 1, state.attempt)),
    targetEventId: target.eventId,
  });
}

describe("interruptions, corrections and restart", () => {
  it("blocks interrupted play and resumes it", () => {
    const paused = transition(fresh(), "interrupt", { reason: "rain" });
    expect(applyEvent(paused, event("ball", payload(paused), paused.lastSeq + 1))).toMatchObject({
      ok: false,
      reason: "not_live",
    });
    const resumed = transition(paused, "resume", {});
    expect(innings(apply(resumed, payload(resumed))).legalBalls).toBe(1);
  });
  it("re-folds a voided third ball and retains raw correction metadata", () => {
    let state = fresh();
    for (let i = 0; i < 3; i++) state = apply(state, payload(state, 4, {}, 4));
    const target = required(state.eventHistory[7]);
    deepFreeze(state);
    const result = correction(state, target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(innings(result.state)).toMatchObject({ runs: 8, legalBalls: 2 });
    expect(result.state.lastSeq).toBe(9);
    expect(result.state.eventHistory).toHaveLength(9);
    expect(innings(state).runs).toBe(12);
  });
  it("rejects voids that invalidate a later wicket", () => {
    let state = fresh();
    state = apply(state, payload(state, 1));
    const target = required(state.eventHistory[5]);
    state = apply(state, {
      ...payload(state),
      wicket: { kind: "bowled", playerOutId: "h2", fielderIds: [] },
    });
    expect(correction(state, target)).toMatchObject({
      ok: false,
      reason: "amend_breaks_later_events",
    });
  });
  it("amends runs, allows amendment chains, and voids the original chain", () => {
    let state = fresh();
    const originalPayload = payload(state, 1);
    state = apply(state, originalPayload);
    const target = required(state.eventHistory[5]);
    const amended = correction(state, target, { ...originalPayload, runsBat: 4, boundary: 4 });
    if (!amended.ok) throw new Error(amended.reason);
    expect(innings(amended.state).runs).toBe(4);
    const amendEvent = required(amended.state.eventHistory[6]);
    const chained = correction(amended.state, amendEvent, {
      ...originalPayload,
      runsBat: 6,
      boundary: 6,
    });
    if (!chained.ok) throw new Error(chained.reason);
    expect(innings(chained.state).runs).toBe(6);
    expect(correction(chained.state, amendEvent)).toMatchObject({
      ok: false,
      reason: "unknown_target",
    });
    const removed = correction(chained.state, target);
    if (!removed.ok) throw new Error(removed.reason);
    expect(innings(removed.state).runs).toBe(0);
    expect(correction(removed.state, target)).toMatchObject({
      ok: false,
      reason: "unknown_target",
    });
  });
  it("rejects mismatched amendment payloads and missing targets", () => {
    const state = apply(fresh(), payload(fresh()));
    expect(
      applyEvent(state, {
        ...event("amend", { payload: { winnerTeamId: "home", decision: "bat" } }, 7),
        targetEventId: required(state.eventHistory[5]).eventId,
      }),
    ).toMatchObject({ ok: false, reason: "amend_type_mismatch" });
    expect(
      correction(state, { ...required(state.eventHistory[5]), eventId: "missing" }),
    ).toMatchObject({
      ok: false,
      reason: "unknown_target",
    });
  });
  it("restarts through a validated boundary and clears the former score", () => {
    const old = apply(
      fullMatch(ONE_OVER, "boundary_count"),
      payload(fullMatch(ONE_OVER, "boundary_count"), 4, {}, 4),
    );
    const result = applyEvent(old, event("restart", { reason: "replay" }, old.lastSeq + 1));
    if (!result.ok) throw new Error(result.reason);
    expect(result.state).toMatchObject({
      attempt: 2,
      innings: [],
      format: null,
      originalTieSetting: "boundary_count",
    });
    expect(replayMatch(result.state.eventHistory)).toEqual(result.state);
    const newEvents = startEvents().map((e, i) => ({
      ...e,
      attempt: 2,
      seq: result.state.lastSeq + i + 1,
      eventId: `new-${String(i)}`,
    }));
    const next = replayMatch([...result.state.eventHistory, ...newEvents]);
    expect(innings(next).runs).toBe(0);
    expect(next.superOverTie).toBe("boundary_count");
    expect(
      applyEvent(next, {
        ...event("void", {}, next.lastSeq + 1, 2),
        targetEventId: required(old.eventHistory[5]).eventId,
      }),
    ).toMatchObject({ ok: false, reason: "unknown_target" });
    expect(() => replayMatch(startEvents().map((e) => ({ ...e, attempt: 2 })))).toThrow(
      ReplayError,
    );
    expect(
      applyEvent(
        result.state,
        event(
          "match_started",
          {
            format: ONE_OVER,
            conditions: {},
            homeTeamId: "home",
            awayTeamId: "away",
            superOverTie: "another",
          },
          result.state.lastSeq + 1,
          2,
        ),
      ),
    ).toMatchObject({ ok: false });
  });
  it("records changed conditions only on subsequent balls", () => {
    let state = apply(fresh(), payload(fresh()));
    state = transition(state, "conditions_changed", { conditions: { timeOfDay: "night" } });
    state = apply(state, payload(state));
    expect(required(innings(state).overs[0]).balls.map((b) => b.conditions.timeOfDay)).toEqual([
      "day",
      "night",
    ]);
  });
  it("adds a player to an existing team and replaces a fielding substitute", () => {
    const events = startEvents();
    events[2] = event(
      "lineup_confirmed",
      {
        teamId: "away",
        battingOrder: ["a1", "a2", "a3"],
        captainId: "a1",
        keeperId: "a2",
        substitutes: ["as"],
      },
      3,
    );
    let state = transition(replayMatch(events), "player_added", {
      teamId: "away",
      registrationId: "guest",
    });
    expect(required(state.lineups.away).battingOrder).toContain("guest");
    state = transition(state, "substitute", {
      teamId: "away",
      inId: "as",
      outId: "a1",
      kind: "injury",
    });
    expect(required(state.lineups.away).out).toContain("a1");
    expect(innings(state).bowlerId).toBeNull();
    expect(
      applyEvent(state, event("bowler_set", { bowlerId: "a1", midOver: false }, state.lastSeq + 1)),
    ).toMatchObject({ ok: false });
  });
  it("requires a derived result before finish and blocks further play", () => {
    expect(applyEvent(fresh(), event("finish", {}, 6))).toMatchObject({ ok: false });
    for (const kind of ["no_result", "abandoned"] as const) {
      const base = kind === "abandoned" ? replayMatch(startEvents().slice(0, 4)) : fresh();
      const state = transition(base, "abandon", { kind, reason: "rain" });
      const finished = transition(state, "finish", {});
      expect(finished.finished).toBe(true);
      expect(applyEvent(finished, event("resume", {}, finished.lastSeq + 1))).toMatchObject({
        ok: false,
        reason: "already_finished",
      });
    }
    expect(
      transition(
        transition(fresh(), "walkover", { winnerTeamId: "home", reason: "absent" }),
        "finish",
        {},
      ).finished,
    ).toBe(true);
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture value");
  return value;
}

const NAMES: NameBook = {
  teams: {
    home: { id: "home", name: "Royals", initials: "ROY" },
    away: { id: "away", name: "Strikers", initials: "STR" },
  },
  players: Object.fromEntries(
    ["h", "a"].flatMap((prefix) =>
      Array.from({ length: 11 }, (_, i) => [
        `${prefix}${String(i + 1)}`,
        {
          name: `Player ${prefix}${String(i + 1)}`,
          initials: prefix.toUpperCase(),
          photoUrl: null,
        },
      ]),
    ),
  ),
};
describe("next actions and public live state", () => {
  it("walks preparation, innings, interruption, result and finished phases", () => {
    expect(nextActions(initialState())).toEqual([{ kind: "confirm_conditions" }]);
    expect(nextActions(replayMatch(startEvents().slice(0, 1)))).toEqual([
      { kind: "confirm_lineup", teamId: "home" },
      { kind: "confirm_lineup", teamId: "away" },
    ]);
    expect(nextActions(replayMatch(startEvents().slice(0, 3)))).toEqual([{ kind: "record_toss" }]);
    expect(nextActions(replayMatch(startEvents().slice(0, 4)))).toEqual([
      { kind: "start_innings", inningsNo: 1, battingTeamId: "home" },
    ]);
    expect(nextActions(fresh())).toContainEqual({ kind: "record_ball", freeHit: false });
    expect(nextActions(transition(fresh(), "interrupt", { reason: "rain" }))).toEqual([
      { kind: "resume" },
    ]);
    expect(nextActions(dotsToEnd(fullMatch()))).toEqual([
      { kind: "start_innings", inningsNo: 2, battingTeamId: "away" },
    ]);
    const tie = tiedMatch();
    expect(nextActions(tie)).toEqual([
      { kind: "start_super_over" },
      { kind: "finish", result: deriveResult(tie) },
    ]);
    expect(nextActions(transition(tie, "finish", {}))).toEqual([]);
    expect(nextActions(transition(tie, "super_over_started", {}))).toEqual([
      { kind: "start_innings", inningsNo: 3, battingTeamId: "away" },
    ]);
  });
  it("suggests the next batter and least recent eligible bowler", () => {
    let state = fresh();
    state = apply(state, {
      ...payload(state),
      wicket: { kind: "bowled", playerOutId: "h1", fielderIds: [] },
    });
    expect(nextActions(state)).toContainEqual({
      kind: "pick_new_batter",
      end: "striker",
      suggestedId: "h3",
    });
    state = fresh();
    for (let i = 0; i < 6; i++) state = apply(state, payload(state));
    expect(nextActions(state)).toContainEqual({
      kind: "pick_bowler",
      allowed: ["a2", "a3"],
      blocked: [{ id: "a1", reason: "consecutive" }],
      suggestedId: "a2",
    });
    state = transition(state, "bowler_set", { bowlerId: "a2", midOver: false });
    for (let i = 0; i < 6; i++) state = apply(state, payload(state));
    expect(nextActions(state)).toContainEqual({
      kind: "pick_bowler",
      allowed: ["a1", "a3"],
      blocked: [{ id: "a2", reason: "consecutive" }],
      suggestedId: "a3",
    });
  });
  it("offers stable missing styles, free hits and retirement prompts", () => {
    let state = fresh();
    const before = nextActions(state);
    expect(before.filter((a) => a.kind === "ask_style")).toHaveLength(3);
    expect(nextActions(state)).toEqual(before);
    state = transition(state, "style_set", { registrationId: "h1", battingHand: BATTING_HANDS[0] });
    expect(nextActions(state)).not.toContainEqual({
      kind: "ask_style",
      registrationId: "h1",
      what: "battingHand",
    });
    state = apply(state, payload(state, 0, { noBall: true }));
    expect(nextActions(state)).toContainEqual({ kind: "record_ball", freeHit: true });
    let gully = fullMatch(FORMAT_PRESETS.tennis_gully);
    for (let n = 0; n < 5; n++) gully = apply(gully, payload(gully, 6, {}, 6));
    expect(nextActions(gully)).toContainEqual({
      kind: "retire_prompt",
      registrationId: "h1",
      atRuns: 25,
    });
  });
  it("projects score, rates, conditions, current players and recent balls", () => {
    let state = apply(fresh(), payload(fresh(), 4, {}, 4));
    state = apply(state, payload(state, 1));
    const live = publicLiveState(state, NAMES);
    expect(live).toMatchObject({
      seq: 7,
      currentRate: "15.00",
      requiredRate: null,
      ballsLeft: 118,
      situation: "Royals 5/0 (0.2)",
      conditionsLine: "Day",
      thisOver: ["4", "1"],
      trust: "self_scored",
    });
    expect(live.batters).toHaveLength(2);
    expect(live.bowler).toMatchObject({ id: "a1", figures: "0.2-0-5-0" });
    expect(live.recent[0]?.text).toBe("0.1 Player a1 to Player h1, FOUR.");
    expect(live).not.toHaveProperty("eventHistory");
    state = transition(state, "interrupt", { reason: "rain" });
    expect(publicLiveState(state, NAMES).situation).toBe("Play stopped: rain");
    const first = dotsToEnd(fullMatch());
    expect(publicLiveState(first, NAMES).situation).toBe("Innings break");
    expect(publicLiveState(startNext(first), NAMES)).toMatchObject({
      situation: "Strikers need 1 off 6 balls",
      requiredRate: "1.00",
      currentRate: "0.00",
    });
  });
  it("formats result margins and projects them as viewer situations", () => {
    let first = fullMatch();
    first = apply(first, payload(first, 4, {}, 4));
    first = dotsToEnd(first);
    const defended = dotsToEnd(startNext(first));
    expect(deriveResult(defended)).toMatchObject({ winnerTeamId: "home", marginText: "by 4 runs" });
    expect(publicLiveState(defended, NAMES).result).toBe("Royals won by 4 runs");
    const chased = apply(
      startNext(dotsToEnd(fullMatch())),
      payload(startNext(dotsToEnd(fullMatch())), 1),
    );
    expect(deriveResult(chased)).toMatchObject({ marginText: "by 10 wickets" });
    expect(publicLiveState(tiedMatch(), NAMES).result).toBe("Match tied");
    expect(
      publicLiveState(
        transition(fresh(), "walkover", { winnerTeamId: "away", reason: "absent" }),
        NAMES,
      ).result,
    ).toBe("Strikers won by walkover");
    expect(
      publicLiveState(transition(fresh(), "abandon", { kind: "no_result", reason: "rain" }), NAMES)
        .result,
    ).toBe("No result");
  });
  it("uses quota for all-out NRR only when enabled and excludes super overs", () => {
    let state = fullMatch();
    for (let n = 1; n <= 10; n++) {
      const striker = innings(state).strikerId;
      if (!striker) throw new Error("Missing striker");
      state = apply(state, {
        ...payload(state, 0, { noBall: true }),
        wicket: {
          kind: "run_out",
          playerOutId: striker,
          fielderIds: [],
          runsCompleted: 0,
        },
      });
      if (n < 10)
        state = transition(state, "new_batter", {
          registrationId: `h${String(n + 2)}`,
          end: "striker",
        });
    }
    expect(scoreForResult(state, NEW_SEASON_SCORING_RULES).home).toMatchObject({
      balls: 0,
      nrr_balls: 6,
    });
    expect(
      scoreForResult(state, { ...NEW_SEASON_SCORING_RULES, allOutUsesQuota: false }).home.nrr_balls,
    ).toBe(0);
    const base = tiedMatch();
    const withSuper = apply(
      startNext(transition(base, "super_over_started", {}), true),
      payload(startNext(transition(base, "super_over_started", {}), true), 4, {}, 4),
    );
    expect(scoreForResult(withSuper, NEW_SEASON_SCORING_RULES)).toEqual(
      scoreForResult(base, NEW_SEASON_SCORING_RULES),
    );
  });
  it("keeps a full T20 viewer payload under 6 KB", () => {
    let state = fullMatch(FORMAT_PRESETS.t20);
    for (let n = 0; n < 120; n++) {
      if (!innings(state).bowlerId) {
        const pick = nextActions(state).find((a) => a.kind === "pick_bowler");
        if (!pick || !pick.suggestedId) throw new Error("Missing bowler");
        state = transition(state, "bowler_set", { bowlerId: pick.suggestedId, midOver: false });
      }
      state = apply(state, { ...payload(state, 4, {}, 4), shot: { zone: "cover", angle: 67 } });
    }
    const live = publicLiveState(state, NAMES);
    expect(live.recent).toHaveLength(12);
    expect(new TextEncoder().encode(JSON.stringify(live)).length).toBeLessThan(6 * 1024);
  });
  it("projects both complete innings, dismissed batters and every bowler without private name-book fields", () => {
    let state = fullMatch({ ...ONE_OVER, oversPerInnings: 2 });
    state = apply(state, {
      ...payload(state),
      wicket: { kind: "bowled", playerOutId: "h1", fielderIds: [] },
    });
    state = transition(state, "new_batter", { registrationId: "h3", end: "striker" });
    for (let n = 1; n < 12; n++) {
      if (!innings(state).bowlerId)
        state = transition(state, "bowler_set", { bowlerId: "a2", midOver: false });
      state = apply(state, payload(state, 2));
    }
    state = startNext(state);
    state = apply(state, payload(state, 4, {}, 4));
    const names: NameBook = {
      teams: {},
      players: { h1: { name: "H. Y.", initials: "HY", photoUrl: "private-photo" } },
    };
    const card = publicScorecard(state, names);
    expect(card.seq).toBe(state.lastSeq);
    expect(card.innings).toHaveLength(2);
    expect(card.innings[0]?.batting[0]).toMatchObject({
      id: "h1",
      name: "H. Y.",
      dismissal: "bowled",
      notOut: false,
      balls: 1,
    });
    expect(card.innings[0]?.batting.map((row) => row.id)).toEqual(["h1", "h2", "h3"]);
    expect(card.innings[0]?.bowling.map((row) => row.id)).toEqual(["a1", "a2"]);
    expect(card.innings[0]?.bowling.map((row) => row.legalBalls)).toEqual([6, 6]);
    expect(card.innings[1]?.batting[0]).toMatchObject({ runs: 4, fours: 1, notOut: true });
    expect(JSON.stringify(card)).not.toContain("private-photo");
    expect(card.innings[0]?.extras).toEqual(innings(state).extras);
  });
  it("includes a mid-over replacement bowler in actual delivery appearance order", () => {
    let state = fresh();
    state = apply(state, payload(state, 4));
    state = transition(state, "bowler_set", { bowlerId: "a2", midOver: true, reason: "injury" });
    state = apply(state, payload(state, 2));
    const card = publicScorecard(state, { teams: {}, players: {} });
    expect(
      card.innings[0]?.bowling.map((line) => ({
        id: line.id,
        legalBalls: line.legalBalls,
        runs: line.runs,
      })),
    ).toEqual([
      { id: "a1", legalBalls: 1, runs: 4 },
      { id: "a2", legalBalls: 1, runs: 2 },
    ]);
  });
});

describe("player lines and commentary", () => {
  it("aggregates batting, bowling, maidens and dots without bench appearances", () => {
    let state = fresh();
    state = apply(state, payload(state, 4, {}, 4));
    state = apply(state, payload(state, 0, { noBall: true }));
    state = apply(state, payload(state, 0, { wides: 1 }));
    state = apply(state, payload(state));
    const lines = playerLines(state);
    expect(lines.get("h1")?.batting).toMatchObject({ runs: 4, balls: 3, fours: 1, sixes: 0 });
    expect(lines.get("a1")?.bowling).toMatchObject({
      runs: 6,
      legalBalls: 2,
      dots: 1,
      wides: 1,
      noBalls: 1,
    });
    expect(lines.has("hs")).toBe(false);
    expect(lines.get("h3")).toEqual({ registrationId: "h3", teamId: "home", appeared: true });
    const maiden = dotsToEnd(fullMatch());
    expect(playerLines(maiden).get("a1")?.bowling).toMatchObject({ maiden: 1, dots: 6 });
    expect(publicLiveState(maiden, NAMES).bowler).toBeNull();
  });
  it("credits catches, stumpings and direct/assisted run outs", () => {
    for (const [kind, fielders, expected] of [
      ["caught", ["a2"], { catches: 1 }],
      ["stumped", ["a2"], { stumpings: 1 }],
      ["run_out", ["a2"], { runOutsDirect: 1 }],
      ["run_out", ["a2", "a3"], { runOutsAssisted: 1 }],
      ["caught_and_bowled", [], { catches: 1 }],
    ] as const) {
      const base = fresh();
      const state = apply(base, {
        ...payload(base),
        wicket: { kind, playerOutId: "h1", fielderIds: [...fielders] },
      });
      const lines = playerLines(state);
      expect(lines.get(kind === "caught_and_bowled" ? "a1" : "a2")?.fielding).toMatchObject(
        expected,
      );
      if (fielders.length === 2)
        expect(lines.get("a3")?.fielding).toMatchObject({ runOutsAssisted: 1 });
      expect(lines.get("h1")?.batting).toMatchObject({ out: true, notOut: false, howOut: kind });
      expect(lines.get("a1")?.bowling?.wickets).toBe(kind === "run_out" ? 0 : 1);
    }
  });
  it("counts both substituted players as appearances and ignores super-over stats", () => {
    const substituted = transition(fresh(), "substitute", {
      teamId: "home",
      inId: "hs",
      outId: "h3",
      kind: "tactical",
    });
    expect(playerLines(substituted).get("hs")?.appeared).toBe(true);
    expect(playerLines(substituted).get("h3")?.appeared).toBe(true);
    const tie = tiedMatch();
    const superState = startNext(transition(tie, "super_over_started", {}), true);
    const scored = apply(superState, {
      ...payload(superState, 4, {}, 4),
      wicket: { kind: "run_out", playerOutId: "a1", fielderIds: ["h3"] },
    });
    expect(playerLines(scored)).toEqual(playerLines(tie));
  });
  it("does not award maidens to incomplete, split or charged overs", () => {
    const partial = apply(fresh(), payload(fresh()));
    expect(playerLines(partial).get("a1")?.bowling?.maiden).toBe(0);
    let split = transition(partial, "bowler_set", {
      bowlerId: "a2",
      midOver: true,
      reason: "injury",
    });
    for (let n = 0; n < 5; n++) split = apply(split, payload(split));
    expect(playerLines(split).get("a1")?.bowling?.maiden).toBe(0);
    expect(playerLines(split).get("a2")?.bowling?.maiden).toBe(0);
    let charged = apply(fresh(), payload(fresh(), 0, { wides: 1 }));
    for (let n = 0; n < 6; n++) charged = apply(charged, payload(charged));
    expect(playerLines(charged).get("a1")?.bowling?.maiden).toBe(0);
    let byes = apply(fresh(), payload(fresh(), 0, { byes: 2 }));
    for (let n = 0; n < 5; n++) byes = apply(byes, payload(byes));
    expect(playerLines(byes).get("a1")?.bowling?.maiden).toBe(1);
  });
  const shapes: { name: string; ball: Partial<BallSummary> }[] = [
    { name: "dot", ball: {} },
    { name: "single", ball: { runsBat: 1 } },
    { name: "three", ball: { runsBat: 3 } },
    {
      name: "four with zone",
      ball: { runsBat: 4, boundary: 4, shot: { zone: "cover", angle: 67 } },
    },
    { name: "six", ball: { runsBat: 6, boundary: 6 } },
    { name: "wide", ball: { extras: { wides: 1 } } },
    { name: "three wides", ball: { extras: { wides: 3 } } },
    { name: "no ball", ball: { extras: { noBall: true } } },
    { name: "no ball and four", ball: { runsBat: 4, extras: { noBall: true } } },
    { name: "two byes", ball: { extras: { byes: 2 } } },
    { name: "leg bye", ball: { extras: { legByes: 1 } } },
    { name: "wicket", ball: { wicket: { kind: "caught", playerOutId: "h1", fielderIds: ["a2"] } } },
  ];
  for (const lang of ["en", "hi"] as const)
    it.each(shapes)(`${lang} commentary $name`, ({ ball }) => {
      const state = apply(fresh(), payload(fresh()));
      const summary = required(required(innings(state).overs[0]).balls[0]);
      expect(commentaryLine({ ...summary, ...ball }, NAMES, lang)).toMatchSnapshot();
    });
});

describe("declared umpire over counts", () => {
  function declared(count: number, final = false): MatchState {
    const base = fullMatch({ ...ONE_OVER, oversPerInnings: final ? 1 : 2, maxOversPerBowler: 1 });
    const opening = required(base.eventHistory[4]);
    return replayMatch([
      ...base.eventHistory.slice(0, 4),
      {
        ...opening,
        payload: {
          ...(opening.payload as PayloadOf<"innings_started">),
          miscountedOvers: { "0": count },
        },
      },
    ]);
  }
  it.each([5, 7])(
    "completes a declared %i-ball over with an illegal extra, quota and maiden",
    (count) => {
      let state = declared(count);
      state = apply(state, payload(state, 0, { byes: 1 }));
      state = apply(state, payload(state, 0, { wides: 1 }));
      for (let n = 1; n < count; n++) state = apply(state, payload(state));
      expect(innings(state)).toMatchObject({
        completedOvers: 1,
        ballsInOver: 0,
        legalBalls: count,
        bowlerId: null,
        closed: null,
      });
      expect(innings(state).overs[0]?.balls).toHaveLength(count + 1);
      expect(publicLiveState(state, NAMES).innings[0]?.overs).toBe("1");
      expect(publicLiveState(state, NAMES).ballsLeft).toBe(6);
      expect(
        applyEvent(
          state,
          event("bowler_set", { bowlerId: "a1", midOver: false }, state.lastSeq + 1),
        ),
      ).toMatchObject({ ok: false, reason: "bowler_quota" });
      let maiden = declared(count, true);
      for (let n = 0; n < count; n++) maiden = apply(maiden, payload(maiden));
      expect(innings(maiden)).toMatchObject({
        closed: "overs",
        completedOvers: 1,
        legalBalls: count,
      });
      expect(playerLines(maiden).get("a1")?.bowling).toMatchObject({
        maiden: 1,
        legalBalls: count,
      });
      expect(publicLiveState(maiden, NAMES).ballsLeft).toBe(0);
    },
  );
  it("rejects malformed, redundant and incompatible declarations", () => {
    const base = fullMatch();
    const opening = required(base.eventHistory[4]);
    for (const miscountedOvers of [{ "00": 5 }, { "-1": 5 }, { "0": 0 }, { "0": 6 }]) {
      expect(() =>
        replayMatch([
          ...base.eventHistory.slice(0, 4),
          {
            ...opening,
            payload: { ...(opening.payload as PayloadOf<"innings_started">), miscountedOvers },
          },
        ]),
      ).toThrow(ReplayError);
    }
    expect(
      applyEvent(declared(3), event("revise", { inningsNo: 1, maxBalls: 4, method: "manual" }, 6)),
    ).toMatchObject({ ok: false, reason: "bad_payload" });
  });
  it("recomputes boundaries for corrections and rejects invalid later play", () => {
    let state = declared(5);
    for (let n = 0; n < 5; n++) state = apply(state, payload(state));
    state = transition(state, "bowler_set", { bowlerId: "a2", midOver: false });
    const opening = required(state.eventHistory[4]);
    expect(
      applyEvent(state, {
        ...event(
          "amend",
          {
            payload: {
              ...(opening.payload as PayloadOf<"innings_started">),
              miscountedOvers: { "0": 7 },
            },
          },
          state.lastSeq + 1,
        ),
        targetEventId: opening.eventId,
      }),
    ).toMatchObject({ ok: false, reason: "amend_breaks_later_events" });
    expect(correction(state, required(state.eventHistory[5]))).toMatchObject({
      ok: false,
      reason: "amend_breaks_later_events",
    });
  });
});

describe("source no-ball totals and fielding assistants", () => {
  it("credits variable no-ball totals and rotates physical surplus runs", () => {
    const state = apply(fresh(), payload(fresh(), 0, { noBall: true, noBallRuns: 2 }));
    expect(innings(state)).toMatchObject({
      runs: 2,
      legalBalls: 0,
      strikerId: "h2",
      extras: { noBalls: 2 },
    });
    expect(innings(state).bowlers.a1).toMatchObject({ runs: 2, noBalls: 2 });
    expect(validateBall(payload(fresh(), 0, { noBallRuns: 2 }))).toMatchObject({ ok: false });
    const higherBase = fresh();
    if (!higherBase.format) throw new Error("Missing format");
    higherBase.format = { ...higherBase.format, noBallRuns: 2 };
    expect(
      applyEvent(
        higherBase,
        event("ball", payload(higherBase, 0, { noBall: true, noBallRuns: 1 }), 6),
      ),
    ).toMatchObject({ ok: false, reason: "bad_payload" });
    expect(
      applyEvent(
        fresh(),
        event(
          "ball",
          {
            ...payload(fresh(), 0, { noBall: true, noBallRuns: 2 }),
            wicket: { kind: "run_out", playerOutId: "h1", fielderIds: [], runsCompleted: 0 },
          },
          6,
        ),
      ),
    ).toMatchObject({ ok: false });
  });
  it("preserves all three run-out assistants and refuses oversized attribution", () => {
    const state = apply(fresh(), {
      ...payload(fresh()),
      wicket: { kind: "run_out", playerOutId: "h1", fielderIds: ["a1", "a2", "a3"] },
    });
    for (const id of ["a1", "a2", "a3"])
      expect(playerLines(state).get(id)?.fielding?.runOutsAssisted).toBe(1);
    expect(
      validateBall({
        ...payload(fresh()),
        wicket: { kind: "caught", playerOutId: "h1", fielderIds: ["a1", "a2"] },
      }),
    ).toMatchObject({ ok: false });
  });
  it("allows explicitly registered temporary fielders without batting or bowling eligibility", () => {
    const events = startEvents();
    const lineup = events[2];
    if (!lineup) throw new Error("Missing lineup");
    events[2] = {
      ...lineup,
      payload: { ...(lineup.payload as PayloadOf<"lineup_confirmed">), substitutes: ["as"] },
    };
    const base = replayMatch(events);
    const wicket = {
      kind: "caught" as const,
      playerOutId: "h1",
      fielderIds: ["as"],
      substituteFielderIds: ["as"],
    };
    const state = apply(base, { ...payload(base), wicket });
    expect(playerLines(state).get("as")?.fielding?.catches).toBe(1);
    expect(
      applyEvent(
        base,
        event("ball", { ...payload(base), wicket: { ...wicket, substituteFielderIds: [] } }, 6),
      ),
    ).toMatchObject({ ok: false, reason: "unknown_player" });
    expect(
      applyEvent(base, event("bowler_set", { bowlerId: "as", midOver: false }, 6)),
    ).toMatchObject({ ok: false, reason: "bowler_not_fielding" });
  });
});

describe("source absent batters and anonymous fielders", () => {
  it("closes with unavailable batters without fabricating wickets or statistics", () => {
    const events = startEvents();
    events[4] = event(
      "innings_started",
      {
        inningsNo: 1,
        battingTeamId: "home",
        strikerId: "h1",
        nonStrikerId: "h2",
        bowlerId: "a1",
        absentBatterIds: ["h3"],
      },
      5,
    );
    const base = replayMatch(events);
    expect(innings(base).batters.h3).toBeUndefined();
    expect(
      applyEvent(base, event("new_batter", { registrationId: "h3", end: "striker" }, 6)),
    ).toMatchObject({ ok: false, reason: "unknown_player" });
    const ended = apply(base, {
      ...payload(base),
      wicket: { kind: "bowled", playerOutId: "h1", fielderIds: [] },
    });
    expect(innings(ended)).toMatchObject({
      wickets: 1,
      closed: "no_more_batters",
      absentBatterIds: ["h3"],
    });
    expect(innings(ended).batters.h3).toBeUndefined();
    expect(
      validateInningsStarted({ ...events[4].payload, absentBatterIds: ["h3", "h3"] }),
    ).toMatchObject({ ok: false });
    expect(
      applyEvent(
        replayMatch(events.slice(0, 4)),
        event(
          "innings_started",
          { ...events[4].payload, absentBatterIds: ["h1"] } as PayloadOf<"innings_started">,
          5,
        ),
      ),
    ).toMatchObject({ ok: false });
  });
  it("treats known plus unknown run-out participants as assisted without anonymous credit", () => {
    const state = apply(fresh(), {
      ...payload(fresh()),
      wicket: { kind: "run_out", playerOutId: "h1", fielderIds: ["a2"], unknownFielderCount: 1 },
    });
    expect(playerLines(state).get("a2")?.fielding).toMatchObject({
      runOutsAssisted: 1,
      runOutsDirect: 0,
    });
    expect([...playerLines(state).keys()]).toEqual([...playerLines(fresh()).keys()]);
    expect(
      validateBall({
        ...payload(fresh()),
        wicket: { kind: "caught", playerOutId: "h1", fielderIds: ["a2"], unknownFielderCount: 1 },
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateBall({
        ...payload(fresh()),
        wicket: { kind: "run_out", playerOutId: "h1", fielderIds: [], unknownFielderCount: 0 },
      }),
    ).toMatchObject({ ok: false });
  });
});

it("reopens provisional exhaustion only for a valid retired-hurt return", () => {
  let base = fresh();
  const advance = <T extends EventType>(state: MatchState, type: T, data: PayloadOf<T>) => {
    const result = applyEvent(state, event(type, data, state.lastSeq + 1));
    if (!result.ok) throw new Error(result.reason);
    return result.state;
  };
  base = advance(base, "retire", { registrationId: "h1", kind: "hurt" });
  base = advance(base, "new_batter", { registrationId: "h3", end: "striker" });
  const closed = apply(base, {
    ...payload(base),
    wicket: { kind: "bowled", playerOutId: "h3", fielderIds: [] },
  });
  expect(innings(closed).closed).toBe("no_more_batters");
  const returned = advance(closed, "resume_batting", { registrationId: "h1" });
  expect(returned.phase).toBe("live");
  expect(innings(returned)).toMatchObject({ closed: null, strikerId: "h1", retiredHurt: [] });
  expect(
    applyEvent(returned, event("resume_batting", { registrationId: "h1" }, returned.lastSeq + 1)),
  ).toMatchObject({ ok: false });
  const denied: MatchState[] = [
    { ...closed, finished: true },
    { ...closed, outcome: "no_result" },
    { ...closed, outcome: "walkover" },
  ];
  for (const field of ["quota", "target", "wickets", "overs"] as const) {
    const copy = replayMatch(closed.eventHistory);
    const current = innings(copy);
    if (field === "quota") current.maxBalls = current.legalBalls;
    if (field === "target") current.target = current.runs;
    if (field === "wickets") current.wickets = 10;
    if (field === "overs") current.closed = "overs";
    denied.push(copy);
  }
  denied.push(
    advance(closed, "innings_started", {
      inningsNo: 2,
      battingTeamId: "away",
      strikerId: "a1",
      nonStrikerId: "a2",
      bowlerId: "h2",
    }),
  );
  for (const state of denied)
    expect(
      applyEvent(state, event("resume_batting", { registrationId: "h1" }, state.lastSeq + 1)),
    ).toMatchObject({ ok: false });
});

it("preserves competition metadata across restart and rejects conflicting amendments", () => {
  const events = startEvents();
  const first = events[0];
  if (!first) throw new Error("Missing first event");
  const payload = {
    ...(first.payload as PayloadOf<"match_started">),
    competition: { name: "Cup", season: "2026" },
  };
  events[0] = event("match_started", payload, 1);
  const restart = event("restart", { reason: "rain" }, 6);
  expect(
    replayMatch([...events, restart, event("match_started", payload, 7, 2)]).competition,
  ).toEqual(payload.competition);
  expect(() =>
    replayMatch([
      ...events,
      restart,
      event("match_started", { ...payload, competition: { name: "Other", season: "2026" } }, 7, 2),
    ]),
  ).toThrow(ReplayError);
  const amendment = {
    ...event("amend", { payload: { ...payload, competition: { name: "Cup", season: "2027" } } }, 6),
    targetEventId: first.eventId,
  };
  expect(() => replayMatch([...events, amendment])).toThrow(ReplayError);
  expect(
    validateMatchStarted({ ...payload, competition: { name: " ", season: "2026" } }),
  ).toMatchObject({ ok: false });
});

it.each(["concussion", "injury"] as const)(
  "reopens provisional exhaustion for a registered %s substitute without entering them",
  (kind) => {
    const advance = <T extends EventType>(state: MatchState, type: T, data: PayloadOf<T>) => {
      const result = applyEvent(state, event(type, data, state.lastSeq + 1));
      if (!result.ok) throw new Error(result.reason);
      return result.state;
    };
    let base = advance(fresh(), "retire", { registrationId: "h1", kind: "hurt" });
    base = advance(base, "new_batter", { registrationId: "h3", end: "striker" });
    const closed = apply(base, {
      ...payload(base),
      wicket: { kind: "bowled", playerOutId: "h3", fielderIds: [] },
    });
    const before = innings(closed);
    const substitution = { teamId: "home", inId: "hs", outId: "h1", kind };
    const reopened = advance(closed, "substitute", substitution);
    expect(reopened.phase).toBe("live");
    expect(innings(reopened)).toMatchObject({
      closed: null,
      strikerId: null,
      nonStrikerId: "h2",
      runs: before.runs,
      wickets: before.wickets,
      legalBalls: before.legalBalls,
    });
    expect(innings(reopened).batters.hs).toBeUndefined();
    expect(
      innings(advance(reopened, "new_batter", { registrationId: "hs", end: "striker" })).strikerId,
    ).toBe("hs");
    const quota = replayMatch(closed.eventHistory);
    innings(quota).maxBalls = innings(quota).legalBalls;
    const ordinary = replayMatch(closed.eventHistory);
    innings(ordinary).retiredHurt = [];
    innings(ordinary).outIds.push("h1");
    for (const denied of [quota, ordinary])
      expect(innings(advance(denied, "substitute", substitution)).closed).toBe("no_more_batters");
    expect(
      applyEvent(
        { ...closed, finished: true },
        event("substitute", substitution, closed.lastSeq + 1),
      ),
    ).toMatchObject({ ok: false, reason: "already_finished" });
    const later = advance(closed, "innings_started", {
      inningsNo: 2,
      battingTeamId: "away",
      strikerId: "a1",
      nonStrikerId: "a2",
      bowlerId: "h2",
    });
    expect(advance(later, "substitute", substitution).innings[0]?.closed).toBe("no_more_batters");
    for (const other of ["impact", "tactical"] as const)
      expect(innings(advance(closed, "substitute", { ...substitution, kind: other })).closed).toBe(
        "no_more_batters",
      );
  },
);

describe("C24 large runs off the bat", () => {
  it.each([8, 9, 10])(
    "credits %i to batter, team and bowler with physical strike parity",
    (runs) => {
      const events = startEvents();
      const ball = event("ball", payload(fresh(), runs), 6);
      expect(validateBall(ball.payload)).toEqual({ ok: true });
      const state = replayMatch([...events, ball]);
      expect(innings(state)).toMatchObject({
        runs,
        legalBalls: 1,
        strikerId: runs % 2 ? "h2" : "h1",
      });
      expect(innings(state).batters.h1).toMatchObject({ runs, balls: 1, fours: 0, sixes: 0 });
      expect(innings(state).bowlers.a1).toMatchObject({ runs, legalBalls: 1 });
      const correction = {
        ...event("amend", { payload: { ...ball.payload, runsBat: 10 } }, 7),
        targetEventId: ball.eventId,
      };
      expect(innings(replayMatch([...events, ball, correction]))).toMatchObject({
        runs: 10,
        strikerId: "h1",
        legalBalls: 1,
      });
    },
  );
  it.each([11, -1, 8.5])("refuses %i runs", (runs) => {
    expect(validateBall(payload(fresh(), runs))).toEqual({
      ok: false,
      reason: "runs_out_of_range",
    });
  });
  it("preserves boundary validation and separate extras", () => {
    expect(validateBall({ ...payload(fresh(), 8), boundary: 4 })).toEqual({
      ok: false,
      reason: "boundary_mismatch",
    });
    expect(innings(apply(fresh(), payload(fresh(), 10, { noBall: true })))).toMatchObject({
      runs: 11,
      legalBalls: 0,
    });
  });
});

describe("C26 whole-match void", () => {
  it("preserves recorded innings and history while removing result eligibility", () => {
    const history = [
      ...startEvents(),
      event(
        "ball",
        {
          bowlerId: "a1",
          strikerId: "h1",
          nonStrikerId: "h2",
          runsBat: 4,
          boundary: 4,
          extras: {},
        },
        6,
      ),
    ];
    const state = replayMatch([
      ...history,
      event("match_voided", { reason: "Fixture invalidated by organiser" }, 7),
    ]);
    expect(state).toMatchObject({ phase: "void", finished: true, outcome: "void" });
    expect(state.innings[0]?.runs).toBe(4);
    expect(state.eventHistory).toHaveLength(7);
    expect(deriveResult(state)).toBeNull();
    expect(nextActions(state)).toEqual([]);
    expect(publicLiveState(state, { teams: {}, players: {} }).situation).toBe("Match void");
  });
  it("allows whole-match void after finish without changing ordinary event void", () => {
    const history = [
      ...startEvents(),
      event("abandon", { kind: "no_result", reason: "Rain" }, 6),
      event("finish", {}, 7),
    ];
    expect(
      replayMatch([...history, event("match_voided", { reason: "Fixture invalidated" }, 8)]).phase,
    ).toBe("void");
    const delivery = event(
      "ball",
      { bowlerId: "a1", strikerId: "h1", nonStrikerId: "h2", runsBat: 4, boundary: 4, extras: {} },
      6,
    );
    expect(
      replayMatch([
        ...startEvents(),
        delivery,
        { ...event("void", {}, 7), targetEventId: delivery.eventId },
      ]).innings[0]?.runs,
    ).toBe(0);
  });
  it("cannot resurrect a match through a later correction, restart or new event", () => {
    const history = [...startEvents(), event("match_voided", { reason: "Invalid fixture" }, 6)];
    for (const later of [
      event("restart", { reason: "Retry" }, 7),
      { ...event("void", {}, 7), targetEventId: history[0]?.eventId ?? null },
      event("style_set", { registrationId: "h1", battingHand: BATTING_HANDS[0] }, 7),
    ]) {
      expect(() => replayMatch([...history, later])).toThrow("already_finished");
    }
    const before = [...startEvents(), event("match_voided", { reason: "Invalid fixture" }, 6)];
    expect(() =>
      replayMatch([
        ...before,
        {
          ...event("amend", { payload: { reason: "A different reason" } }, 7),
          targetEventId: before.at(-1)?.eventId ?? null,
        },
      ]),
    ).toThrow("already_finished");
  });
  it("requires a trimmed reason no longer than the existing fixture cancellation reason", () => {
    for (const reason of ["", " ", " padded ", "x".repeat(301)])
      expect(
        applyEvent(replayMatch(startEvents()), event("match_voided", { reason }, 6)),
      ).toMatchObject({ ok: false, reason: "bad_payload" });
    expect(
      applyEvent(replayMatch(startEvents()), event("match_voided", { reason: "x".repeat(300) }, 6))
        .ok,
    ).toBe(true);
  });
});

describe("public scorecard dismissal attribution", () => {
  const sanitized: NameBook = {
    ...NAMES,
    players: { ...NAMES.players, a2: { name: "A Y", initials: "AY", photoUrl: null } },
  };
  const first = (state: MatchState) => publicScorecard(state, sanitized).innings[0]?.batting[0];
  it.each(["caught", "caught_and_bowled", "stumped", "bowled"] as const)(
    "keeps canonical %s participants without private identity fields",
    (kind) => {
      const base = fresh();
      const fielders = kind === "bowled" ? [] : kind === "caught_and_bowled" ? ["a1"] : ["a2"];
      const next = apply(base, {
        ...payload(base),
        wicket: { kind, playerOutId: "h1", fielderIds: fielders },
      });
      const card = publicScorecard(next, sanitized);
      expect(card.ballsPerOver).toBe(6);
      expect(first(next)?.attribution).toEqual({
        bowler: { id: "a1", name: "Player a1", initials: "A" },
        fielders: fielders.map((id) => ({
          id,
          name: sanitized.players[id]?.name,
          initials: sanitized.players[id]?.initials,
          substitute: false,
        })),
        unknownFielders: 0,
      });
      expect(JSON.stringify(card)).not.toMatch(/photoUrl|dateOfBirth|phone|email|actorPersonId/);
    },
  );
  it("retains every recorded run-out participant and gives no bowler credit", () => {
    const base = fresh();
    const next = apply(base, {
      ...payload(base),
      wicket: { kind: "run_out", playerOutId: "h1", fielderIds: ["a2", "a3"], runsCompleted: 0 },
    });
    expect(first(next)?.attribution?.bowler).toBeNull();
    expect(first(next)?.attribution?.fielders.map((fielder) => fielder.id)).toEqual(["a2", "a3"]);
  });
  it("preserves unknown and registered substitute fielders without inventing a keeper", () => {
    const events = startEvents();
    events[2] = {
      ...required(events[2]),
      payload: {
        ...(required(events[2]).payload as PayloadOf<"lineup_confirmed">),
        substitutes: ["as"],
      },
    };
    const base = replayMatch(events);
    const substitute = apply(base, {
      ...payload(base),
      wicket: {
        kind: "caught",
        playerOutId: "h1",
        fielderIds: ["as"],
        substituteFielderIds: ["as"],
      },
    });
    expect(first(substitute)?.attribution?.fielders).toEqual([
      { id: "as", name: "as", initials: "AS", substitute: true },
    ]);
    const anonymous = apply(base, {
      ...payload(base),
      wicket: { kind: "caught", playerOutId: "h1", fielderIds: [], unknownFielderCount: 1 },
    });
    expect(first(anonymous)?.attribution).toMatchObject({ fielders: [], unknownFielders: 1 });
  });
  it("attributes the final dismissal after a retired-hurt batter returns", () => {
    let state = transition(fresh(), "retire", { registrationId: "h1", kind: "hurt" });
    expect(first(state)).toMatchObject({ retiredHurt: true });
    expect(first(state)?.attribution).toBeUndefined();
    state = transition(state, "new_batter", { registrationId: "h3", end: "striker" });
    state = apply(state, {
      ...payload(state),
      wicket: { kind: "bowled", playerOutId: "h3", fielderIds: [] },
    });
    state = transition(state, "resume_batting", { registrationId: "h1" });
    state = apply(state, {
      ...payload(state),
      wicket: { kind: "caught", playerOutId: "h1", fielderIds: ["a2"] },
    });
    expect(first(state)).toMatchObject({
      retiredHurt: false,
      notOut: false,
      dismissal: "caught",
      attribution: { fielders: [{ id: "a2", name: "A Y" }] },
    });
  });
  it("uses amended participants and removes attribution when the dismissal is voided", () => {
    const base = fresh();
    const original = {
      ...payload(base),
      wicket: { kind: "caught" as const, playerOutId: "h1", fielderIds: ["a2"] },
    };
    const state = apply(base, original);
    const target = required(state.eventHistory[5]);
    const amended = correction(state, target, {
      ...original,
      wicket: { ...original.wicket, fielderIds: ["a3"] },
    });
    if (!amended.ok) throw new Error(amended.reason);
    expect(first(amended.state)?.attribution?.fielders.map((fielder) => fielder.id)).toEqual([
      "a3",
    ]);
    const voided = correction(amended.state, target);
    if (!voided.ok) throw new Error(voided.reason);
    expect(first(voided.state)).toMatchObject({ notOut: true, dismissal: null });
    expect(first(voided.state)?.attribution).toBeUndefined();
  });
});

describe("C31 canonical public charts", () => {
  const names: NameBook = {
    teams: {},
    players: { h1: { name: "H P", initials: "HP", photoUrl: null } },
  };
  const chart = (state: MatchState) => {
    const value = publicCharts(state, names).innings[0];
    if (!value) throw new Error("Missing chart innings");
    expect(value.points.at(-1)).toMatchObject({
      runs: value.runs,
      wickets: value.wickets,
      legalBalls: value.legalBalls,
    });
    expect(
      value.overs.reduce((sum, over) => sum + over.runs, 0) +
        value.adjustments.reduce((sum, adjustment) => sum + adjustment.runs, 0),
    ).toBe(value.runs);
    expect(
      value.overs.reduce((sum, over) => sum + over.wickets, 0) +
        value.adjustments.reduce((sum, adjustment) => sum + adjustment.wickets, 0),
    ).toBe(value.wickets);
    return value;
  };
  it("keeps opening penalties and illegal extras at their canonical legal-ball position", () => {
    let state = replayMatch(startEvents().slice(0, 4));
    state = transition(state, "penalty_runs", { teamId: "home", runs: 5, reason: "other" });
    state = transition(state, "innings_started", {
      inningsNo: 1,
      battingTeamId: "home",
      strikerId: "h1",
      nonStrikerId: "h2",
      bowlerId: "a1",
    });
    deepFreeze(state);
    const before = state.innings[0]?.scoreTrace;
    state = apply(state, payload(state, 0, { wides: 1 }));
    state = apply(state, {
      ...payload(state, 6, { noBall: true }, 6),
      shot: { zone: "cover", angle: 90 },
    });
    state = apply(state, payload(state, 1));
    const value = chart(state);
    expect(value.points.map((point) => [point.runs, point.legalBalls])).toEqual([
      [5, 0],
      [6, 0],
      [13, 0],
      [14, 1],
    ]);
    expect(value.adjustments).toMatchObject([{ kind: "opening", runs: 5, legalBalls: 0 }]);
    expect(value.overs).toMatchObject([{ complete: false, legalBalls: 1, runs: 9 }]);
    expect(before).toHaveLength(1);
    expect(value.shots).toEqual([{ seq: 8, batterId: "h1", angle: 90, runs: 6, boundary: 6 }]);
    expect(value.batters[0]).toEqual({ id: "h1", name: "H P", initials: "HP" });
  });
  it("uses actual miscounted over containers and retains the next partial over", () => {
    const events = startEvents();
    events[4] = event(
      "innings_started",
      {
        inningsNo: 1,
        battingTeamId: "home",
        strikerId: "h1",
        nonStrikerId: "h2",
        bowlerId: "a1",
        miscountedOvers: { "0": 5 },
      },
      5,
    );
    let state = replayMatch(events);
    for (let index = 0; index < 4; index++) state = apply(state, payload(state));
    expect(chart(state).overs[0]).toMatchObject({ complete: false, legalBalls: 4 });
    state = apply(state, payload(state));
    state = transition(state, "bowler_set", { bowlerId: "a2", midOver: false });
    state = apply(state, payload(state, 1));
    expect(chart(state).overs).toMatchObject([
      { number: 1, complete: true, legalBalls: 5 },
      { number: 2, complete: false, legalBalls: 1 },
    ]);
  });
  it("labels a later penalty separately instead of charging it to the completed innings' bars", () => {
    let state = apply(fresh(), payload(fresh(), 2));
    state = transition(state, "innings_closed", { reason: "declared" });
    state = transition(state, "penalty_runs", { teamId: "home", runs: 5, reason: "other" });
    const value = chart(state);
    expect(value.adjustments).toMatchObject([
      { kind: "penalty", runs: 5, legalBalls: 1, subsequent: true },
    ]);
    expect(value.overs[0]?.runs).toBe(2);
  });
  it("records retired-out as a non-delivery wicket, while retired hurt adds no wicket", () => {
    const hurt = transition(fresh(), "retire", {
      registrationId: "h1",
      kind: "hurt",
    });
    expect(chart(hurt).adjustments).toEqual([]);
    const out = transition(fresh(), "retire", {
      registrationId: "h1",
      kind: "out",
    });
    expect(chart(out).adjustments).toMatchObject([
      { kind: "retirement", runs: 0, wickets: 1, legalBalls: 0 },
    ]);
    expect(chart(out).overs).toEqual([]);
  });
  it("regenerates trace and recorded shots through amend and void", () => {
    const state = apply(fresh(), {
      ...payload(fresh(), 4, {}, 4),
      shot: { zone: "cover", angle: 90 },
    });
    const ball = state.eventHistory.at(-1);
    if (!ball) throw new Error("Expected an accepted ball");
    const amended = replayMatch([
      ...state.eventHistory,
      {
        ...event("amend", { payload: payload(fresh(), 2) }, state.lastSeq + 1),
        targetEventId: ball.eventId,
      },
    ]);
    expect(chart(amended).runs).toBe(2);
    expect(chart(amended).shots).toEqual([]);
    const voided = replayMatch([
      ...state.eventHistory,
      {
        ...event("void", {}, state.lastSeq + 1),
        targetEventId: ball.eventId,
      },
    ]);
    expect(chart(voided).points).toHaveLength(1);
    expect(chart(voided).runs).toBe(0);
  });
  it("clears the prior attempt's trace on restart", () => {
    const state = apply(fresh(), payload(fresh(), 2));
    const restarted = transition(state, "restart", { reason: "Restart" });
    expect(publicCharts(restarted, names).innings).toEqual([]);
    expect(restarted.attempt).toBe(2);
  });
  it("retains recorded unusual runs without inventing shots for missing coverage", () => {
    let state = apply(fresh(), { ...payload(fresh(), 5), shot: { zone: "cover", angle: 90 } });
    state = apply(state, payload(state, 1));
    expect(chart(state).shots).toHaveLength(1);
    expect(chart(state).shots[0]).toMatchObject({ runs: 5, boundary: null });
  });
  it("keeps regulation and each super-over innings separate", () => {
    let state = tiedMatch();
    state = transition(state, "super_over_started", {});
    state = transition(state, "innings_started", {
      inningsNo: 3,
      battingTeamId: "away",
      strikerId: "a1",
      nonStrikerId: "a2",
      bowlerId: "h1",
      superOver: true,
    });
    expect(publicCharts(state, names).innings.map((value) => [value.no, value.superOver])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(publicCharts(state, names).innings[2]?.points[0]).toMatchObject({
      kind: "opening",
      runs: 0,
      legalBalls: 0,
    });
  });
});

describe("canonical overlay markers", () => {
  it("keeps a no-ball boundary and gives dismissals precedence", () => {
    const state = apply(fresh(), payload(fresh(), 4, { noBall: true }, 4));
    expect(overlayProjection(state).lastDelivery).toEqual({
      seq: 6,
      boundary: 4,
      dismissal: false,
      sting: "four",
    });
    const out = apply(fresh(), {
      ...payload(fresh()),
      wicket: { kind: "bowled", playerOutId: "h1", fielderIds: [] },
    });
    expect(overlayProjection(out).lastDelivery?.sting).toBe("wicket");
  });
  it("suppresses changed classifications while retaining shot-only corrections", () => {
    const state = apply(fresh(), payload(fresh(), 4, {}, 4));
    const ball = state.eventHistory.at(-1);
    if (!ball) throw new Error("Missing delivery");
    const amend = (replacement: BallPayload) =>
      replayMatch([
        ...state.eventHistory,
        { ...event("amend", { payload: replacement }, 7), targetEventId: ball.eventId },
      ]);
    expect(overlayProjection(amend(payload(fresh()))).lastDelivery).toMatchObject({
      seq: 6,
      boundary: null,
      sting: null,
    });
    expect(
      overlayProjection(
        amend({ ...payload(fresh(), 4, {}, 4), shot: { zone: "cover", angle: 67 } }),
      ).lastDelivery,
    ).toMatchObject({ seq: 6, sting: "four" });
    const voided = replayMatch([
      ...state.eventHistory,
      { ...event("void", {}, 7), targetEventId: ball.eventId },
    ]);
    expect(overlayProjection(voided).lastDelivery).toBeNull();
    expect(overlayProjection(transition(state, "restart", { reason: "Restart" }))).toMatchObject({
      attempt: 2,
      lastDelivery: null,
      betweenOvers: false,
    });
  });
  it.each([5, 7])("uses the actual %i-ball miscounted over boundary", (count) => {
    const events = startEvents();
    events[4] = event(
      "innings_started",
      {
        inningsNo: 1,
        battingTeamId: "home",
        strikerId: "h1",
        nonStrikerId: "h2",
        bowlerId: "a1",
        miscountedOvers: { "0": count },
      },
      5,
    );
    let state = replayMatch(events);
    expect(overlayProjection(state).betweenOvers).toBe(false);
    for (let ball = 0; ball < count; ball += 1) {
      state = apply(state, payload(state));
      expect(overlayProjection(state).betweenOvers).toBe(ball === count - 1);
    }
  });
  it("withholds between-over statistics during an interruption and at terminal state", () => {
    let state = fresh();
    for (let ball = 0; ball < 6; ball += 1) state = apply(state, payload(state));
    expect(overlayProjection(state).betweenOvers).toBe(true);
    expect(overlayProjection({ ...state, interrupted: { reason: "Rain" } }).betweenOvers).toBe(
      false,
    );
    expect(overlayProjection({ ...state, phase: "finished" }).betweenOvers).toBe(false);
  });
});

it("ends between-over STAT when an illegal delivery starts the next over", () => {
  let state = fresh();
  for (let ball = 0; ball < 6; ball += 1) state = apply(state, payload(state));
  expect(overlayProjection(state).betweenOvers).toBe(true);
  state = transition(state, "bowler_set", { bowlerId: "a2", midOver: false });
  state = apply(state, payload(state, 0, { wides: 1 }));
  expect(innings(state).ballsInOver).toBe(0);
  expect(overlayProjection(state).betweenOvers).toBe(false);
});
