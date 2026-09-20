import {
  POSTER_KIND_SIZES,
  TOP_BUY_COUNTS,
  isPosterSize,
  isPosterTheme,
  isTopBuyCount,
  type PosterKind,
  type PosterSize,
  type PosterTheme,
  type TopBuyCount,
} from "@desiauction/core";

/**
 * THE QUERY STRING, WHICH IS NOT TO BE TRUSTED.
 *
 * `?theme=` and `?size=` reach a route handler as arbitrary strings from
 * anywhere, and both end up selecting a record key inside the renderer — the
 * one shape of input that turns a typo into `undefined.palette` at raster time.
 * The two type guards in core are the whole gate: anything they refuse falls
 * back to the default rather than failing the request, because a poster picker
 * with a stale link in it should show a poster, not an error page.
 *
 * Pure, and separate from the routes, so the fallbacks are testable without a
 * database or a rasterizer.
 */

export const DEFAULT_POSTER_THEME: PosterTheme = "floodlight";
export const DEFAULT_POSTER_SIZE: PosterSize = "portrait";
export const DEFAULT_TOP_COUNT: TopBuyCount = 5;
/** A sponsor credit is somebody's typing, drawn on a poster. Keep it a line. */
export const SPONSOR_MAX = 44;

export interface PosterQuery {
  readonly theme: PosterTheme;
  readonly size: PosterSize;
  /** `?download=1` — an attachment rather than something the picker previews. */
  readonly download: boolean;
  /** `?n=` on the top-buys poster: 3, 5 or 10, and nothing else. */
  readonly count: TopBuyCount;
  /**
   * `?prices=0` hides the money. An owner posting "meet the squad" to a fan
   * group usually does not want every fee in the image; the organizer's
   * results sheet does.
   */
  readonly prices: boolean;
  /** `?sponsor=` — a credit line the organizer typed, clamped and scrubbed. */
  readonly sponsor: string | null;
  /**
   * `?motion=1` — the LAYERED sprite the studio animates, rather than the flat
   * poster. Same route, same gate, same audit row: the animation is the poster,
   * taken apart, so it can never drift from the file people download.
   */
  readonly motion: boolean;
}

/**
 * A credit line, made safe to draw.
 *
 * It is free text from a query string that ends up inside the raster. Control
 * characters (a newline would silently become a second line the layout has no
 * budget for) are dropped, runs of whitespace collapse, and the whole thing is
 * clamped — a sponsor who wants a paragraph gets a line.
 */
export function cleanSponsor(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const stripped = value
    // eslint-disable-next-line no-control-regex -- removing them is the point.
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped === "") {
    return null;
  }
  return stripped.length <= SPONSOR_MAX ? stripped : `${stripped.slice(0, SPONSOR_MAX - 1)}…`;
}

/**
 * The query string, narrowed to what the KIND can draw. A season sheet has no
 * square (see `POSTER_KIND_SIZES`), so a stale `?size=square` on that route
 * falls back to the kind's first shape rather than rendering a contact sheet of
 * thumbnails nobody can read.
 */
export function parsePosterQuery(params: URLSearchParams, kind?: PosterKind): PosterQuery {
  const theme = params.get("theme");
  const size = params.get("size");
  const allowed = kind === undefined ? null : POSTER_KIND_SIZES[kind];
  const wanted = size !== null && isPosterSize(size) ? size : DEFAULT_POSTER_SIZE;
  const count = Number(params.get("n"));
  return {
    theme: theme !== null && isPosterTheme(theme) ? theme : DEFAULT_POSTER_THEME,
    size:
      allowed === null || allowed.includes(wanted) ? wanted : (allowed[0] ?? DEFAULT_POSTER_SIZE),
    download: params.get("download") === "1",
    count: isTopBuyCount(count) ? count : DEFAULT_TOP_COUNT,
    // Absent means shown: the money is what a results poster is about, and a
    // missing parameter must never quietly publish less than the studio shows.
    prices: params.get("prices") !== "0",
    sponsor: cleanSponsor(params.get("sponsor")),
    motion: params.get("motion") === "1",
  };
}

/** The counts the studio offers, in the order it offers them. */
export const TOP_COUNTS = TOP_BUY_COUNTS;

/**
 * Headers for a rendered poster.
 *
 * `no-store` is the load-bearing one. This is a photograph of a named civilian
 * behind an organizer's session; a shared cache holding it would be a copy of
 * personal data sitting outside every gate that produced it, and outside the
 * audit row that recorded who took it.
 *
 * The filename is built from slugified parts upstream, so it cannot carry a
 * quote or a newline into this header.
 */
export function posterHeaders(
  filename: string,
  download: boolean,
  motion?: PosterMotionFacts,
): Record<string, string> {
  return {
    "content-type": "image/png",
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
    ...(motion === undefined ? {} : { "x-poster-motion": JSON.stringify(motion) }),
  };
}

/**
 * What the studio's animator needs and cannot read off a picture: which bands
 * the sprite carries, and the number a price counts up to.
 *
 * Sent as a header on the sprite itself — one request, one gate, one audit row —
 * and ASCII-only (JSON escapes anything else), because a header carrying a ₹
 * is a header some proxy will mangle.
 */
export interface PosterMotionFacts {
  readonly layers: readonly string[];
  readonly height: number;
  /** Integer paise for the count-up, when the poster has ONE headline price. */
  readonly pricePaise?: number;
}

/** A refusal is text, not a picture: an error drawn as a poster gets forwarded. */
export function posterRefusal(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
    },
  });
}
