import {
  buildPlayerPoster,
  buildSeasonPoster,
  buildTeamPoster,
  buildTopBuysPoster,
  POSTER_SIZES,
  type PosterSize,
  type PosterTheme,
  type TeamPosterMember,
} from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { imageResponse } from "../../../../server/image-text/image-response";
import { leadersOf, markOf, topBuyOf } from "./poster-broadcast";
import {
  renderPlayerPoster,
  renderRevealPoster,
  renderSeasonPoster,
  renderTeamPoster,
  renderTopBuysPoster,
} from "./poster-card";
import { posterFonts } from "./poster-fonts";
import type { PosterRenderOptions } from "./poster-kit";

/*
 * BROADCAST and SCORECARD (founder, 2026-10-08) — drawn through the real
 * Satori + Devanagari pipeline, one size per kind: enough to prove each
 * renders (a clip-path or a shorthand Satori refuses fails here, not in front
 * of an organizer) without starving the test worker.
 */

const TEAMS = [
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
    jerseyNumber: index % 3 === 0 ? null : String(index + 11),
  })),
];

const team = buildTeamPoster({
  teamName: "जय बजरंग बली",
  teamCrestUrl: null,
  teamColor: "#EA580C",
  competitionName: "BPL-4",
  competitionLogoUrl: null,
  members: SQUAD,
  spentPaise: SQUAD.reduce((sum, member) => sum + (member.pricePaise ?? 0), 0),
  pursePaise: 100_000 * 100,
  unit: "points",
});

const player = buildPlayerPoster({
  playerName: "किशन सिंह",
  number: "R2V7ZET",
  role: "bowler",
  photoUrl: null,
  outcome: "sold",
  pricePaise: 850_000,
  teamName: "आशापुरा इलेवन",
  teamColor: "#2563EB",
  teamCrestUrl: null,
  competitionName: "BPL-4",
  competitionLogoUrl: null,
  unit: "points",
  jerseyNumber: "18",
  lotNumber: "3",
});

const top = buildTopBuysPoster({
  competitionName: "BPL-4",
  competitionLogoUrl: null,
  unit: "points",
  count: 10,
  buys: SQUAD.slice(2).map((member, index) => ({
    playerName: member.name,
    role: member.role,
    photoUrl: null,
    pricePaise: member.pricePaise ?? 0,
    teamName: TEAMS[index % TEAMS.length] ?? "X",
    teamColor: null,
    teamCrestUrl: null,
  })),
});

const season = buildSeasonPoster({
  competitionName: "BPL-4",
  competitionLogoUrl: null,
  unit: "points",
  stage: "after",
  squads: TEAMS.map((teamName, t) => ({
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

function options(theme: PosterTheme, size: PosterSize): PosterRenderOptions {
  return {
    theme,
    size,
    showBranding: true,
    brandMarkSrc: null,
    prices: true,
    sponsor: null,
    shareUrl: "https://desiauction.in/c/bpl-4-320g/t/team-5vgh1z",
  };
}

async function draw(element: React.ReactElement, size: PosterSize): Promise<Buffer> {
  const response = await imageResponse(element, {
    ...POSTER_SIZES[size],
    fonts: await posterFonts(),
  });
  return Buffer.from(await response.arrayBuffer());
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("a team sheet's marks and leaders", () => {
  it("puts the captain first, then the icon, and marks each the way a sheet does", () => {
    const leaders = leadersOf(team.rows, 3);
    expect(leaders.map((row) => row.name)).toEqual(["कालू देवासी", "मुकेश"]);
    expect(leaders.map(markOf)).toEqual(["(c)", "(i)"]);
  });

  it("names the costliest buy, never a pre-signed player", () => {
    expect(topBuyOf(team.rows)?.name).toBe("किशन सिंह");
  });
});

// One draw per test: a draw blocks the worker (resvg is synchronous), and a
// test that draws many in a row can time out vitest's own reporting. One size
// per kind — the layouts are sized per size, so each kind's hardest frame.
for (const theme of ["broadcast", "scorecard"] as const) {
  describe(`${theme} draws, through the real pipeline`, () => {
    const cases: [string, PosterSize, () => React.ReactElement][] = [
      ["the squad sheet", "portrait", () => renderTeamPoster(team, options(theme, "portrait"))],
      ["the squad reveal", "square", () => renderRevealPoster(team, options(theme, "square"))],
      ["the player card", "story", () => renderPlayerPoster(player, options(theme, "story"))],
      ["the top ten buys", "square", () => renderTopBuysPoster(top, options(theme, "square"))],
      ["all ten squads", "story", () => renderSeasonPoster(season, options(theme, "story"))],
    ];
    for (const [name, size, element] of cases) {
      it(`draws ${name}`, async () => {
        const image = await draw(element(), size);
        expect(image.subarray(0, 4).equals(PNG)).toBe(true);
      }, 60_000);
    }
  });
}
