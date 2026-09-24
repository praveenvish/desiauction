import { mix, WHITE, withAlpha } from "./poster-color";
import type { Skin } from "./poster-skins";

/**
 * DEPTH — the v3 surfaces every poster is lit with.
 *
 * The first poster family was flat: a wash, a slab, a stamp. The founder's note
 * on the redesign was "premium, clean, easy to understand, more 3D", and the
 * mockups that earned a yes had four pieces, which these tokens colour:
 *
 * - a BACKLIGHT in the team's colour behind the subject, instead of a slab;
 * - a 3D NUMBER (the shirt number) standing behind the player — a stacked-shadow
 *   body under a lit face;
 * - GLASS: the result panel, a translucent surface with a lit top edge and a
 *   deep cast shadow, so "SOLD · ₹12,500 · to Jaipur Jaguars" reads as one
 *   object;
 * - METAL: the one figure that matters, filled with a polished gradient.
 *
 * Every piece is plain Satori: gradients, `textShadow`, `boxShadow` (inset
 * included) and `backgroundClip: "text"` all rasterize; `backdrop-filter` and
 * CSS filters do not, so the glass is built from gradients rather than blur.
 *
 * The SIX themes keep their meaning — `depthFor` turns each skin into these
 * tokens, and the two paper themes get a lit white card and a bronze metal
 * instead of glass and gold, because gold on cream is legible to nobody.
 */

export interface Depth {
  readonly dark: boolean;
  /** Centre colour of the light behind the subject, and the same hue at zero. */
  readonly backlight: string;
  readonly backlightClear: string;
  /** The 3D number: its lit face, and its body (the extrusion). */
  readonly numberFace: string;
  readonly numberHeroFace: string;
  readonly numberSide: string;
  readonly glassFill: string;
  readonly glassBorder: string;
  readonly glassShadow: string;
  /** The polished fill of the one figure that matters. */
  readonly metal: string;
  readonly pillFill: string;
  readonly pillText: string;
  readonly hairline: string;
}

const GOLD_METAL =
  "linear-gradient(180deg, #FFF3CC 0%, #F4CB6A 34%, #D69A28 58%, #F2CF78 76%, #B27B18 100%)";
const GOLD_PILL = "linear-gradient(180deg, #F7D98A 0%, #E6B24A 55%, #C98F22 100%)";
const GOLD_HERO =
  "linear-gradient(180deg, #FFF0C2 0%, #F2C766 30%, #C98F22 62%, rgba(150,100,20,0.35) 100%)";

const DARK_GLASS = {
  glassFill: "linear-gradient(180deg, rgba(255,255,255,0.085) 0%, rgba(255,255,255,0.03) 100%)",
  glassBorder: "rgba(255,255,255,0.11)",
  glassShadow: "inset 0 1px 0 rgba(255,255,255,0.16), 0 40px 90px -24px rgba(0,0,0,0.85)",
  hairline: "rgba(255,255,255,0.12)",
} as const;

/** A metal fill made from one colour: a lit top, the colour, a shaded foot. */
function metalOf(colour: string): string {
  return `linear-gradient(180deg, ${mix(colour, WHITE, 0.55)} 0%, ${mix(colour, WHITE, 0.2)} 34%, ${colour} 58%, ${mix(colour, WHITE, 0.3)} 76%, ${mix(colour, "#000000", 0.25)} 100%)`;
}

function pillOf(colour: string): string {
  return `linear-gradient(180deg, ${mix(colour, WHITE, 0.35)} 0%, ${colour} 55%, ${mix(colour, "#000000", 0.15)} 100%)`;
}

export function depthFor(skin: Skin): Depth {
  const { palette, family, theme } = skin;
  const team = skin.team.fill;
  if (family === "matchday") {
    // The ground already IS the team. The light becomes a spotlight on the
    // jersey, and the glass darkens instead of brightening so it reads on
    // any colour an organizer picked.
    return {
      dark: true,
      backlight: "rgba(255,255,255,0.20)",
      backlightClear: "rgba(255,255,255,0)",
      numberFace:
        "linear-gradient(180deg, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.10) 62%, rgba(255,255,255,0) 100%)",
      numberHeroFace: GOLD_HERO,
      numberSide: mix(palette.surface, "#000000", 0.45),
      glassFill: "linear-gradient(180deg, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0.16) 100%)",
      glassBorder: "rgba(255,255,255,0.16)",
      glassShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 40px 90px -24px rgba(0,0,0,0.7)",
      metal: GOLD_METAL,
      pillFill: GOLD_PILL,
      pillText: palette.onAccent,
      hairline: "rgba(255,255,255,0.16)",
    };
  }
  if (!skin.dark) {
    // Paper: ink and minimal. A white card lifted by its shadow, a bronze (or
    // the team's own colour, on minimal) metal, and a tinted number.
    const metalBase = theme === "ink" ? "#9A6A0C" : palette.accent;
    return {
      dark: false,
      backlight: withAlpha(team, 0.2),
      backlightClear: withAlpha(team, 0),
      numberFace: `linear-gradient(180deg, ${withAlpha(team, 0.3)} 0%, ${withAlpha(team, 0.08)} 70%, ${withAlpha(team, 0)} 100%)`,
      numberHeroFace: `linear-gradient(180deg, ${mix(metalBase, WHITE, 0.35)} 0%, ${metalBase} 55%, ${withAlpha(metalBase, 0.25)} 100%)`,
      numberSide: mix(team, palette.surface, 0.62),
      glassFill: "linear-gradient(180deg, #FFFFFF 0%, #FBFAF7 100%)",
      glassBorder: palette.border,
      glassShadow: "inset 0 1px 0 #FFFFFF, 0 30px 70px -26px rgba(20,23,31,0.28)",
      metal:
        theme === "ink"
          ? "linear-gradient(180deg, #C8922A 0%, #A8740F 45%, #7A5000 100%)"
          : `linear-gradient(180deg, ${mix(metalBase, WHITE, 0.12)} 0%, ${metalBase} 55%, ${mix(metalBase, "#000000", 0.22)} 100%)`,
      pillFill: pillOf(palette.accent),
      pillText: palette.onAccent,
      hairline: palette.border,
    };
  }
  // The dark classics: floodlight, gold, arena. Arena keeps its green as the
  // metal — the one theme where the price, not the gold, is the loud thing.
  const arena = theme === "arena";
  return {
    dark: true,
    backlight: withAlpha(team, theme === "gold" ? 0.4 : 0.46),
    backlightClear: withAlpha(team, 0),
    numberFace: `linear-gradient(180deg, ${withAlpha(mix(team, WHITE, 0.55), 0.36)} 0%, ${withAlpha(team, 0.12)} 62%, ${withAlpha(team, 0)} 100%)`,
    numberHeroFace: arena ? metalOf(palette.accent) : GOLD_HERO,
    numberSide: mix(team, palette.surface, 0.78),
    ...DARK_GLASS,
    metal: arena ? metalOf(palette.accent) : GOLD_METAL,
    pillFill: arena ? pillOf(palette.accent) : GOLD_PILL,
    pillText: palette.onAccent,
  };
}
