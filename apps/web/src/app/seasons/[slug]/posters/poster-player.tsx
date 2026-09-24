import { monogramOf, POSTER_SIZES, type PlayerPoster, type PosterSize } from "@desiauction/core";

import { mix, WHITE, withAlpha } from "./poster-color";
import {
  Backlight,
  Coin,
  DepthFooter,
  Number3D,
  Pill,
  Portrait,
  SeasonBar,
  Star,
  depthFor,
  metalText,
  type Depth,
} from "./poster-depth";
import { DISPLAY, FIGURES, SERIF } from "./poster-fonts";
import { contextFor, vis, type PosterContext, type PosterRenderOptions } from "./poster-kit";

/**
 * THE PLAYER POSTER, v3.
 *
 * Read in three beats, because a Status is on screen for about three seconds:
 *
 * 1. WHO — the photograph (or, without one, the shirt number in 3D) and the
 *    name in two voices: a light italic first name over a heavy surname.
 * 2. WHAT HAPPENED — ONE glass panel that reads as a sentence:
 *    "SOLD · ₹12,500 · to Jaipur Jaguars". The first family split that across
 *    a stamp, a price row and a caption, and a reader had to assemble it.
 * 3. WHERE FROM — the season at the top, the DesiAuction lockup and the way
 *    back (a QR code) at the foot.
 *
 * Every size is its own layout (see `LAYOUT`) for the same reason the metrics
 * are literal records: a scale factor is letterboxing.
 *
 * MOTION: `base` is the ground, number, header and footer; `hero` the photo and
 * name; `stamp` the panel, its pill and its team line; `price` the figure alone.
 * The panel's container carries no opacity of its own — opacity multiplies, and
 * a hidden container would take the price band down with it.
 */

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The result panel's own measurements — shared with the landscape link card. */
export interface PanelMetrics {
  readonly top: number;
  readonly radius: number;
  readonly padX: number;
  readonly padY: number;
  readonly pill: number;
  readonly caption: number;
  readonly figureMax: number;
  readonly word: number;
  readonly team: number;
  readonly coin: number;
}

interface Layout {
  readonly pad: number;
  readonly header: { readonly top: number; readonly coin: number; readonly name: number };
  /** Where the light and the number stand. */
  readonly stage: Box;
  readonly number: { readonly size: number; readonly top: number };
  /** The number when it IS the hero (no photograph). */
  readonly heroNumber: { readonly size: number; readonly top: number };
  readonly portrait: Box;
  readonly name: {
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly first: number;
    readonly lastMax: number;
    readonly lastMin: number;
    readonly meta: number;
  };
  readonly panel: PanelMetrics;
  readonly footer: { readonly top: number; readonly qr: number };
}

const LAYOUT: Record<PosterSize, Layout> = {
  // 9:16 — the Status. Key content stays between ~170px from the top and
  // ~200px from the bottom, where WhatsApp draws its own bars.
  story: {
    pad: 72,
    header: { top: 172, coin: 68, name: 30 },
    stage: { left: 0, top: 0, width: 1080, height: 1120 },
    number: { size: 820, top: 250 },
    heroNumber: { size: 640, top: 300 },
    portrait: { left: 170, top: 300, width: 740, height: 860 },
    name: { top: 790, left: 72, width: 936, first: 124, lastMax: 228, lastMin: 120, meta: 30 },
    panel: {
      top: 1216,
      radius: 40,
      padX: 40,
      padY: 34,
      pill: 22,
      caption: 20,
      figureMax: 150,
      word: 132,
      team: 40,
      coin: 60,
    },
    footer: { top: 1630, qr: 116 },
  },
  // 4:5 — the feed post.
  portrait: {
    pad: 64,
    header: { top: 64, coin: 56, name: 26 },
    stage: { left: 0, top: 0, width: 1080, height: 780 },
    number: { size: 560, top: 150 },
    heroNumber: { size: 480, top: 170 },
    portrait: { left: 250, top: 150, width: 580, height: 560 },
    name: { top: 540, left: 64, width: 952, first: 84, lastMax: 156, lastMin: 90, meta: 26 },
    panel: {
      top: 834,
      radius: 32,
      padX: 32,
      padY: 26,
      pill: 18,
      caption: 17,
      figureMax: 110,
      word: 96,
      team: 32,
      coin: 46,
    },
    footer: { top: 1180, qr: 96 },
  },
  // 1:1 — the photograph on the right, the name beside it.
  square: {
    pad: 56,
    header: { top: 56, coin: 52, name: 24 },
    stage: { left: 460, top: 60, width: 640, height: 700 },
    number: { size: 520, top: 150 },
    heroNumber: { size: 460, top: 170 },
    portrait: { left: 560, top: 140, width: 440, height: 520 },
    name: { top: 280, left: 56, width: 500, first: 68, lastMax: 132, lastMin: 72, meta: 22 },
    panel: {
      top: 704,
      radius: 30,
      padX: 30,
      padY: 22,
      pill: 16,
      caption: 15,
      figureMax: 96,
      word: 84,
      team: 28,
      coin: 42,
    },
    footer: { top: 976, qr: 72 },
  },
};

/**
 * Pessimistic advance widths for the display faces — a condensed heavy cap, a
 * semicondensed figure and an italic serif. Overestimating costs a few points
 * of type; underestimating costs a line break Satori will not warn about.
 */
export const CAPS = 0.56;
const FIGURE = 0.6;
export const ITALIC = 0.44;

export function fit(text: string, room: number, ratio: number, max: number, min: number): number {
  const wanted = Math.floor(room / Math.max(1, text.length * ratio));
  return Math.max(min, Math.min(max, wanted));
}

/** The panel's sentence, per outcome. */
function panelWords(model: PlayerPoster, prices: boolean) {
  switch (model.outcome) {
    case "sold":
      return {
        pill: "SOLD",
        figure: prices ? model.priceLabel : null,
        word: prices && model.priceLabel !== null ? null : "SOLD",
        link: "to",
        caption: model.lotLabel,
      };
    case "pool":
      return {
        pill: "IN THE POOL",
        figure: model.basePriceLabel,
        word: null,
        link: null,
        caption: model.basePriceLabel === null ? model.lotLabel : "BASE PRICE",
      };
    // Signed before the night: the pill says how, and the TEAM is the headline —
    // "ICON PLAYER · RAJGARH ROYALS". An icon nobody has placed yet says so.
    case "icon":
    case "captain":
    case "retained": {
      const pill =
        model.outcome === "icon"
          ? "ICON PLAYER"
          : model.outcome === "captain"
            ? "CAPTAIN"
            : "RETAINED";
      return {
        pill,
        figure: null,
        word: model.teamName === null ? (pill.split(" ")[0] ?? pill) : null,
        link: null,
        caption: model.teamName === null ? "NOT IN THE AUCTION" : "SIGNED BEFORE THE AUCTION",
      };
    }
    case "unsold":
      return { pill: "UNSOLD", figure: null, word: "UNSOLD", link: null, caption: model.lotLabel };
  }
}

/**
 * "SOLD · ₹12,500 · to Jaipur Jaguars" — the one glass object that says what
 * happened. Shared by every size of the poster and by the link card.
 */
export function ResultPanel({
  ctx,
  depth,
  model,
  panel,
  left,
  width,
}: {
  ctx: PosterContext;
  depth: Depth;
  model: PlayerPoster;
  panel: PanelMetrics;
  left: number;
  width: number;
}) {
  const { palette } = ctx.skin;
  const p = panel;
  const words = panelWords(model, ctx.options.prices);
  const inner = width - 2 * p.padX;
  const unsold = model.outcome === "unsold";
  const pool = model.outcome === "pool";
  const star =
    model.outcome === "icon" || model.outcome === "captain" ? (
      <Star size={p.pill} colour={depth.pillText} />
    ) : null;
  const pillFill = unsold
    ? `linear-gradient(180deg, ${mix(palette.panel, WHITE, 0.12)}, ${palette.panel})`
    : pool
      ? "linear-gradient(180deg, #8EF0C0 0%, #4ADE9A 55%, #25B874 100%)"
      : depth.pillFill;
  const pillInk = unsold ? palette.body : pool ? "#04120C" : depth.pillText;
  const teamRow = model.teamName !== null && words.link !== null;
  const teamHero =
    model.teamName !== null &&
    (model.outcome === "icon" || model.outcome === "captain" || model.outcome === "retained");
  const heroCoin = Math.round(p.word * 0.62);
  const heroSize = teamHero
    ? fit(
        (model.teamName ?? "").toUpperCase(),
        inner - heroCoin - Math.round(heroCoin * 0.35),
        CAPS,
        p.word,
        Math.round(p.word * 0.42),
      )
    : p.word;
  const teamSize = teamRow
    ? fit(model.teamName ?? "", inner - p.coin - p.team * 2, 0.55, p.team, Math.round(p.team * 0.6))
    : p.team;

  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        left,
        top: p.top,
        width,
        flexDirection: "column",
        padding: `${String(p.padY)}px ${String(p.padX)}px`,
      }}
    >
      {/* The glass itself, on its own node so the price band can be drawn alone. */}
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          borderRadius: p.radius,
          backgroundImage: depth.glassFill,
          border: `1px solid ${depth.glassBorder}`,
          boxShadow: depth.glassShadow,
          ...vis(ctx, "stamp"),
        }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Pill ctx={ctx} text={words.pill} size={p.pill} fill={pillFill} ink={pillInk} icon={star} />
        {words.caption === null ? null : (
          <div
            style={{
              display: "flex",
              color: palette.muted,
              fontSize: p.caption,
              letterSpacing: p.caption * 0.2,
              fontWeight: 600,
              ...vis(ctx, "stamp"),
            }}
          >
            {words.caption}
          </div>
        )}
      </div>

      {words.figure === null ? null : (
        <div
          style={{
            display: "flex",
            marginTop: Math.round(p.padY * 0.65),
            fontFamily: FIGURES,
            fontWeight: 700,
            fontSize: fit(words.figure, inner, FIGURE, p.figureMax, Math.round(p.figureMax * 0.5)),
            lineHeight: 0.9,
            letterSpacing: -p.figureMax * 0.02,
            ...(pool ? { color: palette.heading } : metalText(depth)),
            ...vis(ctx, "price"),
          }}
        >
          {words.figure}
        </div>
      )}
      {words.word === null ? null : (
        <div
          style={{
            display: "flex",
            marginTop: Math.round(p.padY * 0.65),
            fontFamily: DISPLAY,
            fontWeight: 800,
            fontSize: fit(words.word, inner, CAPS, p.word, Math.round(p.word * 0.5)),
            lineHeight: 0.9,
            ...(unsold ? { color: palette.muted } : metalText(depth)),
            ...vis(ctx, "stamp"),
          }}
        >
          {words.word}
        </div>
      )}

      {teamHero ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: Math.round(heroCoin * 0.35),
            marginTop: Math.round(p.padY * 0.7),
          }}
        >
          <Coin
            ctx={ctx}
            size={heroCoin}
            colour={model.teamColor ?? palette.accent}
            label={monogramOf(model.teamName ?? "")}
            src={model.teamCrestUrl}
            layer="stamp"
          />
          <div
            style={{
              display: "flex",
              fontFamily: DISPLAY,
              fontWeight: 800,
              fontSize: heroSize,
              lineHeight: 0.9,
              ...metalText(depth),
              ...vis(ctx, "stamp"),
            }}
          >
            {(model.teamName ?? "").toUpperCase()}
          </div>
        </div>
      ) : null}

      {teamRow ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: Math.round(p.coin * 0.3),
            marginTop: Math.round(p.padY * 0.75),
            paddingTop: Math.round(p.padY * 0.7),
            borderTop: `1px solid ${depth.hairline}`,
          }}
        >
          <Coin
            ctx={ctx}
            size={p.coin}
            colour={model.teamColor ?? palette.accent}
            label={monogramOf(model.teamName ?? "")}
            src={model.teamCrestUrl}
            layer="stamp"
          />
          <div
            style={{
              display: "flex",
              fontFamily: SERIF,
              fontStyle: "italic",
              fontSize: teamSize,
              color: palette.muted,
              ...vis(ctx, "stamp"),
            }}
          >
            {words.link}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: teamSize,
              fontWeight: 600,
              color: palette.heading,
              letterSpacing: -teamSize * 0.01,
              ...vis(ctx, "stamp"),
            }}
          >
            {model.teamName}
          </div>
        </div>
      ) : pool ? (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: Math.round(p.team * 0.45),
            marginTop: Math.round(p.padY * 0.75),
            paddingTop: Math.round(p.padY * 0.7),
            borderTop: `1px solid ${depth.hairline}`,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: SERIF,
              fontStyle: "italic",
              fontSize: Math.round(p.team * 1.1),
              color: palette.accent,
              ...vis(ctx, "stamp"),
            }}
          >
            Bid for me
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Anek Devanagari",
              fontWeight: 600,
              fontSize: Math.round(p.team * 0.8),
              color: palette.muted,
              ...vis(ctx, "stamp"),
            }}
          >
            मुझ पर बोली लगाइए
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function renderPlayerPoster(model: PlayerPoster, options: PosterRenderOptions) {
  // A pool player has no buying team, so the light is the palette's own accent.
  const ctx = contextFor(options, model.teamColor);
  const { skin } = ctx;
  const { palette } = skin;
  const depth = depthFor(skin);
  const layout = LAYOUT[options.size];
  const { width, height } = POSTER_SIZES[options.size];
  const contentWidth = width - 2 * layout.pad;
  const photo = model.photoUrl;
  const stageMid = layout.stage.left + layout.stage.width / 2;
  const heroText = model.heroNumber ?? model.monogram;
  const n = layout.name;
  const lastSize = fit(model.lastName.toUpperCase(), n.width, CAPS, n.lastMax, n.lastMin);
  const firstSize =
    model.firstName === null
      ? 0
      : fit(model.firstName, n.width, ITALIC, n.first, Math.round(n.first * 0.55));
  const meta = [model.roleLine, model.heroNumber === null ? null : `No. ${model.heroNumber}`]
    .filter((part): part is string => part !== null && part !== "")
    .join("  ·  ");
  const square = options.size === "square";

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width,
        height,
        overflow: "hidden",
        color: palette.heading,
        fontFamily: "Geist Sans, Anek Devanagari, sans-serif",
        ...(options.only === undefined || options.only === "base"
          ? { background: palette.surface }
          : { background: "transparent" }),
      }}
    >
      <Backlight
        ctx={ctx}
        depth={depth}
        centerX={stageMid}
        centerY={layout.portrait.top + layout.portrait.height * 0.42}
        radius={Math.round(layout.portrait.width * 0.62)}
      />

      {/* The number: behind the photograph, or the hero when there is none. */}
      {photo === null ? (
        <Number3D
          ctx={ctx}
          text={heroText}
          size={layout.heroNumber.size}
          top={layout.heroNumber.top}
          left={stageMid - layout.stage.width / 2}
          width={layout.stage.width}
          face={depth.numberHeroFace}
          side={mix(depth.numberSide, "#000000", 0.2)}
          layer="hero"
        />
      ) : model.heroNumber === null ? null : (
        <Number3D
          ctx={ctx}
          text={model.heroNumber}
          size={layout.number.size}
          top={layout.number.top}
          left={stageMid - layout.stage.width / 2}
          width={layout.stage.width}
          face={depth.numberFace}
          side={depth.numberSide}
        />
      )}

      {photo === null ? null : (
        <Portrait
          ctx={ctx}
          src={photo}
          left={layout.portrait.left}
          top={layout.portrait.top}
          width={layout.portrait.width}
          height={layout.portrait.height}
          ground={palette.surface}
          rim={model.teamColor ?? palette.accent}
        />
      )}

      {/* Lifts the name off whatever is behind it, on every ground — and runs
          past the foot of the light and the photograph, so neither ends in an edge. */}
      {square ? null : (
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 0,
            top: n.top - 60,
            width,
            height:
              Math.max(
                layout.stage.top + layout.stage.height,
                layout.portrait.top + layout.portrait.height,
              ) -
              (n.top - 60) +
              40,
            backgroundImage: `linear-gradient(180deg, ${withAlpha(palette.surface, 0)} 0%, ${withAlpha(palette.surface, 0.78)} 40%, ${palette.surface} 72%)`,
            ...vis(ctx),
          }}
        />
      )}

      <SeasonBar
        ctx={ctx}
        depth={depth}
        name={model.competitionName}
        logoUrl={model.competitionLogoUrl}
        monogram={monogramOf(model.competitionName)}
        coin={layout.header.coin}
        nameSize={layout.header.name}
        top={layout.header.top}
        left={layout.pad}
        width={contentWidth}
        right={
          model.lotLabel === null ? null : (
            <div
              style={{
                display: "flex",
                flexShrink: 0,
                color: palette.muted,
                fontSize: Math.round(layout.header.name * 0.72),
                fontWeight: 600,
                letterSpacing: 4,
                ...vis(ctx),
              }}
            >
              {model.lotLabel}
            </div>
          )
        }
      />

      <div
        style={{
          display: "flex",
          position: "absolute",
          left: n.left,
          top: n.top,
          width: n.width,
          flexDirection: "column",
        }}
      >
        {model.firstName === null ? null : (
          <div
            style={{
              display: "flex",
              fontFamily: SERIF,
              fontStyle: "italic",
              fontSize: firstSize,
              lineHeight: 0.95,
              color: palette.heading,
              ...vis(ctx, "hero"),
            }}
          >
            {model.firstName}
          </div>
        )}
        <div
          style={{
            display: "flex",
            fontFamily: DISPLAY,
            fontWeight: 800,
            fontSize: lastSize,
            lineHeight: 0.86,
            letterSpacing: -lastSize * 0.01,
            color: palette.heading,
            textShadow: depth.dark ? "0 18px 50px rgba(0,0,0,0.55)" : "none",
            ...vis(ctx, "hero"),
          }}
        >
          {model.lastName.toUpperCase()}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: Math.round(n.meta * 0.7),
            fontSize: n.meta,
            color: palette.muted,
            ...vis(ctx, "hero"),
          }}
        >
          {meta}
        </div>
      </div>

      <ResultPanel
        ctx={ctx}
        depth={depth}
        model={model}
        panel={layout.panel}
        left={layout.pad}
        width={contentWidth}
      />

      <DepthFooter
        ctx={ctx}
        shareUrl={options.shareUrl ?? null}
        qr={layout.footer.qr}
        top={layout.footer.top}
        left={layout.pad}
        width={contentWidth}
      />
    </div>
  );
}
