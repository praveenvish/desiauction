import type { ReactNode } from "react";

import { mix, WHITE, withAlpha } from "./poster-color";
import { DISPLAY } from "./poster-fonts";
import { BrandLockup, shown, vis, type MotionLayer, type PosterContext } from "./poster-kit";
import { hostOf, qrDataUri } from "./poster-qr";
import type { Depth } from "./poster-surface";

export { depthFor, type Depth } from "./poster-surface";

/**
 * The v3 PIECES — backlight, 3D number, portrait arch, coin, pill — drawn from
 * the surface tokens in `poster-surface.ts` (see there for why each exists).
 */

// --- Pieces -------------------------------------------------------------------

/**
 * The light behind the subject — the team's colour, never a slab.
 *
 * Satori sizes a `closest-side` radial against the box's far corner, so a glow
 * laid in a box the size of its subject ends in a visible rectangle. The box is
 * therefore a square four radii wide, centred on the light, and the colour is
 * spent by 35% of the way to the corner — about one radius — leaving a full
 * radius of nothing before any edge.
 */
export function Backlight({
  ctx,
  depth,
  centerX,
  centerY,
  radius,
}: {
  ctx: PosterContext;
  depth: Depth;
  centerX: number;
  centerY: number;
  radius: number;
}) {
  if (!shown(ctx)) {
    return null;
  }
  const side = radius * 4;
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        left: Math.round(centerX - side / 2),
        top: Math.round(centerY - side / 2),
        width: side,
        height: side,
        backgroundImage: `radial-gradient(circle at 50% 50%, ${depth.backlight} 0%, ${depth.backlightClear} 35%)`,
      }}
    />
  );
}

/**
 * The shirt number, standing in 3D: a body drawn as a stack of offset shadows
 * under a face filled with light. Two nodes at one position, because a
 * gradient-clipped face paints its shadows THROUGH itself.
 */
export function Number3D({
  ctx,
  text,
  size,
  left,
  top,
  width,
  face,
  side,
  layer = "base",
}: {
  ctx: PosterContext;
  text: string;
  size: number;
  left: number;
  top: number;
  width: number;
  face: string;
  side: string;
  layer?: MotionLayer;
}) {
  const depth = Math.max(4, Math.round(size / 40));
  const body = Array.from(
    { length: depth },
    (_, i) => `${((i + 1) * 0.5).toFixed(1)}px ${String(i + 1)}px 0 ${side}`,
  ).join(", ");
  const base = {
    display: "flex",
    position: "absolute" as const,
    left,
    top,
    width,
    justifyContent: "center",
    fontFamily: DISPLAY,
    fontWeight: 800,
    fontSize: size,
    lineHeight: 0.8,
    letterSpacing: -size * 0.03,
  };
  return (
    <>
      <div style={{ ...base, color: side, textShadow: body, ...vis(ctx, layer) }}>{text}</div>
      <div
        style={{
          ...base,
          backgroundImage: face,
          backgroundClip: "text",
          color: "transparent",
          ...vis(ctx, layer),
        }}
      >
        {text}
      </div>
    </>
  );
}

/**
 * The player's photograph as a lit arch that dissolves into the ground. A real
 * upload is a rectangle with a background, not a cut-out, so the arch and the
 * fade are what make it sit IN the poster rather than on it.
 */
export function Portrait({
  ctx,
  src,
  left,
  top,
  width,
  height,
  ground,
  rim,
  layer = "hero",
}: {
  ctx: PosterContext;
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
  ground: string;
  rim: string;
  layer?: MotionLayer;
}) {
  if (!shown(ctx, layer)) {
    return null;
  }
  const arch = Math.round(width / 2);
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        left,
        top,
        width,
        height,
        borderTopLeftRadius: arch,
        borderTopRightRadius: arch,
        overflow: "hidden",
        boxShadow: `0 -2px 0 ${withAlpha(rim, 0.5)}, 0 -30px 90px ${withAlpha(rim, 0.35)}`,
      }}
    >
      <img src={src} width={width} height={height} style={{ objectFit: "cover" }} alt="" />
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 0,
          bottom: 0,
          width,
          height: Math.round(height * 0.5),
          backgroundImage: `linear-gradient(180deg, ${withAlpha(ground, 0)} 0%, ${withAlpha(
            ground,
            0.82,
          )} 60%, ${ground} 100%)`,
        }}
      />
    </div>
  );
}

/** A crest as a coin: a lit top, a shaded rim, a cast shadow. */
export function Coin({
  ctx,
  size,
  colour,
  label,
  src = null,
  labelColour = WHITE,
  layer = "base",
}: {
  ctx: PosterContext;
  size: number;
  colour: string;
  label: string;
  src?: string | null;
  labelColour?: string;
  layer?: MotionLayer;
}) {
  if (!shown(ctx, layer)) {
    return <div style={{ display: "flex", width: size, height: size, flexShrink: 0 }} />;
  }
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        color: labelColour,
        fontFamily: DISPLAY,
        fontWeight: 800,
        fontSize: Math.round(size * 0.36),
        backgroundImage: `radial-gradient(circle at 32% 24%, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0) 42%), radial-gradient(circle at 50% 50%, ${colour} 58%, ${mix(colour, "#000000", 0.45)} 100%)`,
        boxShadow: `inset 0 ${String(Math.max(1, Math.round(size / 40)))}px 0 rgba(255,255,255,0.35), inset 0 -${String(Math.round(size / 14))}px ${String(Math.round(size / 8))}px rgba(0,0,0,0.35), 0 ${String(Math.round(size / 7))}px ${String(Math.round(size / 3))}px rgba(0,0,0,0.45)`,
        ...vis(ctx, layer),
      }}
    >
      {src === null ? (
        label
      ) : (
        <img
          src={src}
          width={Math.round(size * 0.72)}
          height={Math.round(size * 0.72)}
          style={{ objectFit: "contain" }}
          alt=""
        />
      )}
    </div>
  );
}

/** A glossy label: SOLD, ICON PLAYER, IN THE POOL. */
export function Pill({
  ctx,
  text,
  size,
  fill,
  ink,
  icon = null,
  layer = "stamp",
}: {
  ctx: PosterContext;
  text: string;
  size: number;
  fill: string;
  ink: string;
  icon?: ReactNode;
  layer?: MotionLayer;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: Math.round(size * 0.45),
        padding: `${String(Math.round(size * 0.5))}px ${String(Math.round(size * 0.95))}px`,
        borderRadius: 999,
        backgroundImage: fill,
        color: ink,
        fontFamily: DISPLAY,
        fontWeight: 800,
        fontSize: size,
        letterSpacing: size * 0.18,
        lineHeight: 1,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45), 0 8px 20px rgba(0,0,0,0.3)",
        ...vis(ctx, layer),
      }}
    >
      {icon}
      {text}
    </div>
  );
}

export function Star({ size, colour }: { size: number; colour: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M12 2.5l2.8 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3l-6.1 3.5 1.6-6.8-5.2-4.6 6.9-.6z"
        fill={colour}
      />
    </svg>
  );
}

/** The fill of the one figure that matters. */
export function metalText(depth: Depth) {
  return { backgroundImage: depth.metal, backgroundClip: "text", color: "transparent" } as const;
}

// --- The way back -------------------------------------------------------------

// --- Header and footer --------------------------------------------------------

/** The season, as a coin and its name — below WhatsApp's own status header. */
export function SeasonBar({
  ctx,
  depth,
  name,
  logoUrl,
  monogram,
  coin,
  nameSize,
  right,
  top,
  left,
  width,
}: {
  ctx: PosterContext;
  depth: Depth;
  name: string;
  logoUrl: string | null;
  monogram: string;
  coin: number;
  nameSize: number;
  right: ReactNode;
  top: number;
  left: number;
  width: number;
}) {
  const { palette } = ctx.skin;
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        left,
        top,
        width,
        alignItems: "center",
        gap: Math.round(coin * 0.3),
      }}
    >
      <Coin
        ctx={ctx}
        size={coin}
        colour={depth.dark ? mix(palette.surface, WHITE, 0.08) : palette.panel}
        label={monogram}
        src={logoUrl}
        labelColour={palette.accent}
      />
      <div
        style={{
          display: "flex",
          flexGrow: 1,
          flexShrink: 1,
          color: palette.heading,
          fontSize: nameSize,
          fontWeight: 600,
          letterSpacing: -nameSize * 0.01,
          overflow: "hidden",
          whiteSpace: "nowrap",
          ...vis(ctx),
        }}
      >
        {name}
      </div>
      {right}
    </div>
  );
}

/**
 * The foot of every v3 poster: the real DesiAuction lockup on the left, and —
 * when the season is public — the way back on the right: "Scan to open", the
 * address a reader can type, and the code.
 */
export function DepthFooter({
  ctx,
  shareUrl,
  qr,
  top,
  left,
  width,
}: {
  ctx: PosterContext;
  shareUrl: string | null;
  qr: number;
  top: number;
  left: number;
  width: number;
}) {
  const { palette } = ctx.skin;
  const { options } = ctx;
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        left,
        top,
        width,
        height: qr,
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
      }}
    >
      <BrandLockup ctx={ctx} />
      {options.sponsor !== null ? (
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", ...vis(ctx) }}
        >
          <div style={{ display: "flex", color: palette.muted, fontSize: 18, letterSpacing: 3 }}>
            PRESENTED BY
          </div>
          <div style={{ display: "flex", color: palette.heading, fontSize: 28, fontWeight: 600 }}>
            {options.sponsor}
          </div>
        </div>
      ) : shareUrl === null ? null : (
        <div style={{ display: "flex", alignItems: "center", gap: Math.round(qr * 0.2) }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 6,
              ...vis(ctx),
            }}
          >
            <div
              style={{
                display: "flex",
                color: palette.muted,
                fontSize: Math.max(13, Math.round(qr * 0.14)),
                letterSpacing: 3,
              }}
            >
              SCAN TO OPEN
            </div>
            <div
              style={{
                display: "flex",
                color: palette.body,
                fontSize: Math.max(16, Math.round(qr * 0.19)),
                fontWeight: 600,
              }}
            >
              {hostOf(shareUrl)}
            </div>
          </div>
          {shown(ctx) ? (
            <div
              style={{
                display: "flex",
                width: qr,
                height: qr,
                padding: Math.round(qr * 0.08),
                borderRadius: Math.round(qr * 0.14),
                background: "#F4F2EC",
                boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
              }}
            >
              <img
                src={qrDataUri(shareUrl)}
                width={qr - 2 * Math.round(qr * 0.08)}
                height={qr - 2 * Math.round(qr * 0.08)}
                alt=""
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
