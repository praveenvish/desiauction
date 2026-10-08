import type {
  PlayerPoster,
  PosterKind,
  SeasonPoster,
  TeamPoster,
  TeamPosterRow,
  TopBuysPoster,
} from "@desiauction/core";
import type { ReactElement } from "react";

import { mix, withAlpha } from "./poster-color";
import { renderPlayerPoster as renderV3PlayerPoster } from "./poster-player";
import { renderSquadPoster } from "./poster-squad";
import { renderStadiumPlayer, renderStadiumSquad } from "./poster-stadium";
import { renderStadiumSeason, renderStadiumTopBuys } from "./poster-stadium-season";
import { FIGURES } from "./poster-fonts";
import { withoutHiddenEffects } from "./poster-strip";
import {
  Footer,
  Frame,
  Header,
  MOTION_BANDS,
  TeamChip,
  TitleBlock,
  Tile,
  contextFor,
  ringFor,
  shown,
  vis,
  type PosterContext,
  type PosterRenderOptions,
} from "./poster-kit";
import {
  contentWidth,
  fitHeadline,
  fitName,
  fitRankRows,
  fitSeasonGrid,
  metricsFor,
  seasonFaceNameSize,
  sheetBody,
} from "./poster-layout";

/**
 * THE POSTERS.
 *
 * Five kinds — a player's verdict, a squad sheet, a squad reveal, the night's
 * top buys and the whole season — drawn from the kit in `poster-kit.tsx` so
 * they stay one family. Every one of them carries the season's identity in the
 * header, the DesiAuction lockup in the footer, and the team's colour wherever
 * a poster has one team to belong to.
 *
 * Nothing here decides WHAT may be shown. Consent, age, money sight and the
 * tier all belong to `server/competition/posters.ts`; by the time a model
 * reaches this file every such question has been answered.
 */

// --- Player -----------------------------------------------------------------

/**
 * The player card: Stadium draws its own (`poster-stadium.tsx`); every other
 * theme is the v3 card in `poster-player.tsx`. The route and the studio keep
 * importing it from here, beside the other four kinds.
 */
export function renderPlayerPoster(model: PlayerPoster, options: PosterRenderOptions) {
  return options.theme === "stadium"
    ? renderStadiumPlayer(model, options)
    : renderV3PlayerPoster(model, options);
}

// --- The squad's faces ------------------------------------------------------

/** "C", "ICON", "RET" — worn on the corner of a face, not hidden in a column. */
function Badges({ ctx, row, size }: { ctx: PosterContext; row: TeamPosterRow; size: number }) {
  const { skin } = ctx;
  if (row.badges.length === 0) {
    return null;
  }
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        top: Math.round(size * 0.3),
        left: Math.round(size * 0.3),
        gap: Math.round(size * 0.25),
      }}
    >
      {row.badges.map((badge) => (
        <div
          key={badge}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: Math.round(size * 1.6),
            minWidth: Math.round(size * 1.6),
            padding: `0 ${String(Math.round(size * 0.45))}px`,
            borderRadius: 999,
            background: skin.palette.accent,
            color: skin.palette.onAccent,
            fontSize: size,
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
        >
          {badge}
        </div>
      ))}
    </div>
  );
}

/**
 * THE SQUAD SHEET and MEET THE SQUAD — one layout (`poster-squad.tsx`), with
 * and without the money.
 */
export function renderTeamPoster(model: TeamPoster, options: PosterRenderOptions) {
  return options.theme === "stadium"
    ? renderStadiumSquad(model, options, "sheet")
    : renderSquadPoster(model, options, "sheet");
}

export function renderRevealPoster(model: TeamPoster, options: PosterRenderOptions) {
  return options.theme === "stadium"
    ? renderStadiumSquad(model, options, "reveal")
    : renderSquadPoster(model, options, "reveal");
}

// --- Top buys ---------------------------------------------------------------

/**
 * THE NIGHT'S BIGGEST SIGNINGS, RANKED.
 *
 * Organizer-only upstream, and for the obvious reason: every row is another
 * franchise's business. The rank is the loud thing, the price the second —
 * this is the poster that gets forwarded into the groups where next season's
 * organizers are reading.
 */
export function renderTopBuysPoster(model: TopBuysPoster, options: PosterRenderOptions) {
  if (options.theme === "stadium") {
    return renderStadiumTopBuys(model, options);
  }
  const ctx = contextFor(options, null);
  const { metrics, skin } = ctx;
  const { palette } = skin;
  const titleBand = Math.round(metrics.titleMax * 1.1 + metrics.kickerSize * 1.6);
  const band = sheetBody(metrics, [titleBand]);
  const fit = fitRankRows(model.rows.length, band, metrics);
  const inset = Math.round(fit.rowHeight * 0.1);
  return (
    <Frame ctx={ctx}>
      <Header
        ctx={ctx}
        competitionName={model.competitionName}
        competitionLogoUrl={model.competitionLogoUrl}
        chip={model.chip}
      />
      <div style={{ display: "flex", width: "100%", height: titleBand, alignItems: "center" }}>
        <TitleBlock
          ctx={ctx}
          kicker="Auction night"
          title={model.title}
          sub="The biggest signings, in order"
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: band,
          justifyContent: "center",
          gap: fit.gap,
        }}
      >
        {model.rows.map((row) => {
          const lead = row.rank === 1;
          const rankWidth = Math.round(fit.rankSize * 1.3);
          // The price claims what its own figures need (capped at 30% of the
          // row), and the name gets exactly the rest: two paddings and three
          // gaps of 1.6 insets each. The old sum under-counted both, so on a
          // story the price slid over the team line.
          const priceRoom = Math.min(
            Math.round(contentWidth(metrics) * 0.3),
            Math.round(row.priceLabel.length * fit.priceMax * 0.6),
          );
          const nameRoom =
            contentWidth(metrics) - rankWidth - fit.photo - priceRoom - Math.round(8 * inset);
          const name = fitName(row.name, row.shortName, nameRoom, fit.nameSize, 18);
          return (
            <div
              key={`${row.rankLabel}-${row.name}`}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                height: fit.rowHeight,
                padding: `0 ${String(Math.round(inset * 1.6))}px`,
                gap: Math.round(inset * 1.6),
                borderRadius: metrics.chipRadius,
                background: shown(ctx, "items")
                  ? lead
                    ? mix(palette.panel, palette.accent, 0.16)
                    : palette.panel
                  : "transparent",
                border: `${String(skin.rule)}px solid ${
                  shown(ctx, "items") ? (lead ? palette.accent : palette.border) : "transparent"
                }`,
                ...vis(ctx, "items"),
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: rankWidth,
                  justifyContent: "center",
                  color: lead ? palette.accent : palette.muted,
                  fontSize: fit.rankSize,
                  fontWeight: 700,
                }}
              >
                {row.rankLabel}
              </div>
              <Tile
                ctx={ctx}
                layer="items"
                face
                src={row.photoUrl}
                monogram={row.monogram}
                width={fit.photo}
                height={fit.photo}
                radius={Math.round(fit.photo * 0.22)}
                fontSize={Math.round(fit.photo * 0.34)}
                ring={ringFor(ctx, row.teamColor)}
                ringWidth={row.teamColor === null ? undefined : 3}
              />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flexGrow: 1,
                  flexShrink: 1,
                  flexBasis: 0,
                  minWidth: 0,
                  gap: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    color: palette.heading,
                    fontSize: name.size,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {name.text}
                </div>
                <TeamChip
                  ctx={ctx}
                  name={row.teamName}
                  colour={row.teamColor}
                  size={fit.metaSize}
                />
              </div>
              {/* A fixed claim on the row: the price never slides over the team. */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  width: priceRoom,
                  flexShrink: 0,
                  color: lead ? palette.accent : palette.money,
                  fontFamily: FIGURES,
                  fontSize: fitHeadline(row.priceLabel, priceRoom, fit.priceMax, fit.priceMin),
                  fontWeight: 700,
                }}
              >
                {row.priceLabel}
              </div>
            </div>
          );
        })}
      </div>
      <Footer ctx={ctx} />
    </Frame>
  );
}

// --- The whole season -------------------------------------------------------

/**
 * EVERY SQUAD, ONE SHEET.
 *
 * The poster a club pins the morning after and the one a WhatsApp group
 * forwards for a week: each franchise in its own colour, each player's face
 * under it. Organizer-only, because it is every team's roster at once.
 */
export function renderSeasonPoster(model: SeasonPoster, options: PosterRenderOptions) {
  if (options.theme === "stadium") {
    return renderStadiumSeason(model, options);
  }
  const ctx = contextFor(options, null);
  const { metrics, skin } = ctx;
  const { palette } = skin;
  const titleBand = Math.round(metrics.titleMax * 0.9 + metrics.kickerSize * 1.6);
  const band = sheetBody(metrics, [titleBand]);
  const grid = fitSeasonGrid(
    model.squads.length,
    model.largestSquad,
    contentWidth(metrics),
    band,
    metrics.gap,
  );
  // Before the night nothing has been spent, so there is no money to draw.
  const before = model.stage === "before";
  const prices = options.prices && !before;
  const sub = prices ? `${model.countLine} · ${model.spentLabel} committed` : model.countLine;
  return (
    <Frame ctx={ctx}>
      <Header
        ctx={ctx}
        competitionName={model.competitionName}
        competitionLogoUrl={model.competitionLogoUrl}
        chip={model.chip}
      />
      <div style={{ display: "flex", width: "100%", height: titleBand, alignItems: "center" }}>
        <TitleBlock
          ctx={ctx}
          kicker={before ? "Ahead of auction night" : "Season results"}
          title={before ? "THE TEAMS" : "ALL SQUADS"}
          sub={sub}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          width: "100%",
          height: band,
          alignContent: "flex-start",
          justifyContent: "center",
          gap: metrics.gap,
        }}
      >
        {grid === null
          ? null
          : model.squads.map((squad) => {
              const tone = squad.teamColor ?? palette.accent;
              const faces = grid.faces;
              const drawn = squad.rows.slice(0, faces.shown);
              const missing = squad.rows.length - drawn.length;
              const nameSize = seasonFaceNameSize(faces.cellWidth);
              return (
                <div
                  key={squad.teamName}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    width: grid.panelWidth,
                    height: grid.panelHeight,
                    borderRadius: metrics.chipRadius,
                    background: shown(ctx, "items")
                      ? mix(palette.panel, tone, skin.dark ? 0.12 : 0.06)
                      : "transparent",
                    border: `${String(skin.rule)}px solid ${
                      shown(ctx, "items") ? withAlpha(tone, 0.55) : "transparent"
                    }`,
                    ...vis(ctx, "items"),
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      height: grid.panelHeader,
                      paddingLeft: grid.inset,
                      paddingRight: grid.inset,
                      gap: Math.round(grid.inset * 0.6),
                      borderTopLeftRadius: metrics.chipRadius,
                      borderTopRightRadius: metrics.chipRadius,
                      background: tone,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexGrow: 1,
                        color: skin.team.onFill === "#FFFFFF" ? "#FFFFFF" : "#0B1018",
                        fontSize: grid.nameSize,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {squad.teamName}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        color: skin.team.onFill === "#FFFFFF" ? "#FFFFFF" : "#0B1018",
                        fontSize: Math.round(grid.nameSize * 0.7),
                        letterSpacing: 1,
                      }}
                    >
                      {prices ? squad.spentLabel : squad.countLabel}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      // Same reason as the squad grid: the fitted width is what
                      // makes the rows wrap where the fit said they would.
                      width: faces.gridWidth,
                      marginLeft: "auto",
                      marginRight: "auto",
                      paddingTop: grid.inset,
                      gap: faces.gap,
                      alignContent: "flex-start",
                      justifyContent: "center",
                    }}
                  >
                    {drawn.length === 0 ? (
                      // A team with nobody named yet is still on the sheet —
                      // its whole squad is decided on the night.
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: faces.gridWidth,
                          height: faces.photoHeight,
                          borderRadius: metrics.chipRadius,
                          border: `2px dashed ${palette.border}`,
                          color: palette.body,
                          fontSize: nameSize,
                        }}
                      >
                        Squad at auction
                      </div>
                    ) : null}
                    {drawn.map((row, index) => (
                      <div
                        key={`${squad.teamName}-${row.name}-${String(index)}`}
                        style={{
                          display: "flex",
                          position: "relative",
                          flexDirection: "column",
                          alignItems: "center",
                          width: faces.cellWidth,
                          height: faces.cellHeight,
                        }}
                      >
                        <Tile
                          ctx={ctx}
                          layer="items"
                          face
                          src={row.photoUrl}
                          monogram={row.monogram}
                          width={faces.photoWidth}
                          height={faces.photoHeight}
                          radius={0}
                          round
                          fontSize={Math.round(faces.photoWidth * 0.36)}
                          ring={squad.teamColor ?? ctx.skin.palette.accent}
                          ringWidth={2}
                        />
                        {/* Who the captain and the icons are is the point of
                            the sheet before the night, and worth knowing after. */}
                        <Badges
                          ctx={ctx}
                          row={row}
                          size={Math.max(11, Math.round(faces.photoWidth * 0.14))}
                        />
                        {faces.labelHeight === 0 ? null : (
                          <div
                            style={{
                              display: "flex",
                              marginTop: 4,
                              color: palette.body,
                              fontSize: nameSize,
                              maxWidth: faces.cellWidth,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {row.firstName}
                          </div>
                        )}
                      </div>
                    ))}
                    {missing > 0 ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: faces.photoWidth,
                          height: faces.photoHeight,
                          borderRadius: faces.photoWidth,
                          border: `2px dashed ${palette.border}`,
                          color: palette.body,
                          fontSize: Math.round(faces.photoWidth * 0.3),
                          fontWeight: 700,
                        }}
                      >
                        {`+${String(missing)}`}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
      </div>
      <Footer ctx={ctx} />
    </Frame>
  );
}

// --- The motion sprite ------------------------------------------------------

/**
 * THE SAME POSTER, TAKEN APART — one band per motion layer.
 *
 * Still one request, one gate, one audit row: `posterResponse` draws the bands
 * and stitches them into the single tall PNG the studio's canvas composites
 * back with a reveal. They are drawn SEPARATELY because a blur's cost grows
 * with the canvas it is drawn on — the same four bands took ~24 s as one
 * 1080×7680 render and ~8.5 s as four 1080×1920 ones — and each band is drawn
 * without the effects of the elements it hides (`withoutHiddenEffects`), which
 * brought the four to ~5.8 s. A second, hand-written canvas copy of the design
 * is still not an option: it would be a preview that can lie about the file.
 */
export function renderSpriteBands(
  kind: PosterKind,
  draw: (options: PosterRenderOptions) => ReactElement,
  options: PosterRenderOptions,
): { bands: readonly ReactElement[]; layers: readonly string[]; width: number; height: number } {
  const metrics = metricsFor(options.size);
  const layers = MOTION_BANDS[kind];
  return {
    layers,
    width: metrics.width,
    height: metrics.height,
    bands: layers.map((layer) => withoutHiddenEffects(draw({ ...options, only: layer }))),
  };
}
