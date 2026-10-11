import { describe, expect, it } from "vitest";
import { BATTING_HANDS } from "./types";
import type { ZoneKey } from "./types";
import { mirrorForHand, zoneAngle, zoneOfAngle, ZONE_LABELS } from "./zones";

describe("field zones", () => {
  for (const hand of BATTING_HANDS)
    for (const zone of Object.keys(ZONE_LABELS.en) as ZoneKey[]) {
      it(`${zone} round trips for ${hand}`, () => {
        expect(zoneOfAngle(zoneAngle(zone, hand), hand)).toBe(zone);
        expect(ZONE_LABELS.hi[zone]).toBeTruthy();
      });
    }
  it("mirrors and normalises angles without changing their circular position", () => {
    for (const hand of BATTING_HANDS)
      for (const angle of [0, 22, 67, 180, 337, 359])
        expect(mirrorForHand(mirrorForHand(angle, hand), hand)).toBe(angle);
    expect(zoneOfAngle(360, BATTING_HANDS[0])).toBe("long_off");
    expect(zoneOfAngle(-23, BATTING_HANDS[0])).toBe("long_on");
    expect(zoneAngle("cover", BATTING_HANDS[1])).toBe(293);
  });
});
