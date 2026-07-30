/**
 * Avatar backgrounds that are guaranteed to carry white text.
 *
 * The members grid used to generate its avatars as `hsl(${hue} 55% 42%)` from a
 * hash of the person's id — 360 hues at ONE fixed lightness. HSL lightness is
 * not luminance: at L=42% a blue lands around 8:1 against white and a yellow
 * -green lands at 3.1:1. So whether a member's avatar met WCAG AA was decided
 * by what their id happened to hash to, and adding a member was a coin toss on
 * the page's accessibility. Four of demo-club's seven rows failed; three
 * passed; nothing in the code knew the difference.
 *
 * This replaces the open hue space with a closed, validated one: twelve hues,
 * each with its OWN lightness chosen so the swatch sits at ~5:1 against
 * `#ffffff`. `avatar-color.test.ts` recomputes every entry's contrast from the
 * WCAG formula, so an edit that darkens or brightens one fails the suite rather
 * than the axe scan on a screen nobody is looking at.
 *
 * Hues are spread around the wheel so two people in the same list rarely share
 * a colour, and the per-hue lightness is what keeps them looking like one
 * family instead of a ramp from near-black to near-white.
 */
export const AVATAR_COLORS: readonly string[] = [
  "hsl(4 52% 50%)",
  "hsl(28 52% 40%)",
  "hsl(46 52% 33.5%)",
  "hsl(86 52% 31.5%)",
  "hsl(140 52% 32.5%)",
  "hsl(170 52% 32%)",
  "hsl(196 52% 38%)",
  "hsl(222 52% 52%)",
  "hsl(252 52% 58.5%)",
  "hsl(286 52% 51.5%)",
  "hsl(318 52% 48.5%)",
  "hsl(344 52% 50.5%)",
];

/**
 * A stable colour for a person: the same id always gets the same swatch, and
 * every swatch in the set is legible. The hash is the old one, narrowed from
 * 360 possible hues to 12 validated colours.
 */
export function avatarColor(personId: string): string {
  let hash = 0;
  for (const char of personId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 4093;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] as string;
}
