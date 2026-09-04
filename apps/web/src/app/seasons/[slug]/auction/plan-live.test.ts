import { paise } from "@desiauction/core";
import type { AuctionSnapshot } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import type { ResolvedLot } from "../../../../server/auction/live-summary";
import type { LivePlan, LivePlanLot } from "../../../../server/auction/owner-plan";
import { backupFor, evaluateLivePlan, liveCurrentLot, liveLots } from "./plan-live";

/**
 * THE LINE AND THE PADDLE READ THE SAME FRAME (WR-1, M4).
 *
 * These pin the precedence a lot's status is read with (block → history →
 * queue → server), that "leading" is decided by team, and that a team with
 * nothing planned gets nothing — the room unchanged.
 */

const L = (n: number) => paise(n * 100_000);

function lot(over: Partial<LivePlanLot> & { registrationId: string }): LivePlanLot {
  return {
    lotId: `lot-${over.registrationId}`,
    playerName: `Player ${over.registrationId}`,
    basePrice: L(1),
    status: "queued",
    soldToTeamId: null,
    soldPrice: null,
    ...over,
  };
}

function snapshot(over: Partial<AuctionSnapshot>): AuctionSnapshot {
  return {
    version: 9,
    auctionId: "auc",
    auctionName: "Night",
    auctionStatus: "live",
    currentLot: null,
    queue: [],
    paddles: [
      {
        paddleId: "p1",
        paddleNumber: "P01",
        teamId: "me",
        teamName: "Me",
        committed: 0,
        purseRemaining: L(50),
        released: false,
      },
      {
        paddleId: "p2",
        paddleNumber: "P02",
        teamId: "rival",
        teamName: "Rival",
        committed: null,
        purseRemaining: null,
        released: false,
      },
    ],
    lotsResolved: 0,
    lotsTotal: 3,
    lastOutcome: null,
    recoveries: 0,
    ...over,
  };
}

function resolved(over: Partial<ResolvedLot> & { lotId: string }): ResolvedLot {
  return {
    registrationId: null,
    lotNumber: "L001",
    seq: 1,
    playerName: null,
    role: "batter",
    status: "sold",
    soldPrice: L(9),
    teamId: "rival",
    teamName: "Rival",
    isCaptain: false,
    isViceCaptain: false,
    ...over,
  };
}

const plan: LivePlan = {
  lots: [lot({ registrationId: "a" }), lot({ registrationId: "b" }), lot({ registrationId: "c" })],
  planRules: {
    pursePerTeam: L(100),
    squadMin: 3,
    squadMax: 5,
    minPossiblePrice: L(1),
    slabs: [{ upTo: null, step: L(1) }],
  },
  targetsByTeam: {
    me: [
      {
        id: "t1",
        registrationId: "a",
        maxBid: L(15),
        priority: 1,
        fallbackRegistrationId: "b",
        updatedAt: new Date(0),
      },
    ],
  },
};

describe("liveLots", () => {
  it("reads the block first, then the history, then the queue, then the server", () => {
    const lots = liveLots(
      [
        lot({ registrationId: "a", status: "sold", soldToTeamId: "me", soldPrice: L(9) }),
        lot({ registrationId: "b" }),
        lot({ registrationId: "c", status: "prepared" }),
        lot({ registrationId: "d", status: "prepared" }),
      ],
      snapshot({
        currentLot: {
          lotId: "lot-a",
          lotNumber: "L001",
          playerName: "A",
          role: "batter",
          basePrice: L(1),
          status: "on_block",
          endsAtMs: null,
          extensions: 0,
          nextMinimumBid: L(2),
          currentBid: null,
          bidHistory: [],
        },
        queue: [
          {
            lotId: "lot-c",
            lotNumber: "L003",
            playerName: "C",
            role: "batter",
            basePrice: L(1),
            status: "queued",
          },
        ],
      }),
      [resolved({ lotId: "lot-b", status: "sold", teamId: "rival", soldPrice: L(7) })],
    );
    expect(lots.map((l) => [l.registrationId, l.status, l.soldToTeamId, l.soldPrice])).toEqual([
      // Reopened on the block: the server's "sold" no longer holds.
      ["a", "on_block", null, null],
      ["b", "sold", "rival", L(7)],
      ["c", "queued", null, null],
      ["d", "prepared", null, null],
    ]);
  });
});

describe("liveCurrentLot", () => {
  const onBlock = (paddleNumber: string) =>
    snapshot({
      currentLot: {
        lotId: "lot-a",
        lotNumber: "L001",
        playerName: "A",
        role: "batter",
        basePrice: L(1),
        status: "on_block",
        endsAtMs: null,
        extensions: 0,
        nextMinimumBid: L(6),
        currentBid: { bidId: "b1", paddleNumber, teamName: "x", amount: L(5) },
        bidHistory: [],
      },
    });

  it("decides 'leading is mine' by team, and carries the next bid and the leading amount", () => {
    expect(liveCurrentLot(onBlock("P01"), "me")).toEqual({
      lotId: "lot-a",
      nextMinimumBid: L(6),
      leadingAmount: L(5),
      leadingIsMine: true,
    });
    expect(liveCurrentLot(onBlock("P02"), "me")?.leadingIsMine).toBe(false);
    expect(liveCurrentLot(null, "me")).toBeNull();
  });
});

describe("evaluateLivePlan", () => {
  it("is null for a team with nothing planned", () => {
    expect(evaluateLivePlan(plan, "rival", snapshot({}), [], 0)).toBeNull();
    expect(evaluateLivePlan({ ...plan, targetsByTeam: { me: [] } }, "me", null, [], 0)).toBeNull();
  });

  it("uses the snapshot's own purse when a frame has arrived, and the won lots before it", () => {
    const live = evaluateLivePlan(plan, "me", snapshot({}), [], 0);
    expect(live?.budget.purseRemaining).toBe(L(50));
    const cold = evaluateLivePlan(
      plan,
      "me",
      null,
      [resolved({ lotId: "lot-c", status: "sold", teamId: "me", soldPrice: L(30) })],
      1,
    );
    expect(cold?.budget.purseRemaining).toBe(L(70));
    expect(cold?.targets[0]?.outcome).toBe("open");
  });

  it("names the lost target a lot on the block is the backup for", () => {
    const state = evaluateLivePlan(
      plan,
      "me",
      snapshot({
        currentLot: {
          lotId: "lot-b",
          lotNumber: "L002",
          playerName: "B",
          role: "batter",
          basePrice: L(1),
          status: "on_block",
          endsAtMs: null,
          extensions: 0,
          nextMinimumBid: L(2),
          currentBid: null,
          bidHistory: [],
        },
      }),
      [resolved({ lotId: "lot-a", status: "sold", teamId: "rival", soldPrice: L(16) })],
      0,
    );
    expect(state?.targets[0]?.outcome).toBe("lost");
    expect(state?.targets[0]?.effectiveBackup).toBe("b");
    expect(state === null ? null : backupFor(state)).toBe("a");
    // The backup is not itself a target: the line says so, it does not price it.
    expect(state?.currentLot?.verdict).toBe("not_a_target");
  });
});
