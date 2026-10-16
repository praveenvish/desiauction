import { describe, expect, it } from "vitest";
import { FORMAT_PRESETS, formatByKey, type FormatSpec } from "@desiauction/core/scoring";
import { CRICKET } from "../sports/cricket";
import { BOX_CRICKET } from "../sports/box-cricket";

describe("F-1 formats", () => {
  it("exports the scoring subpath and the six exact preset knobs", () => {
    const actual = Object.values(FORMAT_PRESETS).map((format: FormatSpec) => [
      format.key,
      format.oversPerInnings,
      format.playersPerSide,
      format.wicketsPerInnings,
      format.maxOversPerBowler,
      format.lastManStands,
      format.freeHitOnNoBall,
      format.lbw,
      format.retireAt,
      format.powerplayOvers,
      format.deathFromOver,
    ]);
    expect(actual).toEqual([
      ["t20", 20, 11, 10, 4, false, true, true, null, 6, 16],
      ["t10", 10, 11, 10, 2, false, true, true, null, 3, 8],
      ["odi", 50, 11, 10, 10, false, true, true, null, 10, 41],
      ["six_over", 6, 8, 7, 1, false, true, true, null, 2, 5],
      ["box_6", 6, 6, 6, 1, true, true, false, null, 1, 5],
      ["tennis_gully", 8, 8, 7, 2, false, false, false, 25, 2, 7],
    ]);
  });

  it.each(Object.values(FORMAT_PRESETS))(
    "$key is consistent and has the shared rules",
    (format) => {
      expect(format.wicketsPerInnings).toBeLessThanOrEqual(format.playersPerSide);
      if (format.oversPerInnings !== null) {
        expect(format.deathFromOver).toBeLessThanOrEqual(format.oversPerInnings);
      }
      expect(format).toMatchObject({
        ballsPerOver: 6,
        wideRuns: 1,
        noBallRuns: 1,
        wideReBowl: true,
        noBallReBowl: true,
        noConsecutiveOvers: true,
        superOver: true,
        innings: 1,
      });
      expect(formatByKey(format.key)).toEqual(format);
    },
  );

  it("has unique stable keys and refuses an unknown key", () => {
    const keys = Object.values(FORMAT_PRESETS).map((format) => format.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(formatByKey("unknown")).toBeUndefined();
    expect(formatByKey("toString")).toBeUndefined();
  });

  it("declares the prescribed formats on each cricket pack", () => {
    expect(CRICKET.scoring).toEqual({
      family: "delivery",
      depth: 2,
      formats: [
        FORMAT_PRESETS.t20,
        FORMAT_PRESETS.t10,
        FORMAT_PRESETS.odi,
        FORMAT_PRESETS.six_over,
        FORMAT_PRESETS.tennis_gully,
      ],
      defaultFormat: "t20",
      awardTable: "cricket-v1",
    });
    expect(BOX_CRICKET.scoring).toEqual({
      family: "delivery",
      depth: 2,
      formats: [FORMAT_PRESETS.box_6, FORMAT_PRESETS.six_over],
      defaultFormat: "box_6",
      awardTable: "cricket-v1",
    });
  });
});
