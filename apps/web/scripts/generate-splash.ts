/**
 * Draws the iPhone/iPad launch screens listed in src/lib/apple-splash.ts:
 * the brand mark (public/brand/mark.svg, unchanged) centred on the app's
 * background colour, one PNG per screen and orientation.
 *
 *   pnpm --filter @desiauction/web splash
 *
 * Deterministic (no text, so no system font can change the output) and
 * idempotent: it rewrites public/brand/splash/ from the list and removes
 * images the list no longer names. src/lib/pwa.test.ts fails if an image is
 * missing or the wrong size, so a forgotten run cannot ship.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { SPLASH_BACKGROUND, splashImages } from "../src/lib/apple-splash";

const PUBLIC = path.resolve(import.meta.dirname, "../public");
const OUT = path.join(PUBLIC, "brand/splash");
const MARK = readFileSync(path.join(PUBLIC, "brand/mark.svg"));

// The mark's share of the screen's SHORT side: the same presence as Android's
// splash icon, whichever way the device is held.
const MARK_SHARE = 0.22;

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const images = splashImages();
  const wanted = new Set(images.map((image) => path.basename(image.url)));
  for (const file of readdirSync(OUT)) {
    if (!wanted.has(file)) {
      rmSync(path.join(OUT, file));
    }
  }
  for (const image of images) {
    const size = Math.round(Math.min(image.pixelWidth, image.pixelHeight) * MARK_SHARE);
    const mark = await sharp(MARK, { density: 72 * (size / 64) })
      .resize(size, size)
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: image.pixelWidth,
        height: image.pixelHeight,
        channels: 3,
        background: SPLASH_BACKGROUND,
      },
    })
      .composite([{ input: mark, gravity: "center" }])
      .png({ compressionLevel: 9, palette: true })
      .toFile(path.join(PUBLIC, image.url));
  }
  console.log(`splash: ${String(images.length)} images in ${path.relative(process.cwd(), OUT)}`);
}

void main();
