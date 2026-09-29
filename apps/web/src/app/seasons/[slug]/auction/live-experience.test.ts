import type { AuctionSnapshot } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { moneyFormat } from "../../../../lib/money";
import type { ResolvedLot } from "../../../../server/auction/live-summary";
import { foldSnapshot, initialFeed, reconcileFeed, type FeedState } from "./live-experience";

const INR = moneyFormat("inr");

const EMPTY: FeedState = initialFeed([]);

/** A resolved lot as the SERVER lists it: thick, with the ids the socket lacks. */
function serverRow(partial: Partial<ResolvedLot> & { lotId: string }): ResolvedLot {
  return {
    registrationId: `reg-${partial.lotId}`,
    isCaptain: false,
    isViceCaptain: false,
    lotNumber: partial.lotId,
    seq: 1,
    playerName: "Asha",
    role: "batter",
    status: "sold",
    soldPrice: 500_000,
    teamId: "team-falcons",
    teamName: "Falcons",
    ...partial,
  } as ResolvedLot;
}

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

describe("the server's rows, met with the socket's", () => {
  const sold = { atSeq: 7, lotId: "lot-7", kind: "sold", amount: 500_000 } as const;

  it("a sale seen on the socket has no team id — and gets one from the next server read", () => {
    let feed = foldSnapshot(EMPTY, snap({ version: 1, lastOutcome: sold }), INR);
    expect(feed.resolved[0]?.teamId).toBeNull();
    // The page refreshes its data; the same sale arrives, thick.
    feed = reconcileFeed(feed, [serverRow({ lotId: "lot-7" })]);
    expect(feed.resolved).toHaveLength(1);
    expect(feed.resolved[0]).toMatchObject({
      lotId: "lot-7",
      teamId: "team-falcons",
      registrationId: "reg-lot-7",
      soldPrice: 500_000,
    });
    expect(feed.optimistic.has("lot-7")).toBe(false);
  });

  it("a render that started before the hammer does not take the sale back off the board", () => {
    let feed = foldSnapshot(EMPTY, snap({ version: 1, lastOutcome: sold }), INR);
    // A server read from a moment earlier: it has never heard of lot 7.
    feed = reconcileFeed(feed, [serverRow({ lotId: "lot-3" })]);
    expect(feed.resolved.map((row) => row.lotId).sort()).toEqual(["lot-3", "lot-7"]);
    expect(feed.optimistic.has("lot-7")).toBe(true);
  });

  it("when the two disagree about a lot, the socket's row stands until the server catches up", () => {
    // Passed, requeued, and bought on the second round — all in this tab.
    let feed = foldSnapshot(EMPTY, snap({ version: 1, lastOutcome: sold }), INR);
    const stale = serverRow({ lotId: "lot-7", status: "unsold", soldPrice: null, teamId: null });
    feed = reconcileFeed(feed, [stale]);
    expect(feed.resolved).toHaveLength(1);
    expect(feed.resolved[0]?.status).toBe("sold");
    // The server catches up.
    feed = reconcileFeed(feed, [serverRow({ lotId: "lot-7" })]);
    expect(feed.resolved[0]).toMatchObject({ status: "sold", teamId: "team-falcons" });
  });

  it("a row only the server ever listed goes when the server stops listing it", () => {
    let feed = initialFeed([serverRow({ lotId: "lot-1" }), serverRow({ lotId: "lot-2" })]);
    feed = reconcileFeed(feed, [serverRow({ lotId: "lot-2" })]);
    expect(feed.resolved.map((row) => row.lotId)).toEqual(["lot-2"]);
  });

  it("the same server rows again change nothing, not even the object — new array or not", () => {
    const feed = initialFeed([serverRow({ lotId: "lot-1" })]);
    // A caller that rebuilds its list every render hands over a NEW array with
    // the same contents. Reconciling on that would be a state update in every
    // render, which is a loop.
    expect(reconcileFeed(feed, [serverRow({ lotId: "lot-1" })])).toBe(feed);
  });

  it("an undone sale leaves the board at once", () => {
    let feed = initialFeed([serverRow({ lotId: "lot-7" })]);
    feed = foldSnapshot(
      feed,
      snap({ version: 2, lastOutcome: { atSeq: 9, lotId: "lot-7", kind: "reopened" } }),
      INR,
    );
    expect(feed.resolved).toEqual([]);
    expect(feed.events[0]?.kind).toBe("reopened");
  });
});
