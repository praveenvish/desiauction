import { describe, expect, it } from "vitest";

import type { LiveAuctionRow, RoomState } from "../../../server/admin/live-views";
import type { EngineRoom } from "../../../server/admin/live-watch";
import { biddingNow, engineHealth, goneQuiet, nothingBiddingLine } from "./live-model";

function room(id: string, state: RoomState): LiveAuctionRow {
  return {
    auctionId: id,
    auctionName: id,
    status: state === "paused" ? "paused" : "live",
    state,
    orgName: "Club",
    orgSlug: "club",
    seasonName: `Season ${id}`,
    seasonSlug: id,
    sport: "cricket",
    lots: { total: 2, sold: 1, unsold: 0, remaining: 1 },
    moneyMoved: 0,
    auctionUnit: "inr",
    bids: { total: 0, lastFiveMinutes: 0 },
    openedAtMs: null,
    lastEventAtMs: null,
  };
}

const troubled = (r: EngineRoom | undefined) => r?.state === "unreachable";

describe("biddingNow / goneQuiet", () => {
  it("keeps only active and paused rooms as bidding; quiet ones fold away", () => {
    const rows = [room("a", "active"), room("q", "quiet"), room("p", "paused")];
    expect(biddingNow(rows).map((r) => r.auctionId)).toEqual(["a", "p"]);
    expect(goneQuiet(rows).map((r) => r.auctionId)).toEqual(["q"]);
  });
});

describe("engineHealth", () => {
  const rows = [room("a", "active"), room("b", "quiet"), room("c", "quiet")];

  it("says the engine is down, once, when every room asked went unanswered", () => {
    const engine: Record<string, EngineRoom> = {
      a: { state: "unreachable" },
      b: { state: "unreachable" },
      c: { state: "not_checked" },
    };
    expect(engineHealth(rows, engine, troubled)).toEqual({ kind: "down", asked: 2 });
  });

  it("is answering when any room replied, and counts rooms with their own trouble", () => {
    const engine: Record<string, EngineRoom> = {
      a: { state: "idle", connectedClients: 3 },
      b: { state: "unreachable" },
    };
    expect(engineHealth(rows, engine, troubled)).toEqual({ kind: "answering", troubled: 1 });
  });

  it("is unasked when nothing is open", () => {
    expect(engineHealth([], {}, troubled)).toEqual({ kind: "unasked" });
  });
});

describe("nothingBiddingLine", () => {
  it("points at the quiet rooms, or says what will appear", () => {
    expect(nothingBiddingLine(26, 10)).toBe(
      "26 rooms are open but have gone quiet — below. A room appears here within 10 seconds of its next bid.",
    );
    expect(nothingBiddingLine(1, 10)).toContain("1 room is open but has gone quiet");
    expect(nothingBiddingLine(0, 10)).toBe(
      "When an organizer opens an auction, it appears here within 10 seconds.",
    );
  });
});
