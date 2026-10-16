import * as opentype from "opentype.js";

import type { OutlineCommand, ShapedCluster, Shaper } from "./shaper";

/**
 * A FONT MADE FOR ONE IMAGE, out of the clusters HarfBuzz shaped for it.
 *
 * Satori cannot shape, but it can draw any glyph a font maps a character to,
 * and it still does everything else a name needs: measuring it, fitting it,
 * cutting it with "…" when the cell is too narrow. So each shaped cluster
 * becomes one glyph of a small font, mapped from a Private Use Area character,
 * and the text handed to Satori is those characters. The joined letter and the
 * reordered vowel sign are inside one glyph — there is nothing left to get
 * wrong, and an ellipsis can only ever fall between whole letters.
 */
export const SHAPED_FAMILY = "DA Devanagari Shaped";

/** U+E000, the start of the BMP Private Use Area; 6,400 clusters per image. */
export const SHAPED_FIRST = 0xe000;
export const SHAPED_LIMIT = 0xf8ff - SHAPED_FIRST + 1;

export function buildShapedFont(shaper: Shaper, clusters: readonly ShapedCluster[]): ArrayBuffer {
  const glyphs = [
    new opentype.Glyph({
      name: ".notdef",
      advanceWidth: Math.round(shaper.unitsPerEm / 2),
      path: new opentype.Path(),
    }),
    ...clusters.map(
      (cluster, index) =>
        new opentype.Glyph({
          name: `cluster${String(index)}`,
          unicode: SHAPED_FIRST + index,
          advanceWidth: cluster.advance,
          path: pathOf(cluster.outline),
        }),
    ),
  ];
  const font = new opentype.Font({
    familyName: SHAPED_FAMILY,
    styleName: "Regular",
    unitsPerEm: shaper.unitsPerEm,
    ascender: shaper.ascender,
    descender: shaper.descender,
    glyphs,
  });
  return font.toArrayBuffer();
}

function pathOf(outline: readonly OutlineCommand[]): opentype.Path {
  const path = new opentype.Path();
  for (const { type, values: v } of outline) {
    if (type === "M") {
      path.moveTo(v[0] ?? 0, v[1] ?? 0);
    } else if (type === "L") {
      path.lineTo(v[0] ?? 0, v[1] ?? 0);
    } else if (type === "Q") {
      path.quadraticCurveTo(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
    } else if (type === "C") {
      path.curveTo(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0, v[4] ?? 0, v[5] ?? 0);
    } else {
      path.close();
    }
  }
  return path;
}
