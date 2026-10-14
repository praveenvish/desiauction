import { PlacementLocalMatch } from "./use-placement-match";
import { lobbyFormat } from "@desiauction/core/scoring";
import { TimedLocalMatch } from "./use-timed-match";
import { TIMED_FORMAT_PRESETS, timedEngine } from "@desiauction/core/scoring";
import { describe, expect, it } from "vitest";
import {
  RALLY_FORMAT_PRESETS,
  RAID_FORMAT_PRESETS,
  raidEngine,
  rallyEngine,
  replayMatch,
  type MatchEvent,
} from "@desiauction/core/scoring";
import { RaidLocalMatch } from "./use-raid-match";
import { RallyLocalMatch } from "./use-rally-match";
import { LocalMatch, type MatchView } from "./use-match";
import type { QueueItem } from "./queue";

import { startedHistory } from "./match-test-fixture";
const ball = {
  bowlerId: "away-1",
  strikerId: "home-1",
  nonStrikerId: "home-2",
  runsBat: 4,
  boundary: 4 as const,
  extras: {},
};
describe("local scoring queue", () => {
  it("publishes a local fold before storage resolves and preserves offline balls across refresh", async () => {
    let release: () => void = () => undefined;
    const storage = new Promise<void>((resolve) => {
      release = resolve;
    });
    let shown: MatchView | undefined,
      saved: readonly QueueItem[] = [];
    const model = new LocalMatch(
      "fixture",
      "scorer",
      startedHistory(),
      (items) => {
        saved = items;
        return storage;
      },
      (view) => {
        shown = view;
      },
    );
    model.restore([], "device");
    model.offline = true;
    const id = model.apply("ball", ball);
    expect(id).toBeTruthy();
    expect(shown?.state.innings[0]?.runs).toBe(4);
    expect(shown?.pending).toBe(1);
    const restored = new LocalMatch(
      "fixture",
      "scorer",
      startedHistory(),
      () => Promise.resolve(),
      () => undefined,
    );
    restored.restore([...saved], "device");
    expect(restored.view().state.innings[0]?.runs).toBe(4);
    release();
    await storage;
  });
  it("server rejection rolls back the delivery and displays the exact message", async () => {
    const model = new LocalMatch(
      "fixture",
      "scorer",
      startedHistory(),
      () => Promise.resolve(),
      () => undefined,
    );
    model.restore([], "device");
    const id = model.apply("ball", ball);
    if (!id) throw new Error("Expected delivery");
    await model.received({
      events: startedHistory(),
      attempt: 1,
      lastSeq: 5,
      acks: [
        {
          eventId: id,
          seq: null,
          status: "rejected",
          reason: "not_live",
          message: "The match isn't being scored right now.",
        },
      ],
    });
    expect(model.view()).toMatchObject({
      pending: 0,
      error: "The match isn't being scored right now.",
    });
    expect(model.view().state.innings[0]?.runs).toBe(0);
  });
  it("drops an unsent own ball, but records a void once transmission began", async () => {
    const model = new LocalMatch(
      "fixture",
      "scorer",
      startedHistory(),
      () => Promise.resolve(),
      () => undefined,
    );
    model.restore([], "device");
    const first = model.apply("ball", ball);
    expect(model.undo(first ?? undefined)).toBe(true);
    expect(model.items).toHaveLength(0);
    const second = model.apply("ball", ball);
    await model.batch();
    expect(model.undo(second ?? undefined)).toBe(true);
    expect(model.items.map((i) => i.event.type)).toEqual(["ball", "void"]);
    expect(model.view().state.innings[0]?.runs).toBe(0);
  });
  it("merges server sequence acknowledgements while keeping newer local taps", async () => {
    const model = new LocalMatch(
      "fixture",
      "scorer",
      startedHistory(),
      () => Promise.resolve(),
      () => undefined,
    );
    model.restore([], "device");
    const first = model.apply("ball", ball);
    const sent = await model.batch();
    model.apply("ball", {
      bowlerId: ball.bowlerId,
      strikerId: ball.strikerId,
      nonStrikerId: ball.nonStrikerId,
      runsBat: 2,
      extras: {},
    });
    if (!sent?.items[0] || !first) throw new Error("Expected batch");
    const history = [...startedHistory(), { ...sent.items[0].event, seq: 6 }];
    await model.received({
      events: history,
      attempt: 1,
      lastSeq: 6,
      acks: [{ eventId: first, seq: 6, status: "stored" }],
    });
    expect(model.items).toHaveLength(1);
    expect(model.view().state.innings[0]?.runs).toBe(6);
    expect(replayMatch(model.events()).lastSeq).toBe(7);
  });
  it("removes later invalid dependent balls when a prior accepted-looking ball is refused", async () => {
    const model = new LocalMatch(
      "fixture",
      "scorer",
      startedHistory(),
      () => Promise.resolve(),
      () => undefined,
    );
    model.restore([], "device");
    const first = model.apply("ball", {
      bowlerId: ball.bowlerId,
      strikerId: ball.strikerId,
      nonStrikerId: ball.nonStrikerId,
      runsBat: 1,
      extras: {},
    });
    model.apply("ball", { ...ball, strikerId: "home-2", nonStrikerId: "home-1" });
    if (!first) throw new Error("Expected first ball");
    await model.received({
      events: startedHistory(),
      attempt: 1,
      lastSeq: 5,
      acks: [{ eventId: first, seq: null, status: "rejected", reason: "not_live" }],
    });
    expect(model.items).toHaveLength(0);
    expect(model.view().state.innings[0]?.runs).toBe(0);
  });
  it("rolls back a whole-batch HTTP refusal while preserving transient failures", () => {
    const model = new LocalMatch(
      "fixture",
      "scorer",
      startedHistory(),
      () => Promise.resolve(),
      () => undefined,
    );
    model.restore([], "device");
    const id = model.apply("ball", ball);
    if (!id) throw new Error("Expected ball");
    model.failed("No signal", false, []);
    expect(model.view().state.innings[0]?.runs).toBe(4);
    model.failed("This phone cannot send scoring entries.", true, [id]);
    expect(model.view().state.innings[0]?.runs).toBe(0);
    expect(model.view().pending).toBe(0);
    expect(model.view().error).toBe("This phone cannot send scoring entries.");
  });
});

describe("grouped scoring operations", () => {
  const wicket = {
    bowlerId: ball.bowlerId,
    strikerId: ball.strikerId,
    nonStrikerId: ball.nonStrikerId,
    extras: {},
    runsBat: 0,
    wicket: { kind: "bowled" as const, playerOutId: "home-1", fielderIds: [] },
  };
  function model(changed: (view: MatchView) => void = () => undefined) {
    const result = new LocalMatch(
      "fixture",
      "scorer",
      startedHistory(),
      () => Promise.resolve(),
      changed,
    );
    result.restore([], "device");
    return result;
  }
  function delivery() {
    return { type: "ball" as const, payload: wicket };
  }
  it("rejects an invalid second entry without publishing the first or persisting a partial group", () => {
    const m = model();
    expect(
      m.applyBatch([
        delivery(),
        { type: "new_batter", payload: { registrationId: "away-3", end: "striker" } },
      ]),
    ).toBeNull();
    expect(m.items).toHaveLength(0);
    expect(m.view().state.innings[0]?.wickets).toBe(0);
    expect(m.apply("ball", ball)).toBeTruthy();
    expect(m.items[0]?.event.clientSeq).toBe(6);
  });
  it("publishes the complete group once and restores its order", async () => {
    const views: MatchView[] = [];
    const m = model((view) => views.push(view));
    views.length = 0;
    expect(
      m.applyBatch([
        delivery(),
        { type: "new_batter", payload: { registrationId: "home-3", end: "striker" } },
      ]),
    ).toHaveLength(2);
    expect(views).toHaveLength(1);
    const copy = model();
    copy.restore(m.items, "device");
    const batch = await copy.batch();
    expect(batch?.items.map((item) => [item.event.type, item.groupOrder])).toEqual([
      ["ball", 0],
      ["new_batter", 1],
    ]);
    expect(batch?.items[0]?.groupId).toBe(batch?.items[1]?.groupId);
    expect(copy.view().state.innings[0]?.strikerId).toBe("home-3");
  });
  it("retains an accepted wicket after the replacement is refused", async () => {
    const m = model();
    const ids = m.applyBatch([
      delivery(),
      { type: "new_batter", payload: { registrationId: "home-3", end: "striker" } },
    ]);
    const sent = await m.batch();
    if (!ids?.[0] || !ids[1] || !sent?.items[0]) throw new Error("Missing group");
    await m.received({
      events: [...startedHistory(), { ...sent.items[0].event, seq: 6 }],
      attempt: 1,
      lastSeq: 6,
      acks: [
        { eventId: ids[0], seq: 6, status: "stored" },
        { eventId: ids[1], seq: null, status: "rejected", reason: "unknown_player" },
      ],
    });
    expect(m.items).toHaveLength(0);
    expect(m.view().state.innings[0]).toMatchObject({ wickets: 1, strikerId: null });
    expect(m.view().error).toBeTruthy();
  });
});

describe("explicit takeover canonical resume", () => {
  it("keeps unsent deliveries unchanged and refuses to rebase them", () => {
    const model = new LocalMatch(
      "fixture",
      "scorer",
      startedHistory(),
      () => Promise.resolve(),
      () => undefined,
    );
    model.restore([], "device");
    const id = model.apply("ball", ball);
    const saved = structuredClone(model.items);
    expect(() => {
      model.resumeAfterTakeover(startedHistory());
    }).toThrow("Send or review saved balls");
    expect(model.items).toEqual(saved);
    expect(model.items[0]?.event.eventId).toBe(id);
  });
  it("uses accepted actor sequence and canonical history before enabling subsequent scoring", () => {
    const model = new LocalMatch(
      "fixture",
      "scorer",
      startedHistory(),
      () => Promise.resolve(),
      () => undefined,
    );
    model.restore([], "device");
    const other = new LocalMatch(
      "fixture",
      "scorer",
      startedHistory(),
      () => Promise.resolve(),
      () => undefined,
    );
    other.restore([], "other-device");
    other.apply("ball", ball);
    model.ready = false;
    expect(model.apply("ball", ball)).toBeNull();
    model.resumeAfterTakeover(other.events());
    expect(model.view().state.innings[0]?.runs).toBe(4);
    expect(model.apply("ball", ball)).toBeTruthy();
    expect(model.items[0]?.event.clientSeq).toBe((other.events().at(-1)?.clientSeq ?? 0) + 1);
    expect(model.events().filter((event) => event.type === "ball")).toHaveLength(2);
  });
});

it("rally queue uses canonical family replay, durable identities, refresh and own-rally undo", async () => {
  const payloads: { type: MatchEvent["type"]; payload: unknown }[] = [
    {
      type: "match_started",
      payload: {
        format: RALLY_FORMAT_PRESETS.badminton_bo3,
        conditions: {},
        homeTeamId: "home",
        awayTeamId: "away",
      },
    },
    { type: "lineup_confirmed", payload: { teamId: "home", players: ["h"] } },
    { type: "lineup_confirmed", payload: { teamId: "away", players: ["a"] } },
    {
      type: "rubber_started",
      payload: { rubberNo: 1, homePlayers: ["h"], awayPlayers: ["a"], firstServer: "home" },
    },
  ];
  const history = payloads.map(
    (entry, index) =>
      ({
        ...entry,
        eventId: `rally-setup-${String(index)}`,
        seq: index + 1,
        clientSeq: index + 1,
        v: 1,
        attempt: 1,
        actorPersonId: "scorer",
        targetEventId: null,
        clientRecordedAt: "2026-10-10T12:00:00Z",
      }) as MatchEvent,
  );
  let saved: readonly QueueItem[] = [];
  const model = new RallyLocalMatch(
    "fixture",
    "scorer",
    history,
    (items) => {
      saved = structuredClone(items);
      return Promise.resolve();
    },
    () => undefined,
  );
  model.restore([], "device");
  const ids = model.applyBatch([{ type: "rally", payload: { winner: "home" } }]);
  expect(model.view().state.rallies[0]?.eventId).toBe(ids?.[0]);
  expect(model.view().state.rubbers[0]?.games[0]?.points.home).toBe(1);
  await model.whenDurable();
  const restored = new RallyLocalMatch(
    "fixture",
    "scorer",
    history,
    () => Promise.resolve(),
    () => undefined,
  );
  restored.restore([...saved], "device");
  expect(restored.view().state).toEqual(model.view().state);
  expect(restored.undo()).toBe(true);
  expect(restored.view().state.rallies).toEqual([]);
  const accepted = model.events();
  await model.received({
    acks: [{ eventId: ids?.[0] ?? "", seq: 5, status: "stored" }],
    events: accepted,
    attempt: 1,
    lastSeq: 5,
  });
  expect(model.undo()).toBe(true);
  expect(model.items[0]?.event).toMatchObject({ type: "void", targetEventId: ids?.[0] });
  expect(model.view().state.rallies).toEqual([]);
  expect(rallyEngine.replay(accepted).rallies).toHaveLength(1);
});

it("C51 raid offline queue restores durable original identity and accepts own-family undo", async () => {
  const home = Array.from({ length: 7 }, (_, i) => `h${String(i)}`),
    away = Array.from({ length: 7 }, (_, i) => `a${String(i)}`);
  const payloads: { type: MatchEvent["type"]; payload: unknown }[] = [
    {
      type: "match_started",
      payload: {
        format: RAID_FORMAT_PRESETS.pkl_40,
        conditions: {},
        homeTeamId: "home",
        awayTeamId: "away",
      },
    },
    { type: "lineup_confirmed", payload: { teamId: "home", players: home, startingMat: home } },
    { type: "lineup_confirmed", payload: { teamId: "away", players: away, startingMat: away } },
    { type: "half_started", payload: { half: 1 } },
    { type: "clock", payload: { running: true } },
  ];
  const history = payloads.map(
    (entry, index) =>
      ({
        ...entry,
        eventId: `raid-setup-${String(index)}`,
        seq: index + 1,
        clientSeq: index + 1,
        v: 1,
        attempt: 1,
        actorPersonId: "scorer",
        targetEventId: null,
        clientRecordedAt: new Date(Date.now() - 1000).toISOString(),
      }) as MatchEvent,
  );
  let saved: readonly QueueItem[] = [];
  const model = new RaidLocalMatch(
    "fixture",
    "scorer",
    history,
    (items) => {
      saved = structuredClone(items);
      return Promise.resolve();
    },
    () => undefined,
  );
  model.restore([], "device");
  model.offline = true;
  const raiderId = home[0],
    defenderId = away[0];
  if (!raiderId || !defenderId) throw new Error("Missing raid test players");
  const ids = model.applyBatch([
    {
      type: "raid",
      payload: {
        raiderId,
        touchedIds: [defenderId],
        bonus: false,
        tackled: false,
        tacklerIds: [],
      },
    },
  ]);
  expect(model.view().state.points.home).toBe(1);
  await model.whenDurable();
  const restored = new RaidLocalMatch(
    "fixture",
    "scorer",
    history,
    () => Promise.resolve(),
    () => undefined,
  );
  restored.restore([...saved], "device");
  expect(restored.view().state).toEqual(model.view().state);
  expect(restored.view().state.raids[0]?.eventId).toBe(ids?.[0]);
  expect(restored.undo()).toBe(true);
  expect(restored.view().state.points.home).toBe(0);
  const accepted = model.events();
  await model.received({
    acks: [{ eventId: ids?.[0] ?? "", seq: 6, status: "stored" }],
    events: accepted,
    attempt: 1,
    lastSeq: 6,
  });
  expect(model.undo()).toBe(true);
  expect(model.items[0]?.event).toMatchObject({ type: "void", targetEventId: ids?.[0] });
  expect(model.view().state.raids).toEqual([]);
  expect(raidEngine.replay(accepted).points.home).toBe(1);
});

it("C53 timed offline queue restores durable original identity and accepts own-family undo", async () => {
  const home = Array.from({ length: 7 }, (_, i) => `h${String(i)}`),
    away = Array.from({ length: 7 }, (_, i) => `a${String(i)}`);
  const payloads: { type: MatchEvent["type"]; payload: unknown }[] = [
    {
      type: "match_started",
      payload: {
        format: TIMED_FORMAT_PRESETS.football_90,
        conditions: {},
        homeTeamId: "home",
        awayTeamId: "away",
      },
    },
    { type: "lineup_confirmed", payload: { teamId: "home", players: home, startingActive: home } },
    { type: "lineup_confirmed", payload: { teamId: "away", players: away, startingActive: away } },
    { type: "period_started", payload: { period: 1 } },
    { type: "clock", payload: { running: true } },
  ];
  const history = payloads.map(
    (entry, index) =>
      ({
        ...entry,
        eventId: `raid-setup-${String(index)}`,
        seq: index + 1,
        clientSeq: index + 1,
        v: 1,
        attempt: 1,
        actorPersonId: "scorer",
        targetEventId: null,
        clientRecordedAt: new Date(Date.now() - 1000).toISOString(),
      }) as MatchEvent,
  );
  let saved: readonly QueueItem[] = [];
  const model = new TimedLocalMatch(
    "fixture",
    "scorer",
    history,
    (items) => {
      saved = structuredClone(items);
      return Promise.resolve();
    },
    () => undefined,
  );
  model.restore([], "device");
  model.offline = true;
  const raiderId = home[0],
    defenderId = away[0];
  if (!raiderId || !defenderId) throw new Error("Missing raid test players");
  const ids = model.applyBatch([
    {
      type: "score",
      payload: {
        teamId: "home",
        points: 1,
        scorerId: raiderId,
      },
    },
  ]);
  expect(model.view().state.points.home).toBe(1);
  await model.whenDurable();
  const restored = new TimedLocalMatch(
    "fixture",
    "scorer",
    history,
    () => Promise.resolve(),
    () => undefined,
  );
  restored.restore([...saved], "device");
  expect(restored.view().state).toEqual(model.view().state);
  expect(restored.view().state.timeline[0]?.seq).toBe(6);
  expect(restored.undo()).toBe(true);
  expect(restored.view().state.points.home).toBe(0);
  const accepted = model.events();
  await model.received({
    acks: [{ eventId: ids?.[0] ?? "", seq: 6, status: "stored" }],
    events: accepted,
    attempt: 1,
    lastSeq: 6,
  });
  expect(model.undo()).toBe(true);
  expect(model.items[0]?.event).toMatchObject({ type: "void", targetEventId: ids?.[0] });
  expect(model.view().state.timeline).toEqual([]);
  expect(timedEngine.replay(accepted).points.home).toBe(1);
});

it("C54 durable lobby queue restores original round identity and accepted undo targets the original receipt", async () => {
  const payloads = [
    {
      type: "match_started",
      payload: {
        format: lobbyFormat(2, { placement: [10, 6], perScore: { kills: 1 } }),
        conditions: {},
        teamIds: ["a", "b"],
      },
    },
    { type: "lineup_confirmed", payload: { teamId: "a", players: ["a1"] } },
    { type: "lineup_confirmed", payload: { teamId: "b", players: ["b1"] } },
  ];
  const history = payloads.map(
    (entry, index) =>
      ({
        ...entry,
        eventId: `lobby-${String(index)}`,
        seq: index + 1,
        clientSeq: index + 1,
        v: 1,
        attempt: 1,
        actorPersonId: "scorer",
        targetEventId: null,
        clientRecordedAt: new Date(Date.now() - 1000).toISOString(),
      }) as MatchEvent,
  );
  let saved: readonly QueueItem[] = [];
  const model = new PlacementLocalMatch(
    "fixture",
    "scorer",
    history,
    (items) => {
      saved = structuredClone(items);
      return Promise.resolve();
    },
    () => undefined,
  );
  model.restore([], "device");
  model.offline = true;
  const ids = model.applyBatch([
    {
      type: "lobby_round",
      payload: {
        round: 1,
        rows: [
          { teamId: "a", placement: 1, kills: 7, playerKills: { a1: 7 } },
          { teamId: "b", placement: 2, kills: 2, playerKills: { b1: 2 } },
        ],
      },
    },
  ]);
  await model.whenDurable();
  const restored = new PlacementLocalMatch(
    "fixture",
    "scorer",
    history,
    () => Promise.resolve(),
    () => undefined,
  );
  restored.restore([...saved], "device");
  expect(restored.view().state).toEqual(model.view().state);
  expect(restored.undo()).toBe(true);
  expect(restored.view().state.rounds).toEqual([]);
  const accepted = model.events();
  await model.received({
    acks: [{ eventId: ids?.[0] ?? "", seq: 4, status: "stored" }],
    events: accepted,
    attempt: 1,
    lastSeq: 4,
  });
  expect(model.undo()).toBe(true);
  expect(model.items[0]?.event).toMatchObject({ type: "void", targetEventId: ids?.[0] });
});
