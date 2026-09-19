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

  // The sheets (squad, reveal, top buys, season): one gap between every band,
  // and the title block's type.
  readonly gap: number;
  readonly kickerSize: number;
  readonly titleMax: number;
  readonly titleMin: number;
  readonly subSize: number;

  // Spent / remaining.
  readonly statSize: number;
  readonly statLabelSize: number;
  readonly statHeight: number;

  // Brand footer — on EVERY poster (the founder's call, 2026-09-20): the
  // DesiAuction lockup on one side, the sponsor line or the domain on the other.
  readonly footerHeight: number;
  readonly footerMark: number;
  readonly footerNameSize: number;
  readonly footerTagSize: number;
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
  gap: 22,
  kickerSize: 22,
  titleMax: 60,
  titleMin: 34,
  subSize: 22,
  statSize: 38,
  statLabelSize: 18,
  statHeight: 78,
  footerHeight: 60,
  footerMark: 46,
  footerNameSize: 26,
  footerTagSize: 12,
  footerUrlSize: 20,
};

/**
 * 4:5 — the tallest shape a feed shows uncropped. Between the two, and written
 * out rather than interpolated for the same reason the story is: its extra 270
 * pixels go to the photo and the grid, not to the margins.
 */
const PORTRAIT: PosterMetrics = {
  ...POSTER_SIZES.portrait,
  pad: 56,
  radius: 30,
  chipRadius: 16,
  headerTile: 76,
  competitionMax: 30,
  competitionMin: 18,
  chipSize: 32,
  chipHeight: 64,
  photoWidth: 480,
  photoHeight: 590,
  photoMonogramSize: 190,
  nameMax: 84,
  nameMin: 44,
  roleSize: 34,
  stampSize: 60,
  stampHeight: 104,
  stampTracking: 5,
  stampPadX: 34,
  priceMax: 70,
  priceMin: 38,
  crest: 70,
  crestMonogramSize: 30,
  outcomeSize: 32,
  heroCrest: 116,
  heroCrestMonogramSize: 48,
  teamNameMax: 70,
  teamNameMin: 38,
  squadLabelSize: 28,
  gap: 26,
  kickerSize: 24,
  titleMax: 72,
  titleMin: 38,
  subSize: 24,
  statSize: 42,
  statLabelSize: 20,
  statHeight: 86,
  footerHeight: 66,
  footerMark: 50,
  footerNameSize: 28,
  footerTagSize: 13,
  footerUrlSize: 22,
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
  // The story's extra height is spent here and on the grids — roughly twice
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
  gap: 34,
  kickerSize: 30,
  titleMax: 96,
  titleMin: 44,
  subSize: 30,
  statSize: 52,
  statLabelSize: 24,
  statHeight: 104,
  footerHeight: 84,
  footerMark: 64,
  footerNameSize: 36,
  footerTagSize: 16,
  footerUrlSize: 28,
};

const METRICS: Record<PosterSize, PosterMetrics> = {
  square: SQUARE,
  portrait: PORTRAIT,
  story: STORY,
};

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

// --- The sheets: squad, reveal, top buys, season ---------------------------

function clampTo(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** The header row is as tall as the taller of its two slots. */
export function headerHeight(metrics: PosterMetrics): number {
  return Math.max(metrics.headerTile, metrics.chipHeight);
}

/**
 * The height left for a sheet's ONE flexible band (the grid, the ranked list)
 * once the header, the footer, every fixed band and the gaps between all of
 * them have been paid for.
 *
 * Computed, not left to flexbox, because the grid inside that band is sized
 * from it: a grid fitted to a guess is a grid Satori clips at the bottom.
 */
export function sheetBody(metrics: PosterMetrics, bands: readonly number[]): number {
  const sections = 2 + bands.length + 1;
  const fixed = bands.reduce((total, band) => total + band, 0);
  return (
    metrics.height -
    2 * metrics.pad -
    headerHeight(metrics) -
    metrics.footerHeight -
    fixed -
    metrics.gap * (sections - 1)
  );
}

export interface TileFitOptions {
  readonly gap: number;
  /** Photo height over photo width: 1 for a disc, 1.15 for a portrait card. */
  readonly aspect: number;
  /** The label band under a photo, for a cell this wide. */
  readonly label: (cellWidth: number) => number;
  /** A four-man squad does not get four billboard-sized faces. */
  readonly maxCell: number;
  /** Below this a face is a smudge; the grid overflows instead of shrinking. */
  readonly minPhoto: number;
  readonly maxCols?: number;
}

export interface TileFit {
  readonly cols: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly photoWidth: number;
  readonly photoHeight: number;
  readonly labelHeight: number;
  readonly gap: number;
  /** Tiles drawn with a face. */
  readonly shown: number;
  /** Players that did not fit — drawn as ONE "+N" tile, never silently dropped. */
  readonly overflow: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
}

function tryCols(
  count: number,
  cols: number,
  width: number,
  height: number,
  options: TileFitOptions,
): TileFit | null {
  const rows = Math.ceil(count / cols);
  const cellWidth = Math.min(
    options.maxCell,
    Math.floor((width - (cols - 1) * options.gap) / cols),
  );
  if (cellWidth <= 0) {
    return null;
  }
  const cellRoom = Math.floor((height - (rows - 1) * options.gap) / rows);
  const labelHeight = options.label(cellWidth);
  const photoHeight = Math.min(Math.round(cellWidth * options.aspect), cellRoom - labelHeight);
  const photoWidth = Math.min(cellWidth, Math.floor(photoHeight / options.aspect));
  if (photoWidth < options.minPhoto) {
    return null;
  }
  const cellHeight = photoHeight + labelHeight;
  return {
    cols,
    rows,
    cellWidth,
    cellHeight,
    photoWidth,
    photoHeight,
    labelHeight,
    gap: options.gap,
    shown: count,
    overflow: 0,
    gridWidth: cols * cellWidth + (cols - 1) * options.gap,
    gridHeight: rows * cellHeight + (rows - 1) * options.gap,
  };
}

const EMPTY_FIT: TileFit = {
  cols: 0,
  rows: 0,
  cellWidth: 0,
  cellHeight: 0,
  photoWidth: 0,
  photoHeight: 0,
  labelHeight: 0,
  gap: 0,
  shown: 0,
  overflow: 0,
  gridWidth: 0,
  gridHeight: 0,
};

/**
 * HOW A SQUAD OF FACES SPENDS ITS BAND.
 *
 * Every column count is tried and the one that gives each face the most area
 * wins — four players get four big portraits in a row, twenty-five get a 7×4
 * contact sheet. When even the densest grid would push faces below `minPhoto`,
 * the grid keeps its floor and gives its last cell to a "+N more" tile rather
 * than ending early and looking complete: a squad poster quietly missing a
 * player is the one failure nobody would catch by looking at it.
 */
export function fitTiles(
  count: number,
  width: number,
  height: number,
  options: TileFitOptions,
): TileFit {
  if (count <= 0 || width <= 0 || height <= 0) {
    return EMPTY_FIT;
  }
  const maxCols = Math.min(count, options.maxCols ?? 12);
  let best: TileFit | null = null;
  let bestScore = -1;
  for (let cols = 1; cols <= maxCols; cols += 1) {
    const fit = tryCols(count, cols, width, height, options);
    if (fit === null) {
      continue;
    }
    /*
     * Area alone picked a single row of four faces across the top of a squad
     * poster with half the frame empty underneath it — it won by three per
     * cent of face area and lost the whole design. So a grid that FILLS its
     * band is worth a slightly smaller face: 2x2 beats 4x1 for a franchise
     * that signed four players, which is every franchise early on.
     */
    const fill = Math.min(1, fit.gridHeight / height);
    // And a ragged last row is worth avoiding: four players as 3 + 1 leaves one
    // face stranded in the middle of the poster, 2 + 2 does not.
    const missing = (cols - (count % cols)) % cols;
    const balance = 1 - (0.18 * missing) / cols;
    const score = fit.photoWidth * fit.photoHeight * (0.6 + 0.4 * fill) * balance;
    if (score > bestScore) {
      bestScore = score;
      best = fit;
    }
  }
  if (best !== null) {
    return best;
  }
  // Nothing fits everybody: find the grid that holds the most faces at the floor.
  let capacity = 0;
  let capacityCols = 1;
  for (let cols = 1; cols <= (options.maxCols ?? 12); cols += 1) {
    const cellWidth = Math.floor((width - (cols - 1) * options.gap) / cols);
    if (cellWidth < options.minPhoto) {
      break;
    }
    const cellHeight = Math.ceil(options.minPhoto * options.aspect) + options.label(cellWidth);
    const rows = Math.floor((height + options.gap) / (cellHeight + options.gap));
    if (rows * cols > capacity) {
      capacity = rows * cols;
      capacityCols = cols;
    }
  }
  const fit = capacity < 2 ? null : tryCols(capacity, capacityCols, width, height, options);
  if (fit === null) {
    return { ...EMPTY_FIT, overflow: count };
  }
  const shown = capacity - 1;
  return { ...fit, shown, overflow: count - shown };
}

/** Type inside a squad face tile, and the label band it needs. */
export interface FaceType {
  readonly nameSize: number;
  readonly roleSize: number;
  readonly priceSize: number;
  readonly labelHeight: number;
}

export function faceType(cellWidth: number, prices: boolean): FaceType {
  const nameSize = clampTo(cellWidth * 0.125, 16, 34);
  const roleSize = clampTo(nameSize * 0.68, 12, 22);
  const priceSize = clampTo(nameSize * 0.92, 14, 30);
  const labelHeight = Math.round(
    10 + nameSize * 1.2 + 4 + roleSize * 1.3 + (prices ? 4 + priceSize * 1.25 : 0) + 6,
  );
  return { nameSize, roleSize, priceSize, labelHeight };
}

export interface NameFit {
  readonly text: string;
  readonly size: number;
}

/**
 * A name in a tile: shrink first, then shorten ("Prakash B."), then — as the
 * renderer's last resort — an ellipsis. Shrinking beats shortening while it
 * stays readable, because a surname is how half a village tells two Rameshes
 * apart.
 */
export function fitName(
  full: string,
  short: string,
  width: number,
  max: number,
  min: number,
): NameFit {
  const size = fitHeadline(full, width, max, min);
  const fits = estimateTextWidth(full, size) <= width;
  if (fits && size >= max * 0.78) {
    return { text: full, size };
  }
  const shortSize = fitHeadline(short, width, max, min);
  // Shrinking beats shortening only while it stays close to the tile's own type
  // size: "Vikram Singh Rathore" at half the size of the name beside it looks
  // like a mistake, and "Vikram S." does not.
  return !fits || shortSize > size ? { text: short, size: shortSize } : { text: full, size };
}

export interface RankFit {
  readonly rowHeight: number;
  readonly gap: number;
  readonly photo: number;
  readonly rankSize: number;
  readonly nameSize: number;
  readonly metaSize: number;
  readonly priceMax: number;
  readonly priceMin: number;
  readonly listHeight: number;
}

/**
 * The ranked list on "Top N buys". Rows grow to fill the band for a top three
 * and tighten for a top ten, with a ceiling so three rows on a story do not
 * become three billboards.
 */
export function fitRankRows(count: number, height: number, metrics: PosterMetrics): RankFit {
  const n = Math.max(1, count);
  const gap = Math.round(metrics.gap * 0.55);
  const maxRow = Math.round(metrics.width * 0.24);
  const rowHeight = Math.min(maxRow, Math.floor((height - gap * (n - 1)) / n));
  const photo = rowHeight - 2 * Math.round(rowHeight * 0.1);
  const nameSize = clampTo(rowHeight * 0.24, 20, 56);
  return {
    rowHeight,
    gap,
    photo,
    rankSize: clampTo(rowHeight * 0.4, 26, 104),
    nameSize,
    metaSize: clampTo(nameSize * 0.62, 14, 30),
    priceMax: clampTo(rowHeight * 0.3, 22, 66),
    priceMin: clampTo(rowHeight * 0.18, 18, 34),
    listHeight: n * rowHeight + (n - 1) * gap,
  };
}

export interface SeasonFit {
  readonly panelCols: number;
  readonly panelRows: number;
  readonly panelWidth: number;
  readonly panelHeight: number;
  readonly panelHeader: number;
  readonly inset: number;
  readonly nameSize: number;
  readonly faces: TileFit;
}

/** A face on the season sheet is a coin; it earns a first name only above 72px. */
function seasonLabel(cellWidth: number): number {
  return cellWidth >= 72 ? Math.round(clampTo(cellWidth * 0.19, 13, 20) * 1.3) + 6 : 0;
}

export function seasonFaceNameSize(cellWidth: number): number {
  return clampTo(cellWidth * 0.19, 13, 20);
}

/**
 * EVERY SQUAD ON ONE SHEET.
 *
 * Panel columns are tried like face columns are: the arrangement that gives
 * the largest squad the biggest faces wins, and a squad that cannot fit at the
 * floor overflows into a "+N" coin inside its own panel.
 */
export function fitSeasonGrid(
  teams: number,
  largest: number,
  width: number,
  height: number,
  gap: number,
): SeasonFit | null {
  if (teams <= 0) {
    return null;
  }
  let best: SeasonFit | null = null;
  let bestScore = -1;
  for (let panelCols = 1; panelCols <= Math.min(teams, 4); panelCols += 1) {
    const panelRows = Math.ceil(teams / panelCols);
    const panelWidth = Math.floor((width - (panelCols - 1) * gap) / panelCols);
    const panelHeight = Math.floor((height - (panelRows - 1) * gap) / panelRows);
    const panelHeader = clampTo(panelWidth * 0.1, 44, 64);
    const inset = Math.round(panelHeader * 0.32);
    const faces = fitTiles(
      Math.max(1, largest),
      panelWidth - 2 * inset,
      panelHeight - panelHeader - 2 * inset,
      {
        gap: Math.max(6, Math.round(inset * 0.6)),
        aspect: 1,
        label: seasonLabel,
        maxCell: 140,
        minPhoto: 34,
      },
    );
    /*
     * Everyone visible beats bigger faces with somebody in a "+N" — and a grid
     * that FILLS its panel beats a marginally bigger one that leaves a third of
     * every panel empty, which is what "biggest face wins" produced: six tall
     * skinny panels with two columns of coins down the middle.
     */
    const room = panelHeight - panelHeader - 2 * inset;
    const fill = room <= 0 ? 0 : Math.min(1, faces.gridHeight / room);
    const score = faces.photoWidth * (0.55 + 0.45 * fill) * (faces.overflow > 0 ? 0.3 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = {
        panelCols,
        panelRows,
        panelWidth,
        panelHeight,
        panelHeader,
        inset,
        nameSize: clampTo(panelHeader * 0.42, 18, 28),
        faces,
      };
    }
  }
  return best;
}
