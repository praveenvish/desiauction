import { expect, it } from "vitest";
import { SPORTS } from "../sports";
import { FORMAT_PRESETS } from "./formats";
import { engineFor } from "./registry";
import { replayMatch, replayDelivery } from "./replay";
import { replayMatch as legacyReplay } from "./delivery/replay";
import { publicLiveProjection } from "./delay";
import { publicFamilyPanel } from "./panels";
import type { EventType, MatchEvent, PayloadOf } from "./types";

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
    eventId: `event-${String(seq)}`,
    v: 1,
    targetEventId: null,
    actorPersonId: "scorer",
    clientSeq: seq,
    clientRecordedAt: "2026-10-10T12:00:00.000Z",
  };
}
function setup(): MatchEvent[] {
  return [
    event(
      "match_started",
      { format: FORMAT_PRESETS.t20, conditions: {}, homeTeamId: "home", awayTeamId: "away" },
      1,
    ),
    ...["home", "away"].map((teamId, index) =>
      event(
        "lineup_confirmed",
        {
          teamId,
          battingOrder: [`${teamId}1`, `${teamId}2`],
          captainId: `${teamId}1`,
          keeperId: `${teamId}2`,
          substitutes: [],
        },
        index + 2,
      ),
    ),
    event("toss", { winnerTeamId: "home", decision: "bat" }, 4),
    event(
      "innings_started",
      {
        inningsNo: 1,
        battingTeamId: "home",
        strikerId: "home1",
        nonStrikerId: "home2",
        bowlerId: "away1",
      },
      5,
    ),
  ];
}
it("A-C47-01 every currently scoring pack resolves a real engine; unavailable families refuse", () => {
  for (const pack of SPORTS)
    if (pack.scoring) expect(engineFor(pack.scoring.family)).not.toBeNull();
  for (const family of ["unknown"]) expect(engineFor(family)).toBeNull();
});
it("A-C47-02 all replay entry points preserve correction chains, restart and terminal void", () => {
  const ball = event(
    "ball",
    { strikerId: "home1", nonStrikerId: "home2", bowlerId: "away1", runsBat: 0, extras: {} },
    6,
  );
  const amended = {
    ...event("amend", { payload: { ...ball.payload, runsBat: 4, boundary: 4 } }, 7),
    targetEventId: ball.eventId,
  };
  const chained = {
    ...event("amend", { payload: { ...ball.payload, runsBat: 6, boundary: 6 } }, 8),
    targetEventId: amended.eventId,
  };
  const correction = { ...event("void", {}, 9), targetEventId: ball.eventId };
  const original = [...setup(), ball, amended, chained, correction];
  const restart = event("restart", { reason: "Replay" }, 10);
  const fresh = setup().map((entry, index) => ({
    ...entry,
    seq: index + 11,
    attempt: 2,
    eventId: `new-${String(index)}`,
  }));
  const restarted = [...original, restart, ...fresh];
  for (const history of [
    [],
    setup(),
    original.slice(0, 8),
    original,
    restarted,
    [...restarted, event("match_voided", { reason: "Duplicate match" }, 16, 2)],
  ]) {
    const expected = legacyReplay(history);
    expect(replayMatch(history)).toEqual(expected);
    expect(replayMatch(engineFor("delivery"), history)).toEqual(expected);
    expect(replayDelivery(history)).toEqual(expected);
  }
});
it("closed versioned public panel strips unknown fields and fails closed on explicit mismatches", () => {
  const engine = engineFor("delivery");
  const live = engine.publicLiveState(replayDelivery(setup()), { teams: {}, players: {} });
  expect(live).toMatchObject({ family: "delivery", panel: { v: 1 } });
  expect(publicLiveProjection({ ...live, panel: { v: 1, email: "private@example.test" } })).toEqual(
    live,
  );
  expect(JSON.stringify(live).length).toBeLessThanOrEqual(6 * 1024);
  for (const raw of [
    { ...live, family: "rally" },
    { ...live, panel: {} },
    { ...live, panel: null },
    { ...live, panel: { v: 2 } },
  ])
    expect(publicFamilyPanel(raw, "delivery")).toBeNull();
  expect(publicFamilyPanel(live, "rally")).toBeNull();
  const legacy = { ...live } as Partial<typeof live>;
  delete legacy.family;
  delete legacy.panel;
  expect(publicFamilyPanel(legacy)).toBeNull();
  expect(publicFamilyPanel(legacy, "delivery")).toEqual({ family: "delivery", panel: { v: 1 } });
  expect(publicFamilyPanel({ ...legacy, family: "delivery" }, "delivery")).toBeNull();
});
