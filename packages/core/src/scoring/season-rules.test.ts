import { describe, expect, it } from "vitest";
import { NEW_SEASON_SCORING_RULES, parseSeasonScoringRules } from "./season-rules";

describe("F-3 season scoring rules", () => {
  it("gives new seasons the exact defaults with both NRR fixes on", () => {
    expect(NEW_SEASON_SCORING_RULES).toEqual({
      allOutUsesQuota: true,
      excludeNoResultFromNrr: true,
      editWindowHours: 24,
      publicDelaySeconds: 60,
      shotMap: "every",
      superOverTie: "another",
      replayReplacesAbandoned: true,
    });
    expect(parseSeasonScoringRules(NEW_SEASON_SCORING_RULES)).toEqual(NEW_SEASON_SCORING_RULES);
  });

  it.each([undefined, null, {}, [], "bad", 0])("preserves legacy NRR for %j", (value) => {
    expect(parseSeasonScoringRules(value)).toEqual({
      ...NEW_SEASON_SCORING_RULES,
      allOutUsesQuota: false,
      excludeNoResultFromNrr: false,
    });
  });

  it("reads explicit season settings, including zero delay and false replay", () => {
    const settings = {
      ...NEW_SEASON_SCORING_RULES,
      formatKey: "t10",
      ball: { type: "leather", colour: "pink" },
      editWindowHours: 0,
      publicDelaySeconds: 0,
      shotMap: "boundaries",
      superOverTie: "boundary_count",
      replayReplacesAbandoned: false,
    };
    expect(parseSeasonScoringRules(settings)).toEqual(settings);
  });

  it("does not coerce malformed settings or non-leather colours", () => {
    expect(
      parseSeasonScoringRules({
        allOutUsesQuota: "true",
        excludeNoResultFromNrr: 1,
        editWindowHours: -1,
        publicDelaySeconds: Infinity,
        shotMap: "unknown",
        superOverTie: null,
        ball: { type: "tennis", colour: "white" },
      }),
    ).toEqual({
      ...NEW_SEASON_SCORING_RULES,
      allOutUsesQuota: false,
      excludeNoResultFromNrr: false,
      ball: { type: "tennis" },
    });
    expect(parseSeasonScoringRules({ ball: { type: "unknown" } }).ball).toBeUndefined();
  });
});
