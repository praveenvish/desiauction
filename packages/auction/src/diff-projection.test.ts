import type { AuctionProjection } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import {
  diffProjection,
  type BidProjectionRow,
  type LotProjectionRow,
  type PaddleProjectionRow,
} from "./aggregate";

// THE WATCHDOG'S COMPARISON, PINNED CASE BY CASE.
//
// `diffProjection` is what halts a live auction when a row disagrees with the
// event log — the engine's only defence against a sale price, a purse or a
// bidder's authority being edited underneath it. It was exercised only end to
// end (the certification drill), which proves it fires for the drill's cases
// and says nothing about the others. Each case below changes ONE field of an
// otherwise agreeing world and requires exactly the one divergence it names:
// a missed field here is money or authority the watchdog cannot see.

const LOT: LotProjectionRow = {
  id: "lot-1",
  status: "sold",
  soldPrice: 600_000,
  soldToPaddleId: "pad-a",
  roundsUsed: 1,
};
const BID_1: BidProjectionRow = {
  id: "bid-1",
  lotId: "lot-1",
  paddleId: "pad-b",
  amount: 500_000,
  status: "outbid",
};
const BID_2: BidProjectionRow = {
  id: "bid-2",
  lotId: "lot-1",
  paddleId: "pad-a",
  amount: 600_000,
  status: "accepted",
};
const PAD_A: PaddleProjectionRow = {
  id: "pad-a",
  teamId: "team-a",
  personId: "person-a",
  paddleNumber: "1",
  releasedAt: null,
};
const PAD_B: PaddleProjectionRow = {
  id: "pad-b",
  teamId: "team-b",
  personId: "person-b",
  paddleNumber: "2",
  releasedAt: new Date(1_000),
};

function agreeing(): {
  projection: AuctionProjection;
  lots: LotProjectionRow[];
  bids: BidProjectionRow[];
  paddles: PaddleProjectionRow[];
} {
  return {
    projection: {
      status: "live",
      lots: {
        "lot-1": {
          status: "sold",
          bidCount: 2,
          leadingBidId: "bid-2",
          leadingPaddleId: "pad-a",
          leadingAmount: 600_000,
          soldAmount: 600_000,
          soldPaddleId: "pad-a",
          roundsUsed: 1,
          endsAtMs: null,
          timerExtensions: 0,
        },
      },
      paddles: {
        "pad-a": {
          teamId: "team-a",
          personId: "person-a",
          paddleNumber: "1",
          committed: 600_000,
          released: false,
          releasedAtMs: null,
        },
        "pad-b": {
          teamId: "team-b",
          personId: "person-b",
          paddleNumber: "2",
          committed: 0,
          released: true,
          releasedAtMs: 1_000,
        },
      },
      bids: {
        "bid-1": { lotId: "lot-1", paddleId: "pad-b", amount: 500_000, status: "outbid" },
        "bid-2": { lotId: "lot-1", paddleId: "pad-a", amount: 600_000, status: "accepted" },
      },
      ownerInvites: {},
      paddleGrants: {},
      lastOutcome: null,
      recoveries: 0,
      lastSeq: 9,
      eventCount: 9,
    },
    lots: [{ ...LOT }],
    bids: [{ ...BID_1 }, { ...BID_2 }],
    paddles: [{ ...PAD_A }, { ...PAD_B }],
  };
}

function diff(world: ReturnType<typeof agreeing>, status: "live" | "paused" = "live"): string[] {
  return diffProjection(world.projection, status, world.lots, world.bids, world.paddles);
}

describe("diffProjection — the live watchdog's row-vs-log comparison", () => {
  it("reports nothing when every row agrees with the log", () => {
    expect(diff(agreeing())).toEqual([]);
  });

  it("catches the auction status", () => {
    expect(diff(agreeing(), "paused")).toEqual(["auction: rows=paused events=live"]);
  });

  describe("lots — the sale, which is the purse", () => {
    it.each([
      ["status", { status: "unsold" as const }, "lot lot-1: rows=unsold events=sold"],
      ["sold price", { soldPrice: 60_000 }, "lot lot-1: sold price diverged"],
      ["buyer", { soldToPaddleId: "pad-b" }, "lot lot-1: sold paddle diverged"],
      ["rounds", { roundsUsed: 2 }, "lot lot-1: rounds diverged (rows=2 events=1)"],
    ])("catches a changed %s", (_field, change, expected) => {
      const world = agreeing();
      world.lots = [{ ...LOT, ...change }];
      expect(diff(world)).toEqual([expected]);
    });

    it("catches a deleted lot row, which would silently refund its buyer", () => {
      const world = agreeing();
      world.lots = [];
      expect(diff(world)).toEqual(["lot lot-1: row missing"]);
    });

    it("catches a lot row the log never created", () => {
      const world = agreeing();
      world.lots.push({
        id: "lot-x",
        status: "queued",
        soldPrice: null,
        soldToPaddleId: null,
        roundsUsed: 0,
      });
      expect(diff(world)).toEqual(["lot lot-x: missing from event log"]);
    });
  });

  describe("paddles — who may bid, and whose purse pays", () => {
    it.each([
      ["team", { teamId: "team-b" }, "paddle pad-a: team diverged"],
      ["holder", { personId: "person-b" }, "paddle pad-a: person diverged"],
      ["number", { paddleNumber: "9" }, "paddle pad-a: number diverged"],
      [
        "release",
        { releasedAt: new Date(2_000) },
        "paddle pad-a: released diverged (rows=true events=false)",
      ],
    ])("catches a changed %s", (_field, change, expected) => {
      const world = agreeing();
      world.paddles = [{ ...PAD_A, ...change }, PAD_B];
      expect(diff(world)).toEqual([expected]);
    });

    it("catches a released paddle quietly re-armed", () => {
      const world = agreeing();
      world.paddles = [PAD_A, { ...PAD_B, releasedAt: null }];
      expect(diff(world)).toEqual(["paddle pad-b: released diverged (rows=false events=true)"]);
    });

    it("catches a deleted and an invented paddle row", () => {
      const world = agreeing();
      world.paddles = [
        PAD_A,
        {
          id: "pad-x",
          teamId: "team-b",
          personId: "person-x",
          paddleNumber: "3",
          releasedAt: null,
        },
      ];
      expect(diff(world)).toEqual([
        "paddle pad-x: missing from event log",
        "paddle pad-b: row missing",
      ]);
    });
  });

  describe("bids — the ledger the sale price is read from", () => {
    it.each([
      ["amount", { amount: 900_000 }, "bid bid-2: amount diverged (rows=900000 events=600000)"],
      ["paddle", { paddleId: "pad-b" }, "bid bid-2: paddle diverged"],
      ["lot", { lotId: "lot-x" }, "bid bid-2: lot diverged"],
      ["status", { status: "invalidated" as const }, "bid bid-2: rows=invalidated events=accepted"],
    ])("catches a changed %s", (_field, change, expected) => {
      const world = agreeing();
      world.bids = [BID_1, { ...BID_2, ...change }];
      expect(diff(world)).toEqual([expected]);
    });

    it("catches an accepted bid whose row is gone", () => {
      const world = agreeing();
      world.bids = [BID_2];
      expect(diff(world)).toEqual(["bid bid-1: row missing"]);
    });

    it("catches a bid row with no BidAccepted behind it", () => {
      const world = agreeing();
      world.bids.push({
        id: "bid-x",
        lotId: "lot-1",
        paddleId: "pad-b",
        amount: 700_000,
        status: "accepted",
      });
      expect(diff(world)).toEqual(["bid bid-x: missing from event log"]);
    });
  });

  it("reports every divergence at once rather than stopping at the first", () => {
    const world = agreeing();
    world.lots = [{ ...LOT, soldPrice: 1 }];
    world.bids = [BID_1, { ...BID_2, amount: 1 }];
    expect(diff(world, "paused")).toHaveLength(3);
  });
});
