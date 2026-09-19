import { POSTER_SIZES, type PosterKind } from "@desiauction/core";
import { ImageResponse } from "next/og";

import { posterBrandMark, type PosterResult } from "../../../../server/competition/posters";
import { renderSprite } from "./poster-card";
import type { PosterRenderOptions } from "./poster-kit";
import { posterFonts } from "./poster-fonts";
import { parsePosterQuery, posterHeaders, posterRefusal, type PosterQuery } from "./poster-request";

import type { ReactElement } from "react";

/**
 * ONE DOOR FOR EVERY POSTER.
 *
 * Five kinds reach the rasterizer through this function, and that is the point:
 * the gate, the query parsing, the fonts, the cache headers and the motion
 * sprite are decided once. When the studio grew from two posters to five, the
 * shape of bug this prevents was the fourth route quietly forgetting the
 * `no-store` header, or the Devanagari face, or the brand mark.
 *
 * Every gate, every consent check and every audit row lives in
 * `server/competition/posters.ts`; this validates the query string, rasterizes
 * what comes back, and decides between a preview, a download and a sprite.
 */
export async function posterResponse<TInput, TModel>(args: {
  request: Request;
  kind: PosterKind;
  source: (query: PosterQuery) => Promise<PosterResult<TInput>>;
  build: (input: TInput) => TModel;
  draw: (model: TModel, options: PosterRenderOptions) => ReactElement;
  /** The one number a motion render counts up to, when the poster has one. */
  priceOf?: (input: TInput) => number | null;
  /** The reveal draws no money, whatever the query string says. */
  forcePrices?: boolean;
}): Promise<Response> {
  const query = parsePosterQuery(new URL(args.request.url).searchParams, args.kind);
  const source = await args.source(query);
  if (!source.ok) {
    return posterRefusal(source.status, source.message);
  }
  const options: PosterRenderOptions = {
    theme: query.theme,
    size: query.size,
    showBranding: source.showBranding,
    // The lockup is on EVERY poster now — the tier decides how loud the footer
    // is, not whether the platform's own mark appears at all.
    brandMarkSrc: await posterBrandMark(),
    prices: args.forcePrices ?? query.prices,
    sponsor: query.sponsor,
  };
  const model = args.build(source.input);
  // Without these the rupee sign rasterizes as an empty box — see poster-fonts.
  const fonts = await posterFonts();

  if (!query.motion) {
    return new ImageResponse(args.draw(model, options), {
      ...POSTER_SIZES[query.size],
      fonts,
      headers: posterHeaders(source.filename, query.download),
    });
  }

  const sprite = renderSprite(args.kind, (only) => args.draw(model, only), options);
  const pricePaise = args.priceOf?.(source.input) ?? null;
  return new ImageResponse(sprite.element, {
    width: sprite.width,
    height: sprite.height * sprite.layers.length,
    fonts,
    headers: posterHeaders(source.filename, false, {
      layers: sprite.layers,
      height: sprite.height,
      ...(pricePaise === null ? {} : { pricePaise }),
    }),
  });
}
