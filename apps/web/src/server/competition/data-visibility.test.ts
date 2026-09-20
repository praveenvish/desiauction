import { describe, expect, it } from "vitest";

import { workspaceSightFor } from "./team-workspace";

/**
 * RN-1 §7 — GATE THE DATA, NOT THE BUTTON.
 *
 * The most repeated defect in this codebase was a read model that resolved a
 * capability and used it for ONE thing: hiding a button. The data it guarded
 * shipped to everybody with membership — and because `acceptOwnerJoin` makes
 * every accepted team owner a viewer-level member of the host club, the people
 * receiving it were the RIVAL BIDDERS. That is a competitive-integrity failure
 * before it is a privacy one.
 *
 * `teamsWorkspace` gets it right — the gated keys are OMITTED, not nulled, so
 * nothing can be read back out of the RSC stream. This pins the DECISION for
 * every reader in the matrix; `e2e/live-auction.spec.ts` proves the
 * SERIALIZATION end-to-end, with a control, for the row that matters most.
 */

const NOBODY = { canManage: false, canSettle: false, canReview: false, canConduct: false };

describe("who is served the money", () => {
  it("running the season is money authority over its auction", () => {
    expect(workspaceSightFor({ ...NOBODY, canManage: true }).money).toBe(true);
  });

  it("so is keeping the books — one season cannot answer this two ways", () => {
    expect(workspaceSightFor({ ...NOBODY, canSettle: true }).money).toBe(true);
  });

  it("reviewing registrations is NOT money authority", () => {
    expect(workspaceSightFor({ ...NOBODY, canReview: true }).money).toBe(false);
  });

  it("neither is conducting the auction", () => {
    // Conduct is narrow on purpose (core/capabilities): run the night, see who
    // is bidding. An auctioneer holding the club's purse figures would be
    // `auction.conduct` quietly widening into money authority.
    expect(workspaceSightFor({ ...NOBODY, canConduct: true }).money).toBe(false);
  });
});

describe("who is served the roster — names, phone numbers, marks", () => {
  it("whoever may review registrations, because that is where these live", () => {
    expect(workspaceSightFor({ ...NOBODY, canReview: true }).roster).toBe(true);
    expect(workspaceSightFor({ ...NOBODY, canManage: true }).roster).toBe(true);
  });

  it("NOT the auctioneer: the pool is names and base prices, not phone numbers", () => {
    expect(workspaceSightFor({ ...NOBODY, canConduct: true }).roster).toBe(false);
  });

  it("NOT the books: settlement is money, and money is not people", () => {
    expect(workspaceSightFor({ ...NOBODY, canSettle: true }).roster).toBe(false);
  });
});

describe("the matrix, reader by reader (RN-1 §7)", () => {
  const READERS = [
    {
      who: "organizer",
      caps: { ...NOBODY, canManage: true, canReview: true },
      money: true,
      roster: true,
    },
    { who: "staff", caps: { ...NOBODY, canReview: true }, money: false, roster: true },
    { who: "settlement desk", caps: { ...NOBODY, canSettle: true }, money: true, roster: false },
    { who: "auctioneer", caps: { ...NOBODY, canConduct: true }, money: false, roster: false },
    // A team owner holds none of these ON THE SEASON — `acceptOwnerJoin` gives
    // them club membership, which is not a capability. This is the rival-bidder
    // row, and it is the one proved end-to-end in e2e/live-auction.spec.ts.
    { who: "team owner", caps: NOBODY, money: false, roster: false },
    { who: "player", caps: NOBODY, money: false, roster: false },
    { who: "club member", caps: NOBODY, money: false, roster: false },
  ] as const;

  for (const reader of READERS) {
    it(`${reader.who}: money=${String(reader.money)} roster=${String(reader.roster)}`, () => {
      expect(workspaceSightFor(reader.caps)).toEqual({
        money: reader.money,
        roster: reader.roster,
      });
    });
  }

  it("holding nothing is served nothing — membership is not a capability", () => {
    expect(workspaceSightFor(NOBODY)).toEqual({ money: false, roster: false });
  });

  it("no capability grants the OTHER half by accident", () => {
    // Every single capability, checked in isolation: none turns on both unless
    // it is `competition.manage`, which is the one that genuinely owns both.
    const singles = ["canManage", "canSettle", "canReview", "canConduct"] as const;
    for (const only of singles) {
      const sight = workspaceSightFor({ ...NOBODY, [only]: true });
      if (only !== "canManage") {
        expect(sight.money && sight.roster, `${only} turned on both halves`).toBe(false);
      }
    }
  });
});
