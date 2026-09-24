import { describe, expect, it } from "vitest";

import { SPORTS } from "./index";
import { SPORT_LABELS, sportLabel } from "./labels";

describe("SPORT_LABELS", () => {
  it("is exactly the registry's key → label map", () => {
    expect(SPORT_LABELS).toEqual(Object.fromEntries(SPORTS.map((pack) => [pack.key, pack.label])));
  });

  it("answers null for a key with no pack, including inherited names", () => {
    expect(sportLabel("curling")).toBeNull();
    expect(sportLabel("toString")).toBeNull();
    expect(sportLabel("box_cricket")).toBe("Box cricket");
  });
});
