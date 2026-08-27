import { POSTER_SIZES, type PosterSize } from "@desiauction/core";

/**
 * THE GRID, IN NUMBERS.
 *
 * `poster.ts` decides what a poster SAYS; this decides how much room each thing
 * gets. It lives in its own module for one reason: it is the only part of the
 * renderer that can be wrong in a way a screenshot will not obviously show.
 * Satori clips silently — a block budgeted three pixels too tall does not throw,
 * it just loses the bottom of somebody's name — so the arithmetic is stated
 * once, here, where a test can add it up without a rasterizer.
 *
 * Square and story are written out as two literal records rather than derived
 * from one by a scale factor. A scale factor IS letterboxing: it would spend the
 * story's extra 840 pixels on bigger margins instead of on a bigger photo and
 * more squad rows, which is the entire reason the second size exists.
 */

export interface PosterMetrics {
  readonly width: number;
  readonly height: number;
  /** Frame inset. Every budget below is measured inside `height - 2 * pad`. */
  readonly pad: number;
  readonly radius: number;
  /** Corner radius for the chips and rows inside the frame. */
  readonly chipRadius: number;

  // Header — competition identity on the left, one chip on the right (the
  // registration number for a player, the squad count for a team). Both
  // documents use the same two slots so they read as one family.
  readonly headerTile: number;
  readonly competitionMax: number;
  readonly competitionMin: number;
  readonly chipSize: number;
  readonly chipHeight: number;

  // Player hero.
  readonly photoWidth: number;
  readonly photoHeight: number;
  readonly photoMonogramSize: number;
  readonly nameMax: number;
  readonly nameMin: number;
  readonly roleSize: number;

  // Verdict — the stamp and the money it did or did not carry, on one row.
  readonly stampSize: number;
  readonly stampHeight: number;
  readonly stampTracking: number;
  readonly stampPadX: number;
  readonly priceMax: number;
  readonly priceMin: number;

  // The buying team, under the verdict.
  readonly crest: number;
  readonly crestMonogramSize: number;
  readonly outcomeSize: number;

  // Team poster hero.
  readonly heroCrest: number;
  readonly heroCrestMonogramSize: number;
  readonly teamNameMax: number;
  readonly teamNameMin: number;
  readonly squadLabelSize: number;

  // Squad table.
  readonly squadArea: number;
  readonly rowMin: number;
  readonly rowMax: number;

  // Spent / remaining.
  readonly statSize: number;
  readonly statLabelSize: number;
  readonly statHeight: number;

  // Brand footer — drawn for the free tier only, so every budget above has to
  // survive its absence. `space-between` on the frame is what absorbs it.
  readonly footerMark: number;
  readonly footerNameSize: number;
  readonly footerUrlSize: number;
}

const SQUARE: PosterMetrics = {
  ...POSTER_SIZES.square,
  pad: 48,
  radius: 28,
  chipRadius: 14,
  headerTile: 70,
  competitionMax: 28,
  competitionMin: 18,
  chipSize: 32,
  chipHeight: 62,
  // Portrait, not square. A phone photo of a cricketer is portrait, and a square
  // crop of one takes the top off their head about as often as not.
  photoWidth: 370,
  photoHeight: 456,
  photoMonogramSize: 150,
  nameMax: 68,
  nameMin: 38,
  roleSize: 30,
  stampSize: 54,
  stampHeight: 92,
  stampTracking: 5,
  stampPadX: 30,
  priceMax: 60,
  priceMin: 34,
  crest: 60,
  crestMonogramSize: 26,
  outcomeSize: 30,
  heroCrest: 100,
  heroCrestMonogramSize: 42,
  teamNameMax: 60,
  teamNameMin: 34,
  squadLabelSize: 26,
  squadArea: 552,
  rowMin: 30,
  rowMax: 52,
  statSize: 44,
  statLabelSize: 22,
  statHeight: 92,
  footerMark: 50,
  footerNameSize: 28,
  footerUrlSize: 23,
};

const STORY: PosterMetrics = {
  ...POSTER_SIZES.story,
  pad: 64,
  radius: 34,
  chipRadius: 18,
  headerTile: 88,
  competitionMax: 32,
  competitionMin: 18,
  // The chip does NOT scale with the canvas the way everything else does. It and
  // the competition name share one fixed-width row, and the longest name the
  // model can emit (34 characters) next to the longest chip ("15 players") is
  // what sets the ceiling here — a bigger badge buys itself by pushing the
  // season's own name below the size anybody can read.
  chipSize: 34,
  chipHeight: 70,
  // The story's extra height is spent here and on `squadArea` — roughly twice
  // the photo and a full squad at readable size, which is what the taller
  // canvas is actually for.
  photoWidth: 728,
  photoHeight: 900,
  photoMonogramSize: 300,
  nameMax: 112,
  nameMin: 56,
  roleSize: 42,
  stampSize: 72,
  stampHeight: 124,
  stampTracking: 6,
  stampPadX: 40,
  priceMax: 84,
  priceMin: 46,
  crest: 84,
  crestMonogramSize: 34,
  outcomeSize: 38,
  heroCrest: 140,
  heroCrestMonogramSize: 58,
  teamNameMax: 86,
  teamNameMin: 44,
  squadLabelSize: 32,
  squadArea: 1152,
  rowMin: 40,
  rowMax: 76,
  statSize: 62,
  statLabelSize: 30,
  statHeight: 120,
  footerMark: 66,
  footerNameSize: 36,
  footerUrlSize: 28,
};

const METRICS: Record<PosterSize, PosterMetrics> = { square: SQUARE, story: STORY };

export function metricsFor(size: PosterSize): PosterMetrics {
  return METRICS[size];
}

/** The drawable width inside the frame — what every fit below measures against. */
export function contentWidth(metrics: PosterMetrics): number {
  return metrics.width - 2 * metrics.pad;
}

/**
 * WHY THE TYPE SIZES ARE COMPUTED AND NOT DECLARED.
 *
 * Satori wraps text that does not fit, and a wrapped headline is a second line
 * this layout has no budget for — it pushes the block below it off the bottom
 * of a poster nobody will look at again before posting. The model already
 * clamps a name to 22 characters, but 22 characters at the size a 9-character
 * name wants to be is 1.4x the frame.
 *
 * So the headline shrinks to fit instead. `GLYPH_RATIO` is a deliberately
 * pessimistic average advance width for the default sans at heavy weight —
 * overestimating costs a few points of type, underestimating costs a line
 * break, and only one of those is visible after the fact.
 */
const GLYPH_RATIO = 0.58;

/**
 * Uppercase is the wider case, and every tracked line on a poster is uppercase.
 * Measuring those with the mixed-case ratio is what let the competition name run
 * under the registration-number chip on the first story render.
 */
const CAPS_RATIO = 0.72;

/** Letter-spacing the renderer applies, stated here because the fits pay for it. */
export const HEADER_TRACKING = 2;
export const CHIP_TRACKING = 1.5;
export const OUTCOME_TRACKING = 2.5;
/** Gap between the header's left group and its chip. */
export const HEADER_GAP = 24;

/** What a string is expected to draw at, under that pessimistic ratio. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * GLYPH_RATIO;
}

/** The same, for tracked uppercase — the header kicker and the outcome line. */
export function estimateCapsWidth(text: string, fontSize: number, tracking: number): number {
  return text.length * fontSize * CAPS_RATIO + Math.max(0, text.length - 1) * tracking;
}

export function fitHeadline(text: string, available: number, max: number, min: number): number {
  if (text.length === 0) {
    return max;
  }
  return Math.max(min, Math.min(max, Math.floor(available / (text.length * GLYPH_RATIO))));
}

/** Shrink-to-fit for tracked uppercase: the tracking is paid before the glyphs. */
export function fitCaps(
  text: string,
  available: number,
  max: number,
  min: number,
  tracking: number,
): number {
  if (text.length === 0) {
    return max;
  }
  const room = available - Math.max(0, text.length - 1) * tracking;
  return Math.max(min, Math.min(max, Math.floor(room / (text.length * CAPS_RATIO))));
}

/** Horizontal padding inside the header chip — a fraction of its own height. */
function chipPadX(metrics: PosterMetrics): number {
  return Math.round(metrics.chipHeight * 0.3);
}

/**
 * How wide the header chip will draw. The chip is a fixed claim on the header
 * row — a registration number is not something to shrink — so the competition
 * name is sized against what is left after it, never the other way round.
 */
export function chipWidth(label: string, metrics: PosterMetrics): number {
  return (
    Math.round(estimateCapsWidth(label, metrics.chipSize, CHIP_TRACKING)) + 2 * chipPadX(metrics)
  );
}

export function chipPadding(metrics: PosterMetrics): string {
  return `0 ${String(chipPadX(metrics))}px`;
}

/** The room the competition name has once the tile and the chip have taken theirs. */
export function headerNameRoom(chip: string | null, metrics: PosterMetrics): number {
  const chipRoom = chip === null ? 0 : chipWidth(chip, metrics) + HEADER_GAP;
  return contentWidth(metrics) - metrics.headerTile - HEADER_GAP - chipRoom;
}

/**
 * How wide the stamp slab will draw, so the price beside it can be sized against
 * what is actually left. "RETAINED" is half again as wide as "SOLD", and the
 * price next to it is the longest string on the poster when a franchise pays
 * a crore — the two of them share one row and neither may push the other out.
 */
export function stampWidth(stamp: string, metrics: PosterMetrics): number {
  const glyph = metrics.stampSize * 0.66 + metrics.stampTracking;
  return Math.round(stamp.length * glyph) + 2 * metrics.stampPadX;
}

/** The price is whatever fits in the row once the stamp has taken its half. */
export function fitPrice(price: string, stamp: string, metrics: PosterMetrics): number {
  const room = contentWidth(metrics) - stampWidth(stamp, metrics) - metrics.pad / 2;
  return fitHeadline(price, room, metrics.priceMax, metrics.priceMin);
}

export interface SquadFit {
  readonly rowHeight: number;
  readonly fontSize: number;
  /** How many squad rows are drawn. */
  readonly shown: number;
  /** How many did not fit — zero unless the squad is larger than the frame. */
  readonly overflow: number;
}

/**
 * How the squad table spends its band of pixels.
 *
 * Rows breathe when there are eight of them and tighten when there are fifteen,
 * because one fixed row height would either waste half the poster on a short
 * squad or clip a full one. The floor matters more than the ceiling: below
 * `rowMin` the names stop being readable at the size these actually get viewed,
 * so past that point the table stops shrinking.
 *
 * That is where the last row earns its place. `buildTeamPoster` deliberately
 * does not truncate — a pure model that silently dropped players would produce
 * a squad poster quietly missing somebody's name, the one failure nobody would
 * catch by looking at it. So when a squad genuinely cannot fit, the renderer
 * gives up a row to SAY so rather than ending the list early and looking
 * complete.
 */
export function fitSquadRows(count: number, metrics: PosterMetrics): SquadFit {
  const { squadArea, rowMin, rowMax } = metrics;
  if (count <= 0) {
    return { rowHeight: rowMax, fontSize: rowFontSize(rowMax), shown: 0, overflow: 0 };
  }
  const rowHeight = Math.max(rowMin, Math.min(rowMax, Math.floor(squadArea / count)));
  const capacity = Math.max(1, Math.floor(squadArea / rowHeight));
  const shown = count <= capacity ? count : Math.max(0, capacity - 1);
  return { rowHeight, fontSize: rowFontSize(rowHeight), shown, overflow: count - shown };
}

/** Type inside a row, clamped: too small to read is as bad as clipped. */
function rowFontSize(rowHeight: number): number {
  return Math.max(20, Math.min(38, Math.round(rowHeight * 0.5)));
}
