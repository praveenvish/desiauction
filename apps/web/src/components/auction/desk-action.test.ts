import { describe, expect, it } from "vitest";

import { deskActionOf, deskActionWords, isGavelAction, type DeskInput } from "./desk-action";

const queue = [
  { lotId: "lot-2", lotNumber: "L002", playerName: "Rohan Kulkarni" },
  { lotId: "lot-3", lotNumber: "L003", playerName: "Siddharth Iyer" },
];

function input(overrides: Partial<DeskInput> = {}): DeskInput {
  return { status: "live", connected: true, lot: null, queue, ...overrides };
}

const format = {
  amount: (value: number) => `${value.toLocaleString("en-IN")} pts`,
  teamLabel: (name: string) => name.split(" ")[0] ?? name,
};

describe("deskActionOf — the one next step", () => {
  it("between lots it opens the head of the queue, by name", () => {
    expect(deskActionOf(input())).toEqual({
      kind: "open-next",
      lotId: "lot-2",
      lotNumber: "L002",
      playerName: "Rohan Kulkarni",
    });
  });

  it("with a bid on the block it sells to the leader at the leading amount", () => {
    const action = deskActionOf(
      input({ lot: { currentBid: { teamName: "Pune Panthers", amount: 1500 } } }),
    );
    expect(action).toEqual({ kind: "sell", teamName: "Pune Panthers", amount: 1500 });
    expect(isGavelAction(action)).toBe(true);
  });

  it("with no bid on the block it passes — the same gavel, a different verdict", () => {
    const action = deskActionOf(input({ lot: { currentBid: null } }));
    expect(action).toEqual({ kind: "pass" });
    expect(isGavelAction(action)).toBe(true);
  });

  it("a lot on the block wins over the queue behind it", () => {
    expect(deskActionOf(input({ lot: { currentBid: null } })).kind).toBe("pass");
  });

  it("paused is resume, lot or no lot — the clock is what is stopped", () => {
    expect(deskActionOf(input({ status: "paused" })).kind).toBe("resume");
    expect(
      deskActionOf(input({ status: "paused", lot: { currentBid: { teamName: "A", amount: 10 } } }))
        .kind,
    ).toBe("resume");
  });

  it("a scheduled night queues its players first, then opens", () => {
    expect(deskActionOf(input({ status: "scheduled", queue: [] })).kind).toBe("queue-lots");
    expect(deskActionOf(input({ status: "scheduled" })).kind).toBe("open-auction");
  });

  it("an empty queue between lots is the end of the night", () => {
    expect(deskActionOf(input({ queue: [] })).kind).toBe("complete");
  });

  it("without a snapshot nothing is offered, however the server's record reads", () => {
    expect(deskActionOf(input({ connected: false })).kind).toBe("connecting");
    expect(deskActionOf(input({ connected: false, status: "scheduled" })).kind).toBe("connecting");
  });

  it("a finished night is finished whether or not the engine answered", () => {
    for (const status of ["completed", "reconciled", "abandoned"]) {
      expect(deskActionOf(input({ status })).kind).toBe("finished");
      expect(deskActionOf(input({ status, connected: false })).kind).toBe("finished");
    }
  });

  it("an unknown status is never read as live", () => {
    expect(deskActionOf(input({ status: "draft" })).kind).toBe("connecting");
  });

  it("opening, pausing and resuming are never gavel acts", () => {
    for (const status of ["scheduled", "paused"]) {
      expect(isGavelAction(deskActionOf(input({ status })))).toBe(false);
    }
    expect(isGavelAction(deskActionOf(input()))).toBe(false);
  });
});

describe("deskActionWords — the button names the act", () => {
  it("names the player the next lot opens", () => {
    expect(deskActionWords(deskActionOf(input()), format).label).toBe("Open next: Rohan Kulkarni");
  });

  it("falls back to the lot number for an unnamed player", () => {
    const action = deskActionOf(
      input({ queue: [{ lotId: "x", lotNumber: "L009", playerName: null }] }),
    );
    expect(deskActionWords(action, format).label).toBe("Open next: L009");
  });

  it("names who the gavel sells to, and for how much", () => {
    const action = deskActionOf(
      input({ lot: { currentBid: { teamName: "Pune Panthers", amount: 1500 } } }),
    );
    // In full where there is room; by the name the hall uses on a phone.
    expect(deskActionWords(action, format).label).toBe("Hold to sell to Pune Panthers · 1,500 pts");
    expect(deskActionWords(action, format).shortLabel).toBe("Hold to sell · Pune 1,500 pts");
    // Without a shortener the short label still names the franchise.
    expect(deskActionWords(action, { amount: format.amount }).shortLabel).toBe(
      "Hold to sell · Pune Panthers 1,500 pts",
    );
  });

  it("says a pass is a pass", () => {
    expect(deskActionWords({ kind: "pass" }, format).label).toBe("Hold to pass — no bids");
  });

  it("every live act has words, and a reason", () => {
    for (const action of [
      { kind: "connecting" },
      { kind: "queue-lots" },
      { kind: "open-auction" },
      { kind: "resume" },
      { kind: "pass" },
      { kind: "complete" },
    ] as const) {
      const words = deskActionWords(action, format);
      expect(words.label.length).toBeGreaterThan(0);
      expect(words.why.length).toBeGreaterThan(0);
    }
  });
});
