import { describe, expect, it } from "vitest";

import {
  buildPlayerPoster,
  buildSeasonPoster,
  buildTeamPoster,
  buildTopBuysPoster,
  firstNameOf,
  isPosterKind,
  isPosterSize,
  isPosterTheme,
  isTopBuyCount,
  monogramOf,
  normalizeHexColor,
  POSTER_KIND_SIZES,
  POSTER_KINDS,
  POSTER_SIZES,
  shortNameOf,
  type PlayerPosterInput,
  type TeamPosterInput,
  type TeamPosterMember,
  type TopBuyInput,
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
    { name: "Mlaram", role: "all_rounder", pricePaise: 400_000, marks: [], photoUrl: null },
    {
      name: "Prakash Bishnoi",
      role: "bowler",
      pricePaise: 2_100_000,
      marks: ["captain"],
      photoUrl: "data:image/jpeg;base64,AA",
    },
    { name: "Bhaira Ram", role: "batsman", pricePaise: null, marks: ["icon"], photoUrl: null },
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
    // The captain leads the sheet, and carries the face the source sent.
    expect(t.rows[0]?.markerLabel).toBe("C");
    expect(t.rows[0]?.isCaptain).toBe(true);
    expect(t.rows[0]?.photoUrl).toBe("data:image/jpeg;base64,AA");
    expect(t.captainName).toBe("Prakash Bishnoi");
  });

  it("orders captain, icon, retained, then the room's buys in the source's order", () => {
    const member = (name: string, marks: TeamPosterMember["marks"]): TeamPosterMember => ({
      name,
      role: "batter",
      pricePaise: marks.length === 0 ? 100_000 : null,
      marks,
      photoUrl: null,
    });
    const t = buildTeamPoster({
      ...TEAM,
      members: [
        member("Bought One", []),
        member("Kept", ["retained"]),
        member("Bought Two", []),
        member("Star", ["icon"]),
        member("Skipper", ["captain"]),
      ],
    });
    expect(t.rows.map((row) => row.name)).toEqual([
      "Skipper",
      "Star",
      "Kept",
      "Bought One",
      "Bought Two",
    ]);
  });

  it("badges an icon who is also the captain with BOTH marks", () => {
    const t = buildTeamPoster({
      ...TEAM,
      members: [
        {
          name: "Bhaira Ram",
          role: "batsman",
          marks: ["icon", "captain"],
          pricePaise: null,
          photoUrl: null,
        },
      ],
    });
    expect(t.rows[0]?.badges).toEqual(["C", "ICON"]);
    // A table row has room for one word, and ICON is the one people look for.
    expect(t.rows[0]?.markerLabel).toBe("ICON");
  });

  it("names the coach, refuses a colour that is not a hex, and keeps one that is", () => {
    const t = buildTeamPoster({ ...TEAM, coachName: "  Ramesh Godara ", teamColor: "#1f6f43" });
    expect(t.coachName).toBe("Ramesh Godara");
    expect(t.teamColor).toBe("#1F6F43");
    expect(buildTeamPoster({ ...TEAM, coachName: "  ", teamColor: "red" })).toMatchObject({
      coachName: null,
      teamColor: null,
    });
  });

  /*
   * A pre-signed icon never went under the hammer, so it has no price. Printing
   * ₹0 beside their name would read as "the club paid nothing for them".
   */
  it("prices no pre-signed player", () => {
    const t = buildTeamPoster(TEAM);
    const icon = t.rows.find((row) => row.name === "Bhaira Ram");
    expect(icon?.priceLabel).toBeNull();
    expect(icon?.markerLabel).toBe("ICON");
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
      marks: [],
      photoUrl: null,
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
  it("offers a feed square, a 4:5 feed portrait and a full-bleed story, all 1080 wide", () => {
    expect(POSTER_SIZES.square).toEqual({ width: 1080, height: 1080 });
    expect(POSTER_SIZES.portrait).toEqual({ width: 1080, height: 1350 });
    expect(POSTER_SIZES.story).toEqual({ width: 1080, height: 1920 });
  });

  it("draws every kind in at least one size, and the whole season only tall", () => {
    for (const kind of POSTER_KINDS) {
      expect(POSTER_KIND_SIZES[kind].length).toBeGreaterThan(0);
      expect(isPosterKind(kind)).toBe(true);
    }
    expect(POSTER_KIND_SIZES.season).not.toContain("square");
    expect(isPosterKind("constructor")).toBe(false);
    expect(isTopBuyCount(5)).toBe(true);
    expect(isTopBuyCount(7)).toBe(false);
  });

  it("validates theme and size from untrusted query strings", () => {
    expect(isPosterTheme("gold")).toBe(true);
    expect(isPosterTheme("../../etc/passwd")).toBe(false);
    expect(isPosterSize("story")).toBe(true);
    expect(isPosterSize("portrait")).toBe(true);
    expect(isPosterTheme("matchday")).toBe(true);
    expect(isPosterTheme("minimal")).toBe(true);
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

describe("names and colours for small tiles", () => {
  it("shortens to a first name and an initial, and never below one word", () => {
    expect(shortNameOf("Prakash Bishnoi")).toBe("Prakash B.");
    expect(shortNameOf("Mlaram")).toBe("Mlaram");
    expect(shortNameOf("  Dev  Kumar  Nair ")).toBe("Dev N.");
    expect(firstNameOf("Venkataraghavan Subramaniam")).toBe("Venkatara…");
  });

  it("normalizes a team colour, and refuses anything that could escape a CSS string", () => {
    expect(normalizeHexColor("#abc")).toBe("#AABBCC");
    expect(normalizeHexColor(" #1d4e89 ")).toBe("#1D4E89");
    for (const bad of ["red", "#12345", "url(x)", "#123456;background:red", "", null, undefined]) {
      expect(normalizeHexColor(bad)).toBeNull();
    }
  });
});

const BUY = (name: string, price: number, team = "Alpha XI"): TopBuyInput => ({
  playerName: name,
  role: "batter",
  photoUrl: null,
  pricePaise: price,
  teamName: team,
  teamColor: "#1d4e89",
  teamCrestUrl: null,
});

describe("top buys poster", () => {
  it("ranks by price, highest first, and keeps the source's order on a tie", () => {
    const p = buildTopBuysPoster({
      competitionName: "BSCB-5",
      competitionLogoUrl: null,
      count: 3,
      buys: [
        BUY("Cheap", 100_000),
        BUY("Tie A", 500_000),
        BUY("Top", 900_000),
        BUY("Tie B", 500_000),
      ],
    });
    expect(p.rows.map((row) => row.name)).toEqual(["Top", "Tie A", "Tie B"]);
    expect(p.rows.map((row) => row.rankLabel)).toEqual(["01", "02", "03"]);
    expect(p.rows[0]?.priceLabel).toBe("₹9,000");
    expect(p.rows[0]?.teamColor).toBe("#1D4E89");
    expect(p.title).toBe("TOP 3 BUYS");
  });

  it("titles what is ON the poster, not what was asked for", () => {
    const two = buildTopBuysPoster({
      competitionName: "BSCB-5",
      competitionLogoUrl: null,
      count: 10,
      buys: [BUY("One", 100_000), BUY("Two", 200_000)],
    });
    expect(two.title).toBe("TOP 2 BUYS");
    expect(two.chip).toBe("Top 2");
    const one = buildTopBuysPoster({
      competitionName: "BSCB-5",
      competitionLogoUrl: null,
      count: 5,
      buys: [BUY("One", 100_000)],
    });
    expect(one.title).toBe("TOP BUY");
  });
});

describe("season poster", () => {
  it("counts every player and every rupee, and orders each squad like its own poster", () => {
    const p = buildSeasonPoster({
      competitionName: "BSCB-5",
      competitionLogoUrl: null,
      squads: [
        {
          teamName: "Alpha XI",
          teamColor: "#1f6f43",
          teamCrestUrl: null,
          members: TEAM.members,
          spentPaise: 2_500_000,
        },
        {
          teamName: "Beta United",
          teamCrestUrl: null,
          members: TEAM.members.slice(0, 1),
          spentPaise: 400_000,
        },
      ],
    });
    expect(p.countLine).toBe("4 players · 2 teams");
    expect(p.chip).toBe("2 teams");
    expect(p.spentLabel).toBe("₹29,000");
    expect(p.largestSquad).toBe(3);
    expect(p.squads[0]?.rows[0]?.isCaptain).toBe(true);
    expect(p.squads[0]?.teamColor).toBe("#1F6F43");
    expect(p.squads[1]?.countLabel).toBe("1 player");
  });
});
