import { monogramOf } from "@desiauction/core";
import type { PlayerPoster, PosterSize, PosterTheme, TeamPoster } from "@desiauction/core";
import type { ReactNode } from "react";

import {
  CHIP_TRACKING,
  HEADER_GAP,
  HEADER_TRACKING,
  OUTCOME_TRACKING,
  chipPadding,
  chipWidth,
  contentWidth,
  fitCaps,
  fitHeadline,
  fitPrice,
  fitSquadRows,
  headerNameRoom,
  metricsFor,
  type PosterMetrics,
} from "./poster-layout";

/**
 * THE RASTERIZER BOUNDARY.
 *
 * Pure presentational, exactly like `c/[slug]/share-image-card.tsx`: no server
 * imports, no IO, no `next/image`, and LITERAL hex everywhere — Satori resolves
 * no CSS variables, so `var(--accent)` here silently renders as black. The
 * source of truth for these values is `packages/ui/src/generated/floodlight.css`
 * and every theme below is a deliberate departure from it, not a drift.
 *
 * FOUR THEMES, ONE LAYOUT. A theme is a PALETTE plus ONE emphasis knob
 * (`accentOn`: whether the solid accent lands on the stamp or on the price).
 * Everything else — the frame, the header's two slots, the hero, the verdict
 * row, the squad table, the footer — is the same tree for all four. Four
 * layouts would be four designs, and four designs drift the moment one of them
 * gets a fix the others do not.
 *
 * The brand footer is a PROP, not a decision made here. Whether an organizer's
 * pass has bought the right to an unbranded poster is a commercial question,
 * and answering it needs a database row this file must never reach for.
 */

interface Palette {
  readonly surface: string;
  /** Inner stop of the floodlight wash. */
  readonly washInner: string;
  readonly washGeometry: string;
  readonly panel: string;
  readonly border: string;
  readonly heading: string;
  readonly body: string;
  readonly muted: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly onAccent: string;
  readonly money: string;
}

interface Skin {
  readonly palette: Palette;
  /**
   * The one emphasis knob. Somebody has to carry the solid fill on the verdict
   * row; which one it is, is the whole visible difference between `arena` and
   * the rest, and it is one branch rather than a second layout.
   */
  readonly accentOn: "stamp" | "price";
  /** Rule and tile border weight. */
  readonly rule: number;
}

const SKINS: Record<PosterTheme, Skin> = {
  // The product's own dark navy, verbatim from the floodlight tokens. This is
  // the one that has to look like DesiAuction and not like a poster generator.
  floodlight: {
    palette: {
      surface: "#0B1018",
      washInner: "#161E2E",
      washGeometry: "1200px 780px at 6% -10%",
      panel: "#101623",
      border: "#2C3A52",
      heading: "#E8EEF9",
      body: "#C9D4E8",
      muted: "#7285A6",
      accent: "#E6B24A",
      accentSoft: "#F3D078",
      onAccent: "#070A0F",
      money: "#F6F9FF",
    },
    accentOn: "stamp",
    rule: 1,
  },
  // Ceremony. Warm near-black with the wash overhead rather than off to one
  // side, so the poster reads as a trophy shot instead of a dashboard.
  gold: {
    palette: {
      surface: "#090702",
      washInner: "#241A06",
      washGeometry: "1200px 900px at 50% -12%",
      panel: "#17120A",
      border: "#4A3A16",
      heading: "#FFF7E6",
      body: "#E9D7AE",
      muted: "#A48C5C",
      accent: "#E6B24A",
      accentSoft: "#F3D078",
      onAccent: "#0A0700",
      money: "#FFF7E6",
    },
    accentOn: "stamp",
    rule: 2,
  },
  // Night match under the lights: the product's `--live` green as the accent,
  // and the emphasis moved off the stamp so the stamp draws as outlined block
  // letters — the one theme where the price, not the verdict, is the loud thing.
  arena: {
    palette: {
      surface: "#05130E",
      washInner: "#0D2A1F",
      washGeometry: "1300px 700px at 96% -8%",
      panel: "#0B1F17",
      border: "#1E4A38",
      heading: "#EAFBF3",
      body: "#BCDCCB",
      muted: "#6E9683",
      accent: "#3DD68C",
      accentSoft: "#7BE8B4",
      onAccent: "#04120C",
      money: "#EAFBF3",
    },
    accentOn: "price",
    rule: 2,
  },
  /*
   * The light one, and the reason there is a light one: these get printed, put
   * on a club noticeboard, and posted into feeds that are not black. The accent
   * is the brand gold taken down to a bronze that survives on paper — #E6B24A
   * on cream is legible to nobody, and swapping in a red would have made the
   * fourth theme a different brand rather than a different mood.
   */
  ink: {
    palette: {
      surface: "#F5F2EA",
      washInner: "#FFFFFF",
      washGeometry: "1200px 780px at 6% -10%",
      panel: "#FFFFFF",
      border: "#D9D2C4",
      heading: "#14171F",
      body: "#333A46",
      muted: "#6E7480",
      accent: "#8A5A00",
      accentSoft: "#A97516",
      onAccent: "#FFF8EA",
      money: "#14171F",
    },
    accentOn: "stamp",
    rule: 2,
  },
};

export interface PosterRenderOptions {
  readonly theme: PosterTheme;
  readonly size: PosterSize;
  /**
   * Tier-gated upstream. False strips the whole strip — mark, wordmark and
   * domain — because an unbranded poster is the thing a paid pass buys, not a
   * quieter logo.
   */
  readonly showBranding: boolean;
  /**
   * The DesiAuction mark as a `data:` URI. Satori cannot resolve `next/image`
   * or a relative public path, so the bytes arrive already inlined; null when
   * branding is off, or when the file could not be read and the wordmark alone
   * has to carry it.
   */
  readonly brandMarkSrc: string | null;
}

// --- Shared pieces ----------------------------------------------------------

/**
 * The one tile. Competition logo, player photo and team crest are the same
 * component at three sizes, which is what keeps a missing photo and a missing
 * crest from looking like two different bugs.
 *
 * A null `src` is not an error state: `buildPlayerPoster` hands over a monogram
 * precisely because consent may have been withheld, and this has to look like a
 * design decision rather than a broken image.
 */
function Tile({
  src,
  monogram,
  width,
  height,
  radius,
  fontSize,
  skin,
}: {
  src: string | null;
  monogram: string;
  width: number;
  height: number;
  radius: number;
  fontSize: number;
  skin: Skin;
}) {
  const { palette } = skin;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width,
        height,
        flexShrink: 0,
        borderRadius: radius,
        overflow: "hidden",
        background: palette.panel,
        border: `${String(skin.rule)}px solid ${palette.border}`,
        color: palette.accent,
        fontSize,
        fontWeight: 700,
        letterSpacing: 1,
      }}
    >
      {src === null ? (
        monogram
      ) : (
        <img src={src} style={{ width, height, objectFit: "cover" }} alt="" />
      )}
    </div>
  );
}

/** The header's right slot: `#R4F2A1` on a player, `15 players` on a squad. */
function HeaderChip({
  label,
  metrics,
  skin,
}: {
  label: string;
  metrics: PosterMetrics;
  skin: Skin;
}) {
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
      }}
    >
      {label}
    </div>
  );
}

function Header({
  competitionName,
  competitionLogoUrl,
  monogram,
  chip,
  metrics,
  skin,
}: {
  competitionName: string;
  competitionLogoUrl: string | null;
  monogram: string;
  chip: string | null;
  metrics: PosterMetrics;
  skin: Skin;
}) {
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
          src={competitionLogoUrl}
          monogram={monogram}
          width={metrics.headerTile}
          height={metrics.headerTile}
          radius={Math.round(metrics.headerTile * 0.28)}
          fontSize={Math.round(metrics.headerTile * 0.4)}
          skin={skin}
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
          }}
        >
          {competitionName}
        </div>
      </div>
      {chip === null ? null : <HeaderChip label={chip} metrics={metrics} skin={skin} />}
    </div>
  );
}

/**
 * The strip nobody should want to crop off. Small, bottom-anchored, and drawn
 * only when `showBranding` says the season's pass has not bought it away.
 */
function BrandFooter({
  metrics,
  skin,
  brandMarkSrc,
}: {
  metrics: PosterMetrics;
  skin: Skin;
  brandMarkSrc: string | null;
}) {
  const { palette } = skin;
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 18,
        borderTop: `${String(skin.rule)}px solid ${palette.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {brandMarkSrc === null ? null : (
          <img
            src={brandMarkSrc}
            width={metrics.footerMark}
            height={metrics.footerMark}
            style={{ borderRadius: Math.round(metrics.footerMark * 0.24) }}
            alt=""
          />
        )}
        <div
          style={{
            display: "flex",
            color: palette.heading,
            fontSize: metrics.footerNameSize,
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
        >
          DesiAuction
        </div>
      </div>
      <div
        style={{
          display: "flex",
          color: palette.muted,
          fontSize: metrics.footerUrlSize,
          letterSpacing: 1.5,
        }}
      >
        desiauction.in
      </div>
    </div>
  );
}

function Frame({
  skin,
  metrics,
  children,
}: {
  skin: Skin;
  metrics: PosterMetrics;
  children: ReactNode;
}) {
  const { palette } = skin;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: metrics.pad,
        background: palette.surface,
        backgroundImage: `radial-gradient(${palette.washGeometry}, ${palette.washInner}, ${palette.surface})`,
        color: palette.heading,
        fontFamily: "Geist Sans, Anek Devanagari, sans-serif",
      }}
    >
      {children}
    </div>
  );
}

// --- Player poster ----------------------------------------------------------

/**
 * The verdict row: the stamp and, when the outcome carries one, the price.
 *
 * The model has already decided there is no price on an unsold, retained or
 * icon player, so this never has to know why the second half is missing — it
 * only has to look deliberate when it is.
 */
function Verdict({
  stamp,
  priceLabel,
  metrics,
  skin,
}: {
  stamp: string;
  priceLabel: string | null;
  metrics: PosterMetrics;
  skin: Skin;
}) {
  const { palette } = skin;
  const filledStamp = skin.accentOn === "stamp";
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        justifyContent: priceLabel === null ? "center" : "space-between",
        gap: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: metrics.stampHeight,
          padding: `0 ${String(metrics.stampPadX)}px`,
          borderRadius: metrics.chipRadius,
          background: filledStamp ? palette.accent : palette.panel,
          border: filledStamp ? "none" : `3px solid ${palette.accent}`,
          color: filledStamp ? palette.onAccent : palette.accent,
          fontSize: metrics.stampSize,
          fontWeight: 700,
          letterSpacing: metrics.stampTracking,
        }}
      >
        {stamp}
      </div>
      {priceLabel === null ? null : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: filledStamp ? "auto" : metrics.stampHeight,
            padding: filledStamp ? 0 : `0 ${String(metrics.stampPadX)}px`,
            borderRadius: metrics.chipRadius,
            background: filledStamp ? "transparent" : palette.accent,
            color: filledStamp ? palette.accent : palette.onAccent,
            fontSize: fitPrice(priceLabel, stamp, metrics),
            fontWeight: 700,
          }}
        >
          {priceLabel}
        </div>
      )}
    </div>
  );
}

export function renderPlayerPoster(model: PlayerPoster, options: PosterRenderOptions) {
  const metrics = metricsFor(options.size);
  const skin = SKINS[options.theme];
  const { palette } = skin;
  /*
   * The sentence beside the crest, and ONLY when there is a crest. With no team
   * the model's line is "Unsold", which is the word already stamped six inches
   * above it — the first render said UNSOLD twice, once in a slab and once in a
   * whisper. A poster repeating itself reads as a template, not a design.
   */
  const caption = model.teamName === null ? null : (model.outcomeLine ?? model.teamName);
  return (
    <Frame skin={skin} metrics={metrics}>
      <Header
        competitionName={model.competitionName}
        competitionLogoUrl={model.competitionLogoUrl}
        monogram={monogramOf(model.competitionName)}
        chip={model.numberLabel === null ? null : `#${model.numberLabel}`}
        metrics={metrics}
        skin={skin}
      />

      <Tile
        src={model.photoUrl}
        monogram={model.monogram}
        width={metrics.photoWidth}
        height={metrics.photoHeight}
        radius={metrics.radius}
        fontSize={metrics.photoMonogramSize}
        skin={skin}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            color: palette.heading,
            fontSize: fitHeadline(
              model.name,
              contentWidth(metrics),
              metrics.nameMax,
              metrics.nameMin,
            ),
            fontWeight: 700,
            lineHeight: 1.05,
          }}
        >
          {model.name}
        </div>
        <div
          style={{
            display: "flex",
            color: palette.accentSoft,
            fontSize: metrics.roleSize,
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          {model.roleLine}
        </div>
      </div>

      <Verdict stamp={model.stamp} priceLabel={model.priceLabel} metrics={metrics} skin={skin} />

      {caption === null || model.teamName === null ? (
        // No franchise and nothing to say about one. The row still exists so the
        // frame's rhythm does not change between a sold poster and an unsold one.
        <div style={{ display: "flex", height: metrics.crest }} />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Tile
            src={model.teamCrestUrl}
            monogram={monogramOf(model.teamName)}
            width={metrics.crest}
            height={metrics.crest}
            radius={Math.round(metrics.crest * 0.28)}
            fontSize={metrics.crestMonogramSize}
            skin={skin}
          />
          <div
            style={{
              display: "flex",
              color: palette.body,
              fontSize: fitCaps(
                caption,
                contentWidth(metrics) - metrics.crest - 20,
                metrics.outcomeSize,
                Math.round(metrics.outcomeSize * 0.6),
                OUTCOME_TRACKING,
              ),
              letterSpacing: OUTCOME_TRACKING,
              textTransform: "uppercase",
            }}
          >
            {caption}
          </div>
        </div>
      )}

      {options.showBranding ? (
        <BrandFooter metrics={metrics} skin={skin} brandMarkSrc={options.brandMarkSrc} />
      ) : null}
    </Frame>
  );
}

// --- Team poster ------------------------------------------------------------

function Stat({
  label,
  value,
  metrics,
  skin,
  tone,
}: {
  label: string;
  value: string;
  metrics: PosterMetrics;
  skin: Skin;
  tone: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
        flexBasis: 0,
        flexGrow: 1,
        height: metrics.statHeight,
        padding: `0 ${String(metrics.pad / 2)}px`,
        borderRadius: metrics.chipRadius,
        background: skin.palette.panel,
        border: `${String(skin.rule)}px solid ${skin.palette.border}`,
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
      <div style={{ display: "flex", color: tone, fontSize: metrics.statSize, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

export function renderTeamPoster(model: TeamPoster, options: PosterRenderOptions) {
  const metrics = metricsFor(options.size);
  const skin = SKINS[options.theme];
  const { palette } = skin;
  const fit = fitSquadRows(model.rows.length, metrics);
  const rows = model.rows.slice(0, fit.shown);
  // Price and marker are fixed-width columns on the right; the name takes the
  // rest. Stated once so the header rule, the rows and the overflow line all
  // agree on where the columns are.
  const priceColumn = Math.round(fit.fontSize * 7);
  const markerColumn = Math.round(fit.fontSize * 2.6);

  return (
    <Frame skin={skin} metrics={metrics}>
      <Header
        competitionName={model.competitionName}
        competitionLogoUrl={model.competitionLogoUrl}
        monogram={monogramOf(model.competitionName)}
        chip={model.squadLabel}
        metrics={metrics}
        skin={skin}
      />

      <div style={{ display: "flex", width: "100%", alignItems: "center", gap: 28 }}>
        <Tile
          src={model.teamCrestUrl}
          monogram={monogramOf(model.teamName)}
          width={metrics.heroCrest}
          height={metrics.heroCrest}
          radius={Math.round(metrics.heroCrest * 0.24)}
          fontSize={metrics.heroCrestMonogramSize}
          skin={skin}
        />
        <div
          style={{
            display: "flex",
            color: palette.heading,
            fontSize: fitHeadline(
              model.teamName,
              contentWidth(metrics) - metrics.heroCrest - 28,
              metrics.teamNameMax,
              metrics.teamNameMin,
            ),
            fontWeight: 700,
            lineHeight: 1.05,
          }}
        >
          {model.teamName}
        </div>
      </div>

      {/*
        The roster area is a FIXED height because the card is, but the rows are
        distributed through it rather than stacked at the top. A franchise with
        three signings — every franchise, early on auction night — otherwise got
        one line of squad and a third of a poster of empty navy underneath it,
        which is the exact dead space this product criticises in other people's
        cards. `space-evenly` fills naturally at a full squad and reads as a
        deliberate compact card at a short one.

        `space-around`, not `space-evenly`: Satori implements a SUBSET of
        flexbox and rejects the latter outright at render time — a 500, not a
        style that quietly does nothing. Typecheck and lint both pass it, so the
        only thing that catches it is drawing the poster.
      */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-around",
          width: "100%",
          height: metrics.squadArea,
        }}
      >
        {rows.map((row, index) => (
          <div
            key={`${row.name}-${String(index)}`}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              height: fit.rowHeight,
              padding: `0 ${String(Math.round(fit.fontSize * 0.6))}px`,
              borderRadius: Math.round(fit.rowHeight * 0.22),
              // A tint on every other row, not a rule between every pair: at
              // thirty pixels a row, rules turn the squad into a ledger.
              background: index % 2 === 0 ? palette.panel : "transparent",
            }}
          >
            <div
              style={{
                display: "flex",
                flexGrow: 1,
                alignItems: "baseline",
                gap: Math.round(fit.fontSize * 0.6),
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: palette.heading,
                  fontSize: fit.fontSize,
                  fontWeight: 700,
                }}
              >
                {row.name}
              </div>
              <div
                style={{
                  display: "flex",
                  color: palette.muted,
                  fontSize: Math.round(fit.fontSize * 0.72),
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                }}
              >
                {row.roleLine}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                width: priceColumn,
                color: row.priceLabel === null ? palette.muted : palette.money,
                fontSize: fit.fontSize,
                fontWeight: 700,
              }}
            >
              {/* An em dash, not a zero. A pre-signed icon has no price, and a
                  ₹0 next to their name would read as a player nobody paid for. */}
              {row.priceLabel ?? "—"}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                width: markerColumn,
                color: palette.accent,
                fontSize: Math.round(fit.fontSize * 0.7),
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              {row.markerLabel ?? ""}
            </div>
          </div>
        ))}
        {fit.overflow > 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: fit.rowHeight,
              paddingLeft: Math.round(fit.fontSize * 0.6),
              color: palette.muted,
              fontSize: Math.round(fit.fontSize * 0.8),
              letterSpacing: 1.5,
            }}
          >
            {`+ ${String(fit.overflow)} more in the squad`}
          </div>
        ) : null}
      </div>

      {/* Two equal halves, not two tiles sized to their own numbers: a franchise
          that spent a crore and has ten rupees left would otherwise get a wide
          box and a narrow one, and the narrow one is the number that matters. */}
      <div style={{ display: "flex", width: "100%", gap: 24 }}>
        <Stat
          label="Spent"
          value={model.spentLabel}
          metrics={metrics}
          skin={skin}
          tone={palette.money}
        />
        <Stat
          label="Purse left"
          value={model.remainingLabel}
          metrics={metrics}
          skin={skin}
          tone={palette.accent}
        />
      </div>

      {options.showBranding ? (
        <BrandFooter metrics={metrics} skin={skin} brandMarkSrc={options.brandMarkSrc} />
      ) : null}
    </Frame>
  );
}
