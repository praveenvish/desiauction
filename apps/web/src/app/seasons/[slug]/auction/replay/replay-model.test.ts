import { describe, expect, it } from "vitest";

import {
  bidsIn,
  chapterAt,
  chaptersOf,
  lotRowsAt,
  summaryOf,
  type ReplayEvent,
} from "./replay-model";

let seq = 0;
const ev = (type: string, payload: Record<string, unknown> = {}, atMs = 0): ReplayEvent => {
  seq += 1;
  return { seq, type, atMs, payload };
};

/* A small night: A sells to P1 after two bids, B passes, B comes back and sells to P2. */
const events: ReplayEvent[] = [
  ev("AuctionOpened", {}, 60_000), // 1
  ev("LotOpened", { lotId: "A" }), // 2
  ev("BidAccepted", { lotId: "A", paddleId: "P2", amount: 1000 }), // 3
  ev("BidAccepted", { lotId: "A", paddleId: "P1", amount: 1500 }), // 4
  ev("LotSold", { lotId: "A", paddleId: "P1", amount: 1500 }), // 5
  ev("LotOpened", { lotId: "B" }), // 6
  ev("LotUnsold", { lotId: "B" }), // 7
  ev("LotRequeued", { lotId: "B" }), // 8
  ev("LotOpened", { lotId: "B" }), // 9
  ev("BidAccepted", { lotId: "B", paddleId: "P2", amount: 900 }), // 10
  ev("LotSold", { lotId: "B", paddleId: "P2", amount: 900 }), // 11
  ev("AuctionClosed", {}, 60_000 * 17), // 12
];

describe("chaptersOf", () => {
  it("makes one chapter per time a lot went on the block, re-runs included", () => {
    const chapters = chaptersOf(events);
    expect(chapters.map((c) => [c.lotId, c.round, c.openAt, c.endAt])).toEqual([
      ["A", 1, 2, 5],
      ["B", 1, 6, 7],
      ["B", 2, 9, 11],
    ]);
    expect(chapters[0]?.result).toEqual({ sold: true, paddleId: "P1", amount: 1500 });
    expect(chapters[1]?.result).toEqual({ sold: false });
  });

  it("leaves a lot still on the block open", () => {
    expect(chaptersOf(events.slice(0, 3))[0]).toMatchObject({ endAt: null, result: null });
  });
});

describe("chapterAt", () => {
  const chapters = chaptersOf(events);
  it("is the lot on the block, else the last one decided", () => {
    expect(chapterAt(chapters, 1)).toBeNull();
    expect(chapterAt(chapters, 3)?.lotId).toBe("A");
    expect(chapterAt(chapters, 8)).toMatchObject({ lotId: "B", round: 1 });
    expect(chapterAt(chapters, 12)).toMatchObject({ lotId: "B", round: 2 });
  });
});

describe("lotRowsAt", () => {
  const chapters = chaptersOf(events);
  it("says where each lot stands at a moment", () => {
    expect(lotRowsAt(chapters, ["B", "A", "C"], 3).map((r) => [r.lotId, r.state])).toEqual([
      ["A", "bidding"],
      ["B", "waiting"],
      ["C", "waiting"],
    ]);
    const end = lotRowsAt(chapters, ["A", "B"], 12);
    expect(end.map((r) => [r.lotId, r.state, r.rounds])).toEqual([
      ["A", "sold", 1],
      ["B", "sold", 2],
    ]);
    expect(lotRowsAt(chapters, ["A", "B"], 8)[1]).toMatchObject({ state: "unsold", jumpTo: 6 });
  });
});

describe("bidsIn", () => {
  it("draws only this lot's bids, up to the moment", () => {
    const [a] = chaptersOf(events);
    expect(a).toBeDefined();
    if (a === undefined) return;
    expect(bidsIn(events, a, 12)).toEqual([
      { amount: 1000, paddleId: "P2" },
      { amount: 1500, paddleId: "P1" },
    ]);
    expect(bidsIn(events, a, 3)).toEqual([{ amount: 1000, paddleId: "P2" }]);
  });
});

describe("summaryOf", () => {
  it("counts every lot once, by its last hammer", () => {
    const summary = summaryOf(events, chaptersOf(events), 2);
    expect(summary).toMatchObject({ sold: 2, unsold: 0, lots: 2, minutes: 16 });
    expect(summary.top.map((t) => [t.lotId, t.amount])).toEqual([
      ["A", 1500],
      ["B", 900],
    ]);
    expect(summary.bought).toEqual({ P1: 1, P2: 1 });
  });

  it("counts a pass that was never re-run as unsold", () => {
    const summary = summaryOf(events.slice(0, 7), chaptersOf(events.slice(0, 7)), 2);
    expect(summary).toMatchObject({ sold: 1, unsold: 1, minutes: null });
  });
});
