import { expect, it } from "vitest";
import { placementActivity, placementEngine } from "./engine";
import { lobbyFormat } from "./formats";
import { placementTable, topFragger, type PlacementState } from "./state";
import type { PlacementEventPayloads } from "./payloads";
import type { MatchEvent } from "../types";
import { publicLiveProjection } from "../delay";
import { buildStandings } from "../../standings";
function event<T extends keyof PlacementEventPayloads>(
  s: PlacementState,
  type: T,
  payload: PlacementEventPayloads[T],
  targetEventId: string | null = null,
): MatchEvent<T, PlacementEventPayloads[T]> {
  return {
    type,
    payload,
    targetEventId,
    eventId: `e${String(s.lastSeq + 1)}`,
    seq: s.lastSeq + 1,
    clientSeq: s.lastSeq + 1,
    attempt: s.attempt,
    v: 1,
    actorPersonId: "scorer",
    clientRecordedAt: new Date(100000 + s.lastSeq * 1000).toISOString(),
  };
}
function add<T extends keyof PlacementEventPayloads>(
  s: PlacementState,
  type: T,
  p: PlacementEventPayloads[T],
  target: string | null = null,
) {
  const before = structuredClone(s);
  const out = placementEngine.apply(s, event(s, type, p, target));
  expect(s).toEqual(before);
  if (!out.ok) throw new Error(out.reason);
  expect(placementEngine.replay(out.state.eventHistory)).toEqual(out.state);
  return out.state;
}
const points = { placement: [10, 6], perScore: { kills: 1 } };
function setup(rounds = 2) {
  let s = add(placementEngine.initialState(), "match_started", {
    format: lobbyFormat(rounds, points),
    conditions: {},
    teamIds: ["a", "b"],
  });
  s = add(s, "lineup_confirmed", { teamId: "a", players: ["a1", "a2"] });
  return add(s, "lineup_confirmed", { teamId: "b", players: ["b1", "b2"] });
}
function round(s: PlacementState, a = 7, b = 2, pa = 1, pb = 2) {
  return add(s, "lobby_round", {
    round: s.rounds.length + 1,
    rows: [
      { teamId: "a", placement: pa, kills: a, playerKills: { a1: a, a2: 0 } },
      { teamId: "b", placement: pb, kills: b, playerKills: { b1: b, b2: 0 } },
    ],
  });
}
it("multi-round points persist each round rather than a fictitious overall placement bonus", () => {
  let s = round(round(setup()));
  s = add(s, "finish", {});
  expect(placementTable(s)).toEqual([
    { teamId: "a", placement: 1, points: 34, kills: 14 },
    { teamId: "b", placement: 2, points: 16, kills: 4 },
  ]);
  expect(topFragger(s)).toBe("a1");
  expect(placementEngine.playerLines(s).get("a2")?.placement).toEqual({ kills: 0 });
});
it("aggregate kills may exceed typed single-round bounds; points ties share competition rank", () => {
  const s = add(round(round(setup(), 100, 100, 1, 1), 100, 100, 1, 1), "finish", {});
  expect(placementTable(s).map((x) => [x.placement, x.kills, x.points])).toEqual([
    [1, 200, 220],
    [1, 200, 220],
  ]);
  expect(topFragger(s)).toBe("a1");
});
it("rejects skipped rounds, partial rosters, missing zeroes, wrong attribution sums and excessive kills", () => {
  const s = setup();
  for (const payload of [
    { round: 2, rows: [] },
    { round: 1, rows: [{ teamId: "a", placement: 1, kills: 2, playerKills: { a1: 2 } }] },
    {
      round: 1,
      rows: [
        { teamId: "a", placement: 1, kills: 101, playerKills: { a1: 101, a2: 0 } },
        { teamId: "b", placement: 2, kills: 0, playerKills: { b1: 0, b2: 0 } },
      ],
    },
    {
      round: 1,
      rows: [
        { teamId: "a", placement: 1, kills: 2, playerKills: { a1: 1, a2: 0 } },
        { teamId: "b", placement: 2, kills: 0, playerKills: { b1: 0, b2: 0 } },
      ],
    },
  ])
    expect(placementEngine.apply(s, event(s, "lobby_round", payload)).ok).toBe(false);
  expect(placementEngine.apply(s, event(s, "finish", {})).ok).toBe(false);
});
it("corrections use original identities and refuse voids breaking later rounds; terminal corrections rebuild", () => {
  let s = round(round(setup()));
  const first = s.rounds[0];
  if (!first) throw new Error("fixture");
  expect(placementEngine.apply(s, event(s, "void", {}, first.eventId)).ok).toBe(false);
  s = add(s, "finish", {});
  s = add(
    s,
    "amend",
    {
      payload: {
        round: 1,
        rows: [
          { teamId: "a", placement: 2, kills: 1, playerKills: { a1: 1, a2: 0 } },
          { teamId: "b", placement: 1, kills: 20, playerKills: { b1: 20, b2: 0 } },
        ],
      },
    },
    first.eventId,
  );
  expect(topFragger(s)).toBe("b1");
  expect(s.rounds[0]?.clientRecordedAt).toBe(first.clientRecordedAt);
});
it("null pick for all-zero kills, team placement breaks player ties, abandoned/void publish no competitive result", () => {
  let s = add(round(setup(1), 0, 0), "finish", {});
  expect(topFragger(s)).toBeNull();
  s = add(round(setup(1), 5, 5, 2, 1), "finish", {});
  expect(topFragger(s)).toBe("b1");
  const abandoned = add(setup(), "abandon", { kind: "abandoned", reason: "Stopped" });
  expect(placementEngine.deriveResult(abandoned)?.placements).toEqual([]);
  expect(topFragger(abandoned)).toBeNull();
  const voided = add(s, "match_voided", { reason: "Wrong fixture" });
  expect(placementEngine.deriveResult(voided)).toBeNull();
});
it("restart clears old rounds and rejects duplicate identities and wrong attempts", () => {
  let s = round(setup());
  s = add(s, "restart", { reason: "Wrong setup" });
  expect(s.attempt).toBe(2);
  expect(s.rounds).toEqual([]);
  expect(s.format).toBeNull();
  expect(placementEngine.apply(s, { ...event(s, "resume", {}), attempt: 1 }).ok).toBe(false);
});
it("closed public multi-team projection strips private keys without fabricating home and away", () => {
  const s = round(setup());
  const live = placementEngine.publicLiveState(s, {
    teams: { a: { id: "a", name: "A", initials: "A" }, b: { id: "b", name: "B", initials: "B" } },
    players: {},
  });
  const projected = publicLiveProjection(
    { ...live, email: "private", panel: { ...live.panel, history: s.eventHistory } } as typeof live,
    "placement",
  );
  expect(projected).toEqual(live);
  expect(Array.isArray(projected?.teams)).toBe(true);
  expect(JSON.stringify(projected).length).toBeLessThan(6144);
  expect(publicLiveProjection(live, "delivery")).toBeNull();
});

it("scored standings count the fixture once and retain canonical round points while typed calculation stays unchanged", () => {
  const aggregate = placementTable(round(round(setup())));
  const rules = {
    points: { win: 0, tie: 0, loss: 0, noResult: 0 },
    scoreFields: ["kills"],
    tiebreakers: [],
    lobby: points,
  };
  const scored = buildStandings(
    ["a", "b"],
    [{ source: "scored", scoredPlacements: aggregate }],
    rules,
  );
  expect(scored.find((x) => x.teamId === "a")).toMatchObject({
    played: 1,
    won: 1,
    points: 34,
    scored: { kills: 14 },
  });
  const typed = buildStandings(
    ["a", "b"],
    [
      {
        placements: aggregate.map((x) => ({
          teamId: x.teamId,
          placement: x.placement,
          score: { kills: x.kills },
        })),
      },
    ],
    rules,
  );
  expect(typed.find((x) => x.teamId === "a")?.points).toBe(24);
});

it("complete accepted setup opens live polling without inventing a played round or activity", () => {
  const s = setup();
  expect(s.phase).toBe("live");
  expect(s.rounds).toEqual([]);
  expect(placementActivity(s)).toEqual([]);
  expect(placementEngine.deriveResult(s)).toBeNull();
  expect(topFragger(s)).toBeNull();
});
