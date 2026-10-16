import {
  POSTER_SIZES,
  type PosterSize,
  type SeasonPoster,
  type TeamPosterRow,
  type TopBuyRow,
  type TopBuysPoster,
} from "@desiauction/core";
import type { CSSProperties } from "react";

import { withAlpha } from "./poster-color";
import { Footer, contextFor, shown, vis, type PosterRenderOptions } from "./poster-kit";
import { estimateTextWidth } from "./poster-layout";
import {
  Crest,
  FACE,
  GhostWord,
  Jersey,
  Kicker,
  LABEL,
  NIGHT,
  Portrait,
  Stage,
  fitSize,
  metal,
  monogramFor,
  splitPrice,
  tonesFor,
  type Tones,
} from "./poster-stadium";

/**
 * STADIUM, SEASON-WIDE — "Top buys" and "All squads" in the same family as
 * the squad posters and player cards (founder, 2026-10-08).
 *
 * Neither belongs to one team, so the stage is the night's own colour; every
 * row and card inside still wears ITS team's colours (`tonesFor`), which is
 * what makes ten franchises read as ten franchises on one image.
 */

const ROOT: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  color: "#FFFFFF",
  fontFamily: "Geist Sans, Anek Devanagari, sans-serif",
};

const STAGE_TONES: Tones = tonesFor(NIGHT, null);

// --- Top buys -------------------------------------------------------------------

interface TopLayout {
  readonly pad: number;
  readonly kicker: number;
  readonly title: number;
  readonly hero: number;
  readonly heroName: number;
  readonly heroPrice: number;
  readonly rowMax: number;
}

const TOP: Record<PosterSize, TopLayout> = {
  story: { pad: 64, kicker: 22, title: 150, hero: 360, heroName: 70, heroPrice: 132, rowMax: 176 },
  portrait: {
    pad: 52,
    kicker: 18,
    title: 116,
    hero: 220,
    heroName: 50,
    heroPrice: 92,
    rowMax: 120,
  },
  square: { pad: 44, kicker: 16, title: 92, hero: 170, heroName: 42, heroPrice: 74, rowMax: 96 },
};

function rankNumber(label: string): string {
  return label.replace(/^0/, "");
}

function Price({ label, size }: { label: string; size: number }) {
  const price = splitPrice(label);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: Math.round(size * 0.06) }}>
      {price.lead === "" ? null : (
        <div
          style={{
            display: "flex",
            fontFamily: LABEL,
            fontSize: Math.round(size * 0.45),
            marginBottom: Math.round(size * 0.1),
            ...metal(),
          }}
        >
          {price.lead}
        </div>
      )}
      <div
        style={{
          display: "flex",
          fontFamily: FACE,
          fontSize: size,
          lineHeight: 0.9,
          letterSpacing: -1,
          ...metal(),
        }}
      >
        {price.figure}
      </div>
      {price.tail === "" ? null : (
        <div
          style={{
            display: "flex",
            fontFamily: FACE,
            fontSize: Math.round(size * 0.32),
            marginBottom: Math.round(size * 0.04),
            ...metal(),
          }}
        >
          {price.tail}
        </div>
      )}
    </div>
  );
}

/** A small badge of a player: their photo, or their team's shirt. */
function Face({ row, width, id }: { row: TopBuyRow; width: number; id: string }) {
  const tones = tonesFor(row.teamColor, row.teamName);
  return row.photoUrl === null ? (
    <Jersey width={width} tones={tones} name={null} number="" id={id} />
  ) : (
    <Portrait width={Math.round(width * 0.92)} tones={tones} src={row.photoUrl} />
  );
}

export function renderStadiumTopBuys(model: TopBuysPoster, options: PosterRenderOptions) {
  const ctx = contextFor(options, null);
  const { width, height } = POSTER_SIZES[options.size];
  const L = TOP[options.size];
  const room = width - 2 * L.pad;
  const [first, ...rest] = model.rows;
  const titleWords = model.title.split(" ");
  const titleLead = titleWords.slice(0, 2).join(" "); // "TOP 5"
  const titleTail = titleWords.slice(2).join(" "); // "BUYS"

  // Height left for the ranked rows under the hero.
  const fixed =
    L.pad * 2 +
    L.kicker * 2 +
    L.title * 1.05 +
    (first === undefined ? 0 : L.hero * 1.1 + L.pad * 0.6) +
    ctx.metrics.footerHeight +
    L.pad * 1.4;
  const rowHeight =
    rest.length === 0 ? 0 : Math.min(L.rowMax, Math.floor((height - fixed) / rest.length));
  const rowFace = Math.round(rowHeight * 0.7);

  return (
    <div style={{ ...ROOT, width, height, background: shown(ctx) ? "#020406" : "transparent" }}>
      <Stage ctx={ctx} tones={STAGE_TONES} width={width} height={height} />
      <GhostWord
        ctx={ctx}
        word="TOP"
        top={Math.round(height * 0.04)}
        size={Math.round(L.title * 3)}
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
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "center", ...vis(ctx) }}
        >
          <Kicker
            text={`${model.competitionName.toUpperCase()} · AUCTION`}
            size={L.kicker}
            tones={STAGE_TONES}
          />
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: Math.round(L.title * 0.12),
              marginTop: Math.round(L.kicker * 0.6),
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: FACE,
                fontSize: L.title,
                lineHeight: 1,
                ...metal(),
              }}
            >
              {titleLead}
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: FACE,
                fontSize: Math.round(L.title * 0.62),
                lineHeight: 1.2,
                color: "#FFFFFF",
              }}
            >
              {titleTail}
            </div>
          </div>
        </div>

        {first === undefined ? null : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: Math.round(L.pad * 0.6),
              width: room,
              ...vis(ctx, "hero"),
            }}
          >
            <Face row={first} width={L.hero} id="top1" />
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignSelf: "flex-start",
                  padding: `${String(Math.round(L.kicker * 0.2))}px ${String(Math.round(L.kicker * 0.7))}px`,
                  borderRadius: 6,
                  background: "#FDE047",
                  transform: "rotate(-2deg)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    fontFamily: FACE,
                    fontSize: Math.round(L.kicker * 1.1),
                    letterSpacing: 3,
                    color: "#0B0B0B",
                  }}
                >
                  #1 BUY
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  marginTop: Math.round(L.kicker * 0.6),
                  fontFamily: FACE,
                  fontSize: fitSize(
                    first.name,
                    room - L.hero - L.pad,
                    L.heroName,
                    Math.round(L.heroName * 0.55),
                  ),
                  lineHeight: 1.1,
                  color: "#FFFFFF",
                }}
              >
                {first.name}
              </div>
              <div style={{ display: "flex", marginTop: Math.round(L.kicker * 0.5) }}>
                <Price label={first.priceLabel} size={L.heroPrice} />
              </div>
              <TeamLine row={first} size={Math.round(L.kicker * 1.3)} />
            </div>
          </div>
        )}

        {rest.length === 0 ? null : (
          <div style={{ display: "flex", flexDirection: "column", width: room, gap: 0 }}>
            {rest.map((row, index) => (
              <div
                key={`${row.name}-${String(index)}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: rowHeight,
                  gap: Math.round(rowHeight * 0.18),
                  borderTop: `1px solid ${withAlpha("#FFFFFF", 0.1)}`,
                  ...vis(ctx, "items"),
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: Math.round(rowHeight * 0.7),
                    justifyContent: "center",
                    fontFamily: FACE,
                    fontSize: Math.round(rowHeight * 0.5),
                    color: withAlpha("#FFFFFF", 0.45),
                  }}
                >
                  {rankNumber(row.rankLabel)}
                </div>
                <Face row={row} width={rowFace} id={`top${String(index + 2)}`} />
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      fontFamily: FACE,
                      fontSize: fitSize(
                        row.name,
                        room * 0.45,
                        Math.round(rowHeight * 0.3),
                        Math.round(rowHeight * 0.18),
                      ),
                      lineHeight: 1.2,
                      color: "#FFFFFF",
                    }}
                  >
                    {row.name}
                  </div>
                  <TeamLine row={row} size={Math.round(rowHeight * 0.16)} />
                </div>
                <Price label={row.priceLabel} size={Math.round(rowHeight * 0.36)} />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", width: room }}>
          <Footer ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

/** "● आशापुरा इलेवन" — the buying team, dotted in its own colour. */
function TeamLine({ row, size }: { row: TopBuyRow; size: number }) {
  const tones = tonesFor(row.teamColor, row.teamName);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: Math.round(size * 0.5),
        marginTop: Math.round(size * 0.3),
      }}
    >
      <div
        style={{
          display: "flex",
          width: Math.round(size * 0.7),
          height: Math.round(size * 0.7),
          borderRadius: size,
          background: tones.light,
          border: `2px solid ${tones.base}`,
        }}
      />
      <div
        style={{
          display: "flex",
          fontFamily: FACE,
          fontSize: size,
          lineHeight: 1.2,
          color: withAlpha("#FFFFFF", 0.8),
        }}
      >
        {row.teamName}
      </div>
    </div>
  );
}

// --- All squads -----------------------------------------------------------------

interface SeasonLayout {
  readonly pad: number;
  readonly kicker: number;
  readonly title: number;
  readonly gap: number;
  readonly crest: number;
}

const SEASON: Record<PosterSize, SeasonLayout> = {
  story: { pad: 48, kicker: 20, title: 96, gap: 14, crest: 56 },
  portrait: { pad: 40, kicker: 16, title: 72, gap: 12, crest: 46 },
  square: { pad: 36, kicker: 14, title: 60, gap: 10, crest: 40 },
};

/**
 * "कालू देवासी (c)", "मुकेश (i)" — the squad's marks, in the name itself, the
 * way a team sheet writes them. Letters, not a ★: no poster font has the
 * star, and Satori went to the network for a fallback font mid-render.
 */
function rosterName(row: TeamPosterRow): string {
  if (row.isCaptain) {
    return `${row.name} (c)`;
  }
  return row.isMarked ? `${row.name} (i)` : row.name;
}

/**
 * The card grid that draws names largest: two or three columns of team
 * cards, each card's squad in two columns of names.
 */
export function seasonGrid(
  teams: number,
  longestSquad: number,
  longestName: string,
  roomWidth: number,
  roomHeight: number,
  layout: SeasonLayout,
) {
  let best = { columns: 2, nameSize: 0, cardHeight: 0, cardWidth: 0 };
  for (const columns of [2, 3]) {
    const rows = Math.max(1, Math.ceil(teams / columns));
    const cardWidth = (roomWidth - (columns - 1) * layout.gap) / columns;
    const cardHeight = (roomHeight - (rows - 1) * layout.gap) / rows;
    const header = layout.crest + 16;
    const lines = Math.max(1, Math.ceil(longestSquad / 2));
    const byHeight = (cardHeight - header - 18) / (lines * 1.3);
    let nameSize = Math.min(26, byHeight);
    const colWidth = (cardWidth - 28) / 2;
    while (nameSize > 9 && estimateTextWidth(longestName, nameSize) > colWidth) {
      nameSize -= 0.5;
    }
    if (nameSize > best.nameSize) {
      best = {
        columns,
        nameSize: Math.floor(nameSize),
        cardHeight: Math.floor(cardHeight),
        cardWidth: Math.floor(cardWidth),
      };
    }
  }
  return best;
}

export function renderStadiumSeason(model: SeasonPoster, options: PosterRenderOptions) {
  const ctx = contextFor(options, null);
  const { width, height } = POSTER_SIZES[options.size];
  const L = SEASON[options.size];
  const room = width - 2 * L.pad;
  const prices = options.prices && model.stage === "after";
  const head = L.kicker * 2 + L.title * 1.15 + L.kicker * 1.8;
  const gridHeight = height - 2 * L.pad - head - ctx.metrics.footerHeight - L.pad * 1.2;
  const names = model.squads.flatMap((squad) => squad.rows.map(rosterName));
  const longestName = names.reduce(
    (a, b) => (estimateTextWidth(b, 10) > estimateTextWidth(a, 10) ? b : a),
    "",
  );
  const grid = seasonGrid(
    model.squads.length,
    model.largestSquad,
    longestName,
    room,
    gridHeight,
    L,
  );
  const rows: (typeof model.squads)[] = [];
  for (let index = 0; index < model.squads.length; index += grid.columns) {
    rows.push(model.squads.slice(index, index + grid.columns));
  }
  const sub = [model.countLine, prices ? `${model.spentLabel} spent` : null]
    .filter((part): part is string => part !== null && part !== "")
    .join("  ·  ");

  return (
    <div style={{ ...ROOT, width, height, background: shown(ctx) ? "#020406" : "transparent" }}>
      <Stage ctx={ctx} tones={STAGE_TONES} width={width} height={height} />
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
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "center", ...vis(ctx) }}
        >
          <Kicker
            text={model.stage === "after" ? "THE SQUADS ARE SET" : "MEET THE TEAMS"}
            size={L.kicker}
            tones={STAGE_TONES}
          />
          <div
            style={{
              display: "flex",
              marginTop: Math.round(L.kicker * 0.5),
              fontFamily: FACE,
              fontSize: fitSize(model.competitionName, room, L.title, Math.round(L.title * 0.5)),
              lineHeight: 1.1,
              color: "#FFFFFF",
            }}
          >
            {model.competitionName}
          </div>
          {sub === "" ? null : (
            <div
              style={{
                display: "flex",
                marginTop: Math.round(L.kicker * 0.3),
                fontFamily: LABEL,
                fontSize: Math.round(L.kicker * 0.9),
                letterSpacing: Math.round(L.kicker * 0.25),
                color: "#FDE047",
              }}
            >
              {sub.toUpperCase()}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: L.gap, width: room }}>
          {rows.map((row, r) => (
            <div
              key={`r${String(r)}`}
              style={{ display: "flex", justifyContent: "center", gap: L.gap }}
            >
              {row.map((squad, i) => {
                const tones = tonesFor(squad.teamColor, squad.teamName);
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
                      borderRadius: 16,
                      overflow: "hidden",
                      border: `1px solid ${withAlpha(tones.light, 0.35)}`,
                      backgroundImage: `linear-gradient(180deg, ${withAlpha(tones.base, 0.22)}, ${withAlpha("#000000", 0.35)})`,
                      ...vis(ctx, "items"),
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 12px",
                        backgroundImage: `linear-gradient(90deg, ${tones.base}, ${tones.shade})`,
                      }}
                    >
                      <Crest
                        size={L.crest}
                        tones={tones}
                        src={squad.teamCrestUrl}
                        monogram={squad.teamMonogram || monogramFor(squad.teamName)}
                        badge={options.teamBadge ?? "shield"}
                      />
                      <div
                        style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}
                      >
                        <div
                          style={{
                            display: "flex",
                            fontFamily: FACE,
                            fontSize: fitSize(
                              squad.teamName,
                              grid.cardWidth - L.crest - 40,
                              Math.round(L.crest * 0.46),
                              12,
                            ),
                            lineHeight: 1.15,
                            color: tones.onShirt,
                          }}
                        >
                          {squad.teamName}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            fontFamily: LABEL,
                            fontSize: Math.max(10, Math.round(L.crest * 0.24)),
                            letterSpacing: 1,
                            color: withAlpha(tones.onShirt, 0.8),
                          }}
                        >
                          {[squad.countLabel, prices ? squad.spentLabel : null]
                            .filter((part): part is string => part !== null && part !== "")
                            .join("  ·  ")
                            .toUpperCase()}
                        </div>
                      </div>
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
                                color: player.isCaptain || player.isMarked ? "#FDE047" : "#FFFFFF",
                              }}
                            >
                              {rosterName(player)}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", width: room }}>
          <Footer ctx={ctx} />
        </div>
      </div>
    </div>
  );
}
