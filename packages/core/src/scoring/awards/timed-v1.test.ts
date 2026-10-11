import { expect, it } from "vitest";
import { scoreTimed, pickTimedMatchAwards, timedDiscipline } from "./timed-v1";
import { initialTimedState, emptyTimedStats, type TimedState } from "../timed/state";
import { TIMED_FORMAT_PRESETS } from "../timed/formats";
import { timedClockDisplay } from "../timed/clock";
import { timedPublicLiveState } from "../timed/public-state";
import type { PlayerLine, DerivedResult } from "../types";
function state(): TimedState {
  return {
    ...initialTimedState(),
    format: TIMED_FORMAT_PRESETS.football_90,
    teams: { home: "h", away: "a" },
    period: 2,
    periodClosed: true,
    points: { home: 1, away: 0 },
  };
}
function player(
  role: string | null,
  stats: Partial<NonNullable<PlayerLine["timed"]>> = {},
): PlayerLine {
  return {
    registrationId: "p",
    teamId: "h",
    appeared: true,
    timed: {
      ...emptyTimedStats(role),
      activeIntervals: [{ fromGameMs: 0, toGameMs: 1, period: 1 }],
      ...stats,
    },
  };
}
function score(
  role: string | null,
  stats: Partial<NonNullable<PlayerLine["timed"]>> = {},
  s = state(),
) {
  return scoreTimed(new Map([["p", player(role, stats)]]), s).get("p");
}
it("C53 actual football table uses frozen role and never invents untracked penalty saves/misses", () => {
  expect(
    score("goalkeeper", {
      goals: 2,
      assists: 1,
      ownGoals: 1,
      yellowCards: 2,
      redCards: 1,
      penaltiesScored: 2,
      shootoutConversions: 5,
    })?.points,
  ).toBe(27);
  expect(score(null, { goals: 2, assists: 1 })?.points).toBe(26);
  expect(score("defender", { goals: 1 })?.points).toBe(16);
  expect(score("goalkeeper")?.lines.map((line) => line.code)).toEqual(["clean_sheet"]);
});
it("C53 clean sheet requires actual appearance and complete regulation, whole-match zero conceded and known frozen role", () => {
  expect(score("goalkeeper", { activeIntervals: [] })?.points).toBe(0);
  expect(score("goalkeeper", {}, { ...state(), period: 1 })?.points).toBe(0);
  expect(score("defender", {}, { ...state(), points: { home: 1, away: 1 } })?.points).toBe(0);
  expect(score("goalkeeper", {}, { ...state(), terminal: "abandoned" })?.points).toBe(0);
  expect(score("goalkeeper", { redCards: 1 })?.points).toBe(3);
  expect(score("defender", { shootoutAttempts: 1, shootoutConversions: 0 })?.points).toBe(4);
  expect(score("forward")?.points).toBe(0);
});
it("C53 basketball records actual scoring points minus fouls and hockey refuses fabricated awards", () => {
  expect(
    score(
      null,
      { points: 8, fouls: 3, goals: 9 },
      { ...state(), format: TIMED_FORMAT_PRESETS.basketball_40 },
    )?.points,
  ).toBe(5);
  expect(() => score(null, {}, { ...state(), format: TIMED_FORMAT_PRESETS.hockey_60 })).toThrow(
    /unavailable/,
  );
});
const result: DerivedResult = {
  outcome: "home_win",
  winnerTeamId: "h",
  marginText: "1 goals",
  method: null,
};
const candidate = (id: string, teamId: string, points: number, code = "goals") => ({
  registrationId: id,
  teamId,
  points,
  lines: [{ code, label: code, qty: 1, points }],
});
it("C53 total, winning preference, discipline and registration ID tie ordering; top-three and Fighter boundaries", () => {
  const away = [candidate("a", "a", 30), candidate("b", "a", 29)];
  expect(pickTimedMatchAwards([...away, candidate("h", "h", 28)], result)).toMatchObject({
    player_of_match: { registrationId: "h" },
    fighter_of_match: { registrationId: "a" },
  });
  expect(
    pickTimedMatchAwards([...away, candidate("c", "a", 28), candidate("h", "h", 27)], result),
  ).toMatchObject({
    player_of_match: { registrationId: "a" },
    fighter_of_match: { registrationId: "b" },
  });
  expect(
    pickTimedMatchAwards(
      [candidate("z", "a", 10), candidate("b", "h", 10), candidate("a", "h", 10)],
      result,
    ).player_of_match?.registrationId,
  ).toBe("a");
  expect(
    timedDiscipline([
      { code: "goals", label: "Goal", qty: 1, points: 10 },
      { code: "assists", label: "Assist", qty: 1, points: 6 },
      { code: "clean_sheet", label: "Clean", qty: 1, points: 8 },
    ]),
  ).toBe(16);
  expect(
    pickTimedMatchAwards([candidate("a", "h", 10)], {
      ...result,
      winnerTeamId: null,
      outcome: "tie",
    }).fighter_of_match,
  ).toBeNull();
  expect(pickTimedMatchAwards([], result).player_of_match).toBeNull();
  expect(pickTimedMatchAwards([candidate("a", "h", 10)], null).player_of_match).toBeNull();
});
it("C53 released clock subtracts delay, clamps period/game time and never alters canonical panel", () => {
  const s = {
    ...state(),
    period: 1,
    periodClosed: false,
    periodElapsedMs: 1000,
    gameClockMs: 1000,
    running: true,
    anchorAt: 10000,
  };
  const panel = timedPublicLiveState(s, { teams: {}, players: {} }).panel;
  const before = JSON.stringify(panel);
  expect(timedClockDisplay(panel, { serverAtMs: 20000, delayMs: 6000 }, 1000)).toEqual({
    periodElapsedMs: 6000,
    gameClockMs: 6000,
  });
  expect(timedClockDisplay(panel, { serverAtMs: 99999999, delayMs: 0 })).toEqual({
    periodElapsedMs: 2700000,
    gameClockMs: 2700000,
  });
  expect(
    timedClockDisplay({ ...panel, running: false }, { serverAtMs: 99999999, delayMs: 0 }),
  ).toEqual({ periodElapsedMs: 1000, gameClockMs: 1000 });
  expect(JSON.stringify(panel)).toBe(before);
});
