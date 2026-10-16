import { ImageResponse } from "next/og";

import { posterFonts, type PosterFont } from "../../app/seasons/[slug]/posters/poster-fonts";
import { SHAPED_FAMILY } from "./shaped-font";
import { shapeTree } from "./shape-tree";

import type { ReactElement } from "react";

type ImageInit = NonNullable<ConstructorParameters<typeof ImageResponse>[1]>;

/**
 * THE ONLY WAY THIS APP MAKES AN IMAGE FROM JSX.
 *
 * `new ImageResponse` draws Devanagari letter by letter in typing order, which
 * is wrong for Hindi (see `shaper.ts`). This shapes it first, adds the shaped
 * face to the fonts, and only then rasterizes. A guard test refuses any other
 * import of `ImageResponse`, so no image can skip this.
 *
 * An image given no fonts keeps Satori's own default — the brand cards that
 * carry no names look exactly as they did. The moment it holds Devanagari it
 * gets the poster faces too: the default has no Devanagari and no ₹, and
 * whatever it cannot draw comes out as an empty box.
 */
export async function imageResponse(
  element: ReactElement,
  init: Omit<ImageInit, "fonts"> & { fonts?: readonly PosterFont[] } = {},
): Promise<ImageResponse> {
  const given = init.fonts;
  const root = given === undefined ? "Geist Sans" : (given[0]?.name ?? null);
  const shaped = await shapeTree(element, root);
  if (shaped.font === null && given === undefined) {
    // `fonts` is absent here, which is exactly "Satori's default".
    return new ImageResponse(shaped.node as ReactElement, init as ImageInit);
  }
  const fonts = given ?? (await posterFonts());
  return new ImageResponse(shaped.node as ReactElement, {
    ...init,
    fonts: [
      ...fonts,
      ...(shaped.font === null
        ? []
        : [
            {
              name: SHAPED_FAMILY,
              data: shaped.font,
              weight: 600 as const,
              style: "normal" as const,
            },
          ]),
    ],
  });
}
