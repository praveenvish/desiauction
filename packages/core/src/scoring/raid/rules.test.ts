import { expect, it } from "vitest";
import { RAID_FORMAT_PRESETS } from "./formats";
import { raidEngine } from "./engine";
import type { RaidEventPayloads } from "./payloads";
import type { RaidState } from "./state";
import type { MatchEvent } from "../types";
import { publicFamilyPanel } from "../panels";
import { publicLiveProjection } from "../delay";
import { engineFor } from "../registry";
import { replayMatch } from "../replay";
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}
const base = Date.parse("2026-10-10T12:00:00Z");
function event<T extends keyof RaidEventPayloads>(
  state: RaidState,
  type: T,
  payload: RaidEventPayloads[T],
  ms = 0,
  target: string | null = null,
): MatchEvent<T, RaidEventPayloads[T]> {
  return {
    type,
    payload,
    seq: state.lastSeq + 1,
    clientSeq: state.lastSeq + 1,
    eventId: `e${String(state.lastSeq + 1)}`,
    attempt: state.attempt,
    v: 1,
    targetEventId: target,
    actorPersonId: "scorer",
    clientRecordedAt: new Date(base + ms).toISOString(),
  };
}
function apply<T extends keyof RaidEventPayloads>(
  state: RaidState,
  type: T,
  payload: RaidEventPayloads[T],
  ms = 0,
  target: string | null = null,
): RaidState {
  const result = raidEngine.apply(state, event(state, type, payload, ms, target));
  if (!result.ok) throw new Error(`${type}: ${result.reason}`);
  expect(raidEngine.replay(result.state.eventHistory)).toEqual(result.state);
  return result.state;
}
function squad(prefix: string) {
  return Array.from({ length: 7 }, (_, index) => `${prefix}${String(index + 1)}`);
}
function setup() {
  let state = apply(raidEngine.initialState(), "match_started", {
    format: RAID_FORMAT_PRESETS.pkl_40,
    conditions: {},
    homeTeamId: "home",
    awayTeamId: "away",
  });
  for (const [teamId, prefix] of [
    ["home", "h"],
    ["away", "a"],
  ] as const)
    state = apply(state, "lineup_confirmed", {
      teamId: teamId,
      players: [...squad(prefix), `${prefix}bench`],
      startingMat: squad(prefix),
    });
  state = apply(state, "half_started", { half: 1 });
  return apply(state, "clock", { running: true });
}
function raid(
  state: RaidState,
  touchedIds: string[] = [],
  extra: Partial<RaidEventPayloads["raid"]> = {},
  ms = 0,
) {
  return apply(
    state,
    "raid",
    {
      raiderId: required(state.mat[state.nextRaidingSide][0]),
      touchedIds,
      bonus: false,
      tackled: false,
      tacklerIds: [],
      ...extra,
    },
    ms,
  );
}
it("KR-01 bonus threshold uses pre-raid defenders, touch points and invalid bonus refusal", () => {
  let state = raid(setup(), ["a1", "a2"], { bonus: true });
  expect(state.points).toEqual({ home: 3, away: 0 });
  expect(state.mat.away).toHaveLength(5);
  state = raid(state);
  expect(
    raidEngine.apply(
      state,
      event(state, "raid", {
        raiderId: "h1",
        touchedIds: [],
        bonus: true,
        tackled: false,
        tacklerIds: [],
      }),
    ),
  ).toMatchObject({ ok: false, reason: "bad_payload" });
});
it("KR-02 primary super tackle credit and assists use pre-raid mat", () => {
  let state = raid(setup(), ["a1", "a2", "a3", "a4"]);
  state = raid(state);
  state = raid(state, [], { tackled: true, tacklerIds: ["a6", "a5"] });
  expect(state.points).toEqual({ home: 4, away: 2 });
  expect(state.outs.home).toEqual(["h1"]);
  expect(state.participants.a6?.stats).toMatchObject({ tacklePoints: 2, superTackles: 1 });
  expect(state.participants.a5?.stats).toMatchObject({ tacklePoints: 0, assists: 1 });
  expect(state.mat.away).toEqual(["a5", "a6", "a7", "a1", "a2"]);
});
it("KR-03 every bonus/technical point revives eligible sporting outs FIFO", () => {
  let state = raid(setup(), ["a1", "a2", "a3"]);
  state = apply(state, "technical_point", { teamId: "away", reason: "technical" });
  expect(state.mat.away).toEqual(["a4", "a5", "a6", "a7", "a1"]);
  expect(state.outs.away).toEqual(["a2", "a3"]);
  state = apply(state, "technical_point", { teamId: "away", reason: "technical" });
  expect(state.mat.away.at(-1)).toBe("a2");
});
it("KR-04 all-out awards team-only two and restores seven, without recursive credit", () => {
  const state = raid(setup(), squad("a"));
  expect(state.points).toEqual({ home: 9, away: 0 });
  expect(state.mat.away).toEqual(squad("a"));
  expect(state.participants.h1?.stats.raidPoints).toBe(7);
  expect(state.outs.away).toEqual([]);
});
it("KR-05 third empty raid sends raider out, with no double charge when tackled", () => {
  let state = setup();
  for (let i = 0; i < 4; i++) state = raid(state);
  expect(raidEngine.nextActions(state)).toEqual([
    { kind: "record_raid", side: "home", doOrDie: true },
  ]);
  const empty = raid(state);
  expect(empty.points.away).toBe(1);
  expect(empty.outs.home).toEqual(["h1"]);
  const tackled = raid(state, [], { tackled: true, tacklerIds: ["a1"] });
  expect(tackled.points.away).toBe(1);
});
it("KR-05 positive bonus clears do-or-die and records actual success", () => {
  let state = setup();
  for (let i = 0; i < 4; i++) state = raid(state);
  state = raid(state, [], { bonus: true });
  expect(state.empty.home).toBe(0);
  expect(state.participants.h1?.stats.doOrDieSuccesses).toBe(1);
});
it("KR-06 halves alternate first side and retain mat/out/card state", () => {
  let state = raid(setup(), ["a1"]);
  state = apply(state, "green_card", { playerId: "h2" });
  state = apply(state, "half_ended", {});
  const before = structuredClone(state);
  state = apply(state, "half_started", { half: 2 });
  expect(state.nextRaidingSide).toBe("away");
  expect(state.mat).toEqual(before.mat);
  expect(state.outs).toEqual(before.outs);
  expect(state.cards).toEqual(before.cards);
  expect(state.empty).toEqual({ home: 0, away: 0 });
  expect(state.running).toBe(false);
  state = apply(state, "clock", { running: true });
  state = raid(state);
  expect(state.nextRaidingSide).toBe("home");
});
it("KR-07 Super10 and High5 are threshold flags, never duplicate player points", () => {
  let state = setup();
  for (let i = 0; i < 10; i++) {
    state = raid(state, [], { bonus: true, raiderId: "h1" });
    state = raid(state, [], { tackled: true, tacklerIds: ["h1"] });
    state = apply(state, "technical_point", { teamId: "away", reason: "technical" });
  }
  expect(state.participants.h1?.stats).toMatchObject({
    raidPoints: 10,
    tacklePoints: 10,
    super10: 1,
    high5: 1,
    successfulRaids: 10,
  });
  expect(raidEngine.playerLines(state).get("h1")?.raid).toEqual(state.participants.h1?.stats);
  expect(raidEngine.playerLines(state).has("hbench")).toBe(false);
});
it("KR-08 exact points result including tie, explicit early halves and finish", () => {
  let state = raid(setup(), ["a1"]);
  state = apply(state, "half_ended", {});
  state = apply(state, "half_started", { half: 2 });
  state = apply(state, "half_ended", {});
  expect(raidEngine.scoreForResult(state, {} as never)).toEqual({
    home: { points: 1 },
    away: { points: 0 },
  });
  expect(raidEngine.deriveResult(state)).toMatchObject({
    outcome: "home_win",
    winnerTeamId: "home",
    marginText: "1 points",
  });
  state = apply(state, "finish", {});
  expect(state.finished).toBe(true);
  let tie = setup();
  tie = apply(tie, "half_ended", {});
  tie = apply(tie, "half_started", { half: 2 });
  tie = apply(tie, "half_ended", {});
  expect(raidEngine.deriveResult(tie)?.outcome).toBe("tie");
});
it("canonical clock accumulates running time; duplicate true/pause/interrupt/resume never resets or advances paused time", () => {
  let state = setup();
  state = apply(state, "clock", { running: true }, 30000);
  expect(state.halfElapsedMs).toBe(30000);
  state = apply(state, "clock", { running: false }, 40000);
  state = apply(state, "clock", { running: false }, 90000);
  expect(state.halfElapsedMs).toBe(40000);
  state = apply(state, "clock", { running: true }, 100000);
  state = apply(state, "interrupt", { reason: "other" }, 110000);
  state = apply(state, "resume", {}, 300000);
  expect(state.halfElapsedMs).toBe(50000);
  expect(state.running).toBe(false);
  state = apply(state, "clock", { running: true }, 310000);
  state = raid(state, [], {}, 320000);
  expect(state.halfElapsedMs).toBe(60000);
  expect(state.gameElapsedMs).toBe(60000);
});
it("raid timer is advisory; expiry exposes half end and refuses scoring without inventing events", () => {
  let state = setup();
  state = apply(state, "conditions_changed", { conditions: {} }, 60000);
  expect(raidEngine.publicLiveState(state, { teams: {}, players: {} }).panel.raidElapsedMs).toBe(
    30000,
  );
  expect(state.points).toEqual({ home: 0, away: 0 });
  state = raid(state, [], {}, 60000);
  expect(state.points).toEqual({ home: 0, away: 0 });
  state = apply(state, "conditions_changed", { conditions: {} }, 1300000);
  expect(state.halfElapsedMs).toBe(1200000);
  expect(state.gameElapsedMs).toBe(1200000);
  expect(raidEngine.nextActions(state)).toEqual([{ kind: "end_half" }]);
  expect(
    raidEngine.apply(
      state,
      event(
        state,
        "raid",
        { raiderId: "a1", touchedIds: [], bonus: false, tackled: false, tacklerIds: [] },
        1300000,
      ),
    ).ok,
  ).toBe(false);
  state = apply(state, "half_ended", {}, 1300000);
  expect(state.halfClosed).toBe(true);
});
it("invalid and backward accepted timestamps refuse; equal timestamps remain valid", () => {
  const state = setup();
  expect(
    raidEngine.apply(state, {
      ...event(state, "clock", { running: false }),
      clientRecordedAt: "invalid",
    }).ok,
  ).toBe(false);
  expect(raidEngine.apply(state, event(state, "clock", { running: false }, -1)).ok).toBe(false);
  expect(raidEngine.apply(state, event(state, "clock", { running: false })).ok).toBe(true);
});
it("bonus+tackle scores both sides; original primary choice retained and invalid overlaps refused", () => {
  const state = setup(),
    result = raid(state, [], { bonus: true, tackled: true, tacklerIds: ["a2", "a1"] });
  expect(result.points).toEqual({ home: 1, away: 1 });
  expect(result.outs.home).toEqual([]);
  expect(result.participants.a2?.stats.tacklePoints).toBe(1);
  expect(result.participants.a1?.stats.assists).toBe(1);
  for (const extra of [
    { touchedIds: ["a1", "a1"] },
    { touchedIds: ["a1"], lineOut: ["a1"] },
    { tackled: true, tacklerIds: ["a1"], lineOut: ["a1"] },
    { tackled: true, tacklerIds: [] },
    { tackled: true, tacklerIds: ["a1"], touchedIds: ["a2"] },
    { tackled: true, tacklerIds: ["a1"], lineOut: ["h1"] },
    { tacklerIds: ["a1"] },
    { raiderId: "hbench" },
  ])
    expect(
      raidEngine.apply(
        state,
        event(state, "raid", {
          raiderId: "h1",
          touchedIds: [],
          bonus: false,
          tackled: false,
          tacklerIds: [],
          ...extra,
        }),
      ).ok,
    ).toBe(false);
});
it("defender lineouts credit raider; unassisted raider lineout credits team only", () => {
  const state = raid(setup(), [], { lineOut: ["a1", "a2", "h1"] });
  expect(state.points).toEqual({ home: 2, away: 1 });
  expect(state.participants.h1?.stats.raidPoints).toBe(2);
  expect(Object.values(state.participants).reduce((sum, p) => sum + p.stats.tacklePoints, 0)).toBe(
    0,
  );
  expect(state.mat.home).toContain("h1");
  expect(state.mat.away).toContain("a1");
});
it("green expires in game time across pauses/halftime, yellow does not remove, red never revives", () => {
  let state = apply(setup(), "green_card", { playerId: "h1" });
  state = apply(state, "yellow_card", { playerId: "h2" });
  state = apply(state, "red_card", { playerId: "h3" });
  expect(state.mat.home).not.toContain("h1");
  expect(state.mat.home).toContain("h2");
  expect(state.mat.home).not.toContain("h3");
  expect(state.outs.home).toEqual([]);
  state = apply(state, "clock", { running: false }, 60000);
  state = apply(state, "half_ended", {}, 300000);
  state = apply(state, "half_started", { half: 2 }, 300000);
  state = apply(state, "clock", { running: true }, 300000);
  state = apply(state, "conditions_changed", { conditions: {} }, 360000);
  expect(state.gameElapsedMs).toBe(120000);
  expect(state.mat.home).toContain("h1");
  expect(state.mat.home).not.toContain("h3");
});
it("suspended FIFO out is skipped, not deleted; eligibility restores without fabricated revival", () => {
  let state = raid(setup(), ["a1", "a2"]);
  state = apply(state, "green_card", { playerId: "a1" });
  state = apply(state, "technical_point", { teamId: "away", reason: "technical" });
  expect(state.mat.away).toContain("a2");
  expect(state.outs.away).toEqual(["a1"]);
  state = apply(state, "conditions_changed", { conditions: {} }, 120000);
  expect(state.mat.away).not.toContain("a1");
  state = apply(state, "technical_point", { teamId: "away", reason: "technical" }, 120000);
  expect(state.mat.away).toContain("a1");
});
it("card-depleted all-out awards once and cannot recursively score on empty mat", () => {
  let state = setup();
  for (const id of squad("a")) state = apply(state, "red_card", { playerId: id });
  expect(state.mat.away).toEqual([]);
  expect(state.points.home).toBe(2);
  state = apply(state, "technical_point", { teamId: "away", reason: "technical" });
  expect(state.points.home).toBe(2);
  expect(state.points.away).toBe(1);
});
it("effective corrections retain original timing and activity; chained amend/void and broken history refuse", () => {
  let state = raid(setup(), ["a1"], {}, 30000);
  const target = required(state.eventHistory.at(-1)).eventId;
  state = apply(state, "conditions_changed", { conditions: {} }, 40000);
  state = apply(
    state,
    "amend",
    {
      payload: {
        raiderId: "h1",
        touchedIds: ["a1", "a2"],
        bonus: false,
        tackled: false,
        tacklerIds: [],
      },
    },
    100000,
    target,
  );
  expect(state.halfElapsedMs).toBe(40000);
  expect(state.points.home).toBe(2);
  const amendment = required(state.eventHistory.at(-1)).eventId;
  state = apply(
    state,
    "amend",
    { payload: { raiderId: "h1", touchedIds: [], bonus: false, tackled: false, tacklerIds: [] } },
    110000,
    amendment,
  );
  expect(state.points.home).toBe(0);
  state = apply(state, "void", {}, 120000, target);
  expect(state.nextRaidingSide).toBe("home");
  expect(state.halfElapsedMs).toBe(40000);
  let later = raid(setup(), ["a1"]);
  later = raid(later);
  expect(
    raidEngine.apply(later, event(later, "void", {}, 0, required(later.eventHistory[5]).eventId))
      .ok,
  ).toBe(false);
});
it("clock corrections recompute time and reject raids made invalid by corrected pauses", () => {
  let state = setup();
  const clock = required(state.eventHistory.at(-1)).eventId;
  state = raid(state, [], {}, 1000);
  expect(
    raidEngine.apply(state, event(state, "amend", { payload: { running: false } }, 10000, clock)),
  ).toMatchObject({ ok: false, reason: "amend_breaks_later_events" });
});
it("restart clears game state, attempt guards and terminal void are permanent", () => {
  let state = raid(setup(), ["a1"]);
  state = apply(state, "restart", { reason: "Replay" });
  expect(state.attempt).toBe(2);
  expect(state.points).toEqual({ home: 0, away: 0 });
  expect(state.format).toBeNull();
  state = apply(state, "match_voided", { reason: "Duplicate" });
  expect(state.phase).toBe("void");
  expect(raidEngine.deriveResult(state)).toBeNull();
  expect(raidEngine.apply(state, event(state, "restart", { reason: "Replay" })).ok).toBe(false);
});
it("strict squads/formats/half boundaries and closed private-free <=6KB public projection", () => {
  const state = setup();
  expect(engineFor("raid")).toBe(raidEngine);
  expect(replayMatch(raidEngine, state.eventHistory)).toEqual(state);
  for (const [type, payload] of [
    ["half_started", { half: 2 }],
    ["finish", {}],
    ["lineup_confirmed", { teamId: "home", players: squad("h"), startingMat: squad("h") }],
  ] as const)
    expect(raidEngine.apply(state, event(state, type, payload as never)).ok).toBe(false);
  const live = raidEngine.publicLiveState(state, { teams: {}, players: {} });
  const projection = publicLiveProjection({
    ...live,
    panel: { ...live.panel, email: "secret", points: { ...live.panel.points, phone: "secret" } },
  });
  expect(projection).toEqual(live);
  expect(JSON.stringify(projection)).not.toContain("secret");
  expect(JSON.stringify(live).length).toBeLessThanOrEqual(6144);
  expect(publicFamilyPanel(live, "delivery")).toBeNull();
  expect(
    publicFamilyPanel({ ...live, panel: { ...live.panel, matCount: { home: 8, away: 7 } } }),
  ).toBeNull();
});

it("strict preset and starting mat membership refuse fabricated squads and skipped halves", () => {
  const empty = raidEngine.initialState();
  expect(
    raidEngine.apply(
      empty,
      event(empty, "match_started", {
        format: { ...RAID_FORMAT_PRESETS.pkl_40, halfMinutes: 10 },
        conditions: {},
        homeTeamId: "home",
        awayTeamId: "away",
      }),
    ).ok,
  ).toBe(false);
  const started = apply(empty, "match_started", {
    format: RAID_FORMAT_PRESETS.kabaddi_30,
    conditions: {},
    homeTeamId: "home",
    awayTeamId: "away",
  });
  for (const startingMat of [
    squad("h").slice(0, 6),
    [...squad("h").slice(0, 6), "unknown"],
    [...squad("h").slice(0, 6), "h1"],
  ])
    expect(
      raidEngine.apply(
        started,
        event(started, "lineup_confirmed", { teamId: "home", players: squad("h"), startingMat }),
      ).ok,
    ).toBe(false);
  const home = apply(started, "lineup_confirmed", {
    teamId: "home",
    players: squad("h"),
    startingMat: squad("h"),
  });
  expect(
    raidEngine.apply(
      home,
      event(home, "lineup_confirmed", {
        teamId: "away",
        players: squad("h"),
        startingMat: squad("h"),
      }),
    ),
  ).toMatchObject({ ok: false, reason: "unknown_player" });
  expect(raidEngine.apply(home, event(home, "half_started", { half: 1 })).ok).toBe(false);
  const ready = apply(home, "lineup_confirmed", {
    teamId: "away",
    players: squad("a"),
    startingMat: squad("a"),
  });
  expect(raidEngine.apply(ready, event(ready, "half_started", { half: 2 })).ok).toBe(false);
});
it("incremental apply keeps caller immutable and agrees with replay after clock correction followed by play", () => {
  let state = setup();
  state = apply(state, "clock", { running: false }, 10000);
  const pause = required(state.eventHistory.at(-1)).eventId;
  state = apply(state, "conditions_changed", { conditions: {} }, 20000);
  state = apply(state, "amend", { payload: { running: true } }, 100000, pause);
  expect(state.halfElapsedMs).toBe(20000);
  const before = structuredClone(state);
  state = raid(state, ["a1"], {}, 110000);
  expect(before.points.home).toBe(0);
  expect(state.halfElapsedMs).toBe(110000);
  expect(raidEngine.replay(before.eventHistory)).toEqual(before);
  const duplicate = {
    ...event(state, "clock", { running: false }, 110000),
    eventId: required(state.eventHistory.at(-1)).eventId,
  };
  expect(raidEngine.apply(state, duplicate)).toMatchObject({ ok: false, reason: "duplicate" });
});
it("all-out bonus revives opposing sporting outs and does not appear in any player's raid points", () => {
  let state = raid(setup(), [], { tackled: true, tacklerIds: ["a1"] });
  state = raid(state);
  state = raid(state, squad("a"));
  expect(state.points).toEqual({ home: 9, away: 1 });
  expect(state.mat.home).toContain("h1");
  expect(
    Object.values(state.participants).reduce((sum, entry) => sum + entry.stats.raidPoints, 0),
  ).toBe(7);
});
