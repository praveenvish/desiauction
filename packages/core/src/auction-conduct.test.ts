import { describe, expect, it } from "vitest";

import { decideUndo, replayAuction, type AuctionEventEnvelope } from "./auction";
import { deriveCeremony } from "./auction-ceremony";
import { buildAuctionLedger } from "./auction-ledger";
import {
  buildAuctionSnapshot,
  serializeSnapshot,
  type AuctionSnapshot,
  type SnapshotRefs,
} from "./auction-snapshot";

// PERMANENT CONDUCT & CEREMONY REGRESSIONS (M-IP4-3): the owner workflow in
// replay, the compensating undo (doc 41 lot.reopen — never a back edge), the
// AuctionLedger as a pure projection of the event store, and the deterministic
// FLOODLIGHT ceremony derivation.

const at = 1_900_000_000_000;
let seq = 0;
const ev = (type: string, payload: Record<string, unknown> = {}): AuctionEventEnvelope => ({
  seq: ++seq,
  type,
  atMs: at + seq,
  actor: "actor",
  correlationId: "corr",
  payload,
});

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

/** A night that walks the owner workflow, a sale, and its compensating undo. */
function undoNight(): AuctionEventEnvelope[] {
  seq = 0;
  return [
    ev("AuctionCreated", { competitionId: "comp", lotCount: 2 }),
    ev("OwnerInvited", { inviteId: "inv1", teamId: "t1" }),
    ev("OwnerAccepted", { inviteId: "inv1", teamId: "t1", personId: "per1" }),
    ev("PaddleGranted", { grantId: "gr1", teamId: "t1", personId: "per1" }),
    ev("PaddleIssued", { paddleId: "pad1", teamId: "t1", personId: "per1", paddleNumber: "P01" }),
    ev("PaddleIssued", { paddleId: "pad2", teamId: "t2", personId: "per2", paddleNumber: "P02" }),
    ev("LotPrepared", { lotId: "lot1", registrationId: "r1", lotNumber: "L001" }),
    ev("LotPrepared", { lotId: "lot2", registrationId: "r2", lotNumber: "L002" }),
    ev("LotQueued", { lotId: "lot1" }),
    ev("LotQueued", { lotId: "lot2" }),
    ev("AuctionOpened", {}),
    ev("LotOpened", { lotId: "lot1", endsAtMs: at + 30_000 }),
    ev("BidAccepted", { lotId: "lot1", bidId: "b1", paddleId: "pad1", amount: 1_000_000 }),
    ev("LotSold", { lotId: "lot1", bidId: "b1", paddleId: "pad1", amount: 1_000_000 }),
    // The compensating pair: the winning bid is voided-but-visible, the lot
    // returns to the block with a fresh window, the purse restores.
    ev("BidInvalidated", { lotId: "lot1", bidId: "b1", reason: "undo" }),
    ev("LotReopened", { lotId: "lot1", compensatesSeq: 14, endsAtMs: at + 90_000 }),
  ];
}

describe("owner workflow in replay", () => {
  it("invitation → acceptance → grant land in the projection", () => {
    const result = replayAuction(undoNight());
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.projection.ownerInvites["inv1"]).toEqual({
      teamId: "t1",
      acceptedBy: "per1",
      revoked: false,
    });
    expect(result.projection.paddleGrants["gr1"]).toEqual({ teamId: "t1", personId: "per1" });
  });

  it("accepting an unknown invitation fails replay closed", () => {
    seq = 0;
    const events = [ev("OwnerAccepted", { inviteId: "ghost", teamId: "t", personId: "p" })];
    expect(replayAuction(events)).toEqual({ ok: false, atSeq: 1, reason: "unknown_invite" });
  });
});

describe("compensating undo (doc 41 lot.reopen) — replay", () => {
  it("reopen restores the purse, clears the sale, returns the lot to the block", () => {
    const result = replayAuction(undoNight());
    if (!result.ok) {
      throw new Error(result.reason);
    }
    const lot = result.projection.lots["lot1"];
    expect(lot).toMatchObject({
      status: "on_block",
      soldAmount: null,
      soldPaddleId: null,
      leadingBidId: null,
      leadingAmount: null,
      endsAtMs: at + 90_000,
      timerExtensions: 0,
    });
    // The purse restoration: committed money returned to the team.
    expect(result.projection.paddles["pad1"]?.committed).toBe(0);
    // History stays intact: the bid COUNT survives (voided-but-visible).
    expect(lot?.bidCount).toBe(1);
    expect(result.projection.lastOutcome).toMatchObject({ kind: "reopened", lotId: "lot1" });
  });

  it("replay is deterministic across runs (undo produces identical results)", () => {
    const events = undoNight();
    const a = replayAuction(events);
    const b = replayAuction(events);
    expect(a).toEqual(b);
    if (!a.ok || !b.ok) {
      throw new Error("expected ok");
    }
    const snapA = serializeSnapshot(buildAuctionSnapshot(a.projection, REFS, null));
    const snapB = serializeSnapshot(buildAuctionSnapshot(b.projection, REFS, null));
    expect(snapA).toBe(snapB);
  });

  it("reopening a lot that is not sold/unsold is an illegal replayed transition", () => {
    seq = 0;
    const events = [
      ev("LotPrepared", { lotId: "lot1" }),
      ev("LotReopened", { lotId: "lot1", compensatesSeq: 1, endsAtMs: at + 1_000 }),
    ];
    expect(replayAuction(events)).toEqual({
      ok: false,
      atSeq: 2,
      reason: "illegal_replayed_transition",
    });
  });

  it("an unsold lot reopens without purse movement", () => {
    seq = 0;
    const events = [
      ev("LotPrepared", { lotId: "lot1" }),
      ev("LotQueued", { lotId: "lot1" }),
      ev("AuctionOpened", {}),
      ev("LotOpened", { lotId: "lot1", endsAtMs: at + 30_000 }),
      ev("LotUnsold", { lotId: "lot1" }),
      ev("LotReopened", { lotId: "lot1", compensatesSeq: 5, endsAtMs: at + 60_000 }),
    ];
    const result = replayAuction(events);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.projection.lots["lot1"]?.status).toBe("on_block");
  });
});

describe("decideUndo (the pure undo window)", () => {
  it("targets the most recent sale with its evidence", () => {
    const events = undoNight().slice(0, 14); // up to and including LotSold
    const decision = decideUndo(events);
    expect(decision).toEqual({
      ok: true,
      target: {
        kind: "sold",
        lotId: "lot1",
        atSeq: 14,
        bidId: "b1",
        paddleId: "pad1",
        amount: 1_000_000,
      },
    });
  });

  it("targets an unsold pass symmetrically", () => {
    seq = 0;
    const events = [
      ev("LotPrepared", { lotId: "lot1" }),
      ev("LotQueued", { lotId: "lot1" }),
      ev("AuctionOpened", {}),
      ev("LotOpened", { lotId: "lot1", endsAtMs: at + 30_000 }),
      ev("LotUnsold", { lotId: "lot1" }),
    ];
    const decision = decideUndo(events);
    expect(decision).toMatchObject({ ok: true, target: { kind: "unsold", lotId: "lot1" } });
  });

  it("the window closes when the next lot opens (doc 41)", () => {
    seq = 0;
    const events = [
      ev("LotPrepared", { lotId: "lot1" }),
      ev("LotPrepared", { lotId: "lot2" }),
      ev("LotQueued", { lotId: "lot1" }),
      ev("LotQueued", { lotId: "lot2" }),
      ev("AuctionOpened", {}),
      ev("LotOpened", { lotId: "lot1", endsAtMs: at + 30_000 }),
      ev("LotUnsold", { lotId: "lot1" }),
      ev("LotOpened", { lotId: "lot2", endsAtMs: at + 60_000 }),
    ];
    expect(decideUndo(events)).toEqual({ ok: false, reason: "undo_window_closed" });
  });

  it("a reopened lot on the block closes the window too (no double undo)", () => {
    expect(decideUndo(undoNight())).toEqual({ ok: false, reason: "undo_window_closed" });
  });

  it("nothing to undo on a log without resolutions", () => {
    seq = 0;
    expect(decideUndo([ev("AuctionCreated", {})])).toEqual({
      ok: false,
      reason: "nothing_to_undo",
    });
    expect(decideUndo([])).toEqual({ ok: false, reason: "nothing_to_undo" });
  });
});

describe("AuctionLedger (pure projection of the event store)", () => {
  const ACTORS = { actor: "Priya Organizer" };

  it("renders exactly one row per event, in sequence order", () => {
    const events = undoNight();
    const ledger = buildAuctionLedger(events, REFS, ACTORS);
    expect(ledger.length).toBe(events.length);
    expect(ledger.map((row) => row.seq)).toEqual(events.map((event) => event.seq));
  });

  it("rows carry the directive's columns: actor, paddle, team, lot, bid, result, correlation", () => {
    const ledger = buildAuctionLedger(undoNight(), REFS, ACTORS);
    const sale = ledger.find((row) => row.result === "SOLD");
    expect(sale).toMatchObject({
      actorName: "Priya Organizer",
      paddleNumber: "P01",
      teamName: "Arrows",
      lotNumber: "L001",
      playerName: "Kohli",
      amount: 1_000_000,
      correlationId: "corr",
    });
    const undo = ledger.find((row) => row.result.startsWith("UNDO"));
    expect(undo?.result).toBe("UNDO — lot reopened (compensates #14)");
    expect(undo?.lotNumber).toBe("L001");
    const voided = ledger.find((row) => row.result === "Bid voided");
    expect(voided?.reason).toBe("undo");
  });

  it("rejected bids keep their doc-41 code as the reason", () => {
    seq = 0;
    const events = [
      ev("BidRejected", { lotId: "lot1", paddleId: "pad2", amount: 42, code: "BELOW_CURRENT" }),
    ];
    const [row] = buildAuctionLedger(events, REFS, ACTORS);
    expect(row).toMatchObject({
      result: "Bid rejected",
      reason: "BELOW_CURRENT",
      paddleNumber: "P02",
      teamName: "Blasters",
      amount: 42,
    });
  });

  it("is deterministic and never fails on unknown types (rendering, not validation)", () => {
    seq = 0;
    const events = [ev("SomethingFuture", { x: 1 })];
    const a = buildAuctionLedger(events, REFS, ACTORS);
    const b = buildAuctionLedger(events, REFS, ACTORS);
    expect(a).toEqual(b);
    expect(a[0]?.result).toBe("SomethingFuture");
    expect(a[0]?.actorName).toBe("Priya Organizer");
  });

  it("unknown actors render as Unknown, never leak ids into names", () => {
    seq = 0;
    const [row] = buildAuctionLedger([ev("AuctionOpened", {})], REFS, {});
    expect(row?.actorName).toBe("Unknown");
    expect(row?.actorId).toBe("actor");
  });
});

describe("FLOODLIGHT ceremony derivation (deterministic, presentation-only)", () => {
  function snapshotAt(events: AuctionEventEnvelope[]): AuctionSnapshot {
    const replay = replayAuction(events);
    if (!replay.ok) {
      throw new Error(replay.reason);
    }
    return buildAuctionSnapshot(replay.projection, REFS, null);
  }

  function nightUpTo(count: number): AuctionSnapshot {
    return snapshotAt(undoNight().slice(0, count));
  }

  it("walks opening → bid → sold → reopened deterministically", () => {
    const opened = nightUpTo(12); // LotOpened
    const bid = nightUpTo(13); // BidAccepted
    const sold = nightUpTo(14); // LotSold
    const reopened = nightUpTo(16); // LotReopened

    expect(deriveCeremony(null, opened)).toEqual({ phase: "opening", key: "opening-lot1" });
    expect(deriveCeremony(opened, bid)).toEqual({ phase: "bid", key: "bid-b1" });
    expect(deriveCeremony(bid, sold)).toEqual({ phase: "sold", key: "sold-14" });
    expect(deriveCeremony(sold, reopened)).toEqual({ phase: "reopened", key: "reopened-16" });
  });

  it("anti-snipe extension dominates the simultaneous bid", () => {
    seq = 0;
    const base = [
      ev("PaddleIssued", { paddleId: "pad1", teamId: "t1", personId: "p1", paddleNumber: "P01" }),
      ev("PaddleIssued", { paddleId: "pad2", teamId: "t2", personId: "p2", paddleNumber: "P02" }),
      ev("LotPrepared", { lotId: "lot1" }),
      ev("LotQueued", { lotId: "lot1" }),
      ev("AuctionOpened", {}),
      ev("LotOpened", { lotId: "lot1", endsAtMs: at + 30_000 }),
      ev("BidAccepted", { lotId: "lot1", bidId: "b1", paddleId: "pad1", amount: 1_000_000 }),
    ];
    const before = snapshotAt(base);
    const after = snapshotAt([
      ...base,
      ev("BidAccepted", { lotId: "lot1", bidId: "b2", paddleId: "pad2", amount: 1_500_000 }),
      ev("TimerExtended", { lotId: "lot1", endsAtMs: at + 60_000 }),
    ]);
    expect(deriveCeremony(before, after)).toEqual({
      phase: "extension",
      key: "extension-lot1-1",
    });
  });

  it("pause dominates lot moments; recovery dominates everything", () => {
    const sold = nightUpTo(14);
    const pausedNight = [
      ...undoNight().slice(0, 14),
      { ...ev("AuctionPaused", {}), seq: 15, atMs: at + 15 },
    ];
    const paused = snapshotAt(pausedNight);
    expect(deriveCeremony(sold, paused)).toEqual({ phase: "paused", key: "paused" });

    const recoveredNight = [
      ...pausedNight,
      { ...ev("AuctionRecovered", { divergences: 0, eventCount: 15 }), seq: 16, atMs: at + 16 },
    ];
    const recovered = snapshotAt(recoveredNight);
    expect(deriveCeremony(paused, recovered)).toEqual({
      phase: "recovered",
      key: "recovered-1",
    });
  });

  it("steady frames re-derive the SAME key — transitions never re-trigger", () => {
    const bid = nightUpTo(13);
    expect(deriveCeremony(bid, bid)).toEqual(deriveCeremony(bid, bid));
    expect(deriveCeremony(bid, bid).key).toBe("bid-b1");
  });

  it("the snapshot carries the spectator-safe outcome (names, never person ids)", () => {
    const sold = nightUpTo(14);
    expect(sold.lastOutcome).toEqual({
      kind: "sold",
      lotId: "lot1",
      lotNumber: "L001",
      playerName: "Kohli",
      amount: 1_000_000,
      teamName: "Arrows",
      paddleNumber: "P01",
      atSeq: 14,
    });
    expect(JSON.stringify(sold)).not.toContain("per1");
  });
});

// --- M-IP4-4 CERTIFICATION REGRESSIONS ------------------------------------------
// Two defects were found by attacking the platform during certification. Both
// are locked here, in the pure core, where they cost microseconds to catch.

describe("D-1 — undo may never write an unreplayable event", () => {
  /** A lot goes UNSOLD, the conductor requeues it, then reaches for undo. */
  function unsoldThenRequeued(): AuctionEventEnvelope[] {
    seq = 0;
    return [
      ev("AuctionCreated", { competitionId: "comp", lotCount: 1 }),
      ev("PaddleIssued", { paddleId: "pad1", teamId: "t1", personId: "per1", paddleNumber: "P01" }),
      ev("LotPrepared", { lotId: "lot1", registrationId: "r1", lotNumber: "L001" }),
      ev("LotQueued", { lotId: "lot1" }),
      ev("AuctionOpened", {}),
      ev("LotOpened", { lotId: "lot1", endsAtMs: at + 30_000 }),
      ev("LotUnsold", { lotId: "lot1" }),
      ev("LotRequeued", { lotId: "lot1" }),
    ];
  }

  it("refuses to undo a resolution the conductor has already requeued past", () => {
    expect(decideUndo(unsoldThenRequeued())).toEqual({
      ok: false,
      reason: "undo_window_closed",
    });
  });

  it("refuses to undo a resolution whose lot was withdrawn after it resolved", () => {
    const events = [...unsoldThenRequeued(), ev("LotWithdrawn", { lotId: "lot1" })];
    expect(decideUndo(events)).toEqual({ ok: false, reason: "undo_window_closed" });
  });

  it("PROOF: the event undo WOULD have written is rejected by the reducer forever", () => {
    // This is why D-1 was freeze-blocking: the compensating event lands on a
    // lot that replay sees as `queued`, so the log stops folding — and since
    // recovery IS a replay, the auction could never be recovered again.
    const poisoned = [
      ...unsoldThenRequeued(),
      ev("LotReopened", { lotId: "lot1", compensatesSeq: 7, endsAtMs: at + 90_000 }),
    ];
    expect(replayAuction(poisoned)).toEqual({
      ok: false,
      atSeq: 9,
      reason: "illegal_replayed_transition",
    });
  });

  it("a LEGITIMATE undo is untouched: acting on ANOTHER lot never closes the window", () => {
    seq = 0;
    const events = [
      ev("AuctionCreated", { competitionId: "comp", lotCount: 2 }),
      ev("PaddleIssued", { paddleId: "pad1", teamId: "t1", personId: "per1", paddleNumber: "P01" }),
      ev("LotPrepared", { lotId: "lot1", registrationId: "r1", lotNumber: "L001" }),
      ev("LotPrepared", { lotId: "lot2", registrationId: "r2", lotNumber: "L002" }),
      ev("LotQueued", { lotId: "lot1" }),
      ev("AuctionOpened", {}),
      ev("LotOpened", { lotId: "lot1", endsAtMs: at + 30_000 }),
      ev("BidAccepted", { lotId: "lot1", bidId: "b1", paddleId: "pad1", amount: 1_000_000 }),
      ev("LotSold", { lotId: "lot1", bidId: "b1", paddleId: "pad1", amount: 1_000_000 }),
      // A DIFFERENT lot is queued after the sale — irrelevant to lot1's undo.
      ev("LotQueued", { lotId: "lot2" }),
    ];
    expect(decideUndo(events)).toMatchObject({
      ok: true,
      target: { kind: "sold", lotId: "lot1", bidId: "b1", amount: 1_000_000 },
    });
  });
});

describe("D-2 — the bid ledger is replayed, so the money rows can be verified", () => {
  it("an accepted bid demotes the previous leader to outbid", () => {
    seq = 0;
    const events = [
      ev("AuctionCreated", { competitionId: "comp", lotCount: 1 }),
      ev("PaddleIssued", { paddleId: "pad1", teamId: "t1", personId: "per1", paddleNumber: "P01" }),
      ev("PaddleIssued", { paddleId: "pad2", teamId: "t2", personId: "per2", paddleNumber: "P02" }),
      ev("LotPrepared", { lotId: "lot1", registrationId: "r1", lotNumber: "L001" }),
      ev("LotQueued", { lotId: "lot1" }),
      ev("AuctionOpened", {}),
      ev("LotOpened", { lotId: "lot1", endsAtMs: at + 30_000 }),
      ev("BidAccepted", { lotId: "lot1", bidId: "b1", paddleId: "pad1", amount: 1_000_000 }),
      ev("BidAccepted", { lotId: "lot1", bidId: "b2", paddleId: "pad2", amount: 1_500_000 }),
    ];
    const result = replayAuction(events);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.projection.bids).toEqual({
      b1: { lotId: "lot1", paddleId: "pad1", amount: 1_000_000, status: "outbid" },
      b2: { lotId: "lot1", paddleId: "pad2", amount: 1_500_000, status: "accepted" },
    });
  });

  it("an undone sale leaves the winning bid invalidated — voided, never deleted", () => {
    const result = replayAuction(undoNight());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.projection.bids["b1"]).toEqual({
      lotId: "lot1",
      paddleId: "pad1",
      amount: 1_000_000,
      status: "invalidated",
    });
  });

  it("invalidating a bid the log never accepted fails the replay closed", () => {
    seq = 0;
    const events = [
      ev("AuctionCreated", {}),
      ev("BidInvalidated", { lotId: "lot1", bidId: "ghost", reason: "undo" }),
    ];
    expect(replayAuction(events)).toEqual({ ok: false, atSeq: 2, reason: "unknown_bid" });
  });
});

describe("D-3 — the paddle projection carries what recovery needs to verify + heal rows", () => {
  it("PaddleIssued folds identity with a null release timestamp", () => {
    seq = 0;
    const result = replayAuction([
      ev("AuctionCreated", {}),
      ev("PaddleIssued", { paddleId: "pad1", teamId: "t1", personId: "per1", paddleNumber: "P01" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.projection.paddles["pad1"]).toEqual({
      teamId: "t1",
      personId: "per1",
      paddleNumber: "P01",
      committed: 0,
      released: false,
      releasedAtMs: null,
    });
  });

  it("PaddleReleased records the EXACT release timestamp (so recovery heals releasedAt precisely)", () => {
    seq = 0;
    const events = [
      ev("AuctionCreated", {}),
      ev("PaddleIssued", { paddleId: "pad1", teamId: "t1", personId: "per1", paddleNumber: "P01" }),
      ev("PaddleReleased", { paddleId: "pad1", teamId: "t1" }),
    ];
    const releaseAtMs = events[2]?.atMs;
    const result = replayAuction(events);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const paddle = result.projection.paddles["pad1"];
    expect(paddle?.released).toBe(true);
    // The event's atMs is what the aggregate wrote to the row — recovery uses it.
    expect(paddle?.releasedAtMs).toBe(releaseAtMs);
  });
});
