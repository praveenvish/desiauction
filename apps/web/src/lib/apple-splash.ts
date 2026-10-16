/**
 * THE INSTALLED APP'S LAUNCH SCREEN ON iPHONE AND iPAD.
 *
 * Android draws its own splash from the manifest (icon on background_color).
 * iOS does not: unless a `apple-touch-startup-image` matches the device's
 * exact screen, in its exact orientation, it shows a blank WHITE screen while
 * the app starts, which on a dark app reads as a flash. iOS matches by media
 * query, so there is one image per screen size and orientation.
 *
 * ONE LIST, TWO READERS: scripts/generate-splash.ts draws the PNGs from it and
 * the root layout's metadata links them from it, so an image and its link can
 * never disagree. A new iPhone screen size means one row here, then
 * `pnpm --filter @desiauction/web splash`. Safari downloads only the image
 * whose query matches, and only when someone adds the app to the Home Screen.
 */

/** Same as the manifest's background_color: the splash is the app's first frame. */
export const SPLASH_BACKGROUND = "#0B1018";

interface Screen {
  /** CSS pixels, portrait. */
  readonly width: number;
  readonly height: number;
  readonly ratio: 2 | 3;
}

/**
 * Every screen size Apple has shipped since iOS could install web apps fully
 * (iOS 11.3), newest first. Screens shared by several models are listed once.
 */
export const APPLE_SCREENS: readonly Screen[] = [
  { width: 440, height: 956, ratio: 3 }, // iPhone 16 Pro Max
  { width: 402, height: 874, ratio: 3 }, // iPhone 16 Pro
  { width: 430, height: 932, ratio: 3 }, // iPhone 14 Pro Max, 15/16 Plus, 15 Pro Max
  { width: 393, height: 852, ratio: 3 }, // iPhone 14 Pro, 15, 15 Pro, 16
  { width: 428, height: 926, ratio: 3 }, // iPhone 12/13 Pro Max, 14 Plus
  { width: 390, height: 844, ratio: 3 }, // iPhone 12/13/14, 12/13 Pro
  { width: 375, height: 812, ratio: 3 }, // iPhone X/XS, 11 Pro, 12/13 mini
  { width: 414, height: 896, ratio: 3 }, // iPhone XS Max, 11 Pro Max
  { width: 414, height: 896, ratio: 2 }, // iPhone XR, 11
  { width: 414, height: 736, ratio: 3 }, // iPhone 6+/7+/8 Plus
  { width: 375, height: 667, ratio: 2 }, // iPhone 6/7/8, SE (2nd, 3rd)
  { width: 320, height: 568, ratio: 2 }, // iPhone SE (1st), iPod touch
  { width: 1032, height: 1376, ratio: 2 }, // iPad Pro 13" (M4)
  { width: 1024, height: 1366, ratio: 2 }, // iPad Pro 12.9"
  { width: 834, height: 1210, ratio: 2 }, // iPad Pro 11" (M4)
  { width: 834, height: 1194, ratio: 2 }, // iPad Pro 11"
  { width: 820, height: 1180, ratio: 2 }, // iPad Air 4/5, iPad 10th
  { width: 834, height: 1112, ratio: 2 }, // iPad Air 3, Pro 10.5"
  { width: 810, height: 1080, ratio: 2 }, // iPad 7th–9th
  { width: 768, height: 1024, ratio: 2 }, // iPad mini 5, iPad 9.7"
  { width: 744, height: 1133, ratio: 2 }, // iPad mini 6/7
];

export interface SplashImage {
  /** Device pixels, as drawn. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly url: string;
  readonly media: string;
}

/** Both orientations of every screen: an iPad, or a phone held sideways. */
export function splashImages(): SplashImage[] {
  return APPLE_SCREENS.flatMap((screen) =>
    (["portrait", "landscape"] as const).map((orientation) => {
      const portrait = orientation === "portrait";
      const pixelWidth = (portrait ? screen.width : screen.height) * screen.ratio;
      const pixelHeight = (portrait ? screen.height : screen.width) * screen.ratio;
      return {
        pixelWidth,
        pixelHeight,
        url: `/brand/splash/${String(pixelWidth)}x${String(pixelHeight)}.png`,
        // device-width/height are the PORTRAIT dimensions in either
        // orientation; the orientation feature is what tells them apart.
        media: `(device-width: ${String(screen.width)}px) and (device-height: ${String(
          screen.height,
        )}px) and (-webkit-device-pixel-ratio: ${String(screen.ratio)}) and (orientation: ${orientation})`,
      };
    }),
  );
}
