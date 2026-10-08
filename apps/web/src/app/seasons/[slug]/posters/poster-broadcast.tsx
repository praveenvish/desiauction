import {
  POSTER_SIZES,
  type PlayerPoster,
  type PosterSize,
  type SeasonPoster,
  type TeamPoster,
  type TeamPosterRow,
  type TopBuyRow,
  type TopBuysPoster,
} from "@desiauction/core";
import type { CSSProperties, ReactNode } from "react";

import { withAlpha } from "./poster-color";
import {
  Footer,
  contextFor,
  shown,
  vis,
  type PosterContext,
  type PosterRenderOptions,
} from "./poster-kit";
import { estimateTextWidth } from "./poster-layout";
import {
  Crest,
  FACE,
  Jersey,
  LABEL,
  NIGHT,
  Portrait,
  fitSize,
  monogramFor,
  splitPrice,
  tonesFor,
  type Tones,
} from "./poster-stadium";
import { seasonGrid } from "./poster-stadium-season";

/**
 * BROADCAST — the poster as a TV graphic (founder, 2026-10-08): the team's
 * colour as a slab on the left, cut on a diagonal by a gold stripe, and the
 * squad as a dark list on the right, the way a broadcaster puts a team sheet
 * up before the toss.
 *
 * Every kind is drawn here; the pieces that are not about layout (shirts,
 * crests, colours, price splitting) are Stadium's, so the two families agree
 * on what a team looks like.
 */

export const INK = "#0A0C10";
export const GOLD = "#FDE047";

export const ROOT: CSSProperties = {
  position: "relative",
  display: "flex",
  overflow: "hidden",
  color: "#FFFFFF",
  fontFamily: "Geist Sans, Anek Devanagari, sans-serif",
};

/** "कालू देवासी" + " (c)" — the mark a team sheet writes after a name. */
export function markOf(row: TeamPosterRow): string | null {
  if (row.isCaptain) {
    return "(c)";
  }
  if (row.badges.includes("ICON")) {
    return "(i)";
  }
  return row.isMarked ? "(r)" : null;
}

/** Captain first, then icons, then retained — at most `max`. */
export function leadersOf(rows: readonly TeamPosterRow[], max: number): TeamPosterRow[] {
  const captains = rows.filter((row) => row.isCaptain);
  const marked = rows.filter((row) => !row.isCaptain && row.isMarked);
  return [...captains, ...marked].slice(0, max);
}

export function leaderWord(row: TeamPosterRow): string {
  if (row.isCaptain) {
    return "CAPTAIN";
  }
  return row.badges.includes("ICON") ? "ICON" : "RETAINED";
}

/** The costliest priced row — the "top buy" a stats strip names. */
export function topBuyOf(rows: readonly TeamPosterRow[]): TeamPosterRow | null {
  let best: TeamPosterRow | null = null;
  let bestValue = -1;
  for (const row of rows) {
    if (row.priceLabel === null) {
      continue;
    }
    const value = Number(splitPrice(row.priceLabel).figure.replace(/[^\d.]/g, ""));
    if (value > bestValue) {
      best = row;
      bestValue = value;
    }
  }
  return best;
}

/** "8,500" big with "PTS" small after it; "₹" small before. */
export function PriceText({
  label,
  size,
  color,
  style,
}: {
  label: string;
  size: number;
  color: string;
  style?: CSSProperties;
}) {
  const price = splitPrice(label);
  return (
    <div
      style={{ display: "flex", alignItems: "flex-end", gap: Math.round(size * 0.08), ...style }}
    >
      {price.lead === "" ? null : (
        <div
          style={{
            display: "flex",
            fontFamily: LABEL,
            fontSize: Math.round(size * 0.5),
            marginBottom: Math.round(size * 0.1),
            color,
          }}
        >
          {price.lead}
        </div>
      )}
      <div style={{ display: "flex", fontFamily: FACE, fontSize: size, lineHeight: 1, color }}>
        {price.figure}
      </div>
      {price.tail === "" ? null : (
        <div
          style={{
            display: "flex",
            fontFamily: FACE,
            fontSize: Math.round(size * 0.42),
            marginBottom: Math.round(size * 0.06),
            color: withAlpha(color, 0.75),
          }}
        >
          {price.tail}
        </div>
      )}
    </div>
  );
}

/** Spaced capitals: "BPL-4 · THE SQUAD". */
export function Spaced({
  text,
  size,
  color,
  style,
}: {
  text: string;
  size: number;
  color: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        fontFamily: LABEL,
        fontSize: size,
        letterSpacing: Math.round(size * 0.32),
        lineHeight: 1.2,
        color,
        ...style,
      }}
    >
      {text}
    </div>
  );
}

/** A gold block with dark capitals — CAPTAIN, SOLD, #1 BUY. */
export function Chip({ text, size, ctxStyle }: { text: string; size: number; ctxStyle?: object }) {
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        padding: `${String(Math.round(size * 0.18))}px ${String(Math.round(size * 0.5))}px`,
        background: GOLD,
        ...ctxStyle,
      }}
    >
      <div
        style={{
          display: "flex",
          fontFamily: LABEL,
          fontSize: size,
          letterSpacing: Math.round(size * 0.22),
          lineHeight: 1.1,
          color: "#0B0B0B",
        }}
      >
        {text}
      </div>
    </div>
  );
}

/** The largest size at which the longest WORD of `text` fits `room`. */
function wordFit(text: string, room: number, max: number, min: number): number {
  const longest = text
    .split(/\s+/)
    .reduce((a, b) => (estimateTextWidth(b, 10) > estimateTextWidth(a, 10) ? b : a), "");
  return fitSize(longest, room, max, min);
}

// --- The split stage ------------------------------------------------------------

/**
 * The team's slab, the gold cut and the dark panel. `split` is where the
 * diagonal crosses the middle of the poster; `slant` how far it leans.
 */
function SplitStage({
  ctx,
  tones,
  width,
  height,
  split,
  slant,
}: {
  ctx: PosterContext;
  tones: Tones;
  width: number;
  height: number;
  split: number;
  slant: number;
}) {
  if (!shown(ctx)) {
    return null;
  }
  const stripe = Math.max(10, Math.round(width * 0.014));
  // Satori ignores clip-path; a rotated rectangle draws the same diagonal.
  const angle = (Math.atan2(slant, height) * 180) / Math.PI;
  return (
    <div style={{ position: "absolute", display: "flex", left: 0, top: 0, width, height }}>
      <div
        style={{
          position: "absolute",
          display: "flex",
          left: 0,
          top: 0,
          width,
          height,
          backgroundImage: `linear-gradient(165deg, ${tones.light} 0%, ${tones.base} 38%, ${tones.shade} 100%)`,
        }}
      />
      <EdgeRect
        x={split - stripe}
        y={height / 2}
        angle={angle}
        reach={width * 2}
        span={height * 3}
        edge="left"
        fill="#FDE68A"
      />
      <EdgeRect
        x={split}
        y={height / 2}
        angle={angle}
        reach={width * 2}
        span={height * 3}
        edge="left"
        fill={`linear-gradient(180deg, #0D1016 0%, ${INK} 100%)`}
      />
    </div>
  );
}

/**
 * A rectangle far bigger than the poster, rotated by `angle` degrees, whose
 * `edge` passes through (x, y): one side of a diagonal cut. `reach` is the
 * size across the edge, `span` along it.
 */
export function EdgeRect({
  x,
  y,
  angle,
  reach,
  span,
  edge,
  fill,
}: {
  x: number;
  y: number;
  angle: number;
  reach: number;
  span: number;
  edge: "left" | "bottom";
  fill: string;
}) {
  const rad = (angle * Math.PI) / 180;
  const w = edge === "left" ? reach : span;
  const h = edge === "left" ? span : reach;
  // The rectangle's centre, so that after rotating about it the chosen edge's
  // midpoint lands on (x, y).
  const cx = edge === "left" ? x + (w / 2) * Math.cos(rad) : x + (h / 2) * Math.sin(rad);
  const cy = edge === "left" ? y + (w / 2) * Math.sin(rad) : y - (h / 2) * Math.cos(rad);
  return (
    <div
      style={{
        position: "absolute",
        display: "flex",
        left: Math.round(cx - w / 2),
        top: Math.round(cy - h / 2),
        width: Math.round(w),
        height: Math.round(h),
        ...(fill.startsWith("linear-gradient") ? { backgroundImage: fill } : { background: fill }),
        transform: `rotate(${angle.toFixed(2)}deg)`,
      }}
    />
  );
}

interface SplitLayout {
  readonly pad: number;
  readonly kicker: number;
  readonly title: number;
  readonly leader: number;
  readonly leaderName: number;
  readonly total: number;
  readonly rowMax: number;
  readonly split: number;
  readonly slant: number;
}

const SPLIT: Record<PosterSize, SplitLayout> = {
  story: {
    pad: 64,
    kicker: 22,
    title: 132,
    leader: 176,
    leaderName: 50,
    total: 140,
    rowMax: 108,
    split: 0.43,
    slant: 130,
  },
  portrait: {
    pad: 52,
    kicker: 18,
    title: 108,
    leader: 140,
    leaderName: 42,
    total: 112,
    rowMax: 84,
    split: 0.47,
    slant: 140,
  },
  square: {
    pad: 44,
    kicker: 15,
    title: 84,
    leader: 104,
    leaderName: 32,
    total: 84,
    rowMax: 68,
    split: 0.45,
    slant: 110,
  },
};

/** The geometry both columns read: where the slab's text ends, where the list starts. */
function columnsOf(width: number, L: SplitLayout) {
  const split = Math.round(width * L.split);
  const leftRoom = split - L.slant / 2 - L.pad * 1.3;
  const rightStart = split + L.slant / 2 + Math.round(L.pad * 0.5);
  const rightRoom = width - rightStart - L.pad;
  return { split, leftRoom: Math.round(leftRoom), rightStart, rightRoom: Math.round(rightRoom) };
}

/** One line of the dark list: number, name over a small line, a figure on the right. */
function ListRow({
  ctx,
  height,
  room,
  lead,
  leadColor,
  name,
  sub,
  subDot,
  figure,
  figureColor,
}: {
  ctx: PosterContext;
  height: number;
  room: number;
  lead: string;
  leadColor: string;
  name: string;
  sub: string | null;
  subDot?: string;
  figure: string | null;
  figureColor: string;
}) {
  const leadWidth = Math.round(height * 0.95);
  const figureSize = Math.round(height * 0.36);
  const figureRoom = figure === null ? 0 : estimateTextWidth(figure, figureSize) + height * 0.3;
  const nameSize = fitSize(
    name,
    room - leadWidth - figureRoom - height * 0.2,
    Math.round(height * 0.42),
    Math.round(height * 0.24),
  );
  const subSize = Math.max(10, Math.round(height * 0.15));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        width: room,
        height,
        borderBottom: `1px solid ${withAlpha("#FFFFFF", 0.1)}`,
        ...vis(ctx, "items"),
      }}
    >
      <div
        style={{
          display: "flex",
          width: leadWidth,
          fontFamily: FACE,
          fontSize: Math.round(height * 0.46),
          lineHeight: 1,
          color: leadColor,
        }}
      >
        {lead}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            fontFamily: FACE,
            fontSize: nameSize,
            lineHeight: 1.15,
            whiteSpace: "nowrap",
            color: "#FFFFFF",
          }}
        >
          {name}
        </div>
        {sub === null ? null : (
          <div style={{ display: "flex", alignItems: "center", gap: Math.round(subSize * 0.5) }}>
            {subDot === undefined ? null : (
              <div
                style={{
                  display: "flex",
                  width: Math.round(subSize * 0.75),
                  height: Math.round(subSize * 0.75),
                  borderRadius: subSize,
                  background: subDot,
                }}
              />
            )}
            <Spaced
              text={sub}
              size={subSize}
              color={withAlpha("#FFFFFF", 0.55)}
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                maxWidth: Math.round(room - leadWidth - figureRoom - height * 0.4),
              }}
            />
          </div>
        )}
      </div>
      {figure === null ? null : <PriceText label={figure} size={figureSize} color={figureColor} />}
    </div>
  );
}

/** The slab's foot: the money, or the head count. */
function SlabFoot({
  ctx,
  L,
  room,
  label,
  value,
  tones,
}: {
  ctx: PosterContext;
  L: SplitLayout;
  room: number;
  label: string;
  value: ReactNode;
  tones: Tones;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: room }}>
      <Spaced
        text={label}
        size={L.kicker}
        color={tones.trim}
        style={{ marginBottom: Math.round(L.kicker * 0.4), ...vis(ctx) }}
      />
      {value}
    </div>
  );
}

/** Crest + "BPL-4 · THE SQUAD", over the slab. */
function SlabHead({
  ctx,
  L,
  tones,
  crest,
  monogram,
  text,
  room,
  team = false,
}: {
  ctx: PosterContext;
  L: SplitLayout;
  tones: Tones;
  crest: string | null;
  monogram: string;
  text: string;
  room?: number;
  /** A team's crest (not the competition's): wears the season's shield. */
  team?: boolean;
}) {
  const size = Math.round(L.kicker * 3);
  const full = room ?? 2000;
  const fitsBeside = full - size - L.kicker >= text.length * 0.95 * L.kicker * 0.85;
  // Too narrow a slab for crest and words on one line: the crest goes above.
  const roomLeft = fitsBeside ? full - size - L.kicker : full;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: fitsBeside ? "row" : "column",
        alignItems: fitsBeside ? "center" : "flex-start",
        gap: Math.round(L.kicker * 0.7),
      }}
    >
      <div style={{ display: "flex", ...vis(ctx) }}>
        <Crest
          size={size}
          tones={tones}
          src={crest}
          monogram={monogram}
          badge={team ? (ctx.options.teamBadge ?? "shield") : undefined}
        />
      </div>
      <Spaced
        text={text}
        size={Math.min(L.kicker, Math.floor(roomLeft / (text.length * 0.95)))}
        color={withAlpha(tones.onShirt, 0.85)}
        style={vis(ctx)}
      />
    </div>
  );
}

// --- The squad ------------------------------------------------------------------

export function renderBroadcastSquad(
  model: TeamPoster,
  options: PosterRenderOptions,
  mode: "sheet" | "reveal",
) {
  const ctx = contextFor(options, model.teamColor);
  const { width, height } = POSTER_SIZES[options.size];
  const L = SPLIT[options.size];
  const tones = tonesFor(model.teamColor, model.teamName);
  const cols = columnsOf(width, L);
  const prices = mode === "sheet" && options.prices;
  const leaders = leadersOf(model.rows, options.size === "square" ? 2 : 3);
  const listed = model.rows.filter((row) => !leaders.includes(row));
  const titleSize = wordFit(model.teamName, cols.leftRoom, L.title, Math.round(L.title * 0.42));
  const showSpent = prices && model.spentLabel !== "";

  const listTop = L.pad + L.kicker * 3;
  const footH = ctx.metrics.footerHeight + Math.round(L.pad * 0.5);
  const listRoom = height - listTop - L.pad - footH;
  const rowHeight =
    listed.length === 0 ? 0 : Math.min(L.rowMax, Math.floor(listRoom / listed.length));

  return (
    <div style={{ ...ROOT, width, height, background: shown(ctx) ? INK : "transparent" }}>
      <SplitStage
        ctx={ctx}
        tones={tones}
        width={width}
        height={height}
        split={cols.split}
        slant={L.slant}
      />

      {/* The slab. */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          left: L.pad,
          top: L.pad,
          width: cols.leftRoom,
          height: height - 2 * L.pad - footH,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <SlabHead
            ctx={ctx}
            L={L}
            tones={tones}
            crest={model.teamCrestUrl}
            monogram={model.teamMonogram || monogramFor(model.teamName)}
            text={`${model.competitionName.toUpperCase()} · ${mode === "sheet" ? "THE SQUAD" : "MEET THE SQUAD"}`}
            room={cols.leftRoom}
            team
          />
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              marginTop: Math.round(L.kicker * 0.8),
              fontFamily: FACE,
              fontSize: titleSize,
              lineHeight: 1.08,
              color: tones.onShirt,
              ...vis(ctx),
            }}
          >
            {model.teamName}
          </div>
          {model.coachName === null ? null : (
            <Spaced
              text={`COACH · ${model.coachName.toUpperCase()}`}
              size={Math.round(L.kicker * 0.85)}
              color={withAlpha(tones.onShirt, 0.75)}
              style={{ marginTop: Math.round(L.kicker * 0.6), ...vis(ctx) }}
            />
          )}
        </div>

        {leaders.length === 0 ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: Math.round(L.pad * 0.35) }}>
            {leaders.map((row, index) => (
              <div
                key={`${row.name}-${String(index)}`}
                style={{ display: "flex", alignItems: "center", gap: Math.round(L.pad * 0.4) }}
              >
                <div style={{ display: "flex", ...vis(ctx, "hero") }}>
                  {row.photoUrl === null ? (
                    <Jersey
                      width={L.leader}
                      tones={tones}
                      name={row.firstName}
                      number={row.shirtNumber ?? ""}
                      id={`lead${String(index)}`}
                    />
                  ) : (
                    <Portrait width={Math.round(L.leader * 0.9)} tones={tones} src={row.photoUrl} />
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <Chip
                    text={leaderWord(row)}
                    size={Math.round(L.leaderName * 0.4)}
                    ctxStyle={vis(ctx, "hero")}
                  />
                  <div
                    style={{
                      display: "flex",
                      marginTop: Math.round(L.leaderName * 0.18),
                      fontFamily: FACE,
                      fontSize: fitSize(
                        row.name,
                        cols.leftRoom - L.leader - L.pad * 0.4,
                        L.leaderName,
                        Math.round(L.leaderName * 0.55),
                      ),
                      lineHeight: 1.12,
                      color: tones.onShirt,
                      ...vis(ctx, "hero"),
                    }}
                  >
                    {row.name}
                  </div>
                  <Spaced
                    text={row.roleLine.toUpperCase()}
                    size={Math.round(L.leaderName * 0.3)}
                    color={withAlpha(tones.onShirt, 0.7)}
                    style={vis(ctx, "hero")}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <SlabFoot
          ctx={ctx}
          L={L}
          room={cols.leftRoom}
          tones={tones}
          label={showSpent ? "TOTAL SPENT" : "THE SQUAD"}
          value={
            showSpent ? (
              <PriceText
                label={model.spentLabel}
                size={fitSize(model.spentLabel, cols.leftRoom, L.total, Math.round(L.total * 0.5))}
                color={tones.onShirt}
                style={vis(ctx)}
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  fontFamily: FACE,
                  fontSize: Math.round(L.total * 0.7),
                  lineHeight: 1,
                  color: tones.onShirt,
                  ...vis(ctx),
                }}
              >
                {model.squadLabel.toUpperCase()}
              </div>
            )
          }
        />
      </div>

      {/* The list. */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          left: cols.rightStart,
          top: listTop,
          width: cols.rightRoom,
          height: listRoom,
        }}
      >
        {listed.map((row, index) => (
          <ListRow
            key={`${row.name}-${String(index)}`}
            ctx={ctx}
            height={rowHeight}
            room={cols.rightRoom}
            lead={row.shirtNumber ?? String(index + 1 + leaders.length)}
            leadColor={index === 0 && prices ? GOLD : withAlpha("#FFFFFF", 0.35)}
            name={markOf(row) === null ? row.name : `${row.name} ${markOf(row) ?? ""}`}
            sub={row.roleLine.toUpperCase()}
            figure={prices ? row.priceLabel : null}
            figureColor={index === 0 ? GOLD : "#FFFFFF"}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          display: "flex",
          left: L.pad,
          bottom: L.pad,
          width: width - 2 * L.pad,
        }}
      >
        <Footer ctx={ctx} />
      </div>
    </div>
  );
}

// --- The player card ------------------------------------------------------------

interface CardLayout {
  readonly pad: number;
  readonly kicker: number;
  readonly hero: number;
  readonly name: number;
  readonly stamp: number;
  readonly bar: number;
  readonly price: number;
}

const CARD: Record<PosterSize, CardLayout> = {
  story: { pad: 64, kicker: 24, hero: 700, name: 128, stamp: 44, bar: 132, price: 104 },
  portrait: { pad: 52, kicker: 20, hero: 560, name: 104, stamp: 36, bar: 108, price: 84 },
  square: { pad: 44, kicker: 17, hero: 420, name: 84, stamp: 30, bar: 88, price: 68 },
};

const VERDICT: Record<PlayerPoster["outcome"], string> = {
  sold: "NOW PLAYS FOR",
  captain: "CAPTAIN OF",
  icon: "ICON PLAYER FOR",
  retained: "RETAINED BY",
  unsold: "UNSOLD",
  pool: "IN THE AUCTION",
};

export function renderBroadcastPlayer(model: PlayerPoster, options: PosterRenderOptions) {
  const ctx = contextFor(options, model.teamColor);
  const { width, height } = POSTER_SIZES[options.size];
  const L = CARD[options.size];
  const tones = tonesFor(model.teamColor, model.teamName);
  const room = width - 2 * L.pad;
  const shirtNumber =
    model.heroNumber ?? (model.lotLabel === null ? "" : model.lotLabel.replace(/\D/g, ""));
  const price = options.prices
    ? (model.priceLabel ??
      (model.outcome === "pool" && model.basePriceLabel !== null ? model.basePriceLabel : null))
    : null;
  const priceWord = model.outcome === "pool" ? "BASE" : null;
  const barLabel = model.teamName === null ? null : VERDICT[model.outcome];
  const barLine = model.teamName ?? model.outcomeLine ?? VERDICT[model.outcome];
  const nameSize = fitSize(model.name, room - L.pad, L.name, Math.round(L.name * 0.5));
  const priceRoom =
    price === null ? 0 : estimateTextWidth(price, L.price) + (priceWord === null ? 0 : L.price);
  const sub = [model.roleLine.toUpperCase(), model.lotLabel]
    .filter((part): part is string => part !== null && part !== "")
    .join("  ·  ");

  return (
    <div style={{ ...ROOT, width, height, background: shown(ctx) ? INK : "transparent" }}>
      <SplitStage
        ctx={ctx}
        tones={tones}
        width={width}
        height={height}
        split={Math.round(width * 0.56)}
        slant={Math.round(width * 0.22)}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          width,
          height,
          padding: L.pad,
        }}
      >
        <SlabHead
          ctx={ctx}
          L={{ ...SPLIT[options.size], kicker: L.kicker }}
          tones={tones}
          crest={model.teamName === null ? model.competitionLogoUrl : model.teamCrestUrl}
          monogram={monogramFor(model.teamName ?? model.competitionName)}
          text={`${model.competitionName.toUpperCase()} · AUCTION`}
          team={model.teamName !== null}
        />

        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            ...vis(ctx, "hero"),
          }}
        >
          {model.photoUrl === null ? (
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
          )}
        </div>

        {/* The lower third. */}
        <div style={{ display: "flex", flexDirection: "column", width: room }}>
          <Chip text={model.stamp} size={L.stamp} ctxStyle={vis(ctx, "stamp")} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: `${String(Math.round(L.name * 0.12))}px ${String(Math.round(L.pad * 0.5))}px`,
              background: "#FFFFFF",
              ...vis(ctx, "hero"),
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: FACE,
                fontSize: nameSize,
                lineHeight: 1.12,
                color: "#0B0B0B",
              }}
            >
              {model.name}
            </div>
            {sub === "" ? null : (
              <Spaced
                text={sub}
                size={Math.round(L.kicker * 0.85)}
                color={withAlpha("#0B0B0B", 0.6)}
              />
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: L.bar,
              padding: `0 ${String(Math.round(L.pad * 0.5))}px`,
              backgroundImage: `linear-gradient(90deg, ${tones.shade}, ${INK})`,
              borderLeft: `${String(Math.round(L.pad * 0.2))}px solid ${tones.base}`,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", ...vis(ctx, "hero") }}>
              {barLabel === null ? null : (
                <Spaced
                  text={barLabel}
                  size={Math.round(L.kicker * 0.75)}
                  color={withAlpha("#FFFFFF", 0.65)}
                  style={{ marginBottom: Math.round(L.kicker * 0.35) }}
                />
              )}
              <div
                style={{
                  display: "flex",
                  fontFamily: FACE,
                  fontSize: fitSize(
                    barLine,
                    room - priceRoom - L.pad * 1.4,
                    Math.round(L.bar * 0.36),
                    Math.round(L.bar * 0.2),
                  ),
                  lineHeight: 1.15,
                  color: "#FFFFFF",
                }}
              >
                {barLine}
              </div>
            </div>
            {price === null ? null : (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: Math.round(L.kicker * 0.5),
                  ...vis(ctx, "price"),
                }}
              >
                {priceWord === null ? null : (
                  <Spaced
                    text={priceWord}
                    size={Math.round(L.kicker * 0.8)}
                    color={withAlpha("#FFFFFF", 0.6)}
                    style={{ marginBottom: Math.round(L.price * 0.12) }}
                  />
                )}
                <PriceText label={price} size={L.price} color={GOLD} />
              </div>
            )}
          </div>
          <div style={{ display: "flex", width: room, marginTop: Math.round(L.pad * 0.5) }}>
            <Footer ctx={ctx} />
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Top buys -------------------------------------------------------------------

/** A small badge of a player: their photo, or their team's shirt. */
function BuyFace({ row, width, id }: { row: TopBuyRow; width: number; id: string }) {
  const tones = tonesFor(row.teamColor, row.teamName);
  return row.photoUrl === null ? (
    <Jersey width={width} tones={tones} name={null} number="" id={id} />
  ) : (
    <Portrait width={Math.round(width * 0.92)} tones={tones} src={row.photoUrl} />
  );
}

export function renderBroadcastTopBuys(model: TopBuysPoster, options: PosterRenderOptions) {
  const ctx = contextFor(options, null);
  const { width, height } = POSTER_SIZES[options.size];
  const L = SPLIT[options.size];
  const cols = columnsOf(width, L);
  const [first, ...rest] = model.rows;
  // The slab wears the night's biggest buyer's colour.
  const tones = tonesFor(first?.teamColor ?? NIGHT, first?.teamName ?? null);
  const words = model.title.split(" ");
  const lead = words.slice(0, 2).join(" "); // "TOP 5"
  const tail = words.slice(2).join(" "); // "BUYS"
  const listTop = L.pad + L.kicker * 3;
  const footH = ctx.metrics.footerHeight + Math.round(L.pad * 0.5);
  const listRoom = height - listTop - L.pad - footH;
  const rowHeight =
    rest.length === 0 ? 0 : Math.min(L.rowMax * 1.25, Math.floor(listRoom / rest.length));
  const heroShirt = Math.round(L.leader * 1.25);

  return (
    <div style={{ ...ROOT, width, height, background: shown(ctx) ? INK : "transparent" }}>
      <SplitStage
        ctx={ctx}
        tones={tones}
        width={width}
        height={height}
        split={cols.split}
        slant={L.slant}
      />
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          left: L.pad,
          top: L.pad,
          width: cols.leftRoom,
          height: height - 2 * L.pad - footH,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Spaced
            text={`${model.competitionName.toUpperCase()} · AUCTION`}
            size={L.kicker}
            color={withAlpha(tones.onShirt, 0.85)}
            style={vis(ctx)}
          />
          <div
            style={{
              display: "flex",
              marginTop: Math.round(L.kicker * 0.6),
              fontFamily: FACE,
              fontSize: fitSize(lead, cols.leftRoom, L.title * 1.2, L.title * 0.6),
              lineHeight: 1,
              color: tones.onShirt,
              ...vis(ctx),
            }}
          >
            {lead}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: FACE,
              fontSize: Math.round(L.title * 0.62),
              lineHeight: 1.05,
              color: tones.trim,
              ...vis(ctx),
            }}
          >
            {tail}
          </div>
        </div>

        {first === undefined ? null : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", ...vis(ctx, "hero") }}>
              <BuyFace row={first} width={heroShirt} id="top1" />
            </div>
            <Chip
              text="#1 BUY"
              size={Math.round(L.leaderName * 0.42)}
              ctxStyle={{ marginTop: Math.round(L.pad * 0.3), ...vis(ctx, "hero") }}
            />
            <div
              style={{
                display: "flex",
                marginTop: Math.round(L.leaderName * 0.2),
                fontFamily: FACE,
                fontSize: fitSize(
                  first.name,
                  cols.leftRoom,
                  L.leaderName * 1.2,
                  L.leaderName * 0.6,
                ),
                lineHeight: 1.12,
                color: tones.onShirt,
                ...vis(ctx, "hero"),
              }}
            >
              {first.name}
            </div>
            <Spaced
              text={first.teamName.toUpperCase()}
              size={Math.round(L.leaderName * 0.32)}
              color={withAlpha(tones.onShirt, 0.75)}
              style={vis(ctx, "hero")}
            />
          </div>
        )}

        <SlabFoot
          ctx={ctx}
          L={L}
          room={cols.leftRoom}
          tones={tones}
          label={first === undefined ? "" : "WENT FOR"}
          value={
            first === undefined ? null : (
              <PriceText
                label={first.priceLabel}
                size={fitSize(first.priceLabel, cols.leftRoom, L.total, L.total * 0.5)}
                color={tones.onShirt}
                style={vis(ctx, "hero")}
              />
            )
          }
        />
      </div>

      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          left: cols.rightStart,
          top: listTop,
          width: cols.rightRoom,
          height: listRoom,
        }}
      >
        {rest.map((row, index) => {
          const team = tonesFor(row.teamColor, row.teamName);
          return (
            <ListRow
              key={`${row.name}-${String(index)}`}
              ctx={ctx}
              height={rowHeight}
              room={cols.rightRoom}
              lead={row.rankLabel.replace(/^0/, "")}
              leadColor={withAlpha("#FFFFFF", 0.4)}
              name={row.name}
              sub={row.teamName.toUpperCase()}
              subDot={team.light}
              figure={row.priceLabel}
              figureColor={index === 0 ? GOLD : "#FFFFFF"}
            />
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          display: "flex",
          left: L.pad,
          bottom: L.pad,
          width: width - 2 * L.pad,
        }}
      >
        <Footer ctx={ctx} />
      </div>
    </div>
  );
}

// --- All squads -----------------------------------------------------------------

interface BandLayout {
  readonly pad: number;
  readonly kicker: number;
  readonly title: number;
  readonly gap: number;
  readonly crest: number;
}

const BAND: Record<PosterSize, BandLayout> = {
  story: { pad: 48, kicker: 20, title: 96, gap: 14, crest: 52 },
  portrait: { pad: 40, kicker: 16, title: 72, gap: 12, crest: 44 },
  square: { pad: 36, kicker: 14, title: 60, gap: 10, crest: 38 },
};

export function renderBroadcastSeason(model: SeasonPoster, options: PosterRenderOptions) {
  const ctx = contextFor(options, null);
  const { width, height } = POSTER_SIZES[options.size];
  const L = BAND[options.size];
  const tones = tonesFor(NIGHT, null);
  const room = width - 2 * L.pad;
  const prices = options.prices && model.stage === "after";
  const bandHeight = Math.round(L.pad + L.kicker * 2.6 + L.title * 1.15 + L.kicker * 1.6);
  const stripe = Math.max(8, Math.round(width * 0.012));
  const slant = Math.round(bandHeight * 0.22);
  const gridTop = bandHeight + L.gap * 2;
  const gridHeight = height - gridTop - ctx.metrics.footerHeight - L.pad * 1.6;
  const names = model.squads.flatMap((squad) =>
    squad.rows.map((row) => `${row.name} ${markOf(row) ?? ""}`),
  );
  const longest = names.reduce(
    (a, b) => (estimateTextWidth(b, 10) > estimateTextWidth(a, 10) ? b : a),
    "",
  );
  const grid = seasonGrid(model.squads.length, model.largestSquad, longest, room, gridHeight, L);
  const rows: (typeof model.squads)[] = [];
  for (let index = 0; index < model.squads.length; index += grid.columns) {
    rows.push(model.squads.slice(index, index + grid.columns));
  }
  const sub = [model.countLine, prices ? `${model.spentLabel} spent` : null]
    .filter((part): part is string => part !== null && part !== "")
    .join("  ·  ");
  const bandAngle = (Math.atan2(slant, width) * 180) / Math.PI;

  return (
    <div
      style={{
        ...ROOT,
        flexDirection: "column",
        width,
        height,
        background: shown(ctx) ? INK : "transparent",
      }}
    >
      {shown(ctx) ? (
        <div style={{ position: "absolute", display: "flex", left: 0, top: 0, width, height }}>
          <EdgeRect
            x={width / 2}
            y={bandHeight - slant / 2 + stripe}
            angle={-bandAngle}
            reach={height}
            span={width * 3}
            edge="bottom"
            fill="#FDE68A"
          />
          <EdgeRect
            x={width / 2}
            y={bandHeight - slant / 2}
            angle={-bandAngle}
            reach={height}
            span={width * 3}
            edge="bottom"
            fill={`linear-gradient(120deg, ${tones.light}, ${tones.base} 45%, ${tones.shade})`}
          />
        </div>
      ) : null}

      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          left: L.pad,
          top: L.pad,
          width: room,
        }}
      >
        <Spaced
          text={model.stage === "after" ? "THE SQUADS ARE SET" : "MEET THE TEAMS"}
          size={L.kicker}
          color={GOLD}
          style={vis(ctx)}
        />
        <div
          style={{
            display: "flex",
            marginTop: Math.round(L.kicker * 0.4),
            fontFamily: FACE,
            fontSize: fitSize(model.competitionName, room * 0.9, L.title, L.title * 0.5),
            lineHeight: 1.1,
            color: "#FFFFFF",
            ...vis(ctx),
          }}
        >
          {model.competitionName}
        </div>
        {sub === "" ? null : (
          <Spaced
            text={sub.toUpperCase()}
            size={Math.round(L.kicker * 0.85)}
            color={withAlpha("#FFFFFF", 0.8)}
            style={vis(ctx)}
          />
        )}
      </div>

      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          gap: L.gap,
          left: L.pad,
          top: gridTop,
          width: room,
        }}
      >
        {rows.map((row, r) => (
          <div key={`r${String(r)}`} style={{ display: "flex", gap: L.gap }}>
            {row.map((squad, i) => {
              const team = tonesFor(squad.teamColor, squad.teamName);
              const half = Math.ceil(squad.rows.length / 2);
              const columns = [squad.rows.slice(0, half), squad.rows.slice(half)];
              return (
                <div
                  key={`${squad.teamName}-${String(i)}`}
                  style={{
                    display: "flex",
                    width: grid.cardWidth,
                    height: grid.cardHeight,
                    background: "#12151C",
                    ...vis(ctx, "items"),
                  }}
                >
                  <div style={{ display: "flex", width: 8, background: team.base }} />
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        height: L.crest + 4,
                        justifyContent: "center",
                        padding: "0 12px",
                        borderBottom: `1px solid ${withAlpha("#FFFFFF", 0.1)}`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          fontFamily: FACE,
                          fontSize: fitSize(
                            squad.teamName,
                            grid.cardWidth - 40,
                            Math.round(L.crest * 0.5),
                            12,
                          ),
                          lineHeight: 1.15,
                          color: team.light,
                        }}
                      >
                        {squad.teamName}
                      </div>
                      <Spaced
                        text={[squad.countLabel, prices ? squad.spentLabel : null]
                          .filter((part): part is string => part !== null && part !== "")
                          .join("  ·  ")
                          .toUpperCase()}
                        size={Math.max(10, Math.round(L.crest * 0.22))}
                        color={withAlpha("#FFFFFF", 0.55)}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 10, padding: "8px 12px", flex: 1 }}>
                      {columns.map((column, c) => (
                        <div
                          key={`c${String(c)}`}
                          style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}
                        >
                          {column.map((player, p) => (
                            <div
                              key={`${player.name}-${String(p)}`}
                              style={{
                                display: "flex",
                                fontFamily: FACE,
                                fontSize: grid.nameSize,
                                lineHeight: 1.3,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                color: player.isMarked ? GOLD : "#FFFFFF",
                              }}
                            >
                              {markOf(player) === null
                                ? player.name
                                : `${player.name} ${markOf(player) ?? ""}`}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          display: "flex",
          left: L.pad,
          bottom: L.pad,
          width: room,
        }}
      >
        <Footer ctx={ctx} />
      </div>
    </div>
  );
}
