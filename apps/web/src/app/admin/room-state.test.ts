import { describe, expect, it } from "vitest";

import type { LiveAuctionRow } from "../../server/admin/live-views";
import { ROOM_LABEL, ROOM_TONE, stuckSummary } from "./room-state";

const NOW = 1_000_000_000_000;
const HOUR = 3_600_000;

function room(orgSlug: string, lastEventAtMs: number | null): LiveAuctionRow {
  return { orgSlug, lastEventAtMs } as unknown as LiveAuctionRow;
}

describe("room state, one rule for every admin surface", () => {
  it("gives every state exactly one tone and one word", () => {
    expect(ROOM_TONE).toEqual({ active: "green", quiet: "neutral", paused: "amber", stale: "red" });
    expect(Object.keys(ROOM_LABEL).sort()).toEqual(Object.keys(ROOM_TONE).sort());
  });

  it("counts the board's silent rooms, their clubs and the longest silence", () => {
    const summary = stuckSummary({
      generatedAtMs: NOW,
      stale: [room("a", NOW - 13 * HOUR), room("a", NOW - 50 * HOUR), room("b", null)],
    });
    expect(summary).toEqual({ count: 3, clubs: 2, longestSilentMs: 50 * HOUR });
  });

  it("has no longest silence when no room ever spoke", () => {
    expect(stuckSummary({ generatedAtMs: NOW, stale: [room("a", null)] }).longestSilentMs).toBe(
      null,
    );
    expect(stuckSummary({ generatedAtMs: NOW, stale: [] })).toEqual({
      count: 0,
      clubs: 0,
      longestSilentMs: null,
    });
  });
});
