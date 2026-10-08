import {
  buildPlayerPoster,
  buildSeasonPoster,
  buildTeamPoster,
  buildTopBuysPoster,
  POSTER_SIZES,
  type PosterOutcome,
  type PosterSize,
  type TeamPosterMember,
} from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { imageResponse } from "../../../../server/image-text/image-response";
import {
  renderPlayerPoster,
  renderRevealPoster,
  renderSeasonPoster,
  renderTeamPoster,
  renderTopBuysPoster,
} from "./poster-card";
import { contrast } from "./poster-color";
import { posterFonts } from "./poster-fonts";
import { MOTION_BANDS, type PosterRenderOptions } from "./poster-kit";
import { balancedRows, splitPrice, squadGrid, tonesFor } from "./poster-stadium";

/*
 * STADIUM (founder, 2026-10-07). The arithmetic is tested here directly; the
 * drawing is tested by DRAWING it — through the same Satori + Devanagari
 * pipeline the route uses — because Satori refuses some CSS outright at raster
 * time (a stroked word, an rgba() inside a shorthand) and nothing else would
 * catch that before a poster 500s in front of an organizer.
 */

const BPL_TEAMS = [
  "रघुनाथपुरा XI",
  "ऋद्धि सिद्धि",
  "रामाधणी क्लब, बावरला",
  "जय बजरंग बली",
  "आशापुरा इलेवन",
  "विभम वारियर्स",
  "खुशबु ग्राफिक्स फाइटर्स",
  "जम्भ शक्ति",
  "ओम बना क्लब, बावरला धोरा",
  "रितिका लाइब्रेरी",
];

describe("every team in its own colour", () => {
  it("gives a team with no colour the same one every time", () => {
    expect(tonesFor(null, "आशापुरा इलेवन")).toEqual(tonesFor(null, "आशापुरा इलेवन"));
  });

  it("spreads a real season's ten teams across the palette", () => {
    const shirts = new Set(BPL_TEAMS.map((name) => tonesFor(null, name).base));
    expect(shirts.size).toBeGreaterThanOrEqual(6);
  });

  it("uses the colour the organizer set, when there is one", () => {
    expect(tonesFor("#0F8A8F", "anything").base).toBe("#0F8A8F");
  });

  it("keeps the shirt's lettering readable on a white, a yellow and a black shirt", () => {
    for (const colour of ["#FFFFFF", "#FACC15", "#000000", "#14B8A6", "#1E3A8A"]) {
      const tones = tonesFor(colour, "X");
      expect(contrast(tones.onShirt, tones.base)).toBeGreaterThanOrEqual(1.9);
    }
  });

  it("swaps the gold trim for white on a gold team, so the trim still shows", () => {
    expect(tonesFor("#FDE047", "Gold XI").trim).toBe("#FFFFFF");
    expect(tonesFor("#1E3A8A", "Blue XI").trim).not.toBe("#FFFFFF");
  });
});

describe("the price, split for gold type", () => {
  it("separates the figure from its unit", () => {
    expect(splitPrice("8,500 pts")).toEqual({ lead: "", figure: "8,500", tail: "PTS" });
    expect(splitPrice("₹12,500")).toEqual({ lead: "₹", figure: "12,500", tail: "" });
    expect(splitPrice("₹1.2 Cr")).toEqual({ lead: "₹", figure: "1.2", tail: "CR" });
  });
});

describe("the squad grid", () => {
  it("balances rows — never a lonely last row", () => {
    expect(balancedRows(13, 5)).toEqual([5, 4, 4]);
    expect(balancedRows(15, 5)).toEqual([5, 5, 5]);
    expect(balancedRows(11, 4)).toEqual([4, 4, 3]);
    expect(balancedRows(0, 5)).toEqual([]);
  });

  it("fits every squad from 1 to 25 in the room, with readable shirts", () => {
    const layout = {
      pad: 48,
      kicker: 22,
      crest: 124,
      title: 108,
      hero: 330,
      heroName: 50,
      totals: 120,
      gapX: 12,
      gapY: 22,
      maxJersey: 160,
    };
    for (let count = 1; count <= 25; count += 1) {
      const grid = squadGrid(count, 984, 760, layout);
      expect(grid.rows.reduce((sum, n) => sum + n, 0)).toBe(count);
      expect(grid.jersey).toBeGreaterThanOrEqual(60);
      const rows = grid.rows.length;
      const tileHeight =
        grid.jersey * 1.1 -
        6 +
        Math.round(grid.jersey * 0.17 * 1.25 + grid.jersey * 0.12 * 1.35 + 18);
      expect(rows * tileHeight + (rows - 1) * layout.gapY).toBeLessThanOrEqual(760);
    }
  });
});

// --- Drawing them ------------------------------------------------------------------

const SQUAD: TeamPosterMember[] = [
  {
    name: "कालू देवासी",
    role: "batter",
    pricePaise: null,
    marks: ["captain"],
    photoUrl: null,
    jerseyNumber: "7",
  },
  {
    name: "मुकेश",
    role: "all_rounder",
    pricePaise: null,
    marks: ["icon"],
    photoUrl: null,
    jerseyNumber: "10",
  },
  ...[
    "किशन सिंह",
    "कुलदीप पवार",
    "कैसा राम देवासी",
    "गणपत जी पवार",
    "चन्दन सिंह",
    "पुखराज धूरेशा",
    "मंगल सिंह जी",
    "मंगला बंजारा",
    "राज बन्ना",
    "संजय सियाक",
    "सुनील गोदारा",
    "स्वरूप सिंह चौहान",
    "हरीश देवासी",
  ].map((name, index): TeamPosterMember => ({
    name,
    role: index % 2 === 0 ? "bowler" : "batter",
    pricePaise: (9000 - index * 500) * 100,
    marks: [],
    photoUrl: null,
    // Every third player without a number: the shirt carries his name.
    jerseyNumber: index % 3 === 0 ? null : String(index + 11),
  })),
];

function options(
  size: PosterSize,
  only?: (typeof MOTION_BANDS)["team"][number],
): PosterRenderOptions {
  return {
    theme: "stadium",
    size,
    showBranding: true,
    brandMarkSrc: null,
    prices: true,
    sponsor: null,
    shareUrl: "https://desiauction.in/c/bpl-4-320g/t/team-5vgh1z",
    ...(only === undefined ? {} : { only }),
  };
}

async function png(element: React.ReactElement, size: PosterSize): Promise<Buffer> {
  const response = await imageResponse(element, {
    ...POSTER_SIZES[size],
    fonts: await posterFonts(),
  });
  return Buffer.from(await response.arrayBuffer());
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("Stadium draws, through the real pipeline", () => {
  const team = buildTeamPoster({
    teamName: "आशापुरा इलेवन",
    teamCrestUrl: null,
    teamColor: null,
    competitionName: "BPL-4",
    competitionLogoUrl: null,
    members: SQUAD,
    spentPaise: SQUAD.reduce((sum, member) => sum + (member.pricePaise ?? 0), 0),
    pursePaise: 100_000 * 100,
    unit: "points",
  });

  for (const size of ["story", "portrait", "square"] as const) {
    it(`draws the squad sheet and the reveal (${size})`, async () => {
      const sheet = await png(renderTeamPoster(team, options(size)), size);
      const reveal = await png(renderRevealPoster(team, options(size)), size);
      expect(sheet.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
      expect(reveal.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
    }, 60_000);
  }

  const outcomes: PosterOutcome[] = ["sold", "captain", "icon", "retained", "unsold", "pool"];
  for (const outcome of outcomes) {
    it(`draws the player card: ${outcome}`, async () => {
      const player = buildPlayerPoster({
        playerName: "किशन सिंह",
        number: "R2V7ZET",
        role: "bowler",
        photoUrl: null,
        outcome,
        pricePaise: outcome === "sold" ? 850_000 : null,
        teamName: outcome === "pool" || outcome === "unsold" ? null : "आशापुरा इलेवन",
        teamCrestUrl: null,
        competitionName: "BPL-4",
        competitionLogoUrl: null,
        unit: "points",
        jerseyNumber: "18",
        lotNumber: "3",
        basePricePaise: outcome === "pool" ? 50_000 : null,
      });
      const image = await png(renderPlayerPoster(player, options("story")), "story");
      expect(image.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
    }, 60_000);
  }

  it("draws every animation layer on its own (the studio's Animated tab)", async () => {
    for (const band of MOTION_BANDS.team) {
      const layer = await png(renderTeamPoster(team, options("portrait", band)), "portrait");
      expect(layer.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
    }
  }, 120_000);
});

describe("Stadium season-wide posters draw, through the real pipeline", () => {
  const teams = BPL_TEAMS;
  const season = buildSeasonPoster({
    competitionName: "BPL-4",
    competitionLogoUrl: null,
    unit: "points",
    stage: "after",
    squads: teams.map((teamName, t) => ({
      teamName,
      teamShortName: null,
      teamColor: null,
      teamCrestUrl: null,
      spentPaise: 9000 * 100,
      members: SQUAD.map((member) => ({
        ...member,
        pricePaise: member.pricePaise === null ? null : member.pricePaise + t,
      })),
    })),
  });

  for (const size of ["story", "portrait"] as const) {
    it(`draws all ten squads of fifteen (${size})`, async () => {
      const image = await png(renderSeasonPoster(season, options(size)), size);
      expect(image.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
    }, 60_000);
  }

  for (const count of [3, 5, 10] as const) {
    it(`draws the top ${String(count)} buys`, async () => {
      const top = buildTopBuysPoster({
        competitionName: "BPL-4",
        competitionLogoUrl: null,
        unit: "points",
        count,
        buys: SQUAD.slice(2).map((member, index) => ({
          playerName: member.name,
          role: member.role,
          photoUrl: null,
          pricePaise: member.pricePaise ?? 0,
          teamName: teams[index % teams.length] ?? "X",
          teamColor: null,
          teamCrestUrl: null,
        })),
      });
      for (const size of ["story", "square"] as const) {
        const image = await png(renderTopBuysPoster(top, options(size)), size);
        expect(image.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
      }
    }, 60_000);
  }
});
