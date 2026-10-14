import { describe, expect, it } from "vitest";
import {
  battingFirst,
  movePlayer,
  prefillLineup,
  scoringEventId,
  validLineup,
  type SetupTeam,
} from "./setup-model";
const team: SetupTeam = {
  id: "home",
  name: "Home",
  selectedIds: [],
  players: [
    { id: "a", name: "A", photoUrl: null, isCaptain: false, keeper: false, style: "" },
    { id: "b", name: "B", photoUrl: null, isCaptain: true, keeper: false, style: "" },
    { id: "c", name: "C", photoUrl: null, isCaptain: false, keeper: true, style: "" },
  ],
};
describe("match setup prefill", () => {
  it("uses approved squad order and its captain/keeper when no XI is picked", () => {
    expect(prefillLineup(team, 11)).toEqual({
      teamId: "home",
      battingOrder: ["a", "b", "c"],
      captainId: "b",
      keeperId: "c",
      substitutes: [],
    });
    expect(prefillLineup(team, 2)).toMatchObject({
      battingOrder: ["a", "b"],
      captainId: "b",
      keeperId: "a",
    });
  });
  it("prefers the fixture XI and removes stale or duplicate registrations", () => {
    expect(prefillLineup({ ...team, selectedIds: ["c", "missing", "a", "c"] }, 11)).toMatchObject({
      battingOrder: ["c", "a"],
      captainId: "c",
      keeperId: "c",
    });
  });
  it("moves a player without mutating selection and refuses invalid captain/substitute choices", () => {
    const lineup = prefillLineup(team, 11);
    expect(movePlayer(lineup.battingOrder, "c", -2)).toEqual(["c", "a", "b"]);
    expect(lineup.battingOrder).toEqual(["a", "b", "c"]);
    expect(movePlayer(lineup.battingOrder, "a", -1)).toEqual(lineup.battingOrder);
    expect(validLineup(lineup, 11)).toBe(true);
    expect(validLineup({ ...lineup, captainId: "missing" }, 11)).toBe(false);
    expect(validLineup({ ...lineup, substitutes: ["b"] }, 11)).toBe(false);
    expect(validLineup({ ...lineup, battingOrder: ["a", "a"] }, 11)).toBe(false);
  });
  it("derives batting first from both toss decisions and rejects another team", () => {
    expect(battingFirst("home", "away", "away", "bowl")).toBe("home");
    expect(battingFirst("home", "away", "away", "bat")).toBe("away");
    expect(battingFirst("home", "away", "other", "bat")).toBeNull();
  });
  it("mints compatible event IDs with independent retry identities", () => {
    const a = scoringEventId(1791520000000),
      b = scoringEventId(1791520000000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
    expect(a).not.toBe(b);
  });
});
