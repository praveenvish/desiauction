import { expect, it } from "vitest";
import { timedEngine } from "./engine";
import { TIMED_FORMAT_PRESETS, timedFormat } from "./formats";
import type { TimedEventPayloads } from "./payloads";
import type { TimedState } from "./state";
import type { MatchEvent, NameBook } from "../types";
import { publicLiveProjection } from "../delay";
import { publicFamilyPanel } from "../panels";
const epoch = Date.parse("2026-10-11T10:00:00Z");
function event<T extends keyof TimedEventPayloads>(
  s: TimedState,
  type: T,
  payload: TimedEventPayloads[T],
  ms = 0,
): MatchEvent<T, TimedEventPayloads[T]> {
  return {
    eventId: `e${String(s.lastSeq + 1)}`,
    seq: s.lastSeq + 1,
    attempt: s.attempt,
    type,
    v: 1,
    payload,
    targetEventId: null,
    actorPersonId: "scorer",
    clientSeq: s.lastSeq + 1,
    clientRecordedAt: new Date(
      (s.lastEventAt ? Date.parse(s.lastEventAt) : epoch) + ms,
    ).toISOString(),
  };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function add<T extends keyof TimedEventPayloads>(
  s: TimedState,
  type: T,
  payload: TimedEventPayloads[T],
  ms = 0,
): TimedState {
  const e = event(s, type, payload, ms),
    before = structuredClone(s);
  const result = timedEngine.apply(freeze(s), freeze(e));
  expect(s).toEqual(before);
  if (!result.ok) throw new Error(result.reason);
  expect(result.state).toEqual(timedEngine.replay(result.state.eventHistory));
  return result.state;
}
function setup(key: keyof typeof TIMED_FORMAT_PRESETS = "football_90", players = 5) {
  let s = add(timedEngine.initialState(), "match_started", {
    format: TIMED_FORMAT_PRESETS[key],
    conditions: {},
    homeTeamId: "home",
    awayTeamId: "away",
  });
  for (const teamId of ["home", "away"]) {
    const ids = Array.from({ length: players }, (_, i) => `${teamId}${String(i + 1)}`);
    s = add(s, "lineup_confirmed", {
      teamId,
      players: [...ids, `${teamId}bench`],
      startingActive: ids,
      roles: { [required(ids[0])]: key.startsWith("basketball") ? "guard" : "goalkeeper" },
    });
  }
  return s;
}
function open(key: keyof typeof TIMED_FORMAT_PRESETS = "football_90", players = 5) {
  return add(setup(key, players), "period_started", { period: 1 });
}
function closed(key: keyof typeof TIMED_FORMAT_PRESETS = "football_90_shootout", players = 5) {
  let s = setup(key, players);
  for (let n = 1; n <= TIMED_FORMAT_PRESETS[key].periods; n++) {
    s = add(s, "period_started", { period: n });
    s = add(s, "period_ended", { period: n }, 1000);
  }
  return s;
}
function refused<T extends keyof TimedEventPayloads>(
  s: TimedState,
  type: T,
  payload: TimedEventPayloads[T],
) {
  expect(timedEngine.apply(s, event(s, type, payload))).toMatchObject({ ok: false });
}
function attempt(s: TimedState, scored: boolean, id?: string) {
  const side = required(s.shootout).nextSide,
    used = required(s.shootout).used[side],
    eligible = required(s.shootout).eligible[side];
  return add(s, "shootout_attempt", {
    teamId: side,
    playerId:
      id ??
      (used.length === eligible.length
        ? required(eligible[0])
        : required(eligible.find((p) => !used.includes(p)))),
    scored,
  });
}
it("TR-01 exact supported presets and strict shape; no changed clock or injected preset", () => {
  expect(Object.keys(TIMED_FORMAT_PRESETS)).toEqual([
    "football_90",
    "football_90_shootout",
    "hockey_60",
    "hockey_60_shootout",
    "basketball_40",
  ]);
  for (const preset of Object.values(TIMED_FORMAT_PRESETS)) {
    expect(timedFormat(preset)).toEqual(preset);
    expect(timedFormat({ ...preset, clock: "unknown" })).toBeNull();
    expect(timedFormat({ ...preset, email: "private" })).toBeNull();
    expect(timedFormat({ ...preset, scoreUnits: [9] })).toBeNull();
  }
});
it("TR-02 consecutive open periods and units; paused and expired open scoring; no score after closure", () => {
  const before = setup();
  refused(before, "score", { teamId: "home", points: 1 });
  refused(before, "period_started", { period: 2 });
  let s = add(before, "period_started", { period: 1 });
  refused(s, "score", { teamId: "home", points: 2 });
  s = add(s, "clock", { running: false }, 1000);
  s = add(s, "score", { teamId: "home", points: 1 });
  s = add(s, "clock", { running: true });
  s = add(s, "score", { teamId: "home", points: 1 }, 46 * 60000);
  expect(s.periodElapsedMs).toBe(45 * 60000);
  expect(s.periodClosed).toBe(false);
  expect(s.running).toBe(false);
  s = add(s, "period_ended", { period: 1 });
  refused(s, "score", { teamId: "home", points: 1 });
  expect(timedEngine.deriveResult(s)).toBeNull();
});
it("TR-03 running/stopped modes, repeat clock no reset, interruption freezes and resume paused, period sums", () => {
  let s = open();
  expect(s.running).toBe(true);
  s = add(s, "clock", { running: true }, 5000);
  expect(s.gameClockMs).toBe(5000);
  s = add(s, "interrupt", { reason: "other" }, 2000);
  s = add(s, "resume", {}, 30000);
  expect(s.gameClockMs).toBe(7000);
  expect(s.running).toBe(false);
  s = add(s, "period_ended", { period: 1 }, 1000);
  s = add(s, "period_started", { period: 2 });
  s = add(s, "period_ended", { period: 2 }, 3000);
  expect(s.gameClockMs).toBe(10000);
  expect(s.periodElapsedMs).toBe(3000);
  let b = open("basketball_40");
  expect(b.running).toBe(false);
  b = add(b, "score", { teamId: "home", points: 3 }, 5000);
  expect(b.gameClockMs).toBe(0);
  b = add(b, "clock", { running: true });
  b = add(b, "clock", { running: false }, 2000);
  expect(b.gameClockMs).toBe(2000);
});
it("TR-04 invalid/backward time and duplicate identity refused; equal timestamps accepted", () => {
  const s = open();
  const e = event(s, "clock", { running: false });
  for (const clientRecordedAt of ["invalid", new Date(epoch - 1).toISOString()])
    expect(timedEngine.apply(s, { ...e, clientRecordedAt })).toMatchObject({ ok: false });
  expect(
    timedEngine.apply(s, { ...e, eventId: required(s.eventHistory[0]).eventId }),
  ).toMatchObject({
    ok: false,
  });
  expect(add(s, "clock", { running: false }).gameClockMs).toBe(0);
});
it("TR-05 corrections preserve original clock anchor and recompute intervals without amendment receipt time", () => {
  let s = open();
  s = add(s, "clock", { running: false }, 10000);
  const target = required(s.eventHistory.at(-1));
  s = add(s, "score", { teamId: "home", points: 1, scorerId: "home1" }, 20000);
  const e = {
    ...event(s, "amend", { payload: { running: true } }, 10000),
    targetEventId: target.eventId,
  };
  const result = timedEngine.apply(s, e);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  s = result.state;
  expect(s.gameClockMs).toBe(30000);
  expect(s.anchorAt).toBe(epoch + 30000);
  expect(s).toEqual(timedEngine.replay([...s.eventHistory]));
  const score = required(s.eventHistory.find((e) => e.type === "score"));
  const voided = timedEngine.apply(s, { ...event(s, "void", {}), targetEventId: score.eventId });
  expect(voided.ok).toBe(true);
  if (voided.ok) expect(voided.state.points.home).toBe(0);
});
it("TR-06 active appearance/role snapshots, bench not appeared, valid exchange, red no replacement/re-entry", () => {
  let s = setup();
  expect(timedEngine.playerLines(s).size).toBe(0);
  s = add(s, "period_started", { period: 1 });
  expect(required(s.participants.home1).stats.role).toBe("goalkeeper");
  expect(s.participants.homebench).toBeUndefined();
  s = add(s, "sub", { teamId: "home", outId: "home1", inId: "homebench" }, 10000);
  expect(required(required(s.participants.home1).stats.activeIntervals[0]).toGameMs).toBe(10000);
  expect(required(s.participants.homebench).stats.role).toBeNull();
  refused(s, "score", { teamId: "home", points: 1, scorerId: "home1" });
  s = add(s, "card", { playerId: "homebench", colour: "red" });
  expect(s.active.home).toHaveLength(4);
  refused(s, "sub", { teamId: "home", outId: "homebench", inId: "home1" });
  refused(s, "sub", { teamId: "home", outId: "home2", inId: "homebench" });
  s = add(s, "card", { playerId: "home2", colour: "yellow" });
  s = add(s, "card", { playerId: "home2", colour: "yellow" });
  expect(s.active.home).toContain("home2");
});
it("TR-07 squad ownership/unique IDs/role vocabulary and nonempty active subset are enforced", () => {
  const s = add(timedEngine.initialState(), "match_started", {
    format: TIMED_FORMAT_PRESETS.football_90,
    conditions: {},
    homeTeamId: "home",
    awayTeamId: "away",
  });
  for (const payload of [
    { teamId: "home", players: ["p", "p"], startingActive: ["p"] },
    { teamId: "home", players: ["p"], startingActive: [] },
    { teamId: "home", players: ["p"], startingActive: ["x"] },
    { teamId: "home", players: ["p"], startingActive: ["p"], roles: { p: "bowler" } },
    { teamId: "home", players: ["p"], startingActive: ["p"], roles: { x: "goalkeeper" } },
  ])
    refused(s, "lineup_confirmed", payload);
  const home = add(s, "lineup_confirmed", {
    teamId: "home",
    players: ["p"],
    startingActive: ["p"],
  });
  refused(home, "lineup_confirmed", { teamId: "away", players: ["p"], startingActive: ["p"] });
});
it("TR-08 actual goal/assist/own goal/in-play penalty attribution; missing identity never fabricated", () => {
  let s = open();
  s = add(s, "score", { teamId: "home", points: 1, scorerId: "home1", assistId: "home2" });
  s = add(s, "score", { teamId: "home", points: 1, scorerId: "away1", ownGoal: true });
  s = add(s, "score", { teamId: "home", points: 1, scorerId: "home1", penalty: true });
  s = add(s, "score", { teamId: "home", points: 1 });
  expect(s.points.home).toBe(4);
  expect(required(s.participants.home1).stats).toMatchObject({
    goals: 2,
    points: 2,
    penaltiesScored: 1,
  });
  expect(required(s.participants.home2).stats.assists).toBe(1);
  expect(required(s.participants.away1).stats).toMatchObject({ ownGoals: 1, goals: 0, points: 0 });
  for (const payload of [
    { teamId: "home", points: 1, scorerId: "away2" },
    { teamId: "home", points: 1, scorerId: "home1", assistId: "home1" },
    { teamId: "home", points: 1, scorerId: "home1", ownGoal: true },
    { teamId: "home", points: 1, scorerId: "away1", ownGoal: true, penalty: true },
    { teamId: "home", points: 1, assistId: "away1" },
  ])
    refused(s, "score", payload);
});
it("TR-09 basketball units/fouls/green card, no goal flags; regulation tie honest without extra periods", () => {
  let s = open("basketball_40");
  for (const points of [1, 2, 3])
    s = add(s, "score", { teamId: "home", points, scorerId: "home1" });
  s = add(s, "foul", { teamId: "home", playerId: "home1" });
  s = add(s, "card", { playerId: "home1", colour: "green" });
  expect(required(s.participants.home1).stats).toMatchObject({
    points: 6,
    goals: 0,
    fouls: 1,
    greenCards: 1,
  });
  refused(s, "foul", { teamId: "away", playerId: "home1" });
  refused(s, "score", { teamId: "home", points: 1, penalty: true });
  refused(s, "score", { teamId: "home", points: 1, ownGoal: true });
  const tie = closed("basketball_40");
  expect(timedEngine.deriveResult(tie)).toMatchObject({ outcome: "tie", method: null });
  refused(tie, "period_started", { period: 5 });
  expect(timedEngine.scoreForResult(tie, {} as never)).toEqual({
    home: { points: 0 },
    away: { points: 0 },
  });
});
it("TR-10 shootout activation only final tied enabled; home first and active/nonred cycle eligibility", () => {
  const s = closed();
  expect(required(s.shootout).nextSide).toBe("home");
  refused(s, "shootout_attempt", { teamId: "away", playerId: "away1", scored: true });
  refused(s, "shootout_attempt", { teamId: "home", playerId: "homebench", scored: true });
  let next = attempt(s, true, "home1");
  next = attempt(next, true, "away1");
  refused(next, "shootout_attempt", { teamId: "home", playerId: "home1", scored: true });
  refused(next, "sub", { teamId: "home", inId: "homebench", outId: "home2" });
  refused(closed("football_90"), "shootout_attempt", {
    teamId: "home",
    playerId: "home1",
    scored: true,
  });
  refused(open("football_90_shootout"), "shootout_attempt", {
    teamId: "home",
    playerId: "home1",
    scored: true,
  });
});
it("TR-11 best-five early clinch refuses later attempts; regulation totals exclude shootout", () => {
  let s = closed();
  for (let i = 0; i < 3; i++) {
    s = attempt(s, true);
    s = attempt(s, false);
  }
  expect(required(s.shootout).winner).toBe("home");
  expect(timedEngine.deriveResult(s)).toMatchObject({
    outcome: "home_win",
    method: "penalties",
    marginText: "3–0 on penalties",
  });
  expect(timedEngine.scoreForResult(s, {} as never)).toEqual({
    home: { goals: 0 },
    away: { goals: 0 },
  });
  refused(s, "shootout_attempt", { teamId: "home", playerId: "home4", scored: true });
  expect(required(s.participants.home1).stats).toMatchObject({
    goals: 0,
    shootoutAttempts: 1,
    shootoutConversions: 1,
  });
  expect(required(s.participants.away1).stats.penaltiesScored).toBe(0);
});
it("TR-12 balanced sudden-death pairs and complete player cycles before repeat", () => {
  let s = closed();
  for (let i = 0; i < 10; i++) s = attempt(s, true);
  expect(required(s.shootout).winner).toBeNull();
  s = attempt(s, true, "home1");
  expect(required(s.shootout).winner).toBeNull();
  s = attempt(s, false, "away1");
  expect(required(s.shootout).winner).toBe("home");
  expect(timedEngine.deriveResult(s)?.marginText).toBe("6–5 on penalties");
});
it("TR-13 red players absent at final eligibility, unequal nonzero regulation skips shootout", () => {
  let s = open("football_90_shootout");
  s = add(s, "card", { playerId: "home1", colour: "red" });
  s = add(s, "period_ended", { period: 1 });
  s = add(s, "period_started", { period: 2 });
  s = add(s, "period_ended", { period: 2 });
  expect(required(s.shootout).eligible.home).not.toContain("home1");
  refused(s, "shootout_attempt", { teamId: "home", playerId: "home1", scored: true });
  let winner = open("football_90_shootout");
  winner = add(winner, "score", { teamId: "home", points: 1 });
  winner = add(winner, "period_ended", { period: 1 });
  winner = add(winner, "period_started", { period: 2 });
  winner = add(winner, "period_ended", { period: 2 });
  expect(winner.shootout).toBeNull();
  expect(timedEngine.deriveResult(winner)).toMatchObject({ outcome: "home_win", method: null });
});
it("TR-14 restart removes sporting credit, correction breaking later participation refuses, terminal void remains", () => {
  let s = open();
  s = add(s, "sub", { teamId: "home", outId: "home1", inId: "homebench" });
  const sub = required(s.eventHistory.at(-1));
  s = add(s, "score", { teamId: "home", points: 1, scorerId: "homebench" });
  expect(
    timedEngine.apply(s, { ...event(s, "void", {}), targetEventId: sub.eventId }),
  ).toMatchObject({ ok: false, reason: "amend_breaks_later_events" });
  s = add(s, "restart", { reason: "Restart" });
  expect(s.attempt).toBe(2);
  expect(s.points.home).toBe(0);
  expect(Object.keys(s.participants)).toHaveLength(0);
  expect(s.format).toBeNull();
  s = add(s, "match_voided", { reason: "Void" });
  expect(s.phase).toBe("void");
  expect(timedEngine.deriveResult(s)).toBeNull();
  refused(s, "match_started", {
    format: TIMED_FORMAT_PRESETS.football_90,
    conditions: {},
    homeTeamId: "home",
    awayTeamId: "away",
  });
});
it("TR-15 closed public timeline/privacy fields/clock and engine next actions; final finish immutable", () => {
  let s = open();
  s = add(s, "score", { teamId: "home", points: 1, scorerId: "home1", assistId: "home2" }, 60000);
  const names: NameBook = {
    teams: {
      home: { id: "home", name: "Home", initials: "H" },
      away: { id: "away", name: "Away", initials: "A" },
    },
    players: {
      home1: { name: "Player", initials: "P", photoUrl: null },
      home2: { name: "Assist", initials: "A", photoUrl: null },
    },
  };
  const live = timedEngine.publicLiveState(s, names);
  expect(live.panel).toMatchObject({
    gameClockMs: 60000,
    period: 1,
    timeline: [{ kind: "score", playerName: "Player", assistName: "Assist" }],
  });
  expect(JSON.stringify(live).length).toBeLessThan(6 * 1024);
  expect(
    publicLiveProjection(
      {
        ...live,
        panel: {
          ...live.panel,
          email: "private",
          timeline: live.panel.timeline.map((e) => ({ ...e, phone: "private" })),
        },
      },
      "timed",
    ),
  ).toEqual(live);
  expect(publicFamilyPanel(live, "raid")).toBeNull();
  expect(publicFamilyPanel({ ...live, panel: { ...live.panel, period: 5 } })).toBeNull();
  expect(timedEngine.nextActions(s)).toContainEqual({ kind: "record_score", scoreUnits: [1] });
  let final = closed("football_90");
  final = add(final, "finish", {});
  expect(timedEngine.nextActions(final)).toEqual([]);
  refused(final, "score", { teamId: "home", points: 1 });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing timed state.");
  return value;
}
