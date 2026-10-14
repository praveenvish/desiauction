import { mkdir, writeFile } from "node:fs/promises";
import { buildResultPoster, POSTER_SIZES, POSTER_THEMES } from "@desiauction/core";
import sharp from "sharp";
import { expect, it } from "vitest";
import { imageResponse } from "../../../../server/image-text/image-response";
import { posterFonts } from "./poster-fonts";
import { renderResultPoster } from "./poster-result";

it("rasterizes the result and recorded wagon in every supported theme and size", async () => {
  const model = buildResultPoster({
    competitionName: "MPL 2026",
    competitionLogoUrl: null,
    fixtureNumber: "Match 7",
    headline: "Royals win",
    margin: "by 6 wickets · 10 balls to spare",
    trustLabel: "Self scored",
    teams: [
      { name: "Marwar Royals", score: "158/4 (18.2)", color: "#AA2233" },
      { name: "Jodhpur Strikers", score: "154/8 (20)", color: "#3355AA" },
    ],
    playerOfMatch: {
      name: "Neel Mehta",
      photoUrl: null,
      figures: "58* (37) · 2 for 27",
      shots: [
        { angle: 20, runs: 4 },
        { angle: 64, runs: 6 },
        { angle: 90, runs: 1 },
        { angle: 200, runs: 4 },
        { angle: 280, runs: 6 },
      ],
    },
  });
  const fonts = await posterFonts();
  await mkdir("/tmp/ls1-c36-posters", { recursive: true });
  for (const theme of POSTER_THEMES)
    for (const size of ["square", "portrait", "story"] as const) {
      const response = await imageResponse(
        renderResultPoster(model, {
          theme,
          size,
          showBranding: true,
          brandMarkSrc: null,
          prices: false,
          sponsor: null,
          shareUrl: "https://example.test/c/mpl/m/7",
        }),
        { ...POSTER_SIZES[size], fonts },
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBe(POSTER_SIZES[size].width);
      expect(metadata.height).toBe(POSTER_SIZES[size].height);
      expect(bytes.length).toBeGreaterThan(10000);
      await writeFile(`/tmp/ls1-c36-posters/${theme}-${size}.png`, bytes);
    }
}, 120000);
