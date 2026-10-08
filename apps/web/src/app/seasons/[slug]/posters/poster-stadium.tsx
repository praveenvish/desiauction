import {
  monogramOf,
  POSTER_SIZES,
  TEAM_PALETTE,
  type PlayerPoster,
  type PosterSize,
  type TeamPoster,
  type TeamPosterRow,
} from "@desiauction/core";
import type { ReactNode } from "react";

import type { TeamBadge } from "@desiauction/ui";

import { contrast, luminance, mix, normalize, withAlpha } from "./poster-color";
import { DISPLAY, FIGURES } from "./poster-fonts";
import {
  Footer,
  PosterShield,
  contextFor,
  shown,
  vis,
  type PosterContext,
  type PosterRenderOptions,
} from "./poster-kit";
import { estimateTextWidth } from "./poster-layout";

/**
 * STADIUM — the team on a lit stage (founder, 2026-10-07: "multiple themes and
 * each team a different colour").
 *
 * Built for the place these posters actually go: a WhatsApp Status, where a
 * player posts the card about HIM and an owner posts the squad. Three ideas
 * carry it:
 *
 * 1. THE SHIRT. Most local players have no photo, and a grey circle of
 *    initials says "missing". So a player without one wears his team's shirt,
 *    seen from the back, his name across the shoulders and his number below —
 *    in the team's own colours. With a photo, the photo leads.
 * 2. EVERY TEAM ITS OWN COLOUR. The stage light, the shirt, the trims and the
 *    glow all come from the franchise's colour; a team with none set gets a
 *    distinct one from `TEAM_COLOURS`, picked by its name so it never changes.
 * 3. BROADCAST HIERARCHY. One hero per poster: the price in gold metal under a
 *    rubber stamp on the player card, the captain and icon on the squad.
 *
 * Satori's limits, respected here: flexbox only, literal colours, gradients
 * and shadows (no CSS filters), inline SVG for the shirt and the halftone
 * (resvg draws patterns, masks and clip paths). Motion bands follow the kit:
 * `base` is the stage, header and footer; `hero` the shirt/photo and name (or
 * the crest, title and leaders); `stamp`, `price` and `items` as named.
 */

// --- The team's colour, as a full set of tones --------------------------------

/**
 * Distinct, saturated colours for teams with none set — ten franchises posting
 * the same evening should look like ten franchises.
 */
// The palette lives in the core (`TEAM_PALETTE`), where the server deals it per
// season (`seasonTeamColours`); this hash pick is only the last resort for a
// model that arrived with no colour at all.
const TEAM_COLOURS = TEAM_PALETTE;

/** The night a season-wide or team-less poster stands in. */
export const NIGHT = "#3156B8";

const GOLD = "#FDE047";
const GOLD_METAL =
  "linear-gradient(180deg, #FFF7CC 0%, #FDE68A 26%, #F5B82E 54%, #C98A12 78%, #FFE9A3 100%)";

export interface Tones {
  /** The franchise colour itself — the shirt. */
  readonly base: string;
  /** Its highlight — light on the shoulders, the stage's hot centre. */
  readonly light: string;
  /** Its shadow — the shirt's folds, the number's raised edge. */
  readonly shade: string;
  /** Its night — the stage around the light. */
  readonly night: string;
  /** Trims, stamp and labels: gold, unless the team IS gold. */
  readonly trim: string;
  /** What the text on the shirt is drawn in. */
  readonly onShirt: string;
}

function hashOf(text: string): number {
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash;
}

/** The team's colour (or its assigned one) as the stage uses it. */
export function tonesFor(colour: string | null, teamName: string | null): Tones {
  const base = normalize(
    colour ??
      (teamName === null ? NIGHT : (TEAM_COLOURS[hashOf(teamName) % TEAM_COLOURS.length] ?? NIGHT)),
  );
  // A near-black team still needs a lit shirt; a near-white one a visible fold.
  const lum = luminance(base);
  const shirt = lum < 0.02 ? mix(base, "#FFFFFF", 0.22) : base;
  const trim = contrast(shirt, GOLD) < 1.7 ? "#FFFFFF" : GOLD;
  return {
    base: shirt,
    light: mix(shirt, "#FFFFFF", 0.42),
    shade: mix(shirt, "#000000", 0.45),
    night: mix(shirt, "#000000", 0.86),
    trim,
    onShirt: contrast("#FFFFFF", shirt) >= 1.9 ? "#FFFFFF" : mix(shirt, "#000000", 0.75),
  };
}

// --- Pieces -------------------------------------------------------------------

export const FACE = `${DISPLAY}, Anek Devanagari, sans-serif`;
export const LABEL = `${FIGURES}, Anek Devanagari, sans-serif`;

/** A dot screen that fades away from one edge — print texture on the stage. */
function Halftone({
  width,
  height,
  colour,
  strength,
  from,
  top,
}: {
  width: number;
  /** The band's own height: dots are drawn only where they show. */
  height: number;
  colour: string;
  strength: number;
  from: "top" | "bottom";
  top: number;
}) {
  const id = `ht${from}`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      style={{ position: "absolute", left: 0, top }}
    >
      <defs>
        <pattern id={id} width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="9" cy="9" r="2.6" fill={colour} />
        </pattern>
        <linearGradient
          id={`${id}f`}
          x1="0"
          y1={from === "top" ? "0" : "1"}
          x2="0"
          y2={from === "top" ? "1" : "0"}
        >
          <stop offset="0" stopColor="#FFFFFF" stopOpacity={strength} />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}m`}>
          <rect width={width} height={height} fill={`url(#${id}f)`} />
        </mask>
      </defs>
      <rect width={width} height={height} fill={`url(#${id})`} mask={`url(#${id}m)`} />
    </svg>
  );
}

/** The lit stage: the team's colour as light from above, two beams, dots. */
export function Stage({
  ctx,
  tones,
  width,
  height,
}: {
  ctx: PosterContext;
  tones: Tones;
  width: number;
  height: number;
}) {
  if (!shown(ctx)) {
    return null;
  }
  const glow = Math.round(width * 0.96);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width, height, display: "flex" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          backgroundImage: `linear-gradient(180deg, ${tones.base} 0%, ${tones.shade} 26%, ${tones.night} 58%, #020406 100%)`,
        }}
      />
      {/* Dots only where they show: the pattern and its fade are drawn per
          pixel, and a full-poster screen was a second of render time. */}
      <Halftone
        width={width}
        height={Math.round(height * 0.5)}
        top={0}
        colour={tones.light}
        strength={0.22}
        from="top"
      />
      <div
        style={{
          position: "absolute",
          left: Math.round((width - glow) / 2),
          top: -Math.round(glow * 0.3),
          width: glow,
          height: glow,
          borderRadius: glow,
          backgroundImage: `radial-gradient(circle, ${withAlpha("#FFFFFF", 0.16)} 0%, ${withAlpha("#FFFFFF", 0)} 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -Math.round(width * 0.24),
          top: -200,
          width: 220,
          height: Math.round(height * 1.4),
          backgroundImage: `linear-gradient(180deg, ${withAlpha("#FFFFFF", 0.13)}, ${withAlpha("#FFFFFF", 0)} 60%)`,
          transform: "rotate(22deg)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -Math.round(width * 0.24),
          top: -200,
          width: 220,
          height: Math.round(height * 1.4),
          backgroundImage: `linear-gradient(180deg, ${withAlpha("#FFFFFF", 0.13)}, ${withAlpha("#FFFFFF", 0)} 60%)`,
          transform: "rotate(-22deg)",
        }}
      />
    </div>
  );
}

/** A giant word in outline behind everything — "SOLD", "SQUAD". */
export function GhostWord({
  ctx,
  word,
  top,
  size,
  width,
}: {
  ctx: PosterContext;
  word: string;
  top: number;
  size: number;
  width: number;
}) {
  if (!shown(ctx)) {
    return null;
  }
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width,
        display: "flex",
        justifyContent: "center",
        fontFamily: FACE,
        fontSize: size,
        lineHeight: 0.8,
        letterSpacing: Math.round(size * 0.02),
        // A faint fill, not an outline: Satori draws a stroked transparent
        // word as nothing at all.
        color: "#FFFFFF0E",
      }}
    >
      {word}
    </div>
  );
}

const SHIRT =
  "M122 26 L170 10 Q200 34 230 10 L278 26 L384 92 L346 182 L302 162 Q308 300 298 418 Q200 446 102 418 Q92 300 98 162 L54 182 L16 92 Z";

/** The shirt itself: shaded fabric, raglan seams, ribbed collar, cuffs, mesh, a shadow. */
function Shirt({ width, tones, id }: { width: number; tones: Tones; id: string }) {
  // The knit is invisible on a tile-sized shirt and costs a pattern fill each.
  const mesh = width >= 240;
  // Seams, folds, stitching and the floor shadow only where they can be seen:
  // fifteen tile-sized shirts each paying for them was most of a second.
  const detail = width >= 200;
  const height = Math.round(width * 1.1);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 400 440"
      style={{ position: "absolute", left: 0, top: 0 }}
    >
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tones.light} />
          <stop offset="0.35" stopColor={tones.base} />
          <stop offset="1" stopColor={tones.shade} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000000" stopOpacity="0.45" />
          <stop offset="0.2" stopColor="#000000" stopOpacity="0.05" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.12" />
          <stop offset="0.8" stopColor="#000000" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.5" />
        </linearGradient>
        <pattern id={`${id}m`} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="0.9" fill="#000000" fillOpacity="0.16" />
        </pattern>
        <radialGradient id={`${id}g`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000000" stopOpacity="0.55" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}c`}>
          <path d={SHIRT} />
        </clipPath>
      </defs>
      {detail ? <ellipse cx="200" cy="432" rx="150" ry="20" fill={`url(#${id}g)`} /> : null}
      <path d={SHIRT} fill={`url(#${id}b)`} />
      <g clipPath={`url(#${id}c)`}>
        {mesh ? <rect width="400" height="440" fill={`url(#${id}m)`} /> : null}
        <rect width="400" height="440" fill={`url(#${id}s)`} />
        {detail ? (
          <path d="M170 10 L118 200 L104 200 L156 14 Z" fill="#FFFFFF" fillOpacity="0.10" />
        ) : null}
        {detail ? (
          <path d="M230 10 L282 200 L296 200 L244 14 Z" fill="#000000" fillOpacity="0.12" />
        ) : null}
        {detail ? (
          <path
            d="M150 230 Q160 300 150 380"
            stroke="#000000"
            strokeOpacity="0.10"
            strokeWidth="6"
            fill="none"
          />
        ) : null}
        {detail ? (
          <path
            d="M262 240 Q252 310 266 390"
            stroke="#000000"
            strokeOpacity="0.09"
            strokeWidth="6"
            fill="none"
          />
        ) : null}
        <rect x="0" y="396" width="400" height="12" fill={tones.trim} fillOpacity="0.95" />
        <rect x="0" y="410" width="400" height="4" fill={tones.trim} fillOpacity="0.6" />
      </g>
      <path d="M170 10 Q200 34 230 10 L238 14 Q200 46 162 14 Z" fill={tones.trim} />
      {detail ? (
        <path
          d="M166 13 Q200 40 234 13"
          stroke="#000000"
          strokeOpacity="0.25"
          strokeWidth="1.5"
          fill="none"
          strokeDasharray="3 3"
        />
      ) : null}
      <path
        d="M16 92 L54 182 L66 176 L28 86 Z M384 92 L346 182 L334 176 L372 86 Z"
        fill={tones.trim}
      />
      <path d={SHIRT} fill="none" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="2" />
    </svg>
  );
}

/** The shirt with a name across the shoulders and the number in raised twill. */
export function Jersey({
  width,
  tones,
  name,
  number,
  tilt = 0,
  id,
}: {
  width: number;
  tones: Tones;
  name: string | null;
  number: string;
  tilt?: number;
  id: string;
}) {
  const height = Math.round(width * 1.1);
  // No number: the name IS the back of the shirt, printed big where the
  // number would be — a blank shirt reads as a mistake.
  const nameOnly = name !== null && number === "";
  const nameSize =
    name === null
      ? 0
      : nameOnly
        ? fitSize(name, width * 0.52, width * 0.17, width * 0.09)
        : fitSize(name, width * 0.5, width * 0.1, width * 0.06);
  const numberSize = Math.round(width * (number.length >= 3 ? 0.3 : name === null ? 0.42 : 0.37));
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width,
        height,
        ...(tilt === 0 ? {} : { transform: `rotate(${String(tilt)}deg)` }),
      }}
    >
      <Shirt width={width} tones={tones} id={id} />
      {name === null ? (
        <div style={{ display: "flex", height: Math.round(height * 0.24) }} />
      ) : (
        <div
          style={{
            display: "flex",
            marginTop: Math.round(height * (nameOnly ? 0.36 : 0.2)),
            fontFamily: FACE,
            fontSize: nameSize,
            lineHeight: 1,
            letterSpacing: 2,
            color: tones.onShirt,
          }}
        >
          {name}
        </div>
      )}
      {number === "" ? null : (
        // Raised twill: a dark copy of the number, offset, under the light one.
        // Two plain texts cost nothing; a text-shadow is an SVG filter per
        // glyph run, and fifteen of them were a second of render time.
        <div
          style={{ display: "flex", position: "relative", marginTop: Math.round(width * 0.015) }}
        >
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: Math.max(2, Math.round(width * 0.012)),
              top: Math.max(2, Math.round(width * 0.014)),
              fontFamily: FACE,
              fontSize: numberSize,
              lineHeight: 1,
              color: tones.shade,
            }}
          >
            {number}
          </div>
          <div
            style={{
              display: "flex",
              position: "relative",
              fontFamily: FACE,
              fontSize: numberSize,
              lineHeight: 1,
              color: tones.onShirt,
            }}
          >
            {number}
          </div>
        </div>
      )}
    </div>
  );
}

/** A photograph where a shirt would stand: framed in the team's light. */
export function Portrait({ width, tones, src }: { width: number; tones: Tones; src: string }) {
  const height = Math.round(width * 1.1);
  const ring = Math.max(4, Math.round(width * 0.012));
  return (
    <div
      style={{
        display: "flex",
        width,
        height,
        borderRadius: Math.round(width * 0.08),
        padding: ring,
        backgroundImage: `linear-gradient(160deg, ${tones.trim}, ${tones.base} 55%, ${tones.shade})`,
      }}
    >
      <img
        src={src}
        width={width - 2 * ring}
        height={height - 2 * ring}
        style={{ borderRadius: Math.round(width * 0.07), objectFit: "cover" }}
        alt=""
      />
    </div>
  );
}

/** The franchise's crest on a white disc ringed in its trim. */
export function Crest({
  size,
  tones,
  src,
  monogram,
  badge,
}: {
  size: number;
  tones: Tones;
  src: string | null;
  monogram: string;
  /** A TEAM's crest: with no logo, the season's shield (0111) unless initials. */
  badge?: TeamBadge | undefined;
}) {
  if (src === null && badge !== undefined && badge !== "initials") {
    return <PosterShield size={size} color={tones.base} initials={monogram} fontFamily={FACE} />;
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size,
        backgroundImage: "radial-gradient(circle at 35% 30%, #FFFFFF, #E8EEF0)",
        border: `${String(Math.round(size * 0.05))}px solid ${tones.trim}`,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {src === null ? (
        <div
          style={{
            display: "flex",
            fontFamily: FACE,
            fontSize: Math.round(size * 0.42),
            color: tones.shade,
          }}
        >
          {monogram}
        </div>
      ) : (
        <img
          src={src}
          width={Math.round(size * 0.74)}
          height={Math.round(size * 0.74)}
          style={{ objectFit: "contain" }}
          alt=""
        />
      )}
    </div>
  );
}

/** "———  BPL-4 · AUCTION  ———" */
export function Kicker({ text, size, tones }: { text: string; size: number; tones: Tones }) {
  const rule = Math.round(size * 3);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(size * 0.8) }}>
      <div
        style={{
          display: "flex",
          width: rule,
          height: 2,
          backgroundImage: `linear-gradient(90deg, ${withAlpha(tones.trim, 0)}, ${tones.trim})`,
        }}
      />
      <div
        style={{
          display: "flex",
          fontFamily: LABEL,
          fontSize: size,
          letterSpacing: Math.round(size * 0.5),
          color: withAlpha("#FFFFFF", 0.9),
        }}
      >
        {text}
      </div>
      <div
        style={{
          display: "flex",
          width: rule,
          height: 2,
          backgroundImage: `linear-gradient(90deg, ${tones.trim}, ${withAlpha(tones.trim, 0)})`,
        }}
      />
    </div>
  );
}

/** A rubber stamp: two rules, tilted, glowing faintly. */
function Stamp({ word, size, tones }: { word: string; size: number; tones: Tones }) {
  return (
    <div
      style={{
        display: "flex",
        padding: Math.round(size * 0.07),
        border: `${String(Math.max(3, Math.round(size * 0.05)))}px solid ${tones.trim}`,
        borderRadius: Math.round(size * 0.14),
        transform: "rotate(-7deg)",
      }}
    >
      <div
        style={{
          display: "flex",
          padding: `${String(Math.round(size * 0.05))}px ${String(Math.round(size * 0.26))}px`,
          border: `2px solid ${tones.trim}`,
          borderRadius: Math.round(size * 0.07),
          background: withAlpha(tones.trim, 0.08),
          fontFamily: FACE,
          fontSize: size,
          lineHeight: 1.05,
          letterSpacing: Math.round(size * 0.09),
          color: tones.trim,
        }}
      >
        {word}
      </div>
    </div>
  );
}

/** Gold metal type, for the one number that counts. */
export function metal(): Record<string, string> {
  return { backgroundImage: GOLD_METAL, backgroundClip: "text", color: "transparent" };
}

// --- Sizing -------------------------------------------------------------------

/** The largest size (≤ max) at which `text` fits `room`, never under `min`. */
export function fitSize(text: string, room: number, max: number, min: number): number {
  let size = Math.round(max);
  while (size > min && estimateTextWidth(text, size) > room) {
    size -= 2;
  }
  return Math.max(Math.round(min), size);
}

/** "8,500 pts" → { lead: "", figure: "8,500", tail: "PTS" }; "₹12,500" → lead "₹". */
export function splitPrice(label: string): { lead: string; figure: string; tail: string } {
  // The currency sign is whatever `formatAmount` chose for the season's unit
  // (U+20B9 for rupees, none for points): read off the label, never assumed.
  const match = /^(\u20B9)?\s*([\d,.]+)\s*([A-Za-z]+)?$/.exec(label.trim());
  if (match === null) {
    return { lead: "", figure: label, tail: "" };
  }
  return { lead: match[1] ?? "", figure: match[2] ?? label, tail: (match[3] ?? "").toUpperCase() };
}

interface PlayerLayout {
  readonly pad: number;
  readonly kicker: number;
  readonly hero: number;
  readonly name: number;
  readonly stamp: number;
  readonly price: number;
  readonly crest: number;
  readonly team: number;
  readonly ghost: number;
}

const PLAYER: Record<PosterSize, PlayerLayout> = {
  story: {
    pad: 76,
    kicker: 24,
    hero: 620,
    name: 140,
    stamp: 84,
    price: 200,
    crest: 104,
    team: 56,
    ghost: 560,
  },
  portrait: {
    pad: 60,
    kicker: 20,
    hero: 400,
    name: 104,
    stamp: 60,
    price: 140,
    crest: 84,
    team: 44,
    ghost: 420,
  },
  square: {
    pad: 52,
    kicker: 18,
    hero: 330,
    name: 84,
    stamp: 50,
    price: 116,
    crest: 72,
    team: 38,
    ghost: 360,
  },
};

const VERDICT_WORD: Record<PlayerPoster["outcome"], string> = {
  sold: "NOW PLAYS FOR",
  captain: "CAPTAIN OF",
  icon: "ICON PLAYER FOR",
  retained: "RETAINED BY",
  unsold: "",
  pool: "",
};

// --- The player card ------------------------------------------------------------

export function renderStadiumPlayer(model: PlayerPoster, options: PosterRenderOptions) {
  const ctx = contextFor(options, model.teamColor);
  const { width, height } = POSTER_SIZES[options.size];
  const L = PLAYER[options.size];
  const tones = tonesFor(model.teamColor, model.teamName);
  const room = width - 2 * L.pad;
  const nameSize = fitSize(model.name, room, L.name, Math.round(L.name * 0.5));
  const shirtNumber =
    model.heroNumber ?? (model.lotLabel === null ? "" : model.lotLabel.replace(/\D/g, ""));
  const price = model.priceLabel === null || !options.prices ? null : splitPrice(model.priceLabel);
  const base =
    model.outcome === "pool" && model.basePriceLabel !== null
      ? splitPrice(model.basePriceLabel)
      : null;
  const sub = [model.lotLabel, model.roleLine.toUpperCase()]
    .filter((part): part is string => part !== null && part !== "")
    .join("  ·  ");
  const square = options.size === "square";
  const figureSize =
    price === null
      ? 0
      : fitSize(price.figure, room * (square ? 0.5 : 0.62), L.price, Math.round(L.price * 0.55));

  const hero =
    model.photoUrl === null ? (
      <Jersey
        width={L.hero}
        tones={tones}
        name={model.firstName ?? model.lastName}
        number={shirtNumber}
        tilt={-3}
        id="hero"
      />
    ) : (
      <Portrait width={Math.round(L.hero * 0.86)} tones={tones} src={model.photoUrl} />
    );

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width,
        height,
        overflow: "hidden",
        background: shown(ctx) ? "#020406" : "transparent",
        color: "#FFFFFF",
        fontFamily: "Geist Sans, Anek Devanagari, sans-serif",
      }}
    >
      <Stage ctx={ctx} tones={tones} width={width} height={height} />
      <GhostWord
        ctx={ctx}
        word={model.stamp === "IN THE POOL" ? "BID" : model.stamp}
        top={Math.round(height * 0.16)}
        size={L.ghost}
        width={width}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width,
          height,
          padding: `${String(Math.round(L.pad * 1.1))}px ${String(L.pad)}px ${String(Math.round(L.pad * 0.7))}px`,
        }}
      >
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "center", ...vis(ctx) }}
        >
          <Kicker
            text={`${model.competitionName.toUpperCase()} · AUCTION`}
            size={L.kicker}
            tones={tones}
          />
          {sub === "" ? null : (
            <div
              style={{
                display: "flex",
                marginTop: Math.round(L.kicker * 0.6),
                fontFamily: LABEL,
                fontSize: Math.round(L.kicker * 0.78),
                letterSpacing: Math.round(L.kicker * 0.34),
                color: tones.trim,
              }}
            >
              {sub}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            ...vis(ctx, "hero"),
          }}
        >
          {hero}
          <div
            style={{
              display: "flex",
              marginTop: Math.round(L.name * 0.3),
              fontFamily: FACE,
              fontSize: nameSize,
              lineHeight: 1.05,
              textAlign: "center",
              color: "#FFFFFF",
            }}
          >
            {model.name}
          </div>
        </div>
        <div style={{ display: "flex", flex: 1 }} />
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: Math.round(L.stamp * 0.36),
          }}
        >
          <div style={{ display: "flex", ...vis(ctx, "stamp") }}>
            <Stamp
              word={model.stamp}
              size={model.stamp.length > 6 ? Math.round(L.stamp * 0.72) : L.stamp}
              tones={tones}
            />
          </div>
          {price === null && base === null ? null : (
            <div style={{ display: "flex", flexDirection: "column", ...vis(ctx, "price") }}>
              <div
                style={{
                  display: "flex",
                  fontFamily: LABEL,
                  fontSize: Math.round(L.kicker * 0.84),
                  letterSpacing: Math.round(L.kicker * 0.34),
                  color: withAlpha("#FFFFFF", 0.65),
                }}
              >
                {price === null ? "BASE PRICE" : "FOR"}
              </div>
              <div
                style={{ display: "flex", alignItems: "flex-end", gap: Math.round(L.price * 0.06) }}
              >
                {(price ?? base)?.lead === "" ? null : (
                  <div
                    style={{
                      display: "flex",
                      fontFamily: LABEL,
                      fontSize: Math.round((price === null ? L.price * 0.5 : figureSize) * 0.42),
                      marginBottom: Math.round(figureSize * 0.12),
                      ...metal(),
                    }}
                  >
                    {(price ?? base)?.lead}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    fontFamily: FACE,
                    fontSize: price === null ? Math.round(L.price * 0.5) : figureSize,
                    lineHeight: 0.86,
                    letterSpacing: -2,
                    ...metal(),
                  }}
                >
                  {(price ?? base)?.figure}
                </div>
                {(price ?? base)?.tail === "" ? null : (
                  <div
                    style={{
                      display: "flex",
                      fontFamily: FACE,
                      fontSize: Math.round((price === null ? L.price * 0.5 : figureSize) * 0.28),
                      ...metal(),
                    }}
                  >
                    {(price ?? base)?.tail}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", flex: 1.2 }} />
        {model.teamName === null || VERDICT_WORD[model.outcome] === "" ? null : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: room,
              gap: Math.round(L.pad * 0.3),
              ...vis(ctx, "stamp"),
            }}
          >
            <div
              style={{
                display: "flex",
                height: 2,
                backgroundImage: `linear-gradient(90deg, ${withAlpha(tones.light, 0)}, ${withAlpha(tones.light, 0.55)}, ${withAlpha(tones.light, 0)})`,
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: Math.round(L.crest * 0.22) }}>
              <Crest
                size={L.crest}
                tones={tones}
                src={model.teamCrestUrl}
                monogram={monogramFor(model.teamName)}
                badge={options.teamBadge ?? "shield"}
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    fontFamily: LABEL,
                    fontSize: Math.round(L.kicker * 0.76),
                    letterSpacing: Math.round(L.kicker * 0.3),
                    color: tones.trim,
                  }}
                >
                  {VERDICT_WORD[model.outcome]}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontFamily: FACE,
                    fontSize: fitSize(
                      model.teamName,
                      room - L.crest - 40,
                      L.team,
                      Math.round(L.team * 0.6),
                    ),
                    lineHeight: 1.1,
                    color: "#FFFFFF",
                  }}
                >
                  {model.teamName}
                </div>
              </div>
            </div>
          </div>
        )}
        <div style={{ display: "flex", width: room, marginTop: Math.round(L.pad * 0.3) }}>
          <Footer ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

/**
 * Initials for a crest with no image. Latin initials when the name has Latin
 * words ("Demo Falcons" → DF); otherwise the core's script-aware monogram, so
 * a Hindi name is cut on grapheme clusters, never mid-letter.
 */
export function monogramFor(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word));
  if (words.length === 0) {
    return monogramOf(name);
  }
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

// --- The squad ----------------------------------------------------------------

interface SquadLayout {
  readonly pad: number;
  readonly kicker: number;
  readonly crest: number;
  readonly title: number;
  readonly hero: number;
  readonly heroName: number;
  readonly totals: number;
  readonly gapX: number;
  readonly gapY: number;
  readonly maxJersey: number;
}

const SQUAD: Record<PosterSize, SquadLayout> = {
  story: {
    pad: 48,
    kicker: 22,
    crest: 124,
    title: 108,
    hero: 330,
    heroName: 50,
    totals: 120,
    gapX: 12,
    gapY: 22,
    maxJersey: 160,
  },
  portrait: {
    pad: 44,
    kicker: 18,
    crest: 92,
    title: 80,
    hero: 210,
    heroName: 34,
    totals: 92,
    gapX: 10,
    gapY: 14,
    maxJersey: 140,
  },
  square: {
    pad: 40,
    kicker: 16,
    crest: 76,
    title: 64,
    hero: 170,
    heroName: 28,
    totals: 80,
    gapX: 10,
    gapY: 10,
    maxJersey: 120,
  },
};

/** Rows that balance: 13 → 5·4·4, 15 → 5·5·5, 11 → 4·4·3 — never a lonely last row. */
export function balancedRows(count: number, perRow: number): number[] {
  const rows = Math.ceil(count / perRow);
  const out: number[] = [];
  let left = count;
  for (let row = rows; row > 0; row -= 1) {
    const take = Math.ceil(left / row);
    out.push(take);
    left -= take;
  }
  return out;
}

/** Captain first, then icons, then retained — the squad's faces. */
function leadersOf(rows: readonly TeamPosterRow[]): TeamPosterRow[] {
  return rows.filter((row) => row.isCaptain || row.isMarked).slice(0, 3);
}

function leaderLabel(row: TeamPosterRow): string {
  if (row.isCaptain) {
    return "CAPTAIN";
  }
  return row.badges.includes("ICON") ? "ICON PLAYER" : "RETAINED";
}

/** The plate's height for a jersey of width `w` (name over price). */
function plateHeight(w: number): number {
  return Math.round(w * 0.17 * 1.25 + w * 0.12 * 1.35 + 18);
}

/**
 * The grid of everyone else: the column count that draws the largest shirts
 * in the room left, with rows balanced.
 */
export function squadGrid(
  count: number,
  roomWidth: number,
  roomHeight: number,
  layout: SquadLayout,
) {
  let best = { perRow: 5, jersey: 0 };
  for (let perRow = 3; perRow <= 7; perRow += 1) {
    const rows = Math.ceil(count / perRow);
    const tile = (roomWidth - (perRow - 1) * layout.gapX) / perRow;
    const byWidth = tile * 0.8;
    // tile height = shirt (1.1w) - 6 + plate(w)
    const byHeight = (roomHeight - (rows - 1) * layout.gapY) / rows;
    let jersey = Math.min(byWidth, layout.maxJersey);
    while (jersey > 40 && jersey * 1.1 - 6 + plateHeight(jersey) > byHeight) {
      jersey -= 2;
    }
    if (jersey > best.jersey) {
      best = { perRow, jersey: Math.floor(jersey) };
    }
  }
  return {
    rows: balancedRows(count, best.perRow),
    jersey: best.jersey,
    tile: Math.floor(best.jersey / 0.8),
  };
}

export function renderStadiumSquad(
  model: TeamPoster,
  options: PosterRenderOptions,
  mode: "sheet" | "reveal",
) {
  const ctx = contextFor(options, model.teamColor);
  const { width, height } = POSTER_SIZES[options.size];
  const L = SQUAD[options.size];
  const tones = tonesFor(model.teamColor, model.teamName);
  const prices = mode === "sheet" && options.prices;
  const leaders = leadersOf(model.rows);
  const rest = model.rows.filter((row) => !leaders.includes(row));
  const room = width - 2 * L.pad;
  const titleSize = fitSize(
    model.teamName,
    room - L.crest - 30,
    L.title,
    Math.round(L.title * 0.55),
  );
  const topBuy = prices ? (rest.find((row) => row.priceLabel !== null) ?? null) : null;
  const showTotals = prices && model.spentLabel !== "";

  // The vertical budget, top to bottom.
  const kickerH = Math.round(L.kicker * 1.6);
  const titleH = Math.max(L.crest, Math.round(titleSize * 1.15));
  const heroLabel = Math.round(L.heroName * 0.55);
  const heroH =
    leaders.length === 0
      ? 0
      : Math.round(L.hero * 1.1 + heroLabel + 14 + L.heroName * 1.25 + L.kicker * 1.4);
  const totalsH = showTotals ? L.totals : 0;
  const footerH = ctx.metrics.footerHeight;
  const gaps =
    Math.round(L.pad * 0.6) * (3 + (leaders.length === 0 ? 0 : 1) + (showTotals ? 1 : 0));
  const gridH = height - 2 * L.pad - kickerH - titleH - heroH - totalsH - footerH - gaps;
  // A small squad gets bigger shirts, not a poster of gaps.
  const grow = Math.min(1.8, Math.max(1, 12 / Math.max(1, rest.length)));
  const grid = squadGrid(rest.length, room, gridH, {
    ...L,
    // …but never larger than the leaders' own shirts: the captain leads.
    maxJersey: Math.round(
      Math.min(L.maxJersey * grow, leaders.length === 0 ? Infinity : L.hero * 0.72),
    ),
  });
  const jersey = grid.jersey;
  const tile = grid.tile;
  let cursor = 0;
  const rows = grid.rows.map((n) => rest.slice(cursor, (cursor += n)));
  const plateName = Math.round(jersey * 0.17);
  const platePrice = Math.round(jersey * 0.12);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width,
        height,
        overflow: "hidden",
        background: shown(ctx) ? "#020406" : "transparent",
        color: "#FFFFFF",
        fontFamily: "Geist Sans, Anek Devanagari, sans-serif",
      }}
    >
      <Stage ctx={ctx} tones={tones} width={width} height={height} />
      <GhostWord
        ctx={ctx}
        word="SQUAD"
        top={Math.round(L.pad + kickerH + titleH * 0.6)}
        size={Math.round(L.title * 3.3)}
        width={width}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          width,
          height,
          padding: L.pad,
        }}
      >
        <div style={{ display: "flex", ...vis(ctx) }}>
          <Kicker
            text={`${model.competitionName.toUpperCase()} · ${mode === "sheet" ? "OFFICIAL SQUAD" : "MEET THE SQUAD"}`}
            size={L.kicker}
            tones={tones}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: Math.round(L.crest * 0.22),
            ...vis(ctx, "hero"),
          }}
        >
          <Crest
            size={L.crest}
            tones={tones}
            src={model.teamCrestUrl}
            monogram={model.teamMonogram}
            badge={options.teamBadge ?? "shield"}
          />
          <div
            style={{
              display: "flex",
              fontFamily: FACE,
              fontSize: titleSize,
              lineHeight: 1.05,
              color: "#FFFFFF",
            }}
          >
            {model.teamName}
          </div>
        </div>
        {leaders.length === 0 ? null : (
          <div style={{ display: "flex", gap: Math.round(L.hero * 0.17), ...vis(ctx, "hero") }}>
            {leaders.map((row, index) => (
              <div
                key={`${row.name}-${String(index)}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
              >
                {row.photoUrl === null ? (
                  <Jersey
                    width={L.hero}
                    tones={tones}
                    name={row.firstName}
                    number={row.shirtNumber ?? ""}
                    tilt={leaders.length === 1 ? 0 : index % 2 === 0 ? -3 : 3}
                    id={`lead${String(index)}`}
                  />
                ) : (
                  <Portrait width={Math.round(L.hero * 0.9)} tones={tones} src={row.photoUrl} />
                )}
                <div
                  style={{
                    display: "flex",
                    marginTop: 6,
                    padding: `${String(Math.round(heroLabel * 0.18))}px ${String(Math.round(heroLabel * 0.7))}px`,
                    background: tones.trim,
                    borderRadius: 6,
                    transform: "rotate(-2deg)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      fontFamily: FACE,
                      fontSize: heroLabel,
                      letterSpacing: Math.round(heroLabel * 0.2),
                      color: tones.night,
                    }}
                  >
                    {leaderLabel(row)}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    marginTop: Math.round(L.heroName * 0.3),
                    fontFamily: FACE,
                    fontSize: fitSize(
                      row.name,
                      L.hero * 1.3,
                      L.heroName,
                      Math.round(L.heroName * 0.6),
                    ),
                    lineHeight: 1.15,
                    color: "#FFFFFF",
                  }}
                >
                  {row.name}
                </div>
                <div
                  style={{
                    display: "flex",
                    marginTop: 4,
                    fontFamily: LABEL,
                    fontSize: Math.round(L.kicker * 0.8),
                    letterSpacing: Math.round(L.kicker * 0.3),
                    color: withAlpha("#FFFFFF", 0.6),
                  }}
                >
                  {row.roleLine.toUpperCase()}
                </div>
              </div>
            ))}
          </div>
        )}
        {rest.length === 0 ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: L.gapY }}>
            {rows.map((row, r) => (
              <div
                key={`row${String(r)}`}
                style={{ display: "flex", justifyContent: "center", gap: L.gapX }}
              >
                {row.map((player, i) => {
                  const plateLine = prices ? (player.priceLabel ?? "") : player.roleTag;
                  return (
                    <div
                      key={`${player.name}-${String(i)}`}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        width: tile,
                        ...vis(ctx, "items"),
                      }}
                    >
                      {player.photoUrl === null ? (
                        <Jersey
                          width={jersey}
                          tones={tones}
                          name={player.shirtNumber === null ? player.firstName : null}
                          number={player.shirtNumber ?? ""}
                          id={`t${String(r)}x${String(i)}`}
                        />
                      ) : (
                        <Portrait
                          width={Math.round(jersey * 0.92)}
                          tones={tones}
                          src={player.photoUrl}
                        />
                      )}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          width: tile,
                          marginTop: -6,
                          padding: "8px 6px 10px",
                          borderRadius: 12,
                          backgroundImage: `linear-gradient(180deg, ${withAlpha("#000000", 0.55)}, ${withAlpha("#000000", 0.35)})`,
                          border: `1px solid ${withAlpha("#FFFFFF", 0.1)}`,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "center",
                            textAlign: "center",
                            width: tile - 12,
                            fontFamily: FACE,
                            // A long name wraps to a second line at a size
                            // that still reads, rather than shrinking to dust.
                            fontSize: fitSize(
                              player.name,
                              tile - 12,
                              plateName,
                              Math.round(plateName * 0.8),
                            ),
                            lineHeight: 1.15,
                            color: "#FFFFFF",
                          }}
                        >
                          {player.name}
                        </div>
                        {plateLine === "" ? null : (
                          <div
                            style={{
                              display: "flex",
                              marginTop: 2,
                              fontFamily: LABEL,
                              fontSize: platePrice,
                              letterSpacing: prices ? 0 : 2,
                              ...(prices ? metal() : { color: withAlpha("#FFFFFF", 0.6) }),
                            }}
                          >
                            {prices ? plateLine.toUpperCase() : plateLine}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {!showTotals ? null : (
          <div
            style={{
              display: "flex",
              width: room,
              height: L.totals,
              gap: 16,
              ...vis(ctx, "items"),
            }}
          >
            <Totals label="TOTAL SPENT" tones={tones} height={L.totals} filled>
              {model.spentLabel.toUpperCase()}
            </Totals>
            {topBuy === null ? (
              <Totals label="SQUAD" tones={tones} height={L.totals}>
                {model.squadLabel.toUpperCase()}
              </Totals>
            ) : (
              <Totals
                label={`TOP BUY · ${(topBuy.priceLabel ?? "").toUpperCase()}`}
                tones={tones}
                height={L.totals}
              >
                {topBuy.name}
              </Totals>
            )}
          </div>
        )}
        <div style={{ display: "flex", width: room }}>
          <Footer ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

function Totals({
  label,
  tones,
  height,
  filled = false,
  children,
}: {
  label: string;
  tones: Tones;
  height: number;
  filled?: boolean;
  children: ReactNode;
}) {
  const big = Math.round(height * 0.4);
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        flexDirection: "column",
        justifyContent: "center",
        padding: `0 ${String(Math.round(height * 0.24))}px`,
        borderRadius: Math.round(height * 0.18),
        ...(filled
          ? {
              backgroundImage: `linear-gradient(135deg, ${tones.trim}, ${mix(tones.trim, "#F5B82E", 0.6)})`,
            }
          : {
              background: withAlpha("#FFFFFF", 0.06),
              border: `1px solid ${withAlpha("#FFFFFF", 0.16)}`,
            }),
      }}
    >
      <div
        style={{
          display: "flex",
          fontFamily: LABEL,
          fontSize: Math.round(height * 0.14),
          letterSpacing: Math.round(height * 0.05),
          color: filled ? tones.night : tones.trim,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: Math.round(height * 0.04),
          fontFamily: FACE,
          fontSize: big,
          lineHeight: 1.3,
          color: filled ? tones.night : "#FFFFFF",
        }}
      >
        {children}
      </div>
    </div>
  );
}
