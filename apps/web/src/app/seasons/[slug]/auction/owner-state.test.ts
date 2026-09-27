import type { AuctionSnapshot } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import type { AuctionRules } from "../../../../server/auction/live-summary";
import {
  activeJump,
  jumpReducer,
  ownerStanceOf,
  stateLineOf,
  type OwnerStance,
} from "./owner-state";

/**
 * THE OWNER'S STATE IS ONE PURE ANSWER. These pin the sentence an owner reads
 * first, the order the refusals are decided in (the same order the paddle
 * always used), and the two-step rule for bigger bids: a chosen amount never
 * outlives the situation it was chosen in.
 */

type Lot = NonNullable<AuctionSnapshot["currentLot"]>;
type Bid = NonNullable<Lot["currentBid"]>;

// Points season, ×100 scale: base 1,000 pts, +500 steps.
const P = (n: number) => n * 100;
const rules: AuctionRules = {
  pursePerTeam: P(100_000),
  squadMin: 12,
  squadMax: 12,
  minPossiblePrice: P(1_000),
  initialSeconds: 30,
  extensionSeconds: 10,
  slabs: [{ upTo: null, step: P(500) }],
};

const paddle = (n: string, teamId: string, teamName: string, purse = P(100_000)) => ({
  paddleId: `pad-${n}`,
  paddleNumber: n,
  teamId,
  teamName,
  committed: 0,
  purseRemaining: purse,
  released: false,
});

const bid = (paddleNumber: string, teamName: string, amount: number): Bid => ({
  bidId: `b-${paddleNumber}-${String(amount)}`,
  paddleNumber,
  teamName,
  amount,
});

function frame(opts: {
  bids?: Bid[];
  status?: AuctionSnapshot["auctionStatus"];
  myPurse?: number;
  lotId?: string;
}): { lot: Lot; snapshot: AuctionSnapshot } {
  const bids = opts.bids ?? [];
  const lot: Lot = {
    lotId: opts.lotId ?? "lot-1",
    lotNumber: "L001",
    playerName: "Deepak Kadam",
    role: "bowler",
    basePrice: P(1_000),
    status: "on_block",
    endsAtMs: null,
    extensions: 0,
    nextMinimumBid: P(1_000),
    currentBid: bids.at(-1) ?? null,
    bidHistory: bids,
  };
  const snapshot: AuctionSnapshot = {
    version: 1,
    auctionId: "a",
    auctionName: "Night",
    auctionStatus: opts.status ?? "live",
    currentLot: lot,
    queue: [],
    paddles: [
      paddle("P01", "mm", "Mumbai Mavericks", opts.myPurse),
      paddle("P02", "pp", "Pune Panthers"),
      // A second paddle for Mumbai: the engine decides leading by TEAM.
      paddle("P04", "mm", "Mumbai Mavericks", opts.myPurse),
    ],
    lotsResolved: 0,
    lotsTotal: 37,
    lastOutcome: null,
    recoveries: 0,
  };
  return { lot, snapshot };
}

const stance = (f: ReturnType<typeof frame>, squadSigned = 2): OwnerStance =>
  ownerStanceOf({ ...f, rules, myPaddleNumber: "P01", squadSigned });
const ledger = (amount: number) => `${(amount / 100).toLocaleString("en-IN")} pts`;

describe("ownerStanceOf + stateLineOf", () => {
  it("open: no bids yet — the next bid is the opening bid", () => {
    const s = stance(frame({}));
    expect(s.kind).toBe("open");
    expect(s.raise).toBe(P(1_000));
    expect(s.jumps).toEqual([P(1_500), P(2_000), P(2_500)]);
    expect(stateLineOf(s, ledger)).toMatchObject({
      tone: "accent",
      title: "No bids yet — be the first",
      detail: "Opening bid is 1,000 pts.",
    });
  });

  it("winning: my team leads (any of my team's paddles)", () => {
    const s = stance(frame({ bids: [bid("P04", "Mumbai Mavericks", P(2_000))] }));
    expect(s.kind).toBe("winning");
    expect(s.reason).toBe("leading");
    expect(stateLineOf(s, ledger).title).toBe("You're winning at 2,000 pts");
  });

  it("outbid: I was in this lot and another team now leads", () => {
    const s = stance(
      frame({
        bids: [bid("P01", "Mumbai Mavericks", P(1_000)), bid("P02", "Pune Panthers", P(1_500))],
      }),
    );
    expect(s.kind).toBe("outbid");
    expect(stateLineOf(s, ledger)).toMatchObject({
      tone: "warning",
      title: "Pune Panthers bid 1,500 pts",
      detail: "Bid 2,000 pts to take the lead back.",
    });
  });

  it("chasing: another team leads and I have not bid", () => {
    const s = stance(frame({ bids: [bid("P02", "Pune Panthers", P(1_000))] }));
    expect(s.kind).toBe("chasing");
    expect(stateLineOf(s, ledger).title).toBe("Pune Panthers leads at 1,000 pts");
  });

  it("paused outranks everything, leading included", () => {
    const s = stance(frame({ status: "paused", bids: [bid("P01", "Mumbai Mavericks", P(1_000))] }));
    expect(s).toMatchObject({ kind: "blocked", reason: "paused" });
    expect(stateLineOf(s, ledger).title).toBe("Bidding is paused");
  });

  it("squad full", () => {
    const s = stance(frame({}), 12);
    expect(s).toMatchObject({ kind: "blocked", reason: "squad-full" });
  });

  it("past the budget: names the ceiling and what is still to buy", () => {
    // 20,000 left, 2 signed of a 12 minimum: 9 more must be held at 1,000 each.
    const s = stance(
      frame({ myPurse: P(20_000), bids: [bid("P02", "Pune Panthers", P(11_000))] }),
      2,
    );
    expect(s.ceiling).toBe(P(11_000));
    expect(s).toMatchObject({ kind: "blocked", reason: "too-dear", stillToBuy: 10 });
    expect(stateLineOf(s, ledger)).toMatchObject({
      title: "This is past your budget",
      detail: "You can go up to 11,000 pts — 10 players still to buy.",
    });
  });

  it("an empty purse says so instead of 'up to 0'", () => {
    const s = stance(frame({ myPurse: P(9_000) }), 2);
    expect(s.ceiling).toBe(0);
    expect(stateLineOf(s, ledger).detail).toBe(
      "Your purse can't cover another signing at this price.",
    );
  });
});

describe("two-step bigger bids", () => {
  it("select, re-select to take back, clear", () => {
    let state = jumpReducer(null, { type: "select", lotId: "lot-1", amount: P(2_000) });
    expect(state).toEqual({ lotId: "lot-1", amount: P(2_000) });
    state = jumpReducer(state, { type: "select", lotId: "lot-1", amount: P(2_500) });
    expect(state).toEqual({ lotId: "lot-1", amount: P(2_500) });
    expect(jumpReducer(state, { type: "select", lotId: "lot-1", amount: P(2_500) })).toBeNull();
    expect(jumpReducer(state, { type: "clear" })).toBeNull();
  });

  it("holds while the chosen amount is still a bigger amount on offer", () => {
    const f = frame({ bids: [bid("P02", "Pune Panthers", P(1_000))] });
    const choice = { lotId: "lot-1", amount: P(2_500) };
    expect(activeJump(choice, { lotId: "lot-1", stance: stance(f), disabled: false })).toBe(
      P(2_500),
    );
  });

  it("lapses when the bidding reaches it", () => {
    // Pune bid 2,000: the next bid IS 2,500 now, so the choice means nothing.
    const f = frame({ bids: [bid("P02", "Pune Panthers", P(2_000))] });
    const choice = { lotId: "lot-1", amount: P(2_500) };
    expect(activeJump(choice, { lotId: "lot-1", stance: stance(f), disabled: false })).toBeNull();
  });

  it("lapses on another lot, a locked paddle, a lost connection, or an empty purse", () => {
    const choice = { lotId: "lot-1", amount: P(2_000) };
    const open = frame({});
    expect(
      activeJump(choice, { lotId: "lot-2", stance: stance(open), disabled: false }),
    ).toBeNull();
    expect(activeJump(choice, { lotId: "lot-1", stance: stance(open), disabled: true })).toBeNull();
    const leading = frame({ bids: [bid("P01", "Mumbai Mavericks", P(1_000))] });
    expect(
      activeJump(choice, { lotId: "lot-1", stance: stance(leading), disabled: false }),
    ).toBeNull();
    // 12,000 left, 2 signed: ceiling 12,000 − 9 × 1,000 = 3,000 — the chips
    // above it are out of reach, the one within it is not.
    const thin = frame({ myPurse: P(12_000) });
    expect(
      activeJump(
        { lotId: "lot-1", amount: P(2_500) },
        { lotId: "lot-1", stance: stance(thin), disabled: false },
      ),
    ).toBe(P(2_500));
    const thinner = frame({ myPurse: P(11_000) });
    expect(
      activeJump(
        { lotId: "lot-1", amount: P(2_500) },
        { lotId: "lot-1", stance: stance(thinner), disabled: false },
      ),
    ).toBeNull();
  });
});
