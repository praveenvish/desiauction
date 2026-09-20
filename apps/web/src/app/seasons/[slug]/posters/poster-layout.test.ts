import { POSTER_SIZES, POSTER_THEMES, type PosterSize } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import {
  CHIP_TRACKING,
  HEADER_GAP,
  HEADER_TRACKING,
  OUTCOME_TRACKING,
  chipWidth,
  contentWidth,
  estimateCapsWidth,
  estimateTextWidth,
  fitCaps,
  fitHeadline,
  faceType,
  fitName,
  fitPrice,
  fitRankRows,
  fitSeasonGrid,
  fitTiles,
  headerHeight,
  headerNameRoom,
  metricsFor,
  sheetBody,
  stampWidth,
  type TileFit,
} from "./poster-layout";

// The layout arithmetic, checked without a rasterizer. Satori clips silently, so
// every one of these failures would otherwise ship as a poster with the bottom
// of somebody's name missing.

const SIZES: PosterSize[] = ["square", "portrait", "story"];

describe("poster metrics", () => {
  it("keeps the frame the exact size the model published", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      expect({ width: metrics.width, height: metrics.height }).toEqual(POSTER_SIZES[size]);
    }
  });

  /*
   * The brief's rule, stated as a test: the story is NOT the square with bars on
   * it. Its extra 840 pixels have to reach the photo and the squad table, which
   * is the only reason to render a second shape at all.
   */
  it("spends the story's extra height on the photo and the rows, not on margins", () => {
    const square = metricsFor("square");
    const story = metricsFor("story");
    expect(story.photoHeight).toBeGreaterThan(square.photoHeight * 1.5);
    expect(sheetBody(story, [])).toBeGreaterThan(sheetBody(square, []) * 1.5);
    const portrait = metricsFor("portrait");
    expect(portrait.photoHeight).toBeGreaterThan(square.photoHeight);
    expect(portrait.photoHeight).toBeLessThan(story.photoHeight);
    // And the frame inset does not grow faster than the canvas — that would be
    // exactly the letterboxing this is here to prevent.
    expect(story.pad / story.height).toBeLessThan(square.pad / square.width);
  });
});

describe("fitHeadline", () => {
  /** The longest name `buildPlayerPoster` can emit — it clamps at 22. */
  const LONGEST_NAME = "M".repeat(22);
  /** And the longest team name — clamped at 24. */
  const LONGEST_TEAM = "W".repeat(24);

  it("keeps the model's longest name on one line at both sizes", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      const room = contentWidth(metrics);
      const fitted = fitHeadline(LONGEST_NAME, room, metrics.nameMax, metrics.nameMin);
      expect(estimateTextWidth(LONGEST_NAME, fitted)).toBeLessThanOrEqual(room);
    }
  });

  it("keeps the model's longest team name beside its crest", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      const room = contentWidth(metrics) - metrics.heroCrest - 28;
      const fitted = fitHeadline(LONGEST_TEAM, room, metrics.teamNameMax, metrics.teamNameMin);
      expect(estimateTextWidth(LONGEST_TEAM, fitted)).toBeLessThanOrEqual(room);
    }
  });

  it("leaves a short name at full size and never grows one as it gets longer", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      const room = contentWidth(metrics);
      expect(fitHeadline("Rohit", room, metrics.nameMax, metrics.nameMin)).toBe(metrics.nameMax);
      let previous = metrics.nameMax;
      for (let length = 6; length <= 22; length += 1) {
        const fitted = fitHeadline("M".repeat(length), room, metrics.nameMax, metrics.nameMin);
        expect(fitted).toBeLessThanOrEqual(previous);
        previous = fitted;
      }
    }
  });

  /*
   * Only the story's headline actually has to shrink: at 68pt the square's
   * maximum already clears 22 characters, while the story is designed at 112 and
   * would run a third of a line past the frame without this.
   */
  it("shrinks the story headline that would otherwise wrap", () => {
    const metrics = metricsFor("story");
    const room = contentWidth(metrics);
    expect(fitHeadline(LONGEST_NAME, room, metrics.nameMax, metrics.nameMin)).toBeLessThan(
      metrics.nameMax,
    );
  });

  it("never returns a size outside the bounds, however absurd the string", () => {
    const metrics = metricsFor("story");
    const fitted = fitHeadline("x".repeat(400), 100, metrics.nameMax, metrics.nameMin);
    expect(fitted).toBe(metrics.nameMin);
    expect(fitHeadline("", 100, metrics.nameMax, metrics.nameMin)).toBe(metrics.nameMax);
  });
});

describe("fitPrice", () => {
  /*
   * The worst pair the verdict row can be asked to carry: the widest stamp the
   * model emits next to a price in crores. They share one row, and the reason
   * the price is computed rather than declared is that at story size the
   * declared maximum did not fit beside "RETAINED".
   */
  it("keeps the widest stamp and the largest price on one row", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      const stamp = "RETAINED";
      const price = "₹12,50,00,000";
      const fitted = fitPrice(price, stamp, metrics);
      expect(stampWidth(stamp, metrics) + estimateTextWidth(price, fitted)).toBeLessThanOrEqual(
        contentWidth(metrics),
      );
      expect(fitted).toBeGreaterThanOrEqual(metrics.priceMin);
    }
  });

  it("gives a short price the full size it was designed at", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      expect(fitPrice("₹4,000", "SOLD", metrics)).toBe(metrics.priceMax);
    }
  });

  it("holds for every stamp the model can produce", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      for (const stamp of ["SOLD", "UNSOLD", "RETAINED", "ICON"]) {
        expect(stampWidth(stamp, metrics)).toBeLessThan(contentWidth(metrics));
      }
    }
  });
});

describe("themes and sizes stay in step with the model", () => {
  it("still has exactly the six themes the renderer paints", () => {
    expect([...POSTER_THEMES]).toEqual([
      "floodlight",
      "matchday",
      "minimal",
      "gold",
      "arena",
      "ink",
    ]);
  });
});

describe("the header row", () => {
  /*
   * A PERMANENT REGRESSION, and the one defect in this feature that no type and
   * no lint rule could see.
   *
   * The first story render put "BISHNOI SPORTS CLUB BANGALORE" underneath the
   * `#RB77H2` chip and pushed the chip off the right edge of the poster, because
   * the name was measured with the mixed-case ratio and its letter-spacing was
   * not counted at all. Uppercase plus tracking is the widest text on the poster
   * and it sits in the tightest row.
   */
  const CHIPS = ["#RB77H2", "#R000001", "15 players", "1 player"];
  /** The longest competition name `buildPlayerPoster` can emit — it clamps at 34. */
  const LONGEST_COMPETITION = "W".repeat(34);

  it("never lets the competition name reach the chip", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      for (const chip of CHIPS) {
        const room = headerNameRoom(chip, metrics);
        const fitted = fitCaps(
          LONGEST_COMPETITION,
          room,
          metrics.competitionMax,
          metrics.competitionMin,
          HEADER_TRACKING,
        );
        expect(estimateCapsWidth(LONGEST_COMPETITION, fitted, HEADER_TRACKING)).toBeLessThanOrEqual(
          room,
        );
      }
    }
  });

  it("keeps the whole row inside the frame, tile and chip and name", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      for (const chip of CHIPS) {
        const total =
          metrics.headerTile +
          HEADER_GAP +
          headerNameRoom(chip, metrics) +
          HEADER_GAP +
          chipWidth(chip, metrics);
        expect(total).toBeLessThanOrEqual(contentWidth(metrics));
      }
    }
  });

  it("gives the chip room for its own label", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      for (const chip of CHIPS) {
        expect(chipWidth(chip, metrics)).toBeGreaterThan(
          estimateCapsWidth(chip, metrics.chipSize, CHIP_TRACKING),
        );
      }
    }
  });

  it("still leaves the name a usable band once the chip has taken its width", () => {
    for (const size of SIZES) {
      for (const chip of CHIPS) {
        expect(headerNameRoom(chip, metricsFor(size))).toBeGreaterThan(200);
      }
    }
  });
});

describe("the outcome caption", () => {
  /** "RETAINED BY " plus the model's 22-character team clamp, uppercased. */
  const LONGEST_CAPTION = `RETAINED BY ${"W".repeat(22)}`;

  it("keeps the longest outcome line beside its crest", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      const room = contentWidth(metrics) - metrics.crest - 20;
      const fitted = fitCaps(
        LONGEST_CAPTION,
        room,
        metrics.outcomeSize,
        Math.round(metrics.outcomeSize * 0.6),
        OUTCOME_TRACKING,
      );
      expect(estimateCapsWidth(LONGEST_CAPTION, fitted, OUTCOME_TRACKING)).toBeLessThanOrEqual(
        room,
      );
    }
  });
});

/** A grid's footprint must sit inside the band it was fitted to. */
function expectInside(fit: TileFit, width: number, height: number) {
  expect(fit.gridWidth).toBeLessThanOrEqual(width);
  expect(fit.gridHeight).toBeLessThanOrEqual(height);
  expect(fit.cols * fit.rows).toBeGreaterThanOrEqual(fit.shown + (fit.overflow > 0 ? 1 : 0));
}

describe("the squad face grid", () => {
  const faceOptions = (prices: boolean) => ({
    gap: 14,
    aspect: 1.15,
    label: (cell: number) => faceType(cell, prices).labelHeight,
    maxCell: 300,
    minPhoto: 84,
  });

  it("fits every squad from 1 to 25 inside the band, at every size, priced or not", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      for (const prices of [true, false]) {
        const band = sheetBody(metrics, [metrics.heroCrest, prices ? metrics.statHeight : 0]);
        const width = contentWidth(metrics);
        for (let count = 1; count <= 25; count += 1) {
          const fit = fitTiles(count, width, band, faceOptions(prices));
          expectInside(fit, width, band);
          // Nobody is lost: a face or the "+N" tile accounts for every player.
          expect(fit.shown + fit.overflow).toBe(count);
          expect(fit.photoWidth).toBeGreaterThanOrEqual(84);
        }
      }
    }
  });

  it("draws a whole 25-man squad on the portrait and the story without a '+N'", () => {
    for (const size of ["portrait", "story"] as const) {
      const metrics = metricsFor(size);
      const band = sheetBody(metrics, [metrics.heroCrest, metrics.statHeight]);
      expect(fitTiles(25, contentWidth(metrics), band, faceOptions(true)).overflow).toBe(0);
    }
  });

  it("gives four players four big faces, not a 25-slot sheet with gaps", () => {
    const metrics = metricsFor("portrait");
    const fit = fitTiles(4, contentWidth(metrics), 800, faceOptions(true));
    expect(fit.photoWidth).toBeGreaterThanOrEqual(200);
  });

  it("overflows into ONE '+N' tile instead of shrinking faces to smudges", () => {
    const fit = fitTiles(60, 900, 400, faceOptions(true));
    expect(fit.overflow).toBeGreaterThan(0);
    expect(fit.shown + fit.overflow).toBe(60);
    expect(fit.photoWidth).toBeGreaterThanOrEqual(84);
    expectInside(fit, 900, 400);
  });

  it("does not divide by an empty squad or an empty band", () => {
    expect(fitTiles(0, 900, 400, faceOptions(true))).toMatchObject({ shown: 0, overflow: 0 });
    expect(fitTiles(5, 900, 0, faceOptions(true))).toMatchObject({ shown: 0 });
  });
});

describe("names in small tiles", () => {
  it("shrinks a little, and shortens rather than shrink to half the tile's type", () => {
    expect(fitName("Mlaram", "Mlaram", 200, 30, 16)).toEqual({ text: "Mlaram", size: 30 });
    // A whisker under: the full name keeps its place.
    const nearly = fitName("Prakash Bishnoi", "Prakash B.", 270, 30, 16);
    expect(nearly.text).toBe("Prakash Bishnoi");
    expect(estimateTextWidth(nearly.text, nearly.size)).toBeLessThanOrEqual(270);
    /*
     * A long name that only fits at half the tile's own type size reads as a
     * mistake beside the name next to it; "Vikram S." does not. Found by
     * looking at a rendered squad, not at this function.
     */
    const squeezed = fitName("Vikram Singh Rathore", "Vikram S.", 160, 30, 14);
    expect(squeezed.text).toBe("Vikram S.");
    expect(estimateTextWidth(squeezed.text, squeezed.size)).toBeLessThanOrEqual(160);
    expect(fitName("Venkataraghavan Subramaniam", "Venkataraghavan S.", 150, 30, 16).text).toBe(
      "Venkataraghavan S.",
    );
  });
});

describe("the top-N list", () => {
  it("fits 3, 5 and 10 rows inside the band at every size", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      const band = sheetBody(metrics, [metrics.titleMax + metrics.subSize * 1.4]);
      for (const count of [1, 3, 5, 10]) {
        const fit = fitRankRows(count, band, metrics);
        expect(fit.listHeight).toBeLessThanOrEqual(band);
        expect(fit.photo).toBeGreaterThan(0);
        expect(fit.nameSize).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("caps a top three so it does not become three billboards", () => {
    const metrics = metricsFor("story");
    expect(fitRankRows(3, 1400, metrics).rowHeight).toBeLessThanOrEqual(metrics.width * 0.24);
  });
});

describe("the season sheet", () => {
  it("fits 2 to 12 squads of up to 16 inside the band on the tall shapes", () => {
    for (const size of ["portrait", "story"] as const) {
      const metrics = metricsFor(size);
      const band = sheetBody(metrics, [metrics.titleMax + metrics.subSize * 1.4]);
      const width = contentWidth(metrics);
      for (const teams of [2, 4, 6, 8, 12]) {
        for (const largest of [4, 11, 16]) {
          const fit = fitSeasonGrid(teams, largest, width, band, metrics.gap);
          expect(fit).not.toBeNull();
          if (fit === null) {
            continue;
          }
          const used = fit.panelRows * fit.panelHeight + (fit.panelRows - 1) * metrics.gap;
          expect(used).toBeLessThanOrEqual(band);
          expect(fit.panelCols * fit.panelRows).toBeGreaterThanOrEqual(teams);
          expectInside(
            fit.faces,
            fit.panelWidth - 2 * fit.inset,
            fit.panelHeight - fit.panelHeader - 2 * fit.inset,
          );
          expect(fit.faces.shown + fit.faces.overflow).toBe(largest);
        }
      }
    }
  });

  it("shows every player of an 8-team, 15-man season on the story", () => {
    const metrics = metricsFor("story");
    const band = sheetBody(metrics, [metrics.titleMax + metrics.subSize * 1.4]);
    const fit = fitSeasonGrid(8, 15, contentWidth(metrics), band, metrics.gap);
    expect(fit?.faces.overflow).toBe(0);
  });

  it("has nothing to lay out for a season with no teams", () => {
    expect(fitSeasonGrid(0, 0, 900, 900, 20)).toBeNull();
  });
});

describe("the sheet frame", () => {
  it("leaves the flexible band a real share of every canvas", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      expect(headerHeight(metrics)).toBeGreaterThanOrEqual(metrics.headerTile);
      expect(sheetBody(metrics, [metrics.heroCrest, metrics.statHeight])).toBeGreaterThan(
        metrics.height * 0.4,
      );
    }
  });
});
