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
  fitPrice,
  fitSquadRows,
  headerNameRoom,
  metricsFor,
  stampWidth,
} from "./poster-layout";

// The layout arithmetic, checked without a rasterizer. Satori clips silently, so
// every one of these failures would otherwise ship as a poster with the bottom
// of somebody's name missing.

const SIZES: PosterSize[] = ["square", "story"];
/** `DEFAULT_AUCTION_CONFIG.squadMax` — the biggest squad the platform allows. */
const FULL_SQUAD = 15;

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
    expect(story.squadArea).toBeGreaterThan(square.squadArea * 1.5);
    // And the frame inset does not grow faster than the canvas — that would be
    // exactly the letterboxing this is here to prevent.
    expect(story.pad / story.height).toBeLessThan(square.pad / square.width);
  });
});

describe("fitSquadRows", () => {
  it("never loses a player: shown plus overflow is always the squad", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      for (const count of [0, 1, 8, 15, 30, 120]) {
        const fit = fitSquadRows(count, metrics);
        expect(fit.shown + fit.overflow).toBe(count);
      }
    }
  });

  it("fits a full squad at both sizes with nothing left over", () => {
    for (const size of SIZES) {
      const fit = fitSquadRows(FULL_SQUAD, metricsFor(size));
      expect(fit.overflow).toBe(0);
      expect(fit.shown).toBe(FULL_SQUAD);
    }
  });

  it("never draws more rows than the band can hold", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      for (const count of [1, 5, 15, 40, 200]) {
        const fit = fitSquadRows(count, metrics);
        expect(fit.shown * fit.rowHeight).toBeLessThanOrEqual(metrics.squadArea);
      }
    }
  });

  /*
   * The point of the whole function. `buildTeamPoster` refuses to truncate, so
   * when a squad genuinely cannot fit, the renderer has to keep a row free to
   * SAY so — a list that just stops looks complete, and that is how a squad
   * poster ends up quietly missing somebody.
   */
  it("reserves a row for the overflow line rather than ending the list early", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      const fit = fitSquadRows(500, metrics);
      expect(fit.overflow).toBeGreaterThan(0);
      expect((fit.shown + 1) * fit.rowHeight).toBeLessThanOrEqual(metrics.squadArea);
    }
  });

  it("clamps the row height so rows neither balloon nor become unreadable", () => {
    for (const size of SIZES) {
      const metrics = metricsFor(size);
      for (const count of [1, 3, 15, 60]) {
        const fit = fitSquadRows(count, metrics);
        expect(fit.rowHeight).toBeGreaterThanOrEqual(metrics.rowMin);
        expect(fit.rowHeight).toBeLessThanOrEqual(metrics.rowMax);
        expect(fit.fontSize).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("does not divide by an empty squad", () => {
    const fit = fitSquadRows(0, metricsFor("square"));
    expect(fit).toMatchObject({ shown: 0, overflow: 0 });
    expect(Number.isFinite(fit.rowHeight)).toBe(true);
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
  it("still has exactly the four themes the renderer paints", () => {
    expect([...POSTER_THEMES]).toEqual(["floodlight", "gold", "arena", "ink"]);
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
