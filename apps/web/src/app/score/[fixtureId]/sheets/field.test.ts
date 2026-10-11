import { describe, expect, it } from "vitest";
import {
  BATTING_HANDS,
  replayMatch,
  zoneAngle,
  type BallPayload,
  type EventPayloads,
} from "@desiauction/core/scoring";
import { fieldPoint, fieldZone } from "./field";
import { effectiveStyle, scoringActions, bowlerRows } from "./sheet-model";
import { legalWickets, wicketEntries } from "./wicket-sheet";
import { LocalMatch } from "../use-match";
import { startedHistory } from "../match-test-fixture";
const ball: BallPayload = {
  strikerId: "home-1",
  nonStrikerId: "home-2",
  bowlerId: "away-1",
  runsBat: 0,
  extras: {},
};
const player = {
  id: "home-1",
  name: "Player",
  photoUrl: null,
  isCaptain: false,
  keeper: false,
  style: "",
  battingHand: BATTING_HANDS[1],
};
const model = () => {
  const m = new LocalMatch(
    "fixture",
    "scorer",
    startedHistory(),
    () => Promise.resolve(),
    () => undefined,
  );
  m.restore([], "device");
  return m;
};
describe("scoring sheets", () => {
  it("maps clamped field taps and mirrors each labelled zone", () => {
    expect(fieldPoint(-10, 350, 300, 300)).toEqual({ x: 0, y: 1 });
    for (const hand of BATTING_HANDS)
      for (const zone of ["cover", "point", "mid_wicket", "fine_leg"] as const) {
        const angle = (zoneAngle(zone, hand) * Math.PI) / 180;
        expect(fieldZone(0.5 + Math.sin(angle) * 0.4, 0.5 - Math.cos(angle) * 0.4, hand)).toBe(
          zone,
        );
      }
  });
  it("requires explicit canonical styles despite known profiles and keeps persisted prompt dismissals", () => {
    const state = replayMatch(startedHistory());
    expect(effectiveStyle(state, player, player.id).battingHand).toBeNull();
    expect(
      scoringActions(state, [player], new Set())
        .filter((a) => a.kind === "ask_style")
        .map((a) => a.registrationId),
    ).toContain(player.id);
    state.styles[player.id] = { battingHand: BATTING_HANDS[0] };
    expect(effectiveStyle(state, player, player.id).battingHand).toBe(BATTING_HANDS[0]);
    expect(
      scoringActions(state, [], new Set(["home-2:battingHand"]))
        .filter((a) => a.kind === "ask_style")
        .map((a) => a.registrationId),
    ).not.toContain("home-2");
    expect(
      scoringActions(state, [], new Set()).some(
        (a) => a.kind === "ask_style" && a.registrationId === "home-2",
      ),
    ).toBe(true);
  });
  it("orders the suggested row first and explains every disabled row", () => {
    expect(
      bowlerRows({
        kind: "pick_bowler",
        allowed: ["a", "b"],
        suggestedId: "b",
        blocked: [
          { id: "c", reason: "consecutive" },
          { id: "d", reason: "quota" },
          { id: "e", reason: "subbed_out" },
        ],
      }),
    ).toEqual([
      { id: "b", reason: null },
      { id: "a", reason: null },
      { id: "c", reason: "Just bowled the last over" },
      { id: "d", reason: "Over quota used" },
      { id: "e", reason: "Substituted out" },
    ]);
  });
  it("filters no-ball and wide dismissals through the canonical fold", () => {
    const state = replayMatch(startedHistory());
    expect(legalWickets(state, { ...ball, extras: { noBall: true } })).toEqual([
      "run_out",
      "hit_twice",
      "obstructing",
    ]);
    expect(legalWickets(state, { ...ball, extras: { wides: 1 } })).toEqual([
      "stumped",
      "run_out",
      "hit_wicket",
      "obstructing",
    ]);
    // replay reads the original format, so use a matching canonical history.
    const history = startedHistory();
    const start = history[0];
    if (start?.type !== "match_started") throw new Error("Missing start");
    (start.payload as EventPayloads["match_started"]).format.lbw = false;
    expect(legalWickets(replayMatch(history), ball)).not.toContain("lbw");
    expect(legalWickets(state, ball, "home-2")).toEqual(["run_out", "obstructing", "timed_out"]);
    const m = model();
    m.apply("ball", { ...ball, extras: { noBall: true } });
    expect(legalWickets(m.view().state, ball)).toEqual(["run_out", "obstructing"]);
  });
  it("derives replacement after the wicket and omits it at all out", () => {
    const m = model();
    const entry = {
      type: "ball" as const,
      payload: {
        ...ball,
        wicket: { kind: "bowled" as const, playerOutId: ball.strikerId, fielderIds: [] },
      },
    };
    const entries = wicketEntries((e) => m.preview(e), entry, "home-3");
    expect(entries).toHaveLength(2);
    expect(m.applyBatch(entries)).toHaveLength(2);
    const inning = m.view().state.innings[0];
    if (!inning?.strikerId) throw new Error("Missing replacement");
    const final = {
      type: "ball" as const,
      payload: {
        ...ball,
        strikerId: inning.strikerId,
        nonStrikerId: inning.nonStrikerId,
        wicket: { kind: "bowled" as const, playerOutId: inning.strikerId, fielderIds: [] },
      },
    };
    expect(wicketEntries((e) => m.preview(e), final, "home-1")).toHaveLength(1);
  });
  it("does not rotate the recorded batter's captured shot hand", () => {
    const m = model();
    m.apply("style_set", { registrationId: ball.strikerId, battingHand: BATTING_HANDS[1] });
    const captured = effectiveStyle(m.view().state, player, ball.strikerId).battingHand;
    if (!captured) throw new Error("Missing hand");
    m.apply("ball", { ...ball, runsBat: 1 });
    expect(m.view().state.innings[0]?.strikerId).toBe("home-2");
    expect(captured).toBe(BATTING_HANDS[1]);
    expect(zoneAngle("cover", captured)).toBe(293);
  });
});
