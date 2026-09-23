// The cockpit's "Needs resolution" list must move with the live room, not wait
// for a page refresh — see needs-resolution.ts for the double-listing it fixes.
import { describe, expect, it } from "vitest";

import { lotsNeedingResolution } from "./needs-resolution";

const LOTS = [
  { id: "a", status: "frozen" },
  { id: "b", status: "unsold" },
  { id: "c", status: "sold" },
  { id: "d", status: "queued" },
];

describe("lotsNeedingResolution", () => {
  it("lists frozen and unsold lots, nothing else", () => {
    expect(lotsNeedingResolution(LOTS, null).map((lot) => lot.id)).toEqual(["a", "b"]);
  });

  it("drops a lot the moment the snapshot has it back in the queue (requeued)", () => {
    const snapshot = { queue: [{ lotId: "a" }, { lotId: "d" }], currentLot: null };
    expect(lotsNeedingResolution(LOTS, snapshot).map((lot) => lot.id)).toEqual(["b"]);
  });

  it("drops a lot that is on the block again", () => {
    const snapshot = { queue: [], currentLot: { lotId: "b" } };
    expect(lotsNeedingResolution(LOTS, snapshot).map((lot) => lot.id)).toEqual(["a"]);
  });
});
