import { isPosterSize, isPosterTheme, type PosterSize, type PosterTheme } from "@desiauction/core";

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
export const DEFAULT_POSTER_SIZE: PosterSize = "square";

export interface PosterQuery {
  readonly theme: PosterTheme;
  readonly size: PosterSize;
  /** `?download=1` — an attachment rather than something the picker previews. */
  readonly download: boolean;
}

export function parsePosterQuery(params: URLSearchParams): PosterQuery {
  const theme = params.get("theme");
  const size = params.get("size");
  return {
    theme: theme !== null && isPosterTheme(theme) ? theme : DEFAULT_POSTER_THEME,
    size: size !== null && isPosterSize(size) ? size : DEFAULT_POSTER_SIZE,
    download: params.get("download") === "1",
  };
}

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
export function posterHeaders(filename: string, download: boolean): Record<string, string> {
  return {
    "content-type": "image/png",
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
  };
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
