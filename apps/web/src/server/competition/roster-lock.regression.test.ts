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

import { parseRegistrationCsv } from "@desiauction/core";

import { marksFreezeWithRoster, squadMarksIn } from "./roster-lock";

describe("ROSTER LOCK — what the auction freezes, and what it must not", () => {
  it("freezes the marks that move the auction pool", () => {
    // `auctionReady` builds the pool from approved minus `isIcon`, and squad
    // arithmetic counts `teamId`. Both were priced into bids already placed.
    expect(marksFreezeWithRoster({ isIcon: true })).toBe(true);
    expect(marksFreezeWithRoster({ isIcon: false })).toBe(true);
    expect(marksFreezeWithRoster({ teamId: "01ABC" })).toBe(true);
    expect(marksFreezeWithRoster({ teamId: null })).toBe(true);
  });

  it("freezes retention, which moves the pool exactly as an icon mark does", () => {
    /*
     * Retention was absent from this predicate until it had a writer, and the
     * omission was free while the only way to set `is_retained` was hand-written
     * SQL. It is not free now. `auctionReady` filters the pool on
     * `isIcon OR isRetained` and `placeBid` counts both into the squadMax cap,
     * so retaining somebody mid-auction would delete a lot the queue is already
     * built from and shrink a squad's remaining slots after bids were priced
     * against the old count.
     *
     * UN-retaining is the same event in reverse — it ADDS a player to a pool
     * the queue was already built from — which is why `false` freezes too.
     */
    expect(marksFreezeWithRoster({ isRetained: true })).toBe(true);
    expect(marksFreezeWithRoster({ isRetained: false })).toBe(true);
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
    // Retaining last season's captain is one request that does both, and the
    // half that moves the pool decides.
    expect(marksFreezeWithRoster({ isCaptain: true, isRetained: true })).toBe(true);
  });

  it("has nothing to freeze when nothing was asked for", () => {
    expect(marksFreezeWithRoster({})).toBe(false);
  });
});

/**
 * THE LOCK, APPLIED TO A FILE.
 *
 * The dashboard's toggles have been refused after the auction opens since
 * DA-04. An import carrying the same columns had to be refused for the same
 * reason, or the lock would be a property of the button rather than of the
 * auction — and a file is the faster way to change fifty of them at once.
 *
 * It asks the SAME predicate rather than a second copy of the rule, which is
 * the whole point of this function living outside `actions.ts`.
 */
describe("what a file carries, and what the lock makes of it", () => {
  const parse = (header: string, ...lines: string[]) =>
    parseRegistrationCsv([header, ...lines].join("\n")).rows;

  it("sees nothing to freeze in an ordinary roster", () => {
    // The common case, and it must keep importing mid-auction: a new
    // registration lands in `submitted` and reaches the pool through the same
    // human approval gate.
    const rows = parse("name,phone,role", "Rohit,9876543210,batter");
    expect(squadMarksIn(rows)).toEqual({});
    expect(marksFreezeWithRoster(squadMarksIn(rows))).toBe(false);
  });

  it("freezes a file that assigns a team", () => {
    const rows = parse("name,phone,role,team", "Rohit,9876543210,batter,Andheri Arrows");
    expect(marksFreezeWithRoster(squadMarksIn(rows))).toBe(true);
  });

  it("freezes a file that marks an icon or a retention", () => {
    for (const column of ["is_icon", "is_retained"]) {
      const rows = parse(`name,phone,role,${column}`, "Rohit,9876543210,batter,yes");
      expect(marksFreezeWithRoster(squadMarksIn(rows)), column).toBe(true);
    }
  });

  it("does NOT freeze a file that only names captains", () => {
    // The captain badge decides nothing the engine priced a bid against, and a
    // drafted player's team is settled ON auction night — freezing it would
    // close the one window in which the answer is knowable.
    const rows = parse("name,phone,role,is_captain", "Rohit,9876543210,batter,yes");
    expect(squadMarksIn(rows)).toEqual({});
    expect(marksFreezeWithRoster(squadMarksIn(rows))).toBe(false);
  });

  it("reads a column of blanks as an absent mark, not a false one", () => {
    /*
     * A club's sheet has the column and fills in four of sixty cells. Treating
     * the fifty-six blanks as `false` would make every such file a roster
     * change, refused mid-auction for asserting nothing.
     */
    const rows = parse(
      "name,phone,role,is_icon",
      "Rohit,9876543210,batter,",
      "Jasprit,9876543211,bowler,",
    );
    expect(squadMarksIn(rows)).toEqual({});
    expect(marksFreezeWithRoster(squadMarksIn(rows))).toBe(false);
  });

  it("freezes the whole file when a single row carries a mark", () => {
    // One retention in sixty rows still changes the pool the queue was built
    // from, so the file is a roster change however little of it is filled in.
    const rows = parse(
      "name,phone,role,is_icon",
      "Rohit,9876543210,batter,",
      "Jasprit,9876543211,bowler,yes",
    );
    expect(marksFreezeWithRoster(squadMarksIn(rows))).toBe(true);
  });
});
