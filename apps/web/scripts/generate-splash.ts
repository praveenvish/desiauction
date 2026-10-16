/**
 * Draws what iOS shows for the installed app, from the brand's own vectors:
 *
 *   1. The HOME-SCREEN ICON (src/app/apple-icon.png) from the brand kit's
 *      docs/brand/kit/favicon/apple-touch-icon.svg, unchanged, at 1024px.
 *      It was 180px, the classic iPhone size, and iOS upscaled it wherever it
 *      draws icons larger than that (iOS 18's Large icons, the App Library,
 *      Spotlight), which is what made it soft. 1024 is the size Apple masters
 *      native app icons at; iOS only ever scales it DOWN. Opaque, because iOS
 *      paints transparent icon pixels black.
 *   2. The LAUNCH SCREENS listed in src/lib/apple-splash.ts: the brand mark
 *      (public/brand/mark.svg, unchanged) centred on the app's background
 *      colour, one PNG per screen and orientation.
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
const ICON_SOURCE = readFileSync(
  path.resolve(import.meta.dirname, "../../../docs/brand/kit/favicon/apple-touch-icon.svg"),
);
const APPLE_ICON_SIZE = 1024;

// The mark's share of the screen's SHORT side: the same presence as Android's
// splash icon, whichever way the device is held.
const MARK_SHARE = 0.22;

async function main(): Promise<void> {
  await sharp(ICON_SOURCE, { density: 72 * (APPLE_ICON_SIZE / 64) })
    .resize(APPLE_ICON_SIZE, APPLE_ICON_SIZE)
    .flatten({ background: "#E6B24A" })
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.resolve(import.meta.dirname, "../src/app/apple-icon.png"));

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
