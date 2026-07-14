import { describe, expect, it } from "vitest";

import { replayAuction, type AuctionEventEnvelope } from "./auction";
import {
  buildAuctionSnapshot,
  canonicalJson,
  isAuctionCommandType,
  serializeSnapshot,
  type SnapshotRefs,
} from "./auction-snapshot";

// AuctionSnapshot determinism (M-IP4-2): identical events → identical bytes.

const at = 1_800_000_000_000;
let seq = 0;
const ev = (type: string, payload: Record<string, unknown> = {}): AuctionEventEnvelope => ({
  seq: ++seq,
  type,
  atMs: at + seq,
  actor: "actor",
  correlationId: "corr",
  payload,
});

function liveNight(): AuctionEventEnvelope[] {
  seq = 0;
  return [
    ev("AuctionCreated", { competitionId: "comp", lotCount: 2 }),
    ev("PaddleIssued", { paddleId: "pad1", teamId: "t1", personId: "per1", paddleNumber: "P01" }),
    ev("PaddleIssued", { paddleId: "pad2", teamId: "t2", personId: "per2", paddleNumber: "P02" }),
    ev("LotPrepared", { lotId: "lot1", registrationId: "r1", lotNumber: "L001" }),
    ev("LotPrepared", { lotId: "lot2", registrationId: "r2", lotNumber: "L002" }),
    ev("LotQueued", { lotId: "lot1" }),
    ev("LotQueued", { lotId: "lot2" }),
    ev("AuctionOpened", {}),
    ev("LotOpened", { lotId: "lot1", endsAtMs: at + 30_000 }),
    ev("BidAccepted", { lotId: "lot1", bidId: "b1", paddleId: "pad1", amount: 1_000_000 }),
    ev("TimerExtended", { lotId: "lot1", endsAtMs: at + 45_000 }),
    ev("BidAccepted", { lotId: "lot1", bidId: "b2", paddleId: "pad2", amount: 1_500_000 }),
  ];
}

const REFS: SnapshotRefs = {
  auctionId: "auc1",
  auctionName: "MPL Auction",
  pursePerTeam: 100_000_000,
  slabs: [{ upTo: null, step: 500_000 as never }],
  lots: {
    lot1: { lotNumber: "L001", seq: 1, playerName: "Kohli", role: "batter", basePrice: 1_000_000 },
    lot2: { lotNumber: "L002", seq: 2, playerName: "Sharma", role: "bowler", basePrice: 1_000_000 },
  },
  paddles: {
    pad1: { paddleNumber: "P01", teamId: "t1", teamName: "Arrows" },
    pad2: { paddleNumber: "P02", teamId: "t2", teamName: "Blasters" },
  },
};

const BIDS = {
  lotId: "lot1",
  bids: [
    { bidId: "b1", paddleId: "pad1", amount: 1_000_000 },
    { bidId: "b2", paddleId: "pad2", amount: 1_500_000 },
  ],
};

function snapshotOf(events: AuctionEventEnvelope[]) {
  const replay = replayAuction(events);
  if (!replay.ok) {
    throw new Error(`replay failed: ${replay.reason}`);
  }
  return buildAuctionSnapshot(replay.projection, REFS, BIDS);
}

describe("AuctionSnapshot", () => {
  it("identical events → identical snapshot BYTES (deterministic, no clock)", () => {
    const first = serializeSnapshot(snapshotOf(liveNight()));
    const second = serializeSnapshot(snapshotOf(liveNight()));
    expect(second).toBe(first);
    expect(first).not.toContain("generatedAt");
  });

  it("carries the presentation-ready live state, versioned by the last seq", () => {
    const snapshot = snapshotOf(liveNight());
    expect(snapshot.version).toBe(12);
    expect(snapshot.auctionStatus).toBe("live");
    expect(snapshot.currentLot).toMatchObject({
      lotNumber: "L001",
      playerName: "Kohli",
      status: "on_block",
      endsAtMs: at + 45_000,
      extensions: 1,
      nextMinimumBid: 2_000_000, // one rung above the leader
    });
    expect(snapshot.currentLot?.currentBid).toMatchObject({
      paddleNumber: "P02",
      teamName: "Blasters",
      amount: 1_500_000,
    });
    expect(snapshot.currentLot?.bidHistory.length).toBe(2);
    expect(snapshot.queue.map((q) => q.lotNumber)).toEqual(["L002"]);
    expect(snapshot.paddles.map((p) => p.paddleNumber)).toEqual(["P01", "P02"]);
    expect(snapshot.lotsTotal).toBe(2);
    expect(snapshot.lotsResolved).toBe(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.currentLot)).toBe(true);
  });

  it("purse remaining aggregates committed money per TEAM after a sale", () => {
    const events = [
      ...liveNight(),
      ev("LotSold", { lotId: "lot1", bidId: "b2", paddleId: "pad2", amount: 1_500_000 }),
    ];
    const snapshot = buildAuctionSnapshot(
      (() => {
        const r = replayAuction(events);
        if (!r.ok) {
          throw new Error("replay");
        }
        return r.projection;
      })(),
      REFS,
      null,
    );
    const pad2 = snapshot.paddles.find((p) => p.paddleNumber === "P02");
    expect(pad2?.committed).toBe(1_500_000);
    expect(pad2?.purseRemaining).toBe(98_500_000);
    expect(snapshot.currentLot).toBeNull();
    expect(snapshot.lotsResolved).toBe(1);
  });

  it("a released paddle stays visible, marked released (identity never deleted)", () => {
    const events = [...liveNight(), ev("PaddleReleased", { paddleId: "pad1" })];
    const snapshot = snapshotOf(events.slice());
    void snapshot;
    const replay = replayAuction(events);
    if (!replay.ok) {
      throw new Error("replay");
    }
    const built = buildAuctionSnapshot(replay.projection, REFS, BIDS);
    expect(built.paddles.find((p) => p.paddleNumber === "P01")?.released).toBe(true);
  });
});

describe("anti-snipe replay (the M-IP4-2 watchdog catch, regression-pinned)", () => {
  it("a TimerExtended on a closing lot flips it back to on_block in replay", () => {
    seq = 0;
    const events = [
      ev("LotPrepared", { lotId: "lot1", registrationId: "r1", lotNumber: "L001" }),
      ev("LotQueued", { lotId: "lot1" }),
      ev("AuctionOpened", {}),
      ev("LotOpened", { lotId: "lot1", endsAtMs: at + 30_000 }),
      ev("LotClosingSoon", { lotId: "lot1" }),
      ev("BidAccepted", { lotId: "lot1", bidId: "b1", paddleId: "pad1", amount: 1_000_000 }),
      ev("TimerExtended", { lotId: "lot1", endsAtMs: at + 45_000 }),
    ];
    const replay = replayAuction(events);
    expect(replay.ok).toBe(true);
    if (!replay.ok) {
      return;
    }
    // The extend edge executed: rows and events must agree on on_block.
    expect(replay.projection.lots["lot1"]?.status).toBe("on_block");
    expect(replay.projection.lots["lot1"]?.endsAtMs).toBe(at + 45_000);
    expect(replay.projection.lots["lot1"]?.timerExtensions).toBe(1);
  });
});

describe("canonical JSON", () => {
  it("sorts keys at every level and is whitespace-free", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}',
    );
    // Key insertion order does not matter — the bytes are identical.
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});

describe("command model", () => {
  it("recognizes exactly the closed command set", () => {
    for (const type of ["PlaceBid", "ClaimPaddle", "RecoverAuction", "CompleteAuction"]) {
      expect(isAuctionCommandType(type)).toBe(true);
    }
    expect(isAuctionCommandType("DeleteAuction")).toBe(false);
    expect(isAuctionCommandType("")).toBe(false);
  });
});
