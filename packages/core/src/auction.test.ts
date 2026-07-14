import { describe, expect, it } from "vitest";

import {
  AUCTION_MACHINE,
  AUCTION_STATUSES,
  BID_MACHINE,
  DEFAULT_AUCTION_CONFIG,
  LOT_MACHINE,
  LOT_STATUSES,
  auctionTransition,
  basePriceFor,
  bidTransition,
  decideBid,
  extendOnBid,
  holdRemainingMs,
  isClosingSoon,
  isTimerExpired,
  isValidSlabs,
  ladderContains,
  ladderStep,
  lotNumber,
  lotTransition,
  minPossiblePrice,
  nextMinimumBid,
  openLotTimer,
  paddleNumber,
  replayAuction,
  requeueAllowed,
  resumeLotTimer,
  validateAuctionConfig,
  type AuctionEventEnvelope,
  type BidInput,
  type IncrementSlab,
} from "./auction";
import { paise, comparePaise, multiplyPaise, parsePaise, serializePaise } from "./money";

const READY = { paddleCount: 2, queuedLots: 1, unresolvedLots: 0 };

describe("auction lifecycle machine", () => {
  it("walks the canonical path: scheduled → live ⇄ paused → completed → reconciled", () => {
    expect(auctionTransition("scheduled", "open", READY)).toEqual({ ok: true, next: "live" });
    expect(auctionTransition("live", "pause")).toEqual({ ok: true, next: "paused" });
    expect(auctionTransition("paused", "resume")).toEqual({ ok: true, next: "live" });
    expect(auctionTransition("live", "complete", READY)).toEqual({ ok: true, next: "completed" });
    expect(auctionTransition("completed", "reconcile")).toEqual({ ok: true, next: "reconciled" });
  });

  it("abort (abandoned) is available from every non-terminal state and only those", () => {
    for (const from of ["scheduled", "live", "paused"] as const) {
      expect(auctionTransition(from, "abort")).toEqual({ ok: true, next: "abandoned" });
    }
    expect(auctionTransition("completed", "abort").ok).toBe(false);
    expect(auctionTransition("reconciled", "abort").ok).toBe(false);
    expect(auctionTransition("abandoned", "abort").ok).toBe(false);
  });

  it("open requires ≥2 paddles and ≥1 queued lot (invariant 15 slice)", () => {
    expect(auctionTransition("scheduled", "open")).toEqual({ ok: false, reason: "guard_failed" });
    expect(auctionTransition("scheduled", "open", { ...READY, paddleCount: 1 })).toEqual({
      ok: false,
      reason: "guard_failed",
    });
    expect(auctionTransition("scheduled", "open", { ...READY, queuedLots: 0 })).toEqual({
      ok: false,
      reason: "guard_failed",
    });
  });

  it("complete is blocked while any lot is unresolved (on block / frozen)", () => {
    expect(auctionTransition("live", "complete", { ...READY, unresolvedLots: 1 })).toEqual({
      ok: false,
      reason: "guard_failed",
    });
    expect(auctionTransition("paused", "complete", READY)).toEqual({
      ok: true,
      next: "completed",
    });
  });

  it("terminal states have no exits; undeclared edges are illegal", () => {
    expect(auctionTransition("scheduled", "pause")).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    expect(auctionTransition("live", "open", READY)).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    for (const terminal of ["reconciled", "abandoned"] as const) {
      for (const command of [
        "open",
        "pause",
        "resume",
        "complete",
        "reconcile",
        "abort",
      ] as const) {
        expect(auctionTransition(terminal, command, READY).ok).toBe(false);
      }
    }
    // The machine descriptor mirrors the edge table exactly.
    expect(AUCTION_MACHINE.length).toBe(
      AUCTION_STATUSES.reduce((n, s) => n + AUCTION_MACHINE.filter((e) => e.from === s).length, 0),
    );
  });
});

describe("lot lifecycle machine", () => {
  const LED = { hasLeadingBid: true, requeueAllowed: false };
  const UNLED = { hasLeadingBid: false, requeueAllowed: false };

  it("walks prepare → queue → on_block → sold with a leading bid", () => {
    expect(lotTransition("prepared", "queue")).toEqual({ ok: true, next: "queued" });
    expect(lotTransition("queued", "open")).toEqual({ ok: true, next: "on_block" });
    expect(lotTransition("on_block", "sell", LED)).toEqual({ ok: true, next: "sold" });
  });

  it("sell requires a leading bid; pass requires NO leading bid", () => {
    expect(lotTransition("on_block", "sell", UNLED)).toEqual({ ok: false, reason: "guard_failed" });
    expect(lotTransition("on_block", "pass", LED)).toEqual({ ok: false, reason: "guard_failed" });
    expect(lotTransition("on_block", "pass", UNLED)).toEqual({ ok: true, next: "unsold" });
  });

  it("anti-snipe: closing_soon can extend back to on_block; both can freeze", () => {
    expect(lotTransition("on_block", "closing")).toEqual({ ok: true, next: "closing_soon" });
    expect(lotTransition("closing_soon", "extend")).toEqual({ ok: true, next: "on_block" });
    expect(lotTransition("closing_soon", "hold")).toEqual({ ok: true, next: "frozen" });
    expect(lotTransition("on_block", "hold")).toEqual({ ok: true, next: "frozen" });
  });

  it("frozen exits to sold / unsold / requeue under the same guards", () => {
    expect(lotTransition("frozen", "sell", LED)).toEqual({ ok: true, next: "sold" });
    expect(lotTransition("frozen", "pass", UNLED)).toEqual({ ok: true, next: "unsold" });
    expect(
      lotTransition("frozen", "requeue", { hasLeadingBid: false, requeueAllowed: true }),
    ).toEqual({ ok: true, next: "queued" });
  });

  it("unsold requeues only while the policy allows", () => {
    expect(
      lotTransition("unsold", "requeue", { hasLeadingBid: false, requeueAllowed: true }),
    ).toEqual({ ok: true, next: "queued" });
    expect(
      lotTransition("unsold", "requeue", { hasLeadingBid: false, requeueAllowed: false }),
    ).toEqual({ ok: false, reason: "guard_failed" });
    expect(requeueAllowed({ mode: "requeue", rounds: 2 }, 1)).toBe(true);
    expect(requeueAllowed({ mode: "requeue", rounds: 2 }, 2)).toBe(false);
    expect(requeueAllowed({ mode: "final" }, 0)).toBe(false);
  });

  it("withdraw is legal only before the block; sold and withdrawn are terminal", () => {
    expect(lotTransition("prepared", "withdraw")).toEqual({ ok: true, next: "withdrawn" });
    expect(lotTransition("queued", "withdraw")).toEqual({ ok: true, next: "withdrawn" });
    expect(lotTransition("on_block", "withdraw")).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    for (const terminal of ["sold", "withdrawn"] as const) {
      for (const command of [
        "queue",
        "open",
        "closing",
        "extend",
        "hold",
        "sell",
        "pass",
        "requeue",
        "withdraw",
      ] as const) {
        expect(
          lotTransition(terminal, command, { hasLeadingBid: true, requeueAllowed: true }).ok,
        ).toBe(false);
      }
    }
    expect(LOT_MACHINE.some((e) => e.from === "sold")).toBe(false);
    expect(LOT_STATUSES.length).toBe(8);
  });
});

describe("bid record machine", () => {
  it("accepted → outbid → invalidated; invalidated is terminal", () => {
    expect(bidTransition("accepted", "outbid")).toEqual({ ok: true, next: "outbid" });
    expect(bidTransition("accepted", "invalidate")).toEqual({ ok: true, next: "invalidated" });
    expect(bidTransition("outbid", "invalidate")).toEqual({ ok: true, next: "invalidated" });
    expect(bidTransition("outbid", "outbid")).toEqual({ ok: false, reason: "illegal_transition" });
    expect(bidTransition("invalidated", "outbid").ok).toBe(false);
    expect(BID_MACHINE.length).toBe(3);
  });
});

describe("money value object (M-IP4-1 extension)", () => {
  it("compares, scales and round-trips deterministically — no floats anywhere", () => {
    expect(comparePaise(paise(100), paise(200))).toBe(-1);
    expect(comparePaise(paise(200), paise(200))).toBe(0);
    expect(comparePaise(paise(300), paise(200))).toBe(1);
    expect(multiplyPaise(paise(2_500_000), 7)).toBe(17_500_000);
    expect(() => multiplyPaise(paise(10), -1)).toThrow();
    expect(serializePaise(paise(110500000))).toBe("110500000");
    expect(parsePaise("110500000")).toEqual({ ok: true, value: 110500000 });
    // Fail closed: only canonical integer strings parse.
    for (const bad of ["", "01", "1.5", "-3", "1e6", "₹100", "9007199254740993"]) {
      expect(parsePaise(bad).ok).toBe(false);
    }
  });
});

describe("increment ladder (doc 41 slabs)", () => {
  const slabs: IncrementSlab[] = [
    { upTo: paise(10_000_000), step: paise(500_000) }, // < ₹1L: +₹5k
    { upTo: paise(50_000_000), step: paise(1_000_000) }, // < ₹5L: +₹10k
    { upTo: null, step: paise(2_500_000) }, // above: +₹25k
  ];
  const base = paise(1_000_000); // ₹10k

  it("validates slab shape (ordered, last open-ended, positive steps)", () => {
    expect(isValidSlabs(slabs)).toBe(true);
    expect(isValidSlabs([])).toBe(false);
    expect(isValidSlabs([{ upTo: paise(100), step: paise(10) }])).toBe(false); // last not open
    expect(isValidSlabs([{ upTo: null, step: paise(0) }])).toBe(false);
  });

  it("the step follows the slab of the CURRENT price", () => {
    expect(ladderStep(slabs, paise(5_000_000))).toBe(500_000);
    expect(ladderStep(slabs, paise(10_000_000))).toBe(1_000_000); // boundary enters next slab
    expect(ladderStep(slabs, paise(99_000_000))).toBe(2_500_000);
  });

  it("membership is exact: rungs only, across slab boundaries", () => {
    expect(ladderContains(base, slabs, paise(1_500_000))).toBe(true); // one rung
    expect(ladderContains(base, slabs, paise(1_700_000))).toBe(false); // off-rung
    expect(ladderContains(base, slabs, base)).toBe(true); // the base itself
    expect(ladderContains(base, slabs, paise(500_000))).toBe(false); // below base
    // Walk across the first boundary: …9_500_000 → 10_000_000 → 11_000_000.
    expect(ladderContains(base, slabs, paise(10_000_000))).toBe(true);
    expect(ladderContains(base, slabs, paise(10_500_000))).toBe(false);
    expect(ladderContains(base, slabs, paise(11_000_000))).toBe(true);
  });

  it("nextMinimumBid is the base when unled, else exactly one rung up", () => {
    expect(nextMinimumBid(base, slabs, null)).toBe(base);
    expect(nextMinimumBid(base, slabs, paise(9_500_000))).toBe(10_000_000);
    expect(nextMinimumBid(base, slabs, paise(10_000_000))).toBe(11_000_000);
  });
});

describe("bid validation gauntlet (doc 41 order, exact codes)", () => {
  const okInput: BidInput = {
    auctionStatus: "live",
    lotStatus: "on_block",
    basePrice: paise(1_000_000),
    leadingAmount: paise(1_500_000),
    leadingTeamId: "team-other",
    teamId: "team-me",
    bidderAuthorized: true,
    amountRaw: 2_000_000,
    slabs: [{ upTo: null, step: paise(500_000) }],
    purseRemaining: paise(100_000_000),
    squadSize: 3,
    squadMin: 8,
    squadMax: 15,
    minPossiblePrice: paise(1_000_000),
    roleCount: 1,
    roleMax: 4,
  };

  it("accepts a well-formed bid", () => {
    expect(decideBid(okInput)).toEqual({ ok: true, amount: 2_000_000 });
  });

  it("returns the FIRST failing code in gauntlet order", () => {
    expect(decideBid({ ...okInput, auctionStatus: "paused" })).toEqual({
      ok: false,
      code: "LOT_NOT_OPEN",
    });
    expect(decideBid({ ...okInput, lotStatus: "queued" })).toEqual({
      ok: false,
      code: "LOT_NOT_OPEN",
    });
    expect(decideBid({ ...okInput, bidderAuthorized: false })).toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    });
    expect(decideBid({ ...okInput, leadingTeamId: "team-me" })).toEqual({
      ok: false,
      code: "ALREADY_LEADING",
    });
    expect(decideBid({ ...okInput, amountRaw: 1.5 })).toEqual({
      ok: false,
      code: "INVALID_AMOUNT",
    });
    expect(decideBid({ ...okInput, amountRaw: -5 })).toEqual({
      ok: false,
      code: "INVALID_AMOUNT",
    });
    expect(decideBid({ ...okInput, amountRaw: 500_000 })).toEqual({
      ok: false,
      code: "BELOW_BASE",
    });
    expect(decideBid({ ...okInput, amountRaw: 1_500_000 })).toEqual({
      ok: false,
      code: "BELOW_CURRENT",
    });
    expect(decideBid({ ...okInput, amountRaw: 2_100_000 })).toEqual({
      ok: false,
      code: "INVALID_INCREMENT",
    });
    expect(decideBid({ ...okInput, purseRemaining: paise(1_900_000) })).toEqual({
      ok: false,
      code: "BUDGET_EXCEEDED",
    });
    // Reserve: 8 - 3 - 1 = 4 more players × ₹10k min = 4_000_000 must remain.
    expect(decideBid({ ...okInput, purseRemaining: paise(5_500_000) })).toEqual({
      ok: false,
      code: "RESERVE_VIOLATION",
    });
    expect(decideBid({ ...okInput, squadSize: 15 })).toEqual({ ok: false, code: "SQUAD_FULL" });
    expect(decideBid({ ...okInput, roleCount: 4 })).toEqual({ ok: false, code: "ROLE_LIMIT" });
  });

  it("closing_soon still accepts bids; the first bid needs no leader", () => {
    expect(decideBid({ ...okInput, lotStatus: "closing_soon" }).ok).toBe(true);
    expect(
      decideBid({ ...okInput, leadingAmount: null, leadingTeamId: null, amountRaw: 1_000_000 }),
    ).toEqual({ ok: true, amount: 1_000_000 });
  });

  it("is deterministic: identical input, identical verdict", () => {
    expect(decideBid(okInput)).toEqual(decideBid({ ...okInput }));
  });
});

describe("timer model + auto-extension (invariant 14)", () => {
  const policy = { initialSeconds: 30, extensionSeconds: 15 };
  const T0 = 1_000_000;

  it("opening gives the full initial window", () => {
    const timer = openLotTimer(T0, policy);
    expect(timer).toEqual({ opensAtMs: T0, endsAtMs: T0 + 30_000, extensions: 0 });
    expect(isTimerExpired(timer, T0 + 29_999)).toBe(false);
    expect(isTimerExpired(timer, T0 + 30_000)).toBe(true);
  });

  it("a last-second bid extends to now + extension; an early bid does not", () => {
    const timer = openLotTimer(T0, policy);
    // Early bid (25s remain > 15s extension): unchanged.
    const early = extendOnBid(timer, T0 + 5_000, policy);
    expect(early.extended).toBe(false);
    expect(early.timer.endsAtMs).toBe(T0 + 30_000);
    // Late bid (2s remain): endsAt = bidTime + 15s.
    const late = extendOnBid(timer, T0 + 28_000, policy);
    expect(late.extended).toBe(true);
    expect(late.timer.endsAtMs).toBe(T0 + 43_000);
    expect(late.timer.extensions).toBe(1);
  });

  it("the timer NEVER shrinks and never exceeds now + initial", () => {
    const timer = { opensAtMs: T0, endsAtMs: T0 + 60_000, extensions: 3 };
    // A bid now must not pull endsAt down to now+15s.
    const result = extendOnBid(timer, T0 + 1_000, policy);
    expect(result.extended).toBe(false);
    expect(result.timer.endsAtMs).toBe(T0 + 60_000);
    // And an extension can never grant more than a fresh lot's runway.
    const fresh = openLotTimer(T0, policy);
    const capped = extendOnBid(fresh, T0 + 29_999, policy);
    expect(capped.timer.endsAtMs).toBeLessThanOrEqual(T0 + 29_999 + 30_000);
  });

  it("extension sequence is deterministic: folding the same bid times gives the same end", () => {
    const bids = [T0 + 20_000, T0 + 29_000, T0 + 41_000];
    const fold = (): number =>
      bids.reduce((timer, at) => extendOnBid(timer, at, policy).timer, openLotTimer(T0, policy))
        .endsAtMs;
    expect(fold()).toBe(fold());
    expect(fold()).toBe(T0 + 41_000 + 15_000);
  });

  it("hold freezes the remainder; resume re-attaches it to server-now", () => {
    const timer = openLotTimer(T0, policy);
    const remaining = holdRemainingMs(timer, T0 + 22_000);
    expect(remaining).toBe(8_000);
    const resumed = resumeLotTimer(remaining, T0 + 90_000, timer.extensions);
    expect(resumed.endsAtMs).toBe(T0 + 98_000);
    // A hold after expiry freezes zero, never negative runway.
    expect(holdRemainingMs(timer, T0 + 99_000)).toBe(0);
  });

  it("closing-soon threshold is the extension window", () => {
    const timer = openLotTimer(T0, policy);
    expect(isClosingSoon(timer, T0 + 10_000, policy)).toBe(false); // 20s remain
    expect(isClosingSoon(timer, T0 + 16_000, policy)).toBe(true); // 14s remain
    expect(isClosingSoon(timer, T0 + 31_000, policy)).toBe(false); // expired
  });
});

describe("auction config", () => {
  it("the doc-41 defaults validate; broken configs fail closed with a reason", () => {
    expect(validateAuctionConfig(DEFAULT_AUCTION_CONFIG)).toEqual({ ok: true });
    expect(validateAuctionConfig({ ...DEFAULT_AUCTION_CONFIG, squadMax: 2, squadMin: 8 }).ok).toBe(
      false,
    );
    expect(validateAuctionConfig({ ...DEFAULT_AUCTION_CONFIG, slabs: [] }).ok).toBe(false);
    expect(
      validateAuctionConfig({
        ...DEFAULT_AUCTION_CONFIG,
        timer: { initialSeconds: 10, extensionSeconds: 20 },
      }).ok,
    ).toBe(false);
  });

  it("base price bands resolve fail-closed to the default; min price feeds the reserve", () => {
    expect(basePriceFor(DEFAULT_AUCTION_CONFIG, "A")).toBe(5_000_000);
    expect(basePriceFor(DEFAULT_AUCTION_CONFIG, "unknown")).toBe(1_000_000);
    expect(basePriceFor(DEFAULT_AUCTION_CONFIG, null)).toBe(1_000_000);
    expect(minPossiblePrice(DEFAULT_AUCTION_CONFIG)).toBe(1_000_000);
  });

  it("paddle and lot numbers are deterministic and human-friendly", () => {
    expect(paddleNumber(1)).toBe("P01");
    expect(paddleNumber(12)).toBe("P12");
    expect(lotNumber(1)).toBe("L001");
    expect(lotNumber(120)).toBe("L120");
  });
});

describe("replay reducer (the recovery spine)", () => {
  const at = 1_700_000_000_000;
  let seq = 0;
  const ev = (type: string, payload: Record<string, unknown> = {}): AuctionEventEnvelope => ({
    seq: ++seq,
    type,
    atMs: at + seq,
    actor: "actor",
    correlationId: "corr",
    payload,
  });

  function fullNight(): AuctionEventEnvelope[] {
    seq = 0;
    return [
      ev("AuctionCreated", { competitionId: "comp", lotCount: 2 }),
      ev("PaddleIssued", { paddleId: "pad1", teamId: "t1", personId: "per1", paddleNumber: "P01" }),
      ev("PaddleIssued", { paddleId: "pad2", teamId: "t2", personId: "per2", paddleNumber: "P02" }),
      ev("LotPrepared", { lotId: "lot1", registrationId: "reg1", lotNumber: "L001" }),
      ev("LotPrepared", { lotId: "lot2", registrationId: "reg2", lotNumber: "L002" }),
      ev("LotQueued", { lotId: "lot1" }),
      ev("LotQueued", { lotId: "lot2" }),
      ev("AuctionOpened", {}),
      ev("LotOpened", { lotId: "lot1", endsAtMs: at + 30_000 }),
      ev("BidAccepted", { lotId: "lot1", bidId: "bid1", paddleId: "pad1", amount: 1_000_000 }),
      ev("TimerExtended", { lotId: "lot1", endsAtMs: at + 45_000 }),
      ev("BidAccepted", { lotId: "lot1", bidId: "bid2", paddleId: "pad2", amount: 1_500_000 }),
      ev("BidRejected", {
        lotId: "lot1",
        paddleId: "pad1",
        amount: 1_200_000,
        code: "BELOW_CURRENT",
      }),
      ev("LotSold", { lotId: "lot1", bidId: "bid2", paddleId: "pad2", amount: 1_500_000 }),
      ev("LotOpened", { lotId: "lot2", endsAtMs: at + 90_000 }),
      ev("LotUnsold", { lotId: "lot2" }),
      ev("LotRequeued", { lotId: "lot2" }),
      ev("AuctionPaused", {}),
      ev("AuctionResumed", {}),
      ev("AuctionClosed", {}),
    ];
  }

  it("folds a full auction night into the exact projection, deterministically", () => {
    const events = fullNight();
    const first = replayAuction(events);
    const second = replayAuction(events);
    expect(first).toEqual(second);
    if (!first.ok) {
      throw new Error("expected ok");
    }
    const p = first.projection;
    expect(p.status).toBe("completed");
    expect(p.lastSeq).toBe(events.length);
    expect(p.lots["lot1"]).toMatchObject({
      status: "sold",
      bidCount: 2,
      soldAmount: 1_500_000,
      soldPaddleId: "pad2",
      leadingBidId: "bid2",
    });
    // Requeue reset the leader and counted the round.
    expect(p.lots["lot2"]).toMatchObject({ status: "queued", roundsUsed: 1, leadingBidId: null });
    // Purse projection: pad2 committed the sale amount; pad1 committed nothing.
    expect(p.paddles["pad2"]?.committed).toBe(1_500_000);
    expect(p.paddles["pad1"]?.committed).toBe(0);
    // Rejected bids left no state — evidence only.
    expect(p.lots["lot1"]?.bidCount).toBe(2);
  });

  it("fails closed on a sequence gap (no silent absorption of a corrupted log)", () => {
    const events = fullNight();
    const gapped = events.filter((e) => e.seq !== 3);
    const result = replayAuction(gapped);
    expect(result).toEqual({ ok: false, atSeq: 4, reason: "sequence_gap" });
  });

  it("fails closed on unknown event types and illegal replayed transitions", () => {
    seq = 0;
    expect(replayAuction([ev("SomethingNew", {})])).toEqual({
      ok: false,
      atSeq: 1,
      reason: "unknown_event_type",
    });
    seq = 0;
    const badOrder = [
      ev("LotPrepared", { lotId: "lot1" }),
      // A bid against a lot that was never opened is an illegal replay.
      ev("BidAccepted", { lotId: "lot1", bidId: "b", paddleId: "p", amount: 10 }),
    ];
    expect(replayAuction(badOrder)).toEqual({
      ok: false,
      atSeq: 2,
      reason: "illegal_replayed_transition",
    });
  });

  it("re-proves invariant 14 during replay: a shrinking timer is a corrupt log", () => {
    seq = 0;
    const events = [
      ev("LotPrepared", { lotId: "lot1" }),
      ev("LotQueued", { lotId: "lot1" }),
      ev("LotOpened", { lotId: "lot1", endsAtMs: 50_000 }),
      ev("TimerExtended", { lotId: "lot1", endsAtMs: 40_000 }), // shrank!
    ];
    expect(replayAuction(events)).toEqual({ ok: false, atSeq: 4, reason: "timer_shrank" });
  });

  it("an empty log replays to the initial scheduled state", () => {
    const result = replayAuction([]);
    expect(result).toEqual({
      ok: true,
      projection: {
        status: "scheduled",
        lots: {},
        paddles: {},
        ownerInvites: {},
        paddleGrants: {},
        lastOutcome: null,
        recoveries: 0,
        lastSeq: 0,
        eventCount: 0,
      },
    });
  });
});
