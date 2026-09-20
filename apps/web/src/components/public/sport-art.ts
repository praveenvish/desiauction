/**
 * THE SPORT ART LOOKUP — one place that answers "what picture goes behind
 * this?" for every public surface.
 *
 * The founder is supplying a photograph per sport (1600×600, subject right).
 * Until each one lands, the lookup returns `null` and the surfaces draw their
 * designed fallback: the season's own gradient with the sport's glyph
 * watermarked into it. That fallback is not a placeholder to be replaced
 * later — a season whose organizer uploads no cover photo keeps it forever, so
 * it has to look deliberate on its own.
 *
 * Adding a photo is dropping the file into `public/marketing/sports/` and
 * naming it here. No component changes.
 */

export interface SportArt {
  /** Served from `apps/web/public`. */
  src: string;
  /** `object-position`, so a subject on the right survives a narrow crop. */
  position: string;
  /** Intrinsic size, for `next/image`. */
  width: number;
  height: number;
}

/**
 * Wide art for a card banner or a page hero. Empty until the photographs
 * arrive; `multisport-hero.webp` is NOT reused here on purpose — it is the
 * landing hero, and seeing the same photograph on nine directory cards reads
 * as a bug rather than as a house style.
 */
const SPORT_BANNERS: Readonly<Record<string, SportArt>> = {};

/** The banner for a sport, or `null` when the surface should draw the gradient. */
export function sportBanner(sport: string): SportArt | null {
  return SPORT_BANNERS[sport] ?? null;
}

/**
 * The angle of the fallback gradient, in degrees.
 *
 * The COLOURS are not seeded: they are the floodlight tokens, the same night
 * the whole site is lit by, because a per-sport hue would invent eleven brand
 * colours nobody chose and drag the gold off-palette. What varies is the
 * direction the light comes from, which is enough to keep a grid of gradients
 * from reading as one repeated tile. A `seed` (a season's slug) varies it
 * again within one sport, because a directory page of a single sport — which
 * is most of them today — was twelve identical tiles.
 */
export function sportGradientAngle(sport: string, seed = ""): number {
  let hash = 0;
  for (const char of `${sport}${seed}`) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  // Snap to 15° steps: neighbouring cards differ visibly, and no card lands on
  // an angle so shallow that the gradient reads as a flat fill.
  return 100 + ((Math.round(hash / 15) * 15) % 140);
}
