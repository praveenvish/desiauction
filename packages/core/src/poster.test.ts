import { describe, expect, it } from "vitest";

import {
  buildPlayerPoster,
  buildTeamPoster,
  isPosterSize,
  isPosterTheme,
  monogramOf,
  POSTER_SIZES,
  type PlayerPosterInput,
  type TeamPosterInput,
} from "./poster";

const PLAYER: PlayerPosterInput = {
  playerName: "Mangilal Bishnoi",
  number: "236",
  role: "all_rounder",
  photoUrl: "https://media.example/p.jpg",
  outcome: "sold",
  pricePaise: 400_000,
  teamName: "Jhoomar 29",
  teamCrestUrl: "https://media.example/c.png",
  competitionName: "Bishnoi Sports Club Bangalore",
  competitionLogoUrl: null,
};

describe("player poster", () => {
  it("renders the sale: stamp, price and the buying team", () => {
    const p = buildPlayerPoster(PLAYER);
    expect(p.stamp).toBe("SOLD");
    expect(p.priceLabel).toBe("₹4,000");
    expect(p.outcomeLine).toBe("SOLD TO JHOOMAR 29");
    expect(p.numberLabel).toBe("236");
    // The role is the SHARED label, not the raw column — the live screens
    // rendered "all rounder" for years by string-replacing the underscore.
    expect(p.roleLine).not.toContain("_");
    expect(p.roleLine.toLowerCase()).toContain("rounder");
  });

  /*
   * A price is rendered ONLY for a sale. An unsold player with a number under
   * their face reads as a valuation nobody made — and it would be the one
   * number on a poster the player is most likely to post about themselves.
   */
  it("never prices an UNSOLD player", () => {
    const p = buildPlayerPoster({
      ...PLAYER,
      outcome: "unsold",
      pricePaise: 400_000,
      teamName: null,
    });
    expect(p.stamp).toBe("UNSOLD");
    expect(p.priceLabel).toBeNull();
    expect(p.outcomeLine).toBe("Unsold");
  });

  it("never prices a RETAINED or ICON player, but still names the squad", () => {
    for (const outcome of ["retained", "icon"] as const) {
      const p = buildPlayerPoster({ ...PLAYER, outcome, pricePaise: 900_000 });
      expect(p.priceLabel).toBeNull();
      expect(p.outcomeLine).toContain("JHOOMAR 29");
    }
  });

  it("falls back to a monogram when consent withheld the photo", () => {
    const p = buildPlayerPoster({ ...PLAYER, photoUrl: null });
    expect(p.photoUrl).toBeNull();
    expect(p.monogram).toBe("MB");
  });

  it("clamps a name that would wrap off the poster", () => {
    const p = buildPlayerPoster({
      ...PLAYER,
      playerName: "Venkataraghavan Subramaniam Krishnamurthy",
    });
    expect(p.name.length).toBeLessThanOrEqual(22);
    expect(p.name.endsWith("…")).toBe(true);
  });

  it("treats a blank number as absent rather than printing an empty badge", () => {
    expect(buildPlayerPoster({ ...PLAYER, number: "   " }).numberLabel).toBeNull();
    expect(buildPlayerPoster({ ...PLAYER, number: null }).numberLabel).toBeNull();
  });
});

const TEAM: TeamPosterInput = {
  teamName: "Jhoomar 29",
  teamCrestUrl: null,
  competitionName: "BSCB-5",
  competitionLogoUrl: null,
  members: [
    { name: "Mlaram", role: "all_rounder", pricePaise: 400_000, marker: null },
    { name: "Prakash Bishnoi", role: "bowler", pricePaise: 2_100_000, marker: "captain" },
    { name: "Bhaira Ram", role: "batsman", pricePaise: null, marker: "icon" },
  ],
  spentPaise: 2_500_000,
  pursePaise: 9_700_000,
};

describe("team poster", () => {
  it("lists the squad with prices, markers and the money left", () => {
    const t = buildTeamPoster(TEAM);
    expect(t.rows).toHaveLength(3);
    expect(t.squadLabel).toBe("3 players");
    expect(t.spentLabel).toBe("₹25,000");
    expect(t.remainingLabel).toBe("₹72,000");
    expect(t.rows[1]?.markerLabel).toBe("C");
  });

  /*
   * A pre-signed icon never went under the hammer, so it has no price. Printing
   * ₹0 beside their name would read as "the club paid nothing for them".
   */
  it("prices no pre-signed player", () => {
    const t = buildTeamPoster(TEAM);
    expect(t.rows[2]?.priceLabel).toBeNull();
    expect(t.rows[2]?.markerLabel).toBe("ICON");
  });

  it("never reports negative money left, however the purse was configured", () => {
    const t = buildTeamPoster({ ...TEAM, spentPaise: 99_999_999, pursePaise: 100_000 });
    expect(t.remainingLabel).toBe("₹0");
  });

  /*
   * How many rows FIT is the renderer's problem — it knows the size it is
   * drawing. A pure model that silently dropped players would produce a squad
   * poster missing somebody's name, which is the one bug nobody would report
   * and everybody would notice.
   */
  it("drops nobody from a large squad", () => {
    const members = Array.from({ length: 18 }, (_, i) => ({
      name: `Player ${String(i)}`,
      role: "batsman",
      pricePaise: 100_000,
      marker: null,
    }));
    expect(buildTeamPoster({ ...TEAM, members }).rows).toHaveLength(18);
  });

  it("says '1 player' rather than '1 players'", () => {
    expect(buildTeamPoster({ ...TEAM, members: TEAM.members.slice(0, 1) }).squadLabel).toBe(
      "1 player",
    );
  });
});

describe("poster shapes and themes", () => {
  /*
   * 1080 wide because that is what a phone uploads without re-compressing, and
   * NOT 1200x630 — the link-preview shape, which is wrong for the two places a
   * poster is actually posted.
   */
  it("offers a feed square and a full-bleed story, both 1080 wide", () => {
    expect(POSTER_SIZES.square).toEqual({ width: 1080, height: 1080 });
    expect(POSTER_SIZES.story).toEqual({ width: 1080, height: 1920 });
  });

  it("validates theme and size from untrusted query strings", () => {
    expect(isPosterTheme("gold")).toBe(true);
    expect(isPosterTheme("../../etc/passwd")).toBe(false);
    expect(isPosterSize("story")).toBe(true);
    expect(isPosterSize("banner")).toBe(false);
  });

  it("builds a monogram from one name, two names, or nonsense", () => {
    expect(monogramOf("Mlaram")).toBe("M");
    expect(monogramOf("Dev Nair")).toBe("DN");
    expect(monogramOf("  ")).toBe("?");
  });

  /*
   * Found by looking at a rendered poster, not by reading the function: a demo
   * season called "Demo Cup (settled)" wore the monogram "D(" on its crest tile,
   * because the bracketed word had a letter in it and then contributed its
   * opening parenthesis. Bracketed suffixes are an ordinary way to name a
   * season, so this is the common case, not an exotic one.
   */
  it("takes initials from LETTERS, so a bracketed season is not 'D('", () => {
    expect(monogramOf("Demo Cup (settled)")).toBe("DS");
    expect(monogramOf("Bishnoi Sports Club (Bangalore)")).toBe("BB");
    expect(monogramOf("'Quoted' Name")).toBe("QN");
    expect(monogramOf("!!! ???")).toBe("?");
  });
});
