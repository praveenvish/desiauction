import type { AuctionSnapshot } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { foldSnapshot, type FeedState } from "./live-experience";

const EMPTY: FeedState = {
  resolved: [],
  events: [],
  folded: null,
  seenSeqs: new Set(),
  lastStatus: null,
  recoveries: 0,
};

/** Only the fields the fold reads; the rest of a snapshot is irrelevant here. */
function snap(partial: {
  version: number;
  auctionStatus?: string;
  recoveries?: number;
  lastOutcome?: Partial<NonNullable<AuctionSnapshot["lastOutcome"]>> | null;
}): AuctionSnapshot {
  return {
    auctionStatus: "live",
    recoveries: 0,
    ...partial,
    lastOutcome:
      partial.lastOutcome === undefined || partial.lastOutcome === null
        ? null
        : {
            atSeq: 1,
            kind: "sold",
            lotId: "lot-1",
            lotNumber: "1",
            playerName: "Asha",
            teamName: "Falcons",
            amount: 500_000,
            ...partial.lastOutcome,
          },
  } as unknown as AuctionSnapshot;
}

describe("the live feed fold", () => {
  it("applies an outcome once, even when a reconnect replays it", () => {
    const sold = { atSeq: 7, lotId: "lot-7", playerName: "Asha" };
    let feed = foldSnapshot(EMPTY, snap({ version: 1, lastOutcome: sold }));
    feed = foldSnapshot(feed, snap({ version: 2, lastOutcome: sold }));
    expect(feed.resolved.map((row) => row.lotId)).toEqual(["lot-7"]);
    expect(feed.events.map((event) => event.key)).toEqual(["outcome-7"]);
    // The timeline line carries its subject, so it can wear the player's face.
    expect(feed.events[0]?.subject).toEqual({ lotId: "lot-7", playerName: "Asha" });
  });

  it("does not mutate the feed it was given", () => {
    const before = EMPTY;
    foldSnapshot(before, snap({ version: 1, lastOutcome: { atSeq: 3 } }));
    expect(before.seenSeqs.size).toBe(0);
    expect(before.events).toEqual([]);
  });

  it("records pause, resume and completion as transitions, not on first sight", () => {
    let feed = foldSnapshot(EMPTY, snap({ version: 1, auctionStatus: "live" }));
    expect(feed.events).toEqual([]);
    feed = foldSnapshot(feed, snap({ version: 2, auctionStatus: "paused" }));
    feed = foldSnapshot(feed, snap({ version: 3, auctionStatus: "live" }));
    feed = foldSnapshot(feed, snap({ version: 4, auctionStatus: "completed" }));
    expect(feed.events.map((event) => event.kind)).toEqual(["completed", "resumed", "paused"]);
  });

  it("notes each recovery once", () => {
    let feed = foldSnapshot(EMPTY, snap({ version: 1, recoveries: 1 }));
    feed = foldSnapshot(feed, snap({ version: 2, recoveries: 1 }));
    expect(feed.events.map((event) => event.kind)).toEqual(["recovered"]);
  });

  it("replaces a lot's row when it is re-resolved after an undo", () => {
    let feed = foldSnapshot(
      EMPTY,
      snap({ version: 1, lastOutcome: { atSeq: 1, lotId: "lot-1", kind: "sold" } }),
    );
    feed = foldSnapshot(
      feed,
      snap({ version: 2, lastOutcome: { atSeq: 2, lotId: "lot-1", kind: "unsold", amount: null } }),
    );
    expect(feed.resolved).toHaveLength(1);
    expect(feed.resolved[0]?.status).toBe("unsold");
  });
});
