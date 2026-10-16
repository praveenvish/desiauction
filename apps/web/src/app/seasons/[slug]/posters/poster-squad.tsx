import {
  squadSpotlight,
  type SpotlightCard,
  type TeamPoster,
  type TeamPosterRow,
} from "@desiauction/core";

import { withAlpha } from "./poster-color";
import { FIGURES } from "./poster-fonts";
import {
  Footer,
  Frame,
  Header,
  Tile,
  TitleBlock,
  contextFor,
  shown,
  vis,
  type PosterContext,
  type PosterRenderOptions,
} from "./poster-kit";
import { contentWidth, sheetBody } from "./poster-layout";

/**
 * THE SQUAD, AS A POSTER RATHER THAN A SPREADSHEET (2026-10-05 redesign).
 *
 * The old sheet was every player in one grid of identical tiles: the captain,
 * the icon and the night's biggest buy looked exactly like the twelfth man,
 * and a team's colour was a thin ring. Now, top to bottom:
 *
 *   the team's colour flooding the head of the sheet, its name as the headline;
 *   a SPOTLIGHT of the players the team is known by — captain, icons, the top
 *   buy (`squadSpotlight`) — as big cards;
 *   everyone else as a numbered two-column list, priciest first;
 *   one strip of the four numbers an owner forwards it for.
 *
 * "Meet the squad" is the same sheet with the money left out. A pre-auction
 * squad (a captain and an icon) is just its spotlight. Every size, theme and
 * motion band goes through the same layout: only the arithmetic changes.
 */
export type SquadMode = "sheet" | "reveal";

/** Row height bounds; the tall story size may grow rows further (`rowMax`). */
const ROW_MAX = 64;
const ROW_MIN = 40;

export function renderSquadPoster(
  model: TeamPoster,
  options: PosterRenderOptions,
  mode: SquadMode,
) {
  const ctx = contextFor(options, model.teamColor);
  const { metrics, skin } = ctx;
  const prices = mode === "sheet" && options.prices;
  const { spotlight, rest } = squadSpotlight(model.rows, { prices });

  const width = contentWidth(metrics);
  const titleHeight = Math.round(
    metrics.kickerSize * 1.4 + metrics.titleMax * 1.25 + metrics.subSize * 1.4 + 12,
  );
  const stats = mode === "sheet" && prices;
  const body = sheetBody(metrics, stats ? [titleHeight, metrics.statHeight] : [titleHeight]);
  const inner = Math.round(metrics.gap * 0.8);
  // A third of the sheet per card under a list; a squad that IS its spotlight
  // (a captain and an icon before the night) gets cards sized to how many
  // there are, so two players are not two stamps in an empty page.
  const third = Math.floor((width - 2 * inner) / 3);
  const cardWidth =
    rest.length === 0 && spotlight.length > 0
      ? Math.min(
          Math.floor((width - (spotlight.length - 1) * inner) / spotlight.length),
          Math.round(width * 0.46),
        )
      : third;
  // The spotlight takes about half the body when there is a list under it, and
  // all of it (up to a sensible card) when the squad IS its spotlight.
  const spotHeight =
    spotlight.length === 0
      ? 0
      : rest.length === 0
        ? // Card-shaped, not stretched down the page, and centred in it.
          Math.min(body, Math.round(cardWidth * 1.3))
        : Math.max(220, Math.min(spotMax(metrics.height), Math.round(body * 0.48)));
  const listHeight = Math.max(0, body - spotHeight - (spotlight.length > 0 ? inner : 0));

  const sub = [
    model.squadLabel,
    model.captainName === null ? null : `Captain ${model.captainName}`,
    model.coachName === null ? null : `Coach ${model.coachName}`,
  ]
    .filter((part): part is string => part !== null)
    .join("  ·  ");

  return (
    <Frame ctx={ctx}>
      <TeamFlood ctx={ctx} />
      <Header
        ctx={ctx}
        competitionName={model.competitionName}
        competitionLogoUrl={model.competitionLogoUrl}
        chip={model.squadLabel}
      />
      <div
        style={{
          display: "flex",
          width: "100%",
          height: titleHeight,
          alignItems: "center",
          gap: 24,
        }}
      >
        <div style={{ display: "flex", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
          <TitleBlock
            ctx={ctx}
            kicker={mode === "sheet" ? "The squad" : "Meet the squad"}
            title={model.teamName}
            sub={sub === "" ? null : sub}
          />
        </div>
        <Tile
          ctx={ctx}
          layer="hero"
          src={model.teamCrestUrl}
          monogram={model.teamMonogram}
          team
          width={Math.round(titleHeight * 0.72)}
          height={Math.round(titleHeight * 0.72)}
          radius={Math.round(titleHeight * 0.36)}
          fontSize={Math.round(titleHeight * 0.26)}
          fit="contain"
          ring={skin.team.fill}
          ringWidth={4}
          round
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: body,
          gap: inner,
          justifyContent: rest.length === 0 ? "center" : "flex-start",
        }}
      >
        {spotlight.length === 0 ? null : (
          <Spotlight
            ctx={ctx}
            cards={spotlight}
            height={spotHeight}
            cardWidth={cardWidth}
            prices={prices}
          />
        )}
        {rest.length === 0 ? null : (
          <SquadList
            ctx={ctx}
            rows={rest}
            first={spotlight.length + 1}
            height={listHeight}
            prices={prices}
          />
        )}
      </div>
      {stats ? (
        <StatsStrip
          ctx={ctx}
          cells={[
            { label: "Players", value: String(model.rows.length), tone: skin.palette.heading },
            { label: "Spent", value: model.spentLabel, tone: skin.palette.money },
            { label: "Purse left", value: model.remainingLabel, tone: skin.palette.accent },
            ...(model.topBuyLabel === null
              ? []
              : [{ label: "Top buy", value: model.topBuyLabel, tone: skin.palette.heading }]),
          ]}
        />
      ) : null}
      <Footer ctx={ctx} />
    </Frame>
  );
}

/**
 * The four numbers an owner forwards the sheet for, in ONE panel with hairline
 * dividers. Not four glass `Stat` boxes: each of those carries a blurred
 * shadow, and four blurs cost the rasterizer ~2.3 s a poster — longer than the
 * whole rest of the sheet. One flat panel reads as one strip, too.
 */
function StatsStrip({
  ctx,
  cells,
}: {
  ctx: PosterContext;
  cells: readonly { label: string; value: string; tone: string }[];
}) {
  const { metrics, skin } = ctx;
  const { palette } = skin;
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: metrics.statHeight,
        borderRadius: metrics.chipRadius * 1.5,
        background: palette.panel,
        border: `1px solid ${palette.border}`,
        ...vis(ctx, "base"),
      }}
    >
      {cells.map((cell, index) => (
        <div
          key={cell.label}
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flexGrow: 1,
            flexBasis: 0,
            minWidth: 0,
            padding: `0 ${String(Math.round(metrics.pad / 3))}px`,
            gap: 2,
            ...(index === 0 ? {} : { borderLeft: `1px solid ${palette.border}` }),
          }}
        >
          <div
            style={{
              display: "flex",
              color: palette.muted,
              fontSize: Math.round(metrics.statLabelSize * 0.85),
              letterSpacing: 1.5,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {cell.label}
          </div>
          <div
            style={{
              display: "flex",
              color: cell.tone,
              fontFamily: FIGURES,
              fontSize: metrics.statSize,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** How tall a spotlight card may get: the story size has room for bigger faces. */
function spotMax(posterHeight: number): number {
  return posterHeight >= 1800 ? 600 : 420;
}

/** How tall a list row may get, by the same rule. */
function rowMax(posterHeight: number): number {
  return posterHeight >= 1800 ? 84 : ROW_MAX;
}

/**
 * The team's colour, flooding the head of the sheet and fading out by its
 * middle. Base band only: a motion sprite's other bands are drawn on nothing.
 */
function TeamFlood({ ctx }: { ctx: PosterContext }) {
  if (!shown(ctx)) {
    return null;
  }
  const { metrics, skin } = ctx;
  const colour = skin.team.fill;
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        left: -metrics.pad,
        top: -metrics.pad,
        width: metrics.width,
        height: metrics.height,
        backgroundImage: `radial-gradient(110% 55% at 20% 0%, ${withAlpha(colour, skin.dark ? 0.85 : 0.4)} 0%, ${withAlpha(colour, skin.dark ? 0.4 : 0.18)} 38%, ${withAlpha(colour, skin.dark ? 0.1 : 0.05)} 62%, ${withAlpha(colour, 0)} 78%)`,
      }}
    />
  );
}

/** Up to three big cards, centred. */
function Spotlight({
  ctx,
  cards,
  height,
  cardWidth,
  prices,
}: {
  ctx: PosterContext;
  cards: readonly SpotlightCard[];
  height: number;
  cardWidth: number;
  prices: boolean;
}) {
  const { metrics } = ctx;
  const gap = Math.round(metrics.gap * 0.8);
  return (
    <div style={{ display: "flex", width: "100%", height, gap, justifyContent: "center" }}>
      {cards.map((card, index) => (
        <SpotCard
          key={`${card.row.name}-${String(index)}`}
          ctx={ctx}
          card={card}
          width={cardWidth}
          height={height}
          prices={prices}
        />
      ))}
    </div>
  );
}

function SpotCard({
  ctx,
  card,
  width,
  height,
  prices,
}: {
  ctx: PosterContext;
  card: SpotlightCard;
  width: number;
  height: number;
  prices: boolean;
}) {
  const { metrics, skin } = ctx;
  const { palette } = skin;
  const { row } = card;
  const nameSize = Math.max(22, Math.min(34, Math.round(width * 0.1)));
  const metaSize = Math.max(16, Math.round(nameSize * 0.62));
  const textHeight = Math.round(nameSize * 1.45 + metaSize * 1.6 + 30);
  const portrait = Math.max(80, height - textHeight);
  const price = prices
    ? (row.priceLabel ?? (card.badge === "CAPTAIN" ? null : row.isMarked ? "Pre-signed" : null))
    : null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        height,
        borderRadius: metrics.chipRadius * 2,
        overflow: "hidden",
        background: palette.panel,
        border: `2px solid ${withAlpha(skin.team.fill, 0.55)}`,
        ...vis(ctx, "hero"),
      }}
    >
      <div style={{ display: "flex", position: "relative", width, height: portrait }}>
        <Tile
          ctx={ctx}
          layer="hero"
          src={row.photoUrl}
          monogram={row.monogram}
          width={width}
          height={portrait}
          radius={0}
          fontSize={Math.round(portrait * 0.36)}
          ring={skin.team.fill}
          ringWidth={0}
          face
        />
        {card.badge === null ? null : (
          <div
            style={{
              display: "flex",
              position: "absolute",
              top: 14,
              left: 14,
              padding: "5px 12px",
              borderRadius: 999,
              background: card.badge === "TOP BUY" ? palette.accent : palette.heading,
              color: card.badge === "TOP BUY" ? palette.onAccent : palette.surface,
              fontSize: Math.max(13, Math.round(metaSize * 0.85)),
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            {card.badge}
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          flexGrow: 1,
          padding: "10px 18px 14px",
          gap: 4,
        }}
      >
        <div
          style={{
            display: "flex",
            color: palette.heading,
            fontSize: nameSize,
            fontWeight: 700,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {row.name}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ display: "flex", color: palette.muted, fontSize: metaSize }}>
            {row.roleLine}
          </div>
          {price === null ? null : (
            <div
              style={{
                display: "flex",
                fontFamily: FIGURES,
                fontSize: Math.round(nameSize * 0.95),
                fontWeight: 700,
                color: palette.money,
              }}
            >
              {price}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Everyone not in the spotlight: two columns, numbered on from the cards,
 * priciest first. Rows shrink to fit, down to a readable floor; past that the
 * last row says how many more there are rather than dropping anyone silently.
 */
function SquadList({
  ctx,
  rows,
  first,
  height,
  prices,
}: {
  ctx: PosterContext;
  rows: readonly TeamPosterRow[];
  first: number;
  height: number;
  prices: boolean;
}) {
  const { metrics } = ctx;
  const perColumnRoom = Math.max(1, Math.floor(height / ROW_MIN));
  const capacity = perColumnRoom * 2;
  const overflow = rows.length > capacity ? rows.length - (capacity - 1) : 0;
  const drawn = overflow > 0 ? rows.slice(0, capacity - 1) : rows;
  const perColumn = Math.ceil((drawn.length + (overflow > 0 ? 1 : 0)) / 2);
  const rowHeight = Math.max(
    ROW_MIN,
    Math.min(rowMax(metrics.height), Math.floor(height / Math.max(1, perColumn))),
  );
  const left = drawn.slice(0, perColumn);
  const right = drawn.slice(perColumn);
  const gap = Math.round(metrics.gap * 1.4);
  return (
    <div style={{ display: "flex", width: "100%", height, gap }}>
      {[left, right].map((column, side) => (
        <div
          key={side}
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            flexBasis: 0,
            minWidth: 0,
          }}
        >
          {column.map((row, index) => (
            <ListRow
              key={`${row.name}-${String(index)}`}
              ctx={ctx}
              row={row}
              number={first + index + (side === 0 ? 0 : perColumn)}
              height={rowHeight}
              prices={prices}
            />
          ))}
          {side === 1 && overflow > 0 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: rowHeight,
                color: ctx.skin.palette.muted,
                fontSize: Math.round(rowHeight * 0.38),
                ...vis(ctx, "items"),
              }}
            >
              {`+ ${String(overflow)} more`}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ListRow({
  ctx,
  row,
  number,
  height,
  prices,
}: {
  ctx: PosterContext;
  row: TeamPosterRow;
  number: number;
  height: number;
  prices: boolean;
}) {
  const { skin } = ctx;
  const { palette } = skin;
  // A taller row (the story size) gets more air, not wider furniture: every
  // horizontal measure comes from the ordinary row height, so the NAME keeps
  // its room; only the row itself grows.
  const unit = Math.min(height, ROW_MAX);
  const face = unit - 16;
  const nameSize = Math.round(unit * 0.41);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height,
        gap: Math.round(unit * 0.22),
        borderBottom: `1px solid ${withAlpha(palette.border, 0.7)}`,
        ...vis(ctx, "items"),
      }}
    >
      <div
        style={{
          display: "flex",
          width: Math.round(unit * 0.44),
          color: palette.muted,
          fontSize: Math.round(unit * 0.28),
        }}
      >
        {String(number).padStart(2, "0")}
      </div>
      <Tile
        ctx={ctx}
        layer="items"
        src={row.photoUrl}
        monogram={row.monogram}
        width={face}
        height={face}
        radius={Math.round(face / 2)}
        fontSize={Math.round(face * 0.38)}
        ring={skin.team.fill}
        ringWidth={2}
        round
        face
      />
      <div
        style={{
          display: "flex",
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          color: palette.heading,
          fontSize: nameSize,
          fontWeight: 600,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {row.name}
      </div>
      {row.roleTag === "" ? null : (
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            padding: "2px 7px",
            borderRadius: 6,
            border: `1px solid ${withAlpha(palette.muted, 0.4)}`,
            color: palette.muted,
            fontSize: Math.max(12, Math.round(unit * 0.22)),
            fontWeight: 700,
            letterSpacing: 1.5,
          }}
        >
          {row.roleTag}
        </div>
      )}
      {!prices ? null : (
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            justifyContent: "flex-end",
            width: Math.round(unit * 1.85),
            fontFamily: FIGURES,
            fontSize: nameSize,
            fontWeight: 700,
            color: palette.heading,
          }}
        >
          {row.priceLabel ?? ""}
        </div>
      )}
    </div>
  );
}
