import { describe, expect, it } from "vitest";

import { redactPurses } from "./auction-snapshot";
import type { AuctionSnapshot, SnapshotPaddleEntry } from "./auction-snapshot";

/**
 * THE SEAL (audit 2026-08-18, P1-6).
 *
 * The server decided that a bidder may not see rivals' remaining money, then
 * broadcast every team's purse to every socket and asked the CLIENT to hide it.
 * Anyone could read the sealed figures in the Network tab. Redaction is now a
 * pure function applied at the transport, per socket, and the scope it takes is
 * bound into the WebSocket ticket's HMAC so a viewer cannot widen it.
 */
function paddle(over: Partial<SnapshotPaddleEntry>): SnapshotPaddleEntry {
  return {
    paddleId: "p1",
    paddleNumber: "P01",
    teamId: "team-a",
    teamName: "A",
    committed: 1_000,
    purseRemaining: 9_000,
    released: false,
    ...over,
  };
}

const snapshot = {
  version: 7,
  paddles: [
    paddle({ paddleId: "p1", teamId: "team-a", teamName: "A" }),
    paddle({
      paddleId: "p2",
      teamId: "team-b",
      teamName: "B",
      committed: 2_000,
      purseRemaining: 8_000,
    }),
    paddle({
      paddleId: "p3",
      teamId: "team-c",
      teamName: "C",
      committed: 3_000,
      purseRemaining: 7_000,
    }),
  ],
} as unknown as AuctionSnapshot;

describe("purse redaction", () => {
  it("a null scope is the conductor's board — every purse survives", () => {
    expect(redactPurses(snapshot, null)).toBe(snapshot);
    expect(redactPurses(snapshot, null).paddles.every((p) => p.purseRemaining !== null)).toBe(true);
  });

  it("a bidder sees their own teams' money and nulls for everyone else", () => {
    const out = redactPurses(snapshot, ["team-a"]);
    const byTeam = new Map(out.paddles.map((p) => [p.teamId, p]));
    expect(byTeam.get("team-a")?.purseRemaining).toBe(9_000);
    expect(byTeam.get("team-a")?.committed).toBe(1_000);
    expect(byTeam.get("team-b")?.purseRemaining).toBeNull();
    expect(byTeam.get("team-b")?.committed).toBeNull();
    expect(byTeam.get("team-c")?.purseRemaining).toBeNull();
  });

  it("an empty scope is an anonymous spectator — no money at all", () => {
    const out = redactPurses(snapshot, []);
    expect(out.paddles.every((p) => p.purseRemaining === null && p.committed === null)).toBe(true);
  });

  it("redaction removes ONLY money — identity and standing are the public record", () => {
    const out = redactPurses(snapshot, []);
    expect(out.paddles.map((p) => p.teamName)).toEqual(["A", "B", "C"]);
    expect(out.paddles.map((p) => p.paddleNumber)).toEqual(["P01", "P01", "P01"]);
    expect(out.version).toBe(7);
  });

  it("does not mutate the canonical snapshot — that copy is what gets hashed", () => {
    const before = JSON.stringify(snapshot);
    redactPurses(snapshot, []);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
