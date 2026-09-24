import type { AuctionSnapshot } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { moneyFormat } from "../../../../lib/money";
import { foldSnapshot, type FeedState } from "./live-experience";

const INR = moneyFormat("inr");

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
    let feed = foldSnapshot(EMPTY, snap({ version: 1, lastOutcome: sold }), INR);
    feed = foldSnapshot(feed, snap({ version: 2, lastOutcome: sold }), INR);
    expect(feed.resolved.map((row) => row.lotId)).toEqual(["lot-7"]);
    expect(feed.events.map((event) => event.key)).toEqual(["outcome-7"]);
    // The timeline line carries its subject, so it can wear the player's face.
    expect(feed.events[0]?.subject).toEqual({ lotId: "lot-7", playerName: "Asha" });
  });

  it("does not mutate the feed it was given", () => {
    const before = EMPTY;
    foldSnapshot(before, snap({ version: 1, lastOutcome: { atSeq: 3 } }), INR);
    expect(before.seenSeqs.size).toBe(0);
    expect(before.events).toEqual([]);
  });

  it("records pause, resume and completion as transitions, not on first sight", () => {
    let feed = foldSnapshot(EMPTY, snap({ version: 1, auctionStatus: "live" }), INR);
    expect(feed.events).toEqual([]);
    feed = foldSnapshot(feed, snap({ version: 2, auctionStatus: "paused" }), INR);
    feed = foldSnapshot(feed, snap({ version: 3, auctionStatus: "live" }), INR);
    feed = foldSnapshot(feed, snap({ version: 4, auctionStatus: "completed" }), INR);
    expect(feed.events.map((event) => event.kind)).toEqual(["completed", "resumed", "paused"]);
  });

  it("notes each recovery once", () => {
    let feed = foldSnapshot(EMPTY, snap({ version: 1, recoveries: 1 }), INR);
    feed = foldSnapshot(feed, snap({ version: 2, recoveries: 1 }), INR);
    expect(feed.events.map((event) => event.kind)).toEqual(["recovered"]);
  });

  it("replaces a lot's row when it is re-resolved after an undo", () => {
    let feed = foldSnapshot(
      EMPTY,
      snap({ version: 1, lastOutcome: { atSeq: 1, lotId: "lot-1", kind: "sold" } }),
      INR,
    );
    feed = foldSnapshot(
      feed,
      snap({ version: 2, lastOutcome: { atSeq: 2, lotId: "lot-1", kind: "unsold", amount: null } }),
      INR,
    );
    expect(feed.resolved).toHaveLength(1);
    expect(feed.resolved[0]?.status).toBe("unsold");
  });

  it("prints the sale price in the season's unit", () => {
    const sold = { atSeq: 9, amount: 125_000 };
    const inr = foldSnapshot(EMPTY, snap({ version: 1, lastOutcome: sold }), INR);
    expect(inr.events[0]?.detail).toBe("₹1,250");
    const points = foldSnapshot(
      EMPTY,
      snap({ version: 1, lastOutcome: sold }),
      moneyFormat("points"),
    );
    expect(points.events[0]?.detail).toBe("1,250 pts");
  });
});
