import { monogramOf, type PosterKind, type PosterSize, type PosterTheme } from "@desiauction/core";
import type { ReactNode } from "react";

import { mix, withAlpha } from "./poster-color";
import { FIGURES } from "./poster-fonts";
import { hostOf, qrDataUri } from "./poster-qr";
import {
  CHIP_TRACKING,
  HEADER_GAP,
  HEADER_TRACKING,
  chipPadding,
  chipWidth,
  contentWidth,
  fitCaps,
  headerNameRoom,
  metricsFor,
  type PosterMetrics,
} from "./poster-layout";
import { skinFor, type Skin } from "./poster-skins";
import { depthFor } from "./poster-surface";

/**
 * THE RASTERIZER BOUNDARY — the pieces every poster is built from.
 *
 * Pure presentational, exactly like `c/[slug]/share-image-card.tsx`: no server
 * imports, no IO, no `next/image`, and LITERAL hex everywhere (Satori resolves
 * no CSS variables — `var(--accent)` here renders black). The colours come from
 * `poster-skins.ts`, which holds the palettes and the contrast arithmetic.
 *
 * FIVE KINDS, THREE FAMILIES, ONE KIT. A family changes the frame and the
 * emphasis; the header, the footer, the tiles and the chips are the same
 * components everywhere, which is what stops "more variety" from becoming five
 * posters that drift apart the first time one of them gets a fix.
 */

// --- Motion layers ----------------------------------------------------------

/**
 * A poster, taken apart.
 *
 * The studio animates the SAME render it downloads: the route draws the poster
 * once per layer into one tall sprite, with everything outside that layer at
 * `opacity: 0` and the ground transparent, and the canvas in the browser
 * composites them back with a reveal. The alternative — a second renderer in
 * canvas — is a preview that can lie, and this is the last thing anybody looks
 * at before it goes to a few hundred people.
 *
 * `base` is the ground, the header and the footer; `hero` the subject's own
 * block; `items` the faces or the ranked rows (the animator finds each tile by
 * its own opaque region, so the layout never has to publish coordinates);
 * `stamp` the verdict slab; `price` the one number that counts up.
 */
export const MOTION_LAYERS = ["base", "hero", "items", "stamp", "price"] as const;
export type MotionLayer = (typeof MOTION_LAYERS)[number];

/** The bands each kind actually draws, in the order they are revealed. */
export const MOTION_BANDS: Record<PosterKind, readonly MotionLayer[]> = {
  player: ["base", "hero", "stamp", "price"],
  team: ["base", "hero", "items"],
  reveal: ["base", "hero", "items"],
  top: ["base", "hero", "items"],
  season: ["base", "hero", "items"],
};

export interface PosterRenderOptions {
  readonly theme: PosterTheme;
  readonly size: PosterSize;
  /**
   * Tier-gated upstream. The lockup is on EVERY poster now (the founder opened
   * a paid season's poster and could not find their own logo); what a paid pass
   * buys is the quieter footer — no `desiauction.in` line under the mark.
   */
  readonly showBranding: boolean;
  /**
   * The DesiAuction mark as a `data:` URI. Satori cannot resolve `next/image`
   * or a relative public path, so the bytes arrive already inlined; null when
   * the file could not be read and the wordmark alone has to carry it.
   */
  readonly brandMarkSrc: string | null;
  /** Whether the money is drawn at all — the studio's "Show prices" switch. */
  readonly prices: boolean;
  /** An organizer's credit line, scrubbed upstream. */
  readonly sponsor: string | null;
  /** Set only while drawing a sprite: the one band that is visible. */
  readonly only?: MotionLayer;
  /**
   * The public page this poster points back to — drawn as a QR code, because a
   * Status has no clickable link. Null for a season that is not public: a code
   * that opens a 404 is worse than no code.
   */
  readonly shareUrl?: string | null;
}

export interface PosterContext {
  readonly skin: Skin;
  readonly metrics: PosterMetrics;
  readonly options: PosterRenderOptions;
}

export function contextFor(options: PosterRenderOptions, teamColor: string | null): PosterContext {
  return {
    skin: skinFor(options.theme, teamColor),
    metrics: metricsFor(options.size),
    options,
  };
}

/** Is this band drawn at all in the render in progress? */
export function shown(ctx: PosterContext, layer: MotionLayer = "base"): boolean {
  return ctx.options.only === undefined || ctx.options.only === layer;
}

/**
 * The style every VISUAL node carries. Hiding happens at the leaf, never at a
 * container: opacity multiplies down the tree, so a hidden wrapper would take
 * another band's contents with it.
 */
export function vis(ctx: PosterContext, layer: MotionLayer = "base"): { opacity: number } {
  return { opacity: shown(ctx, layer) ? 1 : 0 };
}

/**
 * The colour a crest ring, a face stripe or a chip takes.
 *
 * On `matchday` the team's colour IS the ground, so a ring in it disappears
 * into the poster; the gold takes over there. Everywhere else the franchise's
 * own colour is the point.
 */
export function ringFor(ctx: PosterContext, colour: string | null): string | null {
  return ctx.skin.family === "matchday" ? ctx.skin.palette.accent : colour;
}

// --- Tiles ------------------------------------------------------------------

export interface TileProps {
  ctx: PosterContext;
  src: string | null;
  monogram: string;
  width: number;
  height: number;
  radius: number;
  fontSize: number;
  layer?: MotionLayer;
  /** A team's colour around (and behind) the tile. */
  ring?: string | null;
  ringWidth?: number | undefined;
  round?: boolean;
  /**
   * A FACE is cropped to fill its tile; a LOGO is not. A club's wordmark is
   * usually wider than it is tall, and `cover` took the ends off the founder's
   * own sponsor lockup on the first real render.
   */
  fit?: "cover" | "contain";
}

/**
 * The one tile. Competition logo, player photo, team crest and squad face are
 * the same component at five sizes, which is what keeps a missing photo and a
 * missing crest from looking like two different bugs.
 *
 * A null `src` is not an error state: consent may have been withheld, or the
 * player may be a minor whose face never rides a public surface, and the
 * initials have to look like a decision rather than a broken image.
 */
export function Tile({
  ctx,
  src,
  monogram,
  width,
  height,
  radius,
  fontSize,
  layer = "base",
  ring = null,
  ringWidth,
  round = false,
  fit = "cover",
}: TileProps) {
  const { skin } = ctx;
  const { palette } = skin;
  const border = ring ?? palette.border;
  const weight = ringWidth ?? skin.rule;
  const corner = round ? Math.round(Math.max(width, height) / 2) : radius;
  // The initials tile is the team's colour when there is one: "rich initials in
  // the team colour" beats a grey hole where a face should be.
  const fill =
    ring === null
      ? palette.panel
      : `linear-gradient(160deg, ${mix(ring, palette.panel, 0.45)}, ${palette.panel})`;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width,
        height,
        flexShrink: 0,
        borderRadius: corner,
        overflow: "hidden",
        background: fill,
        border: `${String(weight)}px solid ${border}`,
        color: ring === null ? palette.accent : skin.palette.heading,
        fontSize,
        fontWeight: 700,
        letterSpacing: 1,
        ...vis(ctx, layer),
      }}
    >
      {src === null || !shown(ctx, layer) ? (
        monogram
      ) : (
        <img
          src={src}
          width={width}
          height={height}
          style={{
            objectFit: fit,
            ...(fit === "contain" ? { padding: Math.round(width * 0.08) } : {}),
          }}
          alt=""
        />
      )}
    </div>
  );
}

/** The header's right slot: `#R4F2A1`, `15 players`, `Top 5`. */
export function HeaderChip({ ctx, label }: { ctx: PosterContext; label: string }) {
  const { metrics, skin } = ctx;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: metrics.chipHeight,
        // A registration number is not something to shrink, so the chip takes
        // its width first and the competition name is sized against the rest.
        flexShrink: 0,
        width: chipWidth(label, metrics),
        justifyContent: "center",
        padding: chipPadding(metrics),
        borderRadius: 999,
        background: skin.palette.accent,
        color: skin.palette.onAccent,
        fontSize: metrics.chipSize,
        fontWeight: 700,
        letterSpacing: CHIP_TRACKING,
        ...vis(ctx),
      }}
    >
      {label}
    </div>
  );
}

/**
 * The season's identity, on every poster: its logo (or its initials) and its
 * name, with one chip on the right.
 */
export function Header({
  ctx,
  competitionName,
  competitionLogoUrl,
  chip,
}: {
  ctx: PosterContext;
  competitionName: string;
  competitionLogoUrl: string | null;
  chip: string | null;
}) {
  const { metrics, skin } = ctx;
  // The chip is a fixed claim on the row; the name gets what is left. Both the
  // fit and the hard `maxWidth` are here because only one of them is a
  // guarantee — an estimate that runs three per cent long puts a competition
  // name underneath a registration number, which is how the first story render
  // came out.
  const nameRoom = headerNameRoom(chip, metrics);
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: Math.max(metrics.headerTile, metrics.chipHeight),
        alignItems: "center",
        justifyContent: "space-between",
        gap: HEADER_GAP,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: HEADER_GAP,
          maxWidth: metrics.headerTile + HEADER_GAP + nameRoom,
          overflow: "hidden",
        }}
      >
        <Tile
          ctx={ctx}
          src={competitionLogoUrl}
          monogram={monogramOf(competitionName)}
          width={metrics.headerTile}
          height={metrics.headerTile}
          radius={Math.round(metrics.headerTile * 0.28)}
          fontSize={Math.round(metrics.headerTile * 0.4)}
          fit="contain"
          round
        />
        <div
          style={{
            display: "flex",
            color: skin.palette.body,
            fontSize: fitCaps(
              competitionName,
              nameRoom,
              metrics.competitionMax,
              metrics.competitionMin,
              HEADER_TRACKING,
            ),
            letterSpacing: HEADER_TRACKING,
            textTransform: "uppercase",
            ...vis(ctx),
          }}
        >
          {competitionName}
        </div>
      </div>
      {chip === null ? null : <HeaderChip ctx={ctx} label={chip} />}
    </div>
  );
}

/**
 * THE LOCKUP NOBODY SHOULD WANT TO CROP OFF.
 *
 * The founder's first note on the studio was that they could not find their own
 * logo on a poster — because branding was tier-gated and their season had a
 * paid pass. It is now on every poster: the DA mark, the wordmark in the
 * product's own two tones, and the tagline under it.
 */
export function BrandLockup({ ctx }: { ctx: PosterContext }) {
  const { metrics, skin, options } = ctx;
  const { palette } = skin;
  const mark = metrics.footerMark;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(mark * 0.3) }}>
      {options.brandMarkSrc === null || !shown(ctx) ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: mark,
            height: mark,
            borderRadius: Math.round(mark * 0.28),
            background: palette.accent,
            color: palette.onAccent,
            fontSize: Math.round(mark * 0.42),
            fontWeight: 700,
            ...vis(ctx),
          }}
        >
          DA
        </div>
      ) : (
        <img
          src={options.brandMarkSrc}
          width={mark}
          height={mark}
          style={{ borderRadius: Math.round(mark * 0.28) }}
          alt=""
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", ...vis(ctx) }}>
        <div
          style={{
            display: "flex",
            color: palette.heading,
            fontSize: metrics.footerNameSize,
            fontWeight: 700,
            letterSpacing: -0.2,
          }}
        >
          Desi
          <span style={{ color: palette.brandAccent }}>Auction</span>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 4,
            color: palette.muted,
            fontSize: metrics.footerTagSize,
            letterSpacing: Math.max(2, metrics.footerTagSize * 0.22),
          }}
        >
          THE GAME STARTS HERE
        </div>
      </div>
    </div>
  );
}

/**
 * The strip at the foot of every poster: the platform's lockup on the left, and
 * on the right the organizer's sponsor credit — or, on the free pass, the
 * address somebody reading the poster can type.
 */
export function Footer({ ctx }: { ctx: PosterContext }) {
  const { metrics, skin, options } = ctx;
  const { palette } = skin;
  const right = options.sponsor === null ? (options.showBranding ? "desiauction.in" : null) : null;
  // A published season gets its way back: the code a phone can scan off a
  // Status, beside the address a reader can type.
  const share = options.sponsor === null ? (options.shareUrl ?? null) : null;
  const qr = Math.round(metrics.footerHeight * 0.92);
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: metrics.footerHeight,
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: Math.round(metrics.footerHeight * 0.18),
        borderTop: `${String(skin.rule)}px solid ${shown(ctx) ? palette.border : "transparent"}`,
      }}
    >
      <BrandLockup ctx={ctx} />
      {options.sponsor !== null ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            ...vis(ctx),
          }}
        >
          <div
            style={{
              display: "flex",
              color: palette.muted,
              fontSize: Math.round(metrics.footerUrlSize * 0.72),
              letterSpacing: 2,
            }}
          >
            PRESENTED BY
          </div>
          <div
            style={{
              display: "flex",
              color: palette.heading,
              fontSize: metrics.footerUrlSize,
              fontWeight: 700,
            }}
          >
            {options.sponsor}
          </div>
        </div>
      ) : share !== null ? (
        <div style={{ display: "flex", alignItems: "center", gap: Math.round(qr * 0.2) }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 4,
              ...vis(ctx),
            }}
          >
            <div
              style={{
                display: "flex",
                color: palette.muted,
                fontSize: Math.round(metrics.footerUrlSize * 0.55),
                letterSpacing: 3,
              }}
            >
              SCAN TO OPEN
            </div>
            <div
              style={{
                display: "flex",
                color: palette.body,
                fontSize: Math.round(metrics.footerUrlSize * 0.8),
                fontWeight: 600,
              }}
            >
              {hostOf(share)}
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
              }}
            >
              <img
                src={qrDataUri(share)}
                width={qr - 2 * Math.round(qr * 0.08)}
                height={qr - 2 * Math.round(qr * 0.08)}
                alt=""
              />
            </div>
          ) : null}
        </div>
      ) : right === null ? null : (
        <div
          style={{
            display: "flex",
            color: palette.muted,
            fontSize: metrics.footerUrlSize,
            letterSpacing: 1.5,
            ...vis(ctx),
          }}
        >
          {right}
        </div>
      )}
    </div>
  );
}

// --- The frame --------------------------------------------------------------

/** The decorations that make the three families three different posters. */
function Decor({ ctx }: { ctx: PosterContext }) {
  const { skin, metrics } = ctx;
  const { palette, family } = skin;
  if (!shown(ctx)) {
    return null;
  }
  if (family === "matchday") {
    return (
      <div style={{ display: "flex", position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
        {/* A spotlight on the jersey. The first family drew a rotated slab
            here; the v3 redesign ("clean, no slabs") lights the team's colour
            instead. Sized four radii wide — see `Backlight` for why. */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: -metrics.width * 0.9,
            left: -metrics.width * 0.5,
            width: metrics.width * 2,
            height: metrics.width * 2,
            backgroundImage: `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 35%)`,
          }}
        />
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            left: 0,
            width: metrics.width,
            height: Math.round(metrics.pad * 0.22),
            background: palette.accent,
          }}
        />
      </div>
    );
  }
  if (family === "minimal") {
    return (
      <div style={{ display: "flex", position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            left: 0,
            width: metrics.width,
            height: Math.round(metrics.pad * 0.18),
            background: skin.team.fill,
          }}
        />
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: Math.round(metrics.pad * 0.55),
            left: Math.round(metrics.pad * 0.55),
            width: metrics.width - Math.round(metrics.pad * 1.1),
            height: metrics.height - Math.round(metrics.pad * 1.1),
            border: `1px solid ${palette.border}`,
            borderRadius: metrics.radius,
          }}
        />
      </div>
    );
  }
  // Classic: the floodlight wash, plus the team's colour as a light behind the
  // top of the sheet, where the crest and the name stand. Laid in a square four
  // radii wide and spent by 35% — Satori measures a radial to the far corner,
  // and the old `closest-side` glow ended in a visible rectangle.
  const radius = metrics.width * 0.5;
  return (
    <div style={{ display: "flex", position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: metrics.width * 0.3 - radius * 2,
          top: metrics.pad + metrics.headerTile * 2 - radius * 2,
          width: radius * 4,
          height: radius * 4,
          backgroundImage: `radial-gradient(circle at 50% 50%, ${skin.team.glow} 0%, ${withAlpha(
            palette.surface,
            0,
          )} 35%)`,
        }}
      />
    </div>
  );
}

export function Frame({ ctx, children }: { ctx: PosterContext; children: ReactNode }) {
  const { skin, metrics } = ctx;
  const { palette } = skin;
  const ground = shown(ctx)
    ? {
        background: palette.surface,
        backgroundImage: `radial-gradient(${palette.washGeometry}, ${palette.washInner}, ${palette.surface})`,
      }
    : // A sprite's other bands are drawn on nothing: the canvas composites them
      // over the base, so any ground here would paint over the poster.
      { background: "transparent" };
  return (
    <div
      style={{
        position: "relative",
        width: metrics.width,
        height: metrics.height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: metrics.pad,
        color: palette.heading,
        fontFamily: "Geist Sans, Anek Devanagari, sans-serif",
        ...ground,
      }}
    >
      <Decor ctx={ctx} />
      <div
        style={{
          display: "flex",
          position: "relative",
          flexDirection: "column",
          width: contentWidth(metrics),
          height: metrics.height - 2 * metrics.pad,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// --- Shared parts -----------------------------------------------------------

/** A kicker over a big title — the sheets' one editorial gesture. */
export function TitleBlock({
  ctx,
  kicker,
  title,
  sub,
  layer = "hero",
  align = "flex-start",
}: {
  ctx: PosterContext;
  kicker: string | null;
  title: string;
  sub: string | null;
  layer?: MotionLayer;
  align?: "flex-start" | "center";
}) {
  const { metrics, skin } = ctx;
  const { palette } = skin;
  const size = Math.max(
    metrics.titleMin,
    Math.min(metrics.titleMax, Math.floor(contentWidth(metrics) / (title.length * 0.62))),
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        alignItems: align,
        gap: 6,
      }}
    >
      {kicker === null ? null : (
        <div
          style={{
            display: "flex",
            color: palette.accent,
            fontSize: metrics.kickerSize,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
            ...vis(ctx, layer),
          }}
        >
          {kicker}
        </div>
      )}
      <div
        style={{
          display: "flex",
          color: palette.heading,
          fontSize: size,
          fontWeight: 700,
          lineHeight: 1.02,
          ...vis(ctx, layer),
        }}
      >
        {title}
      </div>
      {sub === null ? null : (
        <div
          style={{
            display: "flex",
            color: palette.body,
            fontSize: metrics.subSize,
            letterSpacing: 1.2,
            ...vis(ctx, layer),
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

export function Stat({
  ctx,
  label,
  value,
  tone,
  layer = "base",
}: {
  ctx: PosterContext;
  label: string;
  value: string;
  tone: string;
  layer?: MotionLayer;
}) {
  const { metrics, skin } = ctx;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 2,
        flexBasis: 0,
        flexGrow: 1,
        height: metrics.statHeight,
        padding: `0 ${String(Math.round(metrics.pad / 2))}px`,
        borderRadius: metrics.chipRadius,
        // Glass, like the player poster's result panel.
        // Glass only in its own band. The effects are LEFT OUT elsewhere rather
        // than set to "none": Satori rejects `backgroundImage: "none"` (the
        // squad, top-buys and season films failed on it) and still builds a
        // filter for `boxShadow: "none"`.
        ...(shown(ctx, layer)
          ? {
              backgroundImage: depthFor(skin).glassFill,
              boxShadow: depthFor(skin).glassShadow,
            }
          : {}),
        border: `1px solid ${shown(ctx, layer) ? depthFor(skin).glassBorder : "transparent"}`,
        ...vis(ctx, layer),
      }}
    >
      <div
        style={{
          display: "flex",
          color: skin.palette.muted,
          fontSize: metrics.statLabelSize,
          letterSpacing: 2.5,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          color: tone,
          fontFamily: FIGURES,
          fontSize: metrics.statSize,
          fontWeight: 700,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** A franchise, named in its own colour — the season-wide posters' team column. */
export function TeamChip({
  ctx,
  name,
  colour,
  size,
  layer = "items",
}: {
  ctx: PosterContext;
  name: string;
  colour: string | null;
  size: number;
  layer?: MotionLayer;
}) {
  const { skin } = ctx;
  const dot = colour ?? skin.palette.accent;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: Math.round(size * 0.5),
        ...vis(ctx, layer),
      }}
    >
      <div
        style={{
          display: "flex",
          width: Math.round(size * 0.72),
          height: Math.round(size * 0.72),
          borderRadius: size,
          background: dot,
        }}
      />
      <div
        style={{
          display: "flex",
          color: skin.palette.body,
          fontSize: size,
          letterSpacing: 1,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name}
      </div>
    </div>
  );
}
