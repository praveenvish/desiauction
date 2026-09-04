import { describe, expect, it } from "vitest";

import { teamPurseRows } from "../../app/seasons/[slug]/auction/purse-board";

/**
 * THE SEAL MUST NOT BECOME A NUMBER.
 *
 * The engine redacts a team's money per audience: a bidder's socket carries
 * their own purses and nulls the rest, and an ANONYMOUS watcher of /board gets
 * nothing at all. `purseRemaining` has always modelled that with `null`, which
 * the surfaces render as "sealed". `committed` did not — it started at 0 and
 * stayed there — so the projector board printed a confident
 *
 *     TOTAL SPEND  ₹0
 *
 * beside a correct "PLAYERS SOLD 78" and a correct "MOST EXPENSIVE ₹60,000",
 * for a night on which ₹28,40,000 had actually changed hands. Found in the
 * 2026-08-22 production rehearsal, on the one screen two hundred people watch.
 */

const TEAMS = [
  { id: "team-a", name: "Alpha", shortName: "ALP", primaryColor: null },
  { id: "team-b", name: "Bravo", shortName: "BRA", primaryColor: null },
];

function snapshot(paddles: unknown[]): never {
  return { paddles, currentLot: null } as never;
}

const paddle = (over: Record<string, unknown>) => ({
  paddleNumber: "P01",
  teamId: "team-a",
  teamName: "Alpha",
  released: false,
  committed: 0,
  purseRemaining: 0,
  ...over,
});

describe("teamPurseRows — redacted money stays redacted", () => {
  it("reports null committed when every paddle of a team arrived sealed", () => {
    const rows = teamPurseRows(
      snapshot([
        paddle({ teamId: "team-a", teamName: "Alpha", committed: null, purseRemaining: null }),
        paddle({
          paddleNumber: "P02",
          teamId: "team-b",
          teamName: "Bravo",
          committed: null,
          purseRemaining: null,
        }),
      ]),
      TEAMS,
    );
    for (const row of rows) {
      expect(row.committed).toBeNull();
      expect(row.purseRemaining).toBeNull();
      expect(row.total).toBeNull();
    }
    // The board sums only what it was sent; nothing was sent, so there is no total.
    const visible = rows.map((r) => r.committed).filter((v) => v !== null);
    expect(visible).toHaveLength(0);
  });

  it("still adds up the money a conductor IS entitled to", () => {
    const rows = teamPurseRows(
      snapshot([
        paddle({ teamId: "team-a", committed: 455_000_00, purseRemaining: 1_545_000_00 }),
        paddle({
          paddleNumber: "P02",
          teamId: "team-b",
          teamName: "Bravo",
          committed: 505_000_00,
          purseRemaining: 1_495_000_00,
        }),
      ]),
      TEAMS,
    );
    const byId = new Map(rows.map((r) => [r.teamId, r]));
    expect(byId.get("team-a")?.committed).toBe(455_000_00);
    expect(byId.get("team-a")?.total).toBe(2_000_000_00);
    expect(byId.get("team-b")?.committed).toBe(505_000_00);
  });

  it("keeps a team with no paddle at a knowable zero, not a seal", () => {
    // Nobody has claimed for Bravo: they have genuinely spent nothing, and the
    // board may say so. That is a different fact from "you may not know".
    const rows = teamPurseRows(
      snapshot([paddle({ teamId: "team-a", committed: 10_000_00, purseRemaining: 90_000_00 })]),
      TEAMS,
    );
    expect(rows.find((r) => r.teamId === "team-b")?.committed).toBe(0);
    expect(rows.find((r) => r.teamId === "team-a")?.committed).toBe(10_000_00);
  });

  /**
   * The PUBLIC board is the case where NOTHING is visible: an anonymous watcher
   * of /board is sent no money at all, so the purse-per-team scan finds nothing
   * to borrow from. It used to fall back to a literal 0, which the board then
   * printed as a fact — "Demo Panthers ₹0 PURSE REMAINING" on the projector,
   * for a franchise holding its entire purse. A team whose purse cannot be
   * known must read "sealed", exactly like a team whose purse was withheld.
   */
  it("does not invent a zero purse for an unclaimed team when every purse is sealed", () => {
    const rows = teamPurseRows(
      snapshot([paddle({ teamId: "team-a", committed: null, purseRemaining: null })]),
      TEAMS,
    );
    // team-b holds no paddle, and nothing on the wire says what a purse is.
    expect(rows.find((r) => r.teamId === "team-b")?.purseRemaining).toBeNull();
    expect(rows.find((r) => r.teamId === "team-b")?.total).toBeNull();
  });

  it("still lends the real purse to an unclaimed team when money IS visible", () => {
    // The conductor's own board: team-a's money came through, so team-b's
    // untouched purse is genuinely derivable and must still be shown.
    const rows = teamPurseRows(
      snapshot([paddle({ teamId: "team-a", committed: 10_000_00, purseRemaining: 90_000_00 })]),
      TEAMS,
    );
    expect(rows.find((r) => r.teamId === "team-b")?.purseRemaining).toBe(100_000_00);
  });

  it("does not let a sealed team poison the purse-per-team derivation", () => {
    const rows = teamPurseRows(
      snapshot([
        paddle({ teamId: "team-a", committed: 10_000_00, purseRemaining: 90_000_00 }),
        paddle({
          paddleNumber: "P02",
          teamId: "team-b",
          teamName: "Bravo",
          committed: null,
          purseRemaining: null,
        }),
      ]),
      TEAMS,
    );
    expect(rows.find((r) => r.teamId === "team-a")?.total).toBe(100_000_00);
    expect(rows.find((r) => r.teamId === "team-b")?.total).toBeNull();
  });
});
