/**
 * THE LARGE-FORMAT IDENTITY (live-room stage 1).
 *
 * The player card on the auction stage is a portrait a phone's width across.
 * Most players have no photo there — `photoUrl` is consent-gated (DPDP §5) —
 * so the card needs a no-photo face that is worth a whole screen, and it must
 * be the SAME identity the player already wears as a 24px roster mark. This is
 * therefore not a second generator: it reads `placeholderIdentity` and only
 * decides how that pattern, tone and angle are drawn at poster size.
 *
 * Pure and deterministic, like the generator it extends. Never a silhouette:
 * the face is the player's initials in gold foil on their own floodlit pattern.
 */

import { placeholderIdentity, type PlaceholderIdentity } from "./placeholder";

/** The card's drawing space: a 4:5 portrait the SVG slices to any box. */
export const IDENTITY_CARD_VIEW = { width: 400, height: 500 } as const;

export interface IdentityCard extends PlaceholderIdentity {
  /**
   * The pattern's own transform in the 400×500 space. Each pattern turns by a
   * bounded share of the seeded angle, so no seed can rotate a pattern out of
   * the frame and no two nearby seeds look alike.
   */
  transform: string;
  /** Glyph size in view units — one initial is set larger than two. */
  fontSize: number;
  /**
   * Vertical centre of the initials, in view units: a little below the middle,
   * clear of the corner the card's clock badge occupies and of the name at the
   * foot.
   */
  glyphY: number;
}

/**
 * Glyph size for a count of initials: a lone letter gets the room two would share.
 *
 * Sized for the card's WIDEST crop, not its 4:5 drawing. On a phone the card is
 * wider than it is tall, the drawing is sliced top and bottom, and initials set
 * at 172 reached the top-right corner — straight under the 64px seconds badge
 * ("YC" read as "Y" and a clock). At 150, centred at 236, two letters stay
 * clear of that corner at 360, 390 and 430 wide.
 */
function glyphSize(initials: string | null): number {
  if (initials === null) {
    return 0;
  }
  const clusters = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(initials)]
    .length;
  return clusters > 1 ? 150 : 184;
}

/** Below the drawing's middle (250 would be dead centre): see `glyphSize`. */
const GLYPH_Y = 236;

function patternTransform(identity: PlaceholderIdentity): string {
  const { angle, pattern } = identity;
  switch (pattern) {
    case "beams":
      // Floodlight beams fall from a top corner; the seed picks which one.
      return angle % 2 === 0 ? "translate(400 0) scale(-1 1)" : "translate(0 0)";
    case "arcs":
      return `rotate(${String(angle % 90)} 200 250)`;
    case "crease":
      return `rotate(${String((angle % 60) - 30)} 200 250)`;
    case "contour":
      return `rotate(${String((angle % 40) - 20)} 200 250)`;
  }
}

/** The poster-size drawing of a player's seeded identity. */
export function identityCardOf(seed: string, name: string): IdentityCard {
  const identity = placeholderIdentity(seed, name);
  return {
    ...identity,
    transform: patternTransform(identity),
    fontSize: glyphSize(identity.initials),
    glyphY: GLYPH_Y,
  };
}
