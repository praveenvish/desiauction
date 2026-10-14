import { expect, it } from "vitest";
import { engineFor } from "../registry";
import { replayMatch } from "../replay";
import { publicLiveProjection } from "../delay";
import { ReplayError } from "../delivery/replay";
import { validatePayload as deliveryPayload } from "../delivery/validate";
import { RALLY_FORMAT_PRESETS, type RallyFormat } from "./formats";
import { rallyEngine } from "./engine";
import type { RallyEvent, RallyEventPayloads, RallyEventType, Side } from "./events";
import type { RallyState } from "./state";
function event<T extends RallyEventType>(
  state: RallyState,
  type: T,
  payload: RallyEventPayloads[T],
): RallyEvent<T> {
  return {
    type,
    payload,
    seq: state.lastSeq + 1,
    eventId: `event-${String(state.lastSeq + 1)}`,
    attempt: state.attempt,
    v: 1,
    targetEventId: null,
    actorPersonId: "scorer",
    clientSeq: state.lastSeq + 1,
    clientRecordedAt: "2026-10-10T12:00:00.000Z",
  };
}
function apply<T extends RallyEventType>(
  state: RallyState,
  type: T,
  payload: RallyEventPayloads[T],
): RallyState {
  const result = rallyEngine.apply(state, event(state, type, payload));
  if (!result.ok) throw new Error(`${type}: ${result.reason}`);
  return result.state;
}
function setup(format: RallyFormat = RALLY_FORMAT_PRESETS.badminton_bo3) {
  let state = apply(rallyEngine.initialState(), "match_started", {
    format,
    conditions: {},
    homeTeamId: "home",
    awayTeamId: "away",
  });
  state = apply(state, "lineup_confirmed", { teamId: "home", players: ["h1", "h2", "hs"] });
  state = apply(state, "lineup_confirmed", { teamId: "away", players: ["a1", "a2", "as"] });
  return apply(state, "rubber_started", {
    rubberNo: 1,
    homePlayers: ["h1", "h2"],
    awayPlayers: ["a1", "a2"],
    firstServer: "home",
  });
}
function game(state: RallyState) {
  const value = state.rubbers.at(-1)?.games.at(-1);
  if (!value) throw new Error("Missing game");
  return value;
}
function start(state: RallyState, rubberNo = state.rubbers.at(-1)?.no ?? 1) {
  const active = state.rubbers.at(-1)?.active;
  return apply(state, "rubber_started", {
    rubberNo,
    homePlayers: active?.home ?? ["h1", "h2"],
    awayPlayers: active?.away ?? ["a1", "a2"],
    firstServer: "home",
  });
}
function winGame(state: RallyState, side: Side): RallyState {
  while (!game(state).winner) state = apply(state, "rally", { winner: side });
  expect(rallyEngine.replay(state.eventHistory)).toEqual(state);
  return state;
}
it("RR-01 pickleball side-out switches serve without adding a point; rally variant scores every winner", () => {
  let state = setup(RALLY_FORMAT_PRESETS.pickleball_bo3);
  state = apply(state, "rally", { winner: "away" });
  expect(game(state)).toMatchObject({ server: "away", points: { home: 0, away: 0 } });
  state = apply(state, "rally", { winner: "home" });
  expect(game(state).points.home).toBe(0);
  state = apply(state, "rally", { winner: "home" });
  expect(game(state).points.home).toBe(1);
  expect(
    game(apply(setup(RALLY_FORMAT_PRESETS.pickleball_rally_bo3), "rally", { winner: "away" }))
      .points.away,
  ).toBe(1);
});
it("RR-02 badminton deuce continues to the 30-point cap even without a two-point lead", () => {
  let state = setup();
  for (let n = 0; n < 29; n++) {
    state = apply(state, "rally", { winner: "home" });
    state = apply(state, "rally", { winner: "away" });
  }
  expect(game(state).winner).toBeNull();
  state = apply(state, "rally", { winner: "home" });
  expect(game(state)).toMatchObject({ winner: "home", points: { home: 30, away: 29 } });
});
it("RR-04 TT serve changes every two points and every point at 10–10", () => {
  let state = setup(RALLY_FORMAT_PRESETS.tt_bo5);
  state = apply(state, "rally", { winner: "home" });
  expect(game(state).server).toBe("home");
  state = apply(state, "rally", { winner: "away" });
  expect(game(state).server).toBe("away");
  for (let n = 1; n < 10; n++) {
    state = apply(state, "rally", { winner: "home" });
    state = apply(state, "rally", { winner: "away" });
  }
  expect(game(state)).toMatchObject({ points: { home: 10, away: 10 }, server: "home" });
  state = apply(state, "rally", { winner: "home" });
  expect(game(state).server).toBe("away");
  expect(game(state).winner).toBeNull();
  state = apply(state, "rally", { winner: "home" });
  expect(game(state)).toMatchObject({
    server: "home",
    winner: "home",
    points: { home: 12, away: 10 },
  });
});
it("RR-02/RR-06 volleyball fifth set ends at 15 and records sets plus all actual points", () => {
  let state = setup(RALLY_FORMAT_PRESETS.volleyball_bo5);
  for (const side of ["home", "away", "home", "away", "home"] as const) {
    if (game(state).winner) state = start(state);
    state = winGame(state, side);
  }
  expect(game(state)).toMatchObject({ no: 5, points: { home: 15, away: 0 }, winner: "home" });
  expect(rallyEngine.scoreForResult(state)).toEqual({
    home: { sets: 3, points: 65 },
    away: { sets: 2, points: 50 },
  });
  expect(rallyEngine.deriveResult(state)).toMatchObject({
    outcome: "home_win",
    winnerTeamId: "home",
  });
});
it("RR-03/RR-06 a 5-rubber tie stops at 3–1 and records rubber and game totals", () => {
  let state = setup(RALLY_FORMAT_PRESETS.badminton_tie_5);
  for (const [index, side] of (["home", "away", "home", "home"] as const).entries()) {
    if (index > 0) state = start(state, index + 1);
    state = winGame(state, side);
    state = start(state);
    state = winGame(state, side);
  }
  expect(state.rubbers).toHaveLength(4);
  expect(rallyEngine.scoreForResult(state)).toEqual({
    home: { rubbers: 3, games: 6 },
    away: { rubbers: 1, games: 2 },
  });
  expect(rallyEngine.nextActions(state)).toMatchObject([{ kind: "finish" }]);
  expect(
    rallyEngine.apply(
      state,
      event(state, "rubber_started", {
        rubberNo: 5,
        homePlayers: ["h1"],
        awayPlayers: ["a1"],
        firstServer: "home",
      }),
    ).ok,
  ).toBe(false);
});
it("RR-05 explicit same-rubber continuation refuses duplicates, skipped rubbers and rallies after closure", () => {
  let state = setup();
  expect(
    rallyEngine.apply(
      state,
      event(state, "rubber_started", {
        rubberNo: 1,
        homePlayers: ["h1", "h2"],
        awayPlayers: ["a1", "a2"],
        firstServer: "away",
      }),
    ).ok,
  ).toBe(false);
  state = winGame(state, "home");
  expect(rallyEngine.apply(state, event(state, "rally", { winner: "away" }))).toMatchObject({
    ok: false,
    reason: "innings_over",
    detail: "This game is complete.",
  });
  expect(
    rallyEngine.apply(
      state,
      event(state, "rubber_started", {
        rubberNo: 2,
        homePlayers: ["h1", "h2"],
        awayPlayers: ["a1", "a2"],
        firstServer: "home",
      }),
    ).ok,
  ).toBe(false);
  state = start(state);
  expect(game(state).no).toBe(2);
  state = winGame(state, "home");
  state = apply(state, "finish", {});
  expect(rallyEngine.nextActions(state)).toEqual([]);
  expect(rallyEngine.apply(state, event(state, "rally", { winner: "home" }))).toMatchObject({
    ok: false,
    reason: "already_finished",
  });
});
it("canonical squads refuse unknown/cross-team players and missing squads", () => {
  const state = setup();
  expect(
    rallyEngine.apply(state, {
      ...event(state, "rally", { winner: "home" }),
      targetEventId: "other",
    }),
  ).toMatchObject({ ok: false, reason: "bad_payload" });
  expect(
    rallyEngine.apply(
      state,
      event(state, "rally", { winner: "home", playerId: "a1", endedBy: "ace" }),
    ),
  ).toMatchObject({ ok: false, reason: "unknown_player" });
  expect(
    rallyEngine.apply(state, event(state, "rally", { winner: "away", playerId: "unknown" })).ok,
  ).toBe(false);
  const empty = apply(rallyEngine.initialState(), "match_started", {
    format: RALLY_FORMAT_PRESETS.tt_bo5,
    conditions: {},
    homeTeamId: "home",
    awayTeamId: "away",
  });
  expect(
    rallyEngine.apply(
      empty,
      event(empty, "rubber_started", {
        rubberNo: 1,
        homePlayers: ["h1"],
        awayPlayers: ["a1"],
        firstServer: "home",
      }),
    ).ok,
  ).toBe(false);
  const first = apply(empty, "lineup_confirmed", { teamId: "home", players: ["h1"] });
  expect(
    rallyEngine.apply(first, event(first, "lineup_confirmed", { teamId: "away", players: ["h1"] }))
      .ok,
  ).toBe(false);
});
it("volleyball substitutions preserve active count and continue into the next game", () => {
  let state = setup(RALLY_FORMAT_PRESETS.volleyball_bo5);
  state = apply(state, "substitute", { side: "home", inId: "hs", outId: "h1" });
  expect(state.rubbers[0]?.active.home).toEqual(["hs", "h2"]);
  state = winGame(state, "home");
  state = start(state);
  expect(state.rubbers[0]?.active.home).toEqual(["hs", "h2"]);
  expect([...rallyEngine.playerLines(state).keys()].sort()).toEqual(["a1", "a2", "h1", "h2", "hs"]);
  expect(
    rallyEngine.apply(state, event(state, "substitute", { side: "home", inId: "as", outId: "hs" }))
      .ok,
  ).toBe(false);
  const badminton = setup();
  expect(
    rallyEngine.apply(
      badminton,
      event(badminton, "substitute", { side: "home", inId: "hs", outId: "h1" }),
    ).ok,
  ).toBe(false);
});
it("optional attribution records only actual winning/losing-side credit", () => {
  let state = setup();
  state = apply(state, "rally", { winner: "home" });
  expect(rallyEngine.playerLines(state).get("h1")?.rally?.ralliesWon).toBe(0);
  state = apply(state, "rally", { winner: "home", endedBy: "ace", playerId: "h1" });
  state = apply(state, "rally", { winner: "away", endedBy: "error", playerId: "h2" });
  expect(rallyEngine.playerLines(state).get("h1")?.rally).toMatchObject({ aces: 1, ralliesWon: 1 });
  expect(rallyEngine.playerLines(state).get("h2")?.rally).toMatchObject({
    errors: 1,
    ralliesWon: 0,
  });
});
it("effective correction chains preserve raw history and restart attempts; whole void is terminal", () => {
  let state = setup();
  state = apply(state, "rally", { winner: "home" });
  const target = state.eventHistory.at(-1);
  if (!target) throw new Error("Missing rally");
  const amendment = {
    ...event(state, "amend", { payload: { winner: "away" } }),
    targetEventId: target.eventId,
  };
  let changed = rallyEngine.apply(state, amendment);
  if (!changed.ok) throw new Error(changed.reason);
  state = changed.state;
  const chained = {
    ...event(state, "amend", { payload: { winner: "home" } }),
    targetEventId: amendment.eventId,
  };
  changed = rallyEngine.apply(state, chained);
  if (!changed.ok) throw new Error(changed.reason);
  state = changed.state;
  const removed = rallyEngine.apply(state, {
    ...event(state, "void", {}),
    targetEventId: target.eventId,
  });
  if (!removed.ok) throw new Error(removed.reason);
  state = removed.state;
  expect(game(state).points).toEqual({ home: 0, away: 0 });
  expect(state.eventHistory).toContainEqual(target);
  expect(replayMatch(engineFor("rally"), state.eventHistory)).toEqual(state);
  state = apply(state, "restart", { reason: "Replay" });
  expect(state).toMatchObject({ attempt: 2, rubbers: [], squads: {} });
  state = apply(state, "match_voided", { reason: "Duplicate" });
  expect(rallyEngine.deriveResult(state)).toBeNull();
  expect(() => rallyEngine.replay([...state.eventHistory, event(state, "finish", {})])).toThrow(
    ReplayError,
  );
});
it("rally public panel strips injected nested secrets, rejects malformed/mismatched panels and stays under 6KB", () => {
  const state = setup(),
    live = rallyEngine.publicLiveState(state, { teams: {}, players: {} });
  const polluted = {
    ...live,
    panel: {
      ...live.panel,
      email: "private",
      score: { home: { ...live.panel.score.home, phone: "private" }, away: live.panel.score.away },
    },
  };
  expect(publicLiveProjection(polluted, "rally")).toEqual(live);
  expect(publicLiveProjection(live, "delivery")).toBeNull();
  expect(
    publicLiveProjection({ ...live, panel: { ...live.panel, server: "private" } }, "rally"),
  ).toBeNull();
  expect(JSON.stringify(live).length).toBeLessThanOrEqual(6 * 1024);
  expect(deliveryPayload("lineup_confirmed", { teamId: "home", players: ["h1"] }).ok).toBe(false);
  expect(
    deliveryPayload("match_started", {
      format: RALLY_FORMAT_PRESETS.tt_bo5,
      conditions: {},
      homeTeamId: "home",
      awayTeamId: "away",
    }).ok,
  ).toBe(false);
});
it("RR-04 winner serves next; only known preset shapes and canonical squad IDs are accepted", () => {
  const state = setup();
  expect(game(apply(state, "rally", { winner: "away" })).server).toBe("away");
  const empty = rallyEngine.initialState();
  expect(
    rallyEngine.apply(
      empty,
      event(empty, "match_started", {
        format: { ...RALLY_FORMAT_PRESETS.tt_bo5, pointsToWin: 99 },
        conditions: {},
        homeTeamId: "home",
        awayTeamId: "away",
      }),
    ).ok,
  ).toBe(false);
  const started = apply(empty, "match_started", {
    format: RALLY_FORMAT_PRESETS.tt_bo5,
    conditions: {},
    homeTeamId: "home",
    awayTeamId: "away",
  });
  expect(
    rallyEngine.apply(
      started,
      event(started, "lineup_confirmed", { teamId: "home", players: ["h1", "h1"] }),
    ).ok,
  ).toBe(false);
  expect(
    rallyEngine.apply(started, event(started, "lineup_confirmed", { teamId: "home", players: [] }))
      .ok,
  ).toBe(false);
});
it("volleyball between-game substitution requires the actual current active roster on continuation", () => {
  let state = winGame(setup(RALLY_FORMAT_PRESETS.volleyball_bo5), "home");
  state = apply(state, "substitute", { side: "home", inId: "hs", outId: "h1" });
  expect(
    rallyEngine.apply(
      state,
      event(state, "rubber_started", {
        rubberNo: 1,
        homePlayers: ["h1", "h2"],
        awayPlayers: ["a1", "a2"],
        firstServer: "home",
      }),
    ).ok,
  ).toBe(false);
  state = start(state);
  expect(state.rubbers.at(-1)?.active.home).toEqual(["hs", "h2"]);
});
it("correction refuses a broken later game boundary and immutable competition metadata", () => {
  let state = winGame(setup(), "home");
  const winner = state.eventHistory.at(-1);
  if (!winner) throw new Error("Missing winner");
  state = start(state);
  expect(
    rallyEngine.apply(state, { ...event(state, "void", {}), targetEventId: winner.eventId }),
  ).toMatchObject({ ok: false, reason: "amend_breaks_later_events" });
  const original = state.eventHistory[0];
  if (!original || original.type !== "match_started") throw new Error("Missing start");
  const started = original.payload as RallyEventPayloads["match_started"];
  expect(
    rallyEngine.apply(state, {
      ...event(state, "amend", {
        payload: { ...started, competition: { name: "Other", season: "Other" } },
      }),
      targetEventId: original.eventId,
    }),
  ).toMatchObject({ ok: false, reason: "amend_type_mismatch" });
  expect(
    rallyEngine.apply(state, { ...event(state, "void", {}), targetEventId: "unknown" }),
  ).toMatchObject({ ok: false, reason: "unknown_target" });
});
it("shared interrupt/resume/abandon/walkover and post-restart canonical setup preserve honest results", () => {
  let state = setup();
  state = apply(state, "interrupt", { reason: "other" });
  expect(rallyEngine.apply(state, event(state, "rally", { winner: "home" }))).toMatchObject({
    ok: false,
    reason: "not_live",
  });
  state = apply(state, "resume", {});
  expect(
    rallyEngine.deriveResult(apply(state, "abandon", { kind: "no_result", reason: "Weather" })),
  ).toMatchObject({ outcome: "no_result", winnerTeamId: null });
  expect(
    rallyEngine.deriveResult(
      apply(state, "walkover", { winnerTeamId: "away", reason: "Conceded" }),
    ),
  ).toMatchObject({ outcome: "away_win", method: "walkover" });
  state = apply(state, "restart", { reason: "Replay" });
  const fresh = setup().eventHistory.map((entry, index) => ({
    ...entry,
    seq: state.lastSeq + index + 1,
    attempt: 2,
    eventId: `new-${String(index)}`,
  }));
  const resumed = replayMatch(engineFor("rally"), [...state.eventHistory, ...fresh]);
  expect(resumed).toMatchObject({
    attempt: 2,
    squads: { home: ["h1", "h2", "hs"], away: ["a1", "a2", "as"] },
  });
  expect(game(resumed).points).toEqual({ home: 0, away: 0 });
});

it("effective rally activity retains original timing through corrections and resets at restart", () => {
  let state = apply(setup(), "rally", { winner: "home", playerId: "h1", endedBy: "winner" });
  const original = state.eventHistory.at(-1);
  if (!original) throw new Error("Missing rally");
  const amended = rallyEngine.apply(state, {
    ...event(state, "amend", { payload: { winner: "away", playerId: "a1", endedBy: "winner" } }),
    clientRecordedAt: "2026-10-10T13:00:00.000Z",
    targetEventId: original.eventId,
  });
  if (!amended.ok) throw new Error(amended.reason);
  state = amended.state;
  expect(state.rallies).toEqual([
    {
      eventId: original.eventId,
      seq: original.seq,
      clientRecordedAt: original.clientRecordedAt,
      winner: "away",
      playerId: "a1",
      endedBy: "winner",
    },
  ]);
  const undone = rallyEngine.apply(state, {
    ...event(state, "void", {}),
    targetEventId: original.eventId,
  });
  if (!undone.ok) throw new Error(undone.reason);
  expect(undone.state.rallies).toEqual([]);
  state = apply(state, "restart", { reason: "Replay" });
  expect(state.rallies).toEqual([]);
  expect(state.participants).toEqual({});
  expect(state.eventHistory.some((row) => row.eventId === original.eventId)).toBe(true);
});
