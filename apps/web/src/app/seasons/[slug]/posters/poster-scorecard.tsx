import {
  POSTER_SIZES,
  type PlayerPoster,
  type PosterSize,
  type SeasonPoster,
  type TeamPoster,
  type TopBuysPoster,
} from "@desiauction/core";
import type { CSSProperties, ReactNode } from "react";

import { GOLD, PriceText, ROOT, Spaced, markOf, topBuyOf } from "./poster-broadcast";
import { withAlpha } from "./poster-color";
import {
  Footer,
  PosterShield,
  contextFor,
  drawsShield,
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
  tonesFor,
  type Tones,
} from "./poster-stadium";
import { seasonGrid } from "./poster-stadium-season";

/**
 * SCORECARD — the poster as a printed team sheet (founder, 2026-10-08): the
 * team's colour as a header band, then a clean table — number, player, role,
 * what they went for — and a strip of totals underneath. The theme for the
 * club that wants the facts, legible at a glance in a WhatsApp group.
 */

const PAPER = "#0F1214";
const LINE = withAlpha("#FFFFFF", 0.08);

interface SheetLayout {
  readonly pad: number;
  readonly band: number;
  readonly kicker: number;
  readonly title: number;
  readonly head: number;
  readonly rowMax: number;
  readonly tile: number;
}

const SHEET: Record<PosterSize, SheetLayout> = {
  story: { pad: 60, band: 400, kicker: 22, title: 120, head: 20, rowMax: 84, tile: 150 },
  portrait: { pad: 56, band: 300, kicker: 20, title: 96, head: 17, rowMax: 62, tile: 112 },
  square: { pad: 44, band: 230, kicker: 16, title: 76, head: 14, rowMax: 48, tile: 92 },
};

/** The coloured band: kicker, title, and a tilted tile with the crest. */
function Band({
  ctx,
  L,
  width,
  tones,
  kicker,
  title,
  crest,
  monogram,
  sub,
  titleLayer = "base",
  team = false,
}: {
  ctx: PosterContext;
  L: SheetLayout;
  width: number;
  tones: Tones;
  kicker: string;
  title: string;
  crest: string | null;
  monogram: string;
  sub?: string;
  titleLayer?: "base" | "stamp";
  /** A team's band: with no logo it wears the season's shield (0111). */
  team?: boolean;
}) {
  const tile = Math.round(L.band * 0.56);
  const room = width - 2 * L.pad - tile - L.pad * 0.5;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width,
        height: L.band,
        padding: `0 ${String(L.pad)}px`,
      }}
    >
      {shown(ctx) ? (
        <div
          style={{
            position: "absolute",
            display: "flex",
            left: 0,
            top: 0,
            width,
            height: L.band,
            backgroundImage: `linear-gradient(115deg, ${tones.base} 0%, ${tones.shade} 100%)`,
          }}
        />
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", width: room }}>
        <Spaced
          text={kicker}
          size={L.kicker}
          color={withAlpha(tones.onShirt, 0.8)}
          style={vis(ctx)}
        />
        <div
          style={{
            display: "flex",
            marginTop: Math.round(L.kicker * 0.9),
            fontFamily: FACE,
            fontSize: fitSize(title, room, L.title, Math.round(L.title * 0.45)),
            lineHeight: 1.2,
            color: tones.onShirt,
            ...vis(ctx, titleLayer),
          }}
        >
          {title}
        </div>
        {sub === undefined || sub === "" ? null : (
          <Spaced
            text={sub}
            size={Math.round(L.kicker * 0.85)}
            color={withAlpha(tones.onShirt, 0.8)}
            style={vis(ctx)}
          />
        )}
      </div>
      {team && crest === null && drawsShield(ctx.options) ? (
        <PosterShield
          size={tile}
          color={tones.base}
          initials={monogram}
          fontFamily={FACE}
          style={vis(ctx)}
        />
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: tile,
            height: tile,
            borderRadius: Math.round(tile * 0.14),
            background: withAlpha("#FFFFFF", 0.14),
            border: `3px solid ${withAlpha("#FFFFFF", 0.35)}`,
            transform: "rotate(4deg)",
            ...vis(ctx),
          }}
        >
          {crest === null ? (
            <div
              style={{
                display: "flex",
                fontFamily: FACE,
                fontSize: Math.round(tile * 0.4),
                color: tones.onShirt,
              }}
            >
              {monogram}
            </div>
          ) : (
            <Crest size={Math.round(tile * 0.78)} tones={tones} src={crest} monogram={monogram} />
          )}
        </div>
      )}
    </div>
  );
}

/** One cell of the totals strip. */
function Tile({
  ctx,
  L,
  label,
  children,
  fill,
  layer = "base",
}: {
  ctx: PosterContext;
  L: SheetLayout;
  label: string;
  children: ReactNode;
  fill: string;
  layer?: "base" | "hero" | "items";
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        flex: 1,
        minWidth: 0,
        height: L.tile,
        padding: `0 ${String(Math.round(L.tile * 0.18))}px`,
        borderRadius: Math.round(L.tile * 0.12),
        background: fill,
        ...vis(ctx, layer),
      }}
    >
      <Spaced text={label} size={Math.round(L.head * 0.85)} color={withAlpha("#FFFFFF", 0.7)} />
      {children}
    </div>
  );
}

function TileText({ text, size, color }: { text: string; size: number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        fontFamily: FACE,
        fontSize: size,
        lineHeight: 1.15,
        whiteSpace: "nowrap",
        color,
      }}
    >
      {text}
    </div>
  );
}

const CELL: CSSProperties = { display: "flex", alignItems: "center" };

// --- The squad ------------------------------------------------------------------

export function renderScorecardSquad(
  model: TeamPoster,
  options: PosterRenderOptions,
  mode: "sheet" | "reveal",
) {
  const ctx = contextFor(options, model.teamColor);
  const { width, height } = POSTER_SIZES[options.size];
  const L = SHEET[options.size];
  const tones = tonesFor(model.teamColor, model.teamName);
  const room = width - 2 * L.pad;
  const prices = mode === "sheet" && options.prices;
  // Captain, then the pre-signed, then everyone in the order they were bought.
  const rows = [
    ...model.rows.filter((row) => row.isCaptain),
    ...model.rows.filter((row) => !row.isCaptain && row.isMarked),
    ...model.rows.filter((row) => !row.isMarked),
  ];
  const top = prices ? topBuyOf(rows) : null;
  const captain = rows.find((row) => row.isCaptain) ?? null;

  const headH = Math.round(L.head * 2.6);
  const footer = ctx.metrics.footerHeight;
  const tableRoom = height - L.band - headH - L.tile - footer - L.pad * 2.4;
  const rowHeight = rows.length === 0 ? 0 : Math.min(L.rowMax, Math.floor(tableRoom / rows.length));
  const numberW = Math.round(L.head * 4);
  const roleW = Math.round(L.head * 6);
  const priceW = prices ? Math.round(room * 0.3) : 0;
  const nameRoom = room - numberW - roleW - priceW;
  const nameMax = Math.round(rowHeight * 0.52);
  const longest = rows
    .map((row) => `${row.name} ${markOf(row) ?? ""}`)
    .reduce((a, b) => (estimateTextWidth(b, 10) > estimateTextWidth(a, 10) ? b : a), "");
  const nameSize = fitSize(longest, nameRoom - 12, nameMax, Math.round(rowHeight * 0.3));
  const cellSize = Math.round(rowHeight * 0.44);

  return (
    <div
      style={{
        ...ROOT,
        flexDirection: "column",
        width,
        height,
        background: shown(ctx) ? PAPER : "transparent",
      }}
    >
      <Band
        ctx={ctx}
        L={L}
        width={width}
        tones={tones}
        kicker={`${mode === "sheet" ? "TEAM SHEET" : "MEET THE SQUAD"} · ${model.competitionName.toUpperCase()}`}
        title={model.teamName}
        crest={model.teamCrestUrl}
        monogram={model.teamMonogram || monogramFor(model.teamName)}
        team
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: `${String(Math.round(L.pad * 0.4))}px ${String(L.pad)}px ${String(L.pad)}px`,
        }}
      >
        {/* The column heads. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: headH,
            borderBottom: `2px solid ${withAlpha("#FFFFFF", 0.14)}`,
            ...vis(ctx),
          }}
        >
          <Spaced
            text="NO."
            size={L.head}
            color={withAlpha("#FFFFFF", 0.5)}
            style={{ width: numberW }}
          />
          <Spaced
            text="PLAYER"
            size={L.head}
            color={withAlpha("#FFFFFF", 0.5)}
            style={{ width: nameRoom }}
          />
          <Spaced
            text="ROLE"
            size={L.head}
            color={withAlpha("#FFFFFF", 0.5)}
            style={{ width: roleW }}
          />
          {prices ? (
            <Spaced
              text="BOUGHT FOR"
              size={L.head}
              color={withAlpha("#FFFFFF", 0.5)}
              style={{ width: priceW, justifyContent: "flex-end" }}
            />
          ) : null}
        </div>

        {/* The rows. */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          {rows.map((row, index) => {
            const mark = markOf(row);
            return (
              <div
                key={`${row.name}-${String(index)}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: rowHeight,
                  borderBottom: `1px solid ${LINE}`,
                  background: index % 2 === 1 ? withAlpha("#FFFFFF", 0.025) : "transparent",
                  ...vis(ctx, "items"),
                }}
              >
                <div
                  style={{
                    ...CELL,
                    width: numberW,
                    fontFamily: FACE,
                    fontSize: cellSize,
                    color: tones.light,
                  }}
                >
                  {row.shirtNumber ?? String(index + 1)}
                </div>
                <div style={{ ...CELL, width: nameRoom, gap: Math.round(nameSize * 0.3) }}>
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
                    {row.name}
                  </div>
                  {mark === null ? null : (
                    <div
                      style={{
                        display: "flex",
                        fontFamily: LABEL,
                        fontSize: Math.round(nameSize * 0.62),
                        color:
                          row.isCaptain || row.badges.includes("ICON")
                            ? GOLD
                            : withAlpha("#FFFFFF", 0.6),
                      }}
                    >
                      {mark}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    ...CELL,
                    width: roleW,
                    fontFamily: LABEL,
                    fontSize: Math.round(cellSize * 0.85),
                    letterSpacing: 1,
                    color: withAlpha("#FFFFFF", 0.6),
                  }}
                >
                  {row.roleTag}
                </div>
                {prices ? (
                  <div style={{ ...CELL, width: priceW, justifyContent: "flex-end" }}>
                    {row.priceLabel === null ? (
                      <Spaced
                        text={row.isMarked ? "PRE-SIGNED" : "—"}
                        size={Math.round(cellSize * 0.8)}
                        color={row.isMarked ? GOLD : withAlpha("#FFFFFF", 0.4)}
                      />
                    ) : (
                      <PriceText
                        label={row.priceLabel}
                        size={cellSize}
                        color={row === top ? GOLD : "#FFFFFF"}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* The totals. */}
        <div
          style={{
            display: "flex",
            gap: Math.round(L.pad * 0.3),
            marginTop: Math.round(L.pad * 0.4),
          }}
        >
          <Tile ctx={ctx} L={L} label="SQUAD" fill={withAlpha("#FFFFFF", 0.06)}>
            <TileText
              text={String(model.rows.length)}
              size={Math.round(L.tile * 0.4)}
              color="#FFFFFF"
            />
          </Tile>
          {prices && model.spentLabel !== "" ? (
            <Tile ctx={ctx} L={L} label="TOTAL SPENT" fill={tones.base}>
              <PriceText
                label={model.spentLabel}
                size={Math.round(L.tile * 0.4)}
                color={tones.onShirt}
              />
            </Tile>
          ) : captain === null ? null : (
            <Tile ctx={ctx} L={L} label="CAPTAIN" fill={tones.base}>
              <TileText
                text={captain.name}
                size={fitSize(captain.name, room * 0.36, L.tile * 0.34, L.tile * 0.2)}
                color={tones.onShirt}
              />
            </Tile>
          )}
          {top !== null ? (
            <Tile ctx={ctx} L={L} label="TOP BUY" fill={withAlpha("#FFFFFF", 0.06)}>
              <TileText
                text={top.name}
                size={fitSize(top.name, room * 0.34, L.tile * 0.34, L.tile * 0.2)}
                color={GOLD}
              />
            </Tile>
          ) : model.coachName === null ? null : (
            <Tile ctx={ctx} L={L} label="COACH" fill={withAlpha("#FFFFFF", 0.06)}>
              <TileText
                text={model.coachName}
                size={fitSize(model.coachName, room * 0.34, L.tile * 0.34, L.tile * 0.2)}
                color="#FFFFFF"
              />
            </Tile>
          )}
        </div>

        <div style={{ display: "flex", width: room, marginTop: Math.round(L.pad * 0.4) }}>
          <Footer ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

// --- The player card ------------------------------------------------------------

interface EntryLayout {
  readonly hero: number;
  readonly name: number;
  readonly line: number;
  readonly price: number;
  readonly vertical: boolean;
}

const ENTRY: Record<PosterSize, EntryLayout> = {
  story: { hero: 560, name: 104, line: 40, price: 150, vertical: true },
  portrait: { hero: 380, name: 76, line: 32, price: 120, vertical: false },
  square: { hero: 300, name: 60, line: 26, price: 92, vertical: false },
};

export function renderScorecardPlayer(model: PlayerPoster, options: PosterRenderOptions) {
  const ctx = contextFor(options, model.teamColor);
  const { width, height } = POSTER_SIZES[options.size];
  const L = SHEET[options.size];
  const E = ENTRY[options.size];
  const tones = tonesFor(model.teamColor, model.teamName);
  const room = width - 2 * L.pad;
  const shirtNumber =
    model.heroNumber ?? (model.lotLabel === null ? "" : model.lotLabel.replace(/\D/g, ""));
  const factsRoom = E.vertical ? room : room - E.hero - L.pad * 0.6;
  const facts: [string, string][] = [
    ["ROLE", model.roleLine],
    ...(model.teamName === null ? [] : ([["TEAM", model.teamName]] as [string, string][])),
    ...(model.lotLabel === null ? [] : ([["LOT", model.lotLabel]] as [string, string][])),
    ...(model.numberLabel === null ? [] : ([["NO.", model.numberLabel]] as [string, string][])),
  ];
  const price = options.prices ? model.priceLabel : null;
  const base = options.prices && model.outcome === "pool" ? model.basePriceLabel : null;
  const tileLabel =
    price !== null ? "BOUGHT FOR" : base !== null ? "BASE PRICE" : model.outcome.toUpperCase();
  const tileFill = price !== null ? tones.base : withAlpha("#FFFFFF", 0.06);
  const tileText =
    price ??
    base ??
    model.outcomeLine ??
    (model.outcome === "unsold" ? "Back in the pool" : "Pre-signed");

  const hero = (
    <div style={{ display: "flex", justifyContent: "center", ...vis(ctx, "hero") }}>
      {model.photoUrl === null ? (
        <Jersey
          width={E.hero}
          tones={tones}
          name={model.firstName ?? model.lastName}
          number={shirtNumber}
          id="hero"
        />
      ) : (
        <Portrait width={Math.round(E.hero * 0.9)} tones={tones} src={model.photoUrl} />
      )}
    </div>
  );

  const entry = (
    <div style={{ display: "flex", flexDirection: "column", width: factsRoom }}>
      <div
        style={{
          display: "flex",
          fontFamily: FACE,
          fontSize: fitSize(model.name, factsRoom, E.name, Math.round(E.name * 0.5)),
          lineHeight: 1.12,
          color: "#FFFFFF",
          ...vis(ctx, "hero"),
        }}
      >
        {model.name}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: Math.round(E.line * 0.5),
          borderTop: `2px solid ${withAlpha("#FFFFFF", 0.14)}`,
        }}
      >
        {facts.map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: Math.round(E.line * 2),
              borderBottom: `1px solid ${LINE}`,
              ...vis(ctx, "hero"),
            }}
          >
            <Spaced
              text={label}
              size={Math.round(E.line * 0.55)}
              color={withAlpha("#FFFFFF", 0.5)}
            />
            <div
              style={{
                display: "flex",
                fontFamily: FACE,
                fontSize: fitSize(value, factsRoom * 0.7, E.line, E.line * 0.6),
                color: label === "TEAM" ? tones.light : "#FFFFFF",
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      style={{
        ...ROOT,
        flexDirection: "column",
        width,
        height,
        background: shown(ctx) ? PAPER : "transparent",
      }}
    >
      <Band
        ctx={ctx}
        L={L}
        width={width}
        tones={tones}
        kicker={`${model.competitionName.toUpperCase()} · AUCTION`}
        title={model.stamp}
        titleLayer="stamp"
        crest={model.teamCrestUrl}
        monogram={monogramFor(model.teamName ?? model.competitionName)}
        team={model.teamName !== null}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 1,
          padding: L.pad,
        }}
      >
        {E.vertical ? (
          <div style={{ display: "flex", flexDirection: "column", gap: Math.round(L.pad * 0.5) }}>
            {hero}
            {entry}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: Math.round(L.pad * 0.6) }}>
            {hero}
            {entry}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", width: room }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: Math.round(E.price * 1.5),
              padding: `0 ${String(Math.round(L.pad * 0.6))}px`,
              borderRadius: Math.round(L.tile * 0.12),
              background: tileFill,
              ...vis(ctx, "price"),
            }}
          >
            <Spaced
              text={tileLabel}
              size={Math.round(L.kicker * 0.9)}
              color={withAlpha(price !== null ? tones.onShirt : "#FFFFFF", 0.75)}
            />
            {price !== null || base !== null ? (
              <PriceText
                label={tileText}
                size={E.price}
                color={price !== null ? tones.onShirt : GOLD}
              />
            ) : (
              <TileText
                text={tileText}
                size={fitSize(tileText, room * 0.6, E.price * 0.5, E.price * 0.3)}
                color={GOLD}
              />
            )}
          </div>
          <div style={{ display: "flex", width: room, marginTop: Math.round(L.pad * 0.4) }}>
            <Footer ctx={ctx} />
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Top buys -------------------------------------------------------------------

export function renderScorecardTopBuys(model: TopBuysPoster, options: PosterRenderOptions) {
  const ctx = contextFor(options, null);
  const { width, height } = POSTER_SIZES[options.size];
  const L = SHEET[options.size];
  const tones = tonesFor(NIGHT, null);
  const room = width - 2 * L.pad;
  const headH = Math.round(L.head * 2.6);
  const footer = ctx.metrics.footerHeight;
  const tableRoom = height - L.band - headH - footer - L.pad * 2.2;
  const count = model.rows.length;
  // The first row is a row and a half: the night's headline.
  const unit = count === 0 ? 0 : Math.floor(tableRoom / (count + 0.6));
  const rowHeight = Math.min(L.rowMax * 1.6, unit);
  const firstHeight = Math.round(rowHeight * 1.6);
  const rankW = Math.round(L.head * 4.5);
  const priceW = Math.round(room * 0.3);
  const nameRoom = room - rankW - priceW;

  return (
    <div
      style={{
        ...ROOT,
        flexDirection: "column",
        width,
        height,
        background: shown(ctx) ? PAPER : "transparent",
      }}
    >
      <Band
        ctx={ctx}
        L={L}
        width={width}
        tones={tones}
        kicker={`${model.competitionName.toUpperCase()} · AUCTION`}
        title={model.title}
        crest={model.competitionLogoUrl}
        monogram={monogramFor(model.competitionName)}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: `${String(Math.round(L.pad * 0.4))}px ${String(L.pad)}px ${String(L.pad)}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: headH,
            borderBottom: `2px solid ${withAlpha("#FFFFFF", 0.14)}`,
            ...vis(ctx),
          }}
        >
          <Spaced
            text="#"
            size={L.head}
            color={withAlpha("#FFFFFF", 0.5)}
            style={{ width: rankW }}
          />
          <Spaced
            text="PLAYER"
            size={L.head}
            color={withAlpha("#FFFFFF", 0.5)}
            style={{ width: nameRoom }}
          />
          <Spaced
            text="WENT FOR"
            size={L.head}
            color={withAlpha("#FFFFFF", 0.5)}
            style={{ width: priceW, justifyContent: "flex-end" }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          {model.rows.map((row, index) => {
            const first = index === 0;
            const h = first ? firstHeight : rowHeight;
            const team = tonesFor(row.teamColor, row.teamName);
            const nameSize = fitSize(
              row.name,
              nameRoom - 16,
              Math.round(h * 0.4),
              Math.round(h * 0.22),
            );
            const teamSize = Math.max(12, Math.round(h * 0.21));
            return (
              <div
                key={`${row.name}-${String(index)}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: h,
                  borderBottom: `1px solid ${LINE}`,
                  borderLeft: first ? `6px solid ${GOLD}` : "6px solid transparent",
                  background: first ? withAlpha(GOLD, 0.08) : "transparent",
                  ...vis(ctx, first ? "hero" : "items"),
                }}
              >
                <div
                  style={{
                    ...CELL,
                    width: rankW - 6,
                    paddingLeft: 10,
                    fontFamily: FACE,
                    fontSize: Math.round(h * 0.42),
                    color: first ? GOLD : withAlpha("#FFFFFF", 0.4),
                  }}
                >
                  {String(row.rank)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", width: nameRoom }}>
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
                    {row.name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: Math.round(teamSize * 0.5),
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        width: Math.round(teamSize * 0.75),
                        height: Math.round(teamSize * 0.75),
                        borderRadius: teamSize,
                        background: team.light,
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        fontFamily: FACE,
                        fontSize: teamSize,
                        color: withAlpha("#FFFFFF", 0.65),
                      }}
                    >
                      {row.teamName}
                    </div>
                  </div>
                </div>
                <div style={{ ...CELL, width: priceW, justifyContent: "flex-end" }}>
                  <PriceText
                    label={row.priceLabel}
                    size={Math.round(h * (first ? 0.42 : 0.36))}
                    color={first ? GOLD : "#FFFFFF"}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", width: room, marginTop: Math.round(L.pad * 0.4) }}>
          <Footer ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

// --- All squads -----------------------------------------------------------------

const GRID: Record<
  PosterSize,
  { pad: number; kicker: number; title: number; gap: number; crest: number }
> = {
  story: { pad: 48, kicker: 20, title: 96, gap: 14, crest: 52 },
  portrait: { pad: 40, kicker: 16, title: 72, gap: 12, crest: 44 },
  square: { pad: 36, kicker: 14, title: 60, gap: 10, crest: 38 },
};

export function renderScorecardSeason(model: SeasonPoster, options: PosterRenderOptions) {
  const ctx = contextFor(options, null);
  const { width, height } = POSTER_SIZES[options.size];
  const L = SHEET[options.size];
  const G = GRID[options.size];
  const tones = tonesFor(NIGHT, null);
  const room = width - 2 * G.pad;
  const prices = options.prices && model.stage === "after";
  const band = Math.round(L.band * 0.85);
  const gridTop = band + G.gap * 2;
  const gridHeight = height - gridTop - ctx.metrics.footerHeight - G.pad * 1.6;
  const names = model.squads.flatMap((squad) =>
    squad.rows.map((row, index) => `${String(index + 1)}  ${row.name} ${markOf(row) ?? ""}`),
  );
  const longest = names.reduce(
    (a, b) => (estimateTextWidth(b, 10) > estimateTextWidth(a, 10) ? b : a),
    "",
  );
  const grid = seasonGrid(model.squads.length, model.largestSquad, longest, room, gridHeight, G);
  const rows: (typeof model.squads)[] = [];
  for (let index = 0; index < model.squads.length; index += grid.columns) {
    rows.push(model.squads.slice(index, index + grid.columns));
  }
  const sub = [model.countLine, prices ? `${model.spentLabel} spent` : null]
    .filter((part): part is string => part !== null && part !== "")
    .join("  ·  ")
    .toUpperCase();

  return (
    <div
      style={{
        ...ROOT,
        flexDirection: "column",
        width,
        height,
        background: shown(ctx) ? PAPER : "transparent",
      }}
    >
      <Band
        ctx={ctx}
        L={{ ...L, band, title: G.title }}
        width={width}
        tones={tones}
        kicker={model.stage === "after" ? "ALL SQUADS" : "THE TEAMS"}
        sub={sub}
        title={model.competitionName}
        crest={model.competitionLogoUrl}
        monogram={monogramFor(model.competitionName)}
      />
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          gap: G.gap,
          left: G.pad,
          top: gridTop,
          width: room,
        }}
      >
        {rows.map((row, r) => (
          <div key={`r${String(r)}`} style={{ display: "flex", gap: G.gap }}>
            {row.map((squad, i) => {
              const team = tonesFor(squad.teamColor, squad.teamName);
              const half = Math.ceil(squad.rows.length / 2);
              const columns = [squad.rows.slice(0, half), squad.rows.slice(half)];
              return (
                <div
                  key={`${squad.teamName}-${String(i)}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    width: grid.cardWidth,
                    height: grid.cardHeight,
                    borderRadius: 10,
                    overflow: "hidden",
                    background: withAlpha("#FFFFFF", 0.04),
                    border: `1px solid ${LINE}`,
                    ...vis(ctx, "items"),
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      height: G.crest + 8,
                      padding: "0 12px",
                      background: team.base,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        fontFamily: FACE,
                        fontSize: fitSize(
                          squad.teamName,
                          grid.cardWidth - 28,
                          Math.round(G.crest * 0.46),
                          12,
                        ),
                        lineHeight: 1.15,
                        color: team.onShirt,
                      }}
                    >
                      {squad.teamName}
                    </div>
                    <Spaced
                      text={[squad.countLabel, prices ? squad.spentLabel : null]
                        .filter((part): part is string => part !== null && part !== "")
                        .join(" · ")
                        .toUpperCase()}
                      size={Math.max(10, Math.round(G.crest * 0.2))}
                      color={withAlpha(team.onShirt, 0.8)}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 10, padding: "8px 12px", flex: 1 }}>
                    {columns.map((column, c) => (
                      <div
                        key={`c${String(c)}`}
                        style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}
                      >
                        {column.map((player, p) => {
                          const mark = markOf(player);
                          return (
                            <div
                              key={`${player.name}-${String(p)}`}
                              style={{
                                display: "flex",
                                fontSize: grid.nameSize,
                                lineHeight: 1.3,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                gap: Math.round(grid.nameSize * 0.4),
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  fontFamily: LABEL,
                                  width: Math.round(grid.nameSize * 1.3),
                                  color: team.light,
                                }}
                              >
                                {String(c * half + p + 1)}
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  fontFamily: FACE,
                                  color: player.isMarked ? GOLD : "#FFFFFF",
                                }}
                              >
                                {mark === null ? player.name : `${player.name} ${mark}`}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div
        style={{ position: "absolute", display: "flex", left: G.pad, bottom: G.pad, width: room }}
      >
        <Footer ctx={ctx} />
      </div>
    </div>
  );
}
