import type { PlayerPoster } from "@desiauction/core";

import { mix, withAlpha } from "./poster-color";
import { Backlight, Number3D, Portrait, depthFor } from "./poster-depth";
import { DISPLAY, SERIF } from "./poster-fonts";
import { BrandLockup, contextFor, vis, type PosterRenderOptions } from "./poster-kit";
import { CAPS, ITALIC, ResultPanel, fit, type PanelMetrics } from "./poster-player";

/**
 * THE LINK CARD — the player poster, laid landscape for a link preview.
 *
 * 1200×630 is what WhatsApp, X and iMessage draw when somebody pastes a player's
 * public page into a chat. It is the same poster in the same voice: the photo
 * (or the 3D shirt number) on the left, the name and the one glass panel on the
 * right. The name and the panel sit just right of centre, so the square crop a
 * chat shows at small size still carries both.
 *
 * Always the floodlight skin: a link preview lands in a chat whose theme nobody
 * chose, and the dark card reads on both.
 */

export const LINK_CARD_SIZE = { width: 1200, height: 630 } as const;

const PANEL: PanelMetrics = {
  top: 0,
  radius: 28,
  padX: 26,
  padY: 20,
  pill: 15,
  caption: 13,
  figureMax: 92,
  word: 80,
  team: 27,
  coin: 38,
};

export function renderPlayerLinkCard(
  model: PlayerPoster,
  options: Pick<PosterRenderOptions, "brandMarkSrc">,
) {
  const ctx = contextFor(
    {
      theme: "floodlight",
      // The square's metrics size the lockup; nothing else here reads them.
      size: "square",
      showBranding: true,
      brandMarkSrc: options.brandMarkSrc,
      prices: true,
      sponsor: null,
    },
    model.teamColor,
  );
  const { palette } = ctx.skin;
  const depth = depthFor(ctx.skin);
  const { width, height } = LINK_CARD_SIZE;
  const column = { left: 560, width: width - 560 - 60 };
  const lastSize = fit(model.lastName.toUpperCase(), column.width, CAPS, 128, 64);
  const firstSize =
    model.firstName === null ? 0 : fit(model.firstName, column.width, ITALIC, 64, 36);
  // The panel sits on the foot of the card; its top is measured from there.
  const panelTop = model.outcome === "sold" || model.outcome === "pool" ? 344 : 404;

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width,
        height,
        overflow: "hidden",
        background: palette.surface,
        color: palette.heading,
        fontFamily: "Geist Sans, Anek Devanagari, sans-serif",
      }}
    >
      <Backlight ctx={ctx} depth={depth} centerX={280} centerY={300} radius={300} />
      {model.photoUrl === null ? (
        <Number3D
          ctx={ctx}
          text={model.heroNumber ?? model.monogram}
          size={440}
          left={20}
          top={120}
          width={520}
          face={depth.numberHeroFace}
          side={mix(depth.numberSide, "#000000", 0.2)}
        />
      ) : (
        <>
          {model.heroNumber === null ? null : (
            <Number3D
              ctx={ctx}
              text={model.heroNumber}
              size={560}
              left={20}
              top={70}
              width={520}
              face={depth.numberFace}
              side={depth.numberSide}
            />
          )}
          <Portrait
            ctx={ctx}
            src={model.photoUrl}
            left={70}
            top={130}
            width={420}
            height={500}
            ground={palette.surface}
            rim={model.teamColor ?? palette.accent}
          />
        </>
      )}
      {/* The column's ground, so the name never sits on the photograph. */}
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 380,
          top: 0,
          width: 340,
          height,
          backgroundImage: `linear-gradient(90deg, ${withAlpha(palette.surface, 0)} 0%, ${palette.surface} 62%)`,
        }}
      />

      <div
        style={{
          display: "flex",
          position: "absolute",
          left: column.left,
          top: 50,
          width: column.width,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            color: palette.muted,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: 3,
            // The lockup is a fixed claim on the row; a long season name ends
            // in an ellipsis before it can reach the mark.
            maxWidth: column.width - 300,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            ...vis(ctx),
          }}
        >
          {model.competitionName.toUpperCase()}
        </div>
        <BrandLockup ctx={ctx} />
      </div>

      <div
        style={{
          display: "flex",
          position: "absolute",
          left: column.left,
          top: 100,
          width: column.width,
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
            textShadow: "0 14px 40px rgba(0,0,0,0.5)",
          }}
        >
          {model.lastName.toUpperCase()}
        </div>
      </div>

      <ResultPanel
        ctx={ctx}
        depth={depth}
        model={model}
        panel={{ ...PANEL, top: panelTop }}
        left={column.left}
        width={column.width}
      />
    </div>
  );
}

/** The alt text a chat announces — the same sentence the panel draws. */
export function linkCardAlt(model: PlayerPoster): string {
  const team = model.teamName === null ? "" : ` — ${model.teamName}`;
  const verdict =
    model.outcome === "sold" && model.priceLabel !== null
      ? `Sold for ${model.priceLabel}${team}`
      : model.outcome === "pool"
        ? `In the auction pool${model.basePriceLabel === null ? "" : `, base price ${model.basePriceLabel}`}`
        : `${model.stamp.charAt(0)}${model.stamp.slice(1).toLowerCase()}${team}`;
  return `${model.name}, ${model.roleLine}. ${verdict}. ${model.competitionName}.`;
}
