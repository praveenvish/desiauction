/**
 * PERMANENT REGRESSION — the captain a tournament could never name.
 *
 * A full real-browser run of the lifecycle (4 teams, 50 players, 42 lots)
 * could not satisfy "one captain per team". The mark was refused after the
 * auction opened with "The auction has started — squads are set by the auction
 * now, not by hand.", and before it opened there was nothing to captain: a
 * drafted player's team is decided ON auction night. The two windows never
 * overlapped, so the badge was unreachable for every player who went under the
 * hammer — which is every player who is not an icon.
 *
 * The lock itself is right. It was just drawn around one mark too many.
 */
import { describe, expect, it } from "vitest";

import { marksFreezeWithRoster } from "./roster-lock";

describe("ROSTER LOCK — what the auction freezes, and what it must not", () => {
  it("freezes the marks that move the auction pool", () => {
    // `auctionReady` builds the pool from approved minus `isIcon`, and squad
    // arithmetic counts `teamId`. Both were priced into bids already placed.
    expect(marksFreezeWithRoster({ isIcon: true })).toBe(true);
    expect(marksFreezeWithRoster({ isIcon: false })).toBe(true);
    expect(marksFreezeWithRoster({ teamId: "01ABC" })).toBe(true);
    expect(marksFreezeWithRoster({ teamId: null })).toBe(true);
  });

  it("does NOT freeze the captain badge — the one mark only auction night can settle", () => {
    expect(marksFreezeWithRoster({ isCaptain: true })).toBe(false);
    expect(marksFreezeWithRoster({ isCaptain: false })).toBe(false);
  });

  it("freezes a captain change that also moves the player", () => {
    // Naming a captain is free; moving them is not, and a request that does
    // both is still a roster move.
    expect(marksFreezeWithRoster({ isCaptain: true, teamId: "01ABC" })).toBe(true);
    expect(marksFreezeWithRoster({ isCaptain: true, isIcon: true })).toBe(true);
  });

  it("has nothing to freeze when nothing was asked for", () => {
    expect(marksFreezeWithRoster({})).toBe(false);
  });
});
