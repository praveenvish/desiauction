import { describe, expect, it } from "vitest";

import {
  STRIKE_CLIP_HEIGHT,
  STRIKE_DONE_MS,
  STRIKE_IMPACT_MS,
  strikeFrame,
} from "./strike-timeline";

const REST = {
  tileOpacity: 1,
  tileScale: 1,
  riseOpacity: 1,
  glyphDy: 0,
  clipHeight: STRIKE_CLIP_HEIGHT,
  sweepOpacity: 0,
};

describe("the strike", () => {
  it("starts from nothing", () => {
    const f = strikeFrame(0);
    expect(f.tileOpacity).toBe(0);
    expect(f.riseOpacity).toBe(0);
    expect(f.clipHeight).toBe(0);
  });

  it("has not cut the D before the slash falls", () => {
    expect(strikeFrame(250).clipHeight).toBe(0);
  });

  it("lands the whole slash on the impact frame, and the tile dips just after", () => {
    expect(strikeFrame(STRIKE_IMPACT_MS).clipHeight).toBe(STRIKE_CLIP_HEIGHT);
    expect(strikeFrame(STRIKE_IMPACT_MS + 100).tileScale).toBeLessThan(0.975);
  });

  it("rests exactly as the drawn mark once done, and stays there", () => {
    for (const t of [STRIKE_DONE_MS, STRIKE_DONE_MS + 1, 5000]) {
      expect(strikeFrame(t)).toMatchObject(REST);
    }
  });
});
