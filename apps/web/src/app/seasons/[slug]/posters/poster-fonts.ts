import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * FONTS FOR THE RASTERIZER — and the reason the price was a tofu box.
 *
 * Satori does not inherit the app's `next/font` faces: an `ImageResponse` given
 * no `fonts` falls back to whatever the runtime happens to provide, and that
 * fallback has no U+20B9. So the rupee sign — the single most important glyph on
 * a poster whose whole subject is what somebody paid — rendered as an empty
 * rectangle, on every card, in the one artifact built to be shared publicly.
 * Nothing in a type or a lint rule can see that; it is only visible by looking.
 *
 * Anek Devanagari is loaded BESIDE Geist and listed second in `fontFamily`:
 * Satori falls through per-glyph, so anything Geist lacks (₹, and Devanagari in
 * a player's name) is drawn by a face that has it, while the Latin text keeps
 * the product's own type.
 *
 * Read once per process, not per request — a poster route is `force-dynamic`,
 * and re-reading three files on every preview keystroke would make the studio
 * feel broken.
 */
export interface PosterFont {
  readonly name: string;
  readonly data: ArrayBuffer;
  readonly weight: 400 | 600;
  readonly style: "normal";
}

const DIR = join(process.cwd(), "public", "fonts", "poster");

const FACES: readonly { file: string; name: string; weight: 400 | 600 }[] = [
  { file: "geist-sans-400.woff", name: "Geist Sans", weight: 400 },
  { file: "geist-sans-600.woff", name: "Geist Sans", weight: 600 },
  { file: "anek-devanagari-600.woff", name: "Anek Devanagari", weight: 600 },
];

let cached: Promise<PosterFont[]> | null = null;

async function load(): Promise<PosterFont[]> {
  const faces = await Promise.all(
    FACES.map(async (face) => {
      try {
        const buffer = await readFile(join(DIR, face.file));
        return {
          name: face.name,
          // A Node Buffer is a view over a pooled ArrayBuffer; slice it so
          // Satori receives only this font's bytes.
          data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          weight: face.weight,
          style: "normal" as const,
        };
      } catch {
        // A missing face is not worth failing a poster over — Satori will fall
        // back, and a card with plainer type beats a 500 on the one screen an
        // organizer opened to post something.
        return null;
      }
    }),
  );
  return faces.filter((face): face is PosterFont => face !== null);
}

export function posterFonts(): Promise<PosterFont[]> {
  cached ??= load();
  return cached;
}
