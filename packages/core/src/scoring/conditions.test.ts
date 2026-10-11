import { describe, expect, it } from "vitest";
import { conditionsLine, defaultConditions, type ConditionsGround } from "./conditions";

const ground: ConditionsGround = { indoor: false, floodlights: true, surface: "turf" };

describe("F-2 conditions", () => {
  it.each([
    ["14:59", true, "day"],
    ["15:00", true, "day_night"],
    ["17:59", true, "day_night"],
    ["15:00", false, "day"],
    ["18:00", false, "night"],
    ["23:59", true, "night"],
    ["00:00", true, "day"],
    ["invalid", true, "day"],
  ] as const)("defaults %s with floodlights %s to %s", (time, floodlights, expected) => {
    expect(defaultConditions({ ...ground, floodlights }, time, {}).timeOfDay).toBe(expected);
  });

  it.each([
    ["turf", "turf"],
    ["matting", "matting"],
    ["astroturf", "astroturf"],
    ["concrete", "cement"],
    ["other", undefined],
  ] as const)("maps %s to %s", (surface, expected) => {
    expect(defaultConditions({ ...ground, surface }, "12:00", {}).pitch).toBe(expected);
  });

  it("uses indoor and season ball defaults without mutating the season", () => {
    const ball = { type: "leather", colour: "white" } as const;
    const conditions = defaultConditions({ ...ground, indoor: true }, "18:00", { ball });
    expect(conditions).toEqual({ timeOfDay: "night", ground: "indoor", pitch: "turf", ball });
    expect(conditions.ball).not.toBe(ball);
    expect(defaultConditions(null, null, {})).toEqual({ timeOfDay: "day", ground: "full" });
  });

  it("renders the exact example and omits unknown components", () => {
    expect(
      conditionsLine({
        timeOfDay: "night",
        ball: { type: "leather", colour: "white" },
        pitch: "turf",
      }),
    ).toBe("Night · white leather · turf");
    expect(conditionsLine({})).toBe("");
    expect(
      conditionsLine({ timeOfDay: "day_night", ball: { type: "tennis" }, pitch: "cement" }),
    ).toBe("Day–night · Tennis · cement");
    expect(conditionsLine({ timeOfDay: "day", ball: { type: "leather" } })).toBe("Day · leather");
    expect(conditionsLine({ ball: { type: "tape" } })).toBe("Tape");
    expect(conditionsLine({ ball: { type: "rubber" } })).toBe("Rubber");
  });
});
