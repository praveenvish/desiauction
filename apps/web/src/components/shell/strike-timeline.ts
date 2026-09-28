// THE STRIKE, as numbers. The DA mark's motion logo: the tile lands, the D and
// the A's leg rise, the slash falls like a gavel and cuts in front of the D,
// the tile takes the hit on the frame the sting sounds, one pass of floodlight,
// then the mark rests exactly as drawn. Pure, so the frames are testable and
// the component only applies them.

/** The gavel lands here: the tile dips and the sting sounds on this frame. */
export const STRIKE_IMPACT_MS = 400;
/** After this the mark is at rest, identical to public/brand/mark.svg. */
export const STRIKE_DONE_MS = 1000;
/** Full height of the slash's reveal clip, in mark units (the tile is 64). */
export const STRIKE_CLIP_HEIGHT = 44;

export interface StrikeFrame {
  /** The tile's opacity and scale about its centre. */
  tileOpacity: number;
  tileScale: number;
  /** The D and the A's leg fade and rise into place before the strike. */
  riseOpacity: number;
  glyphDy: number;
  /** How much of the slash (and the gap it cuts) is revealed, top down. */
  clipHeight: number;
  /** The floodlight pass: its x offset and opacity. */
  sweepX: number;
  sweepOpacity: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const span = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeIn = (x: number) => x * x;
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

export function strikeFrame(t: number): StrikeFrame {
  const enter = easeOut(span(t, 0, 180));
  // A 3% dip, there and back, over the 200ms after impact.
  const bump =
    t >= STRIKE_IMPACT_MS && t <= STRIKE_IMPACT_MS + 200
      ? Math.sin((Math.PI * (t - STRIKE_IMPACT_MS)) / 200)
      : 0;
  const rise = easeOut(span(t, 80, 260));
  const drop =
    t >= STRIKE_IMPACT_MS
      ? 1.2 * (1 - easeOut(span(t, STRIKE_IMPACT_MS, STRIKE_IMPACT_MS + 140)))
      : 0;
  const sweep = span(t, 520, STRIKE_DONE_MS);
  return {
    tileOpacity: enter,
    tileScale: (0.88 + 0.12 * enter) * (1 - 0.03 * bump),
    riseOpacity: rise,
    glyphDy: 3 * (1 - rise) + drop,
    clipHeight: STRIKE_CLIP_HEIGHT * easeIn(span(t, 260, STRIKE_IMPACT_MS)),
    sweepX: -10 + 100 * easeInOut(sweep),
    sweepOpacity: sweep > 0 && sweep < 1 ? 0.2 * Math.sin(Math.PI * sweep) : 0,
  };
}
