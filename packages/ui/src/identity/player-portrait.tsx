"use client";

import { useId, useState } from "react";

import { IDENTITY_CARD_VIEW, identityCardOf, type IdentityCard } from "./identity-card";
import styles from "./player-portrait.module.css";

export interface PlayerPortraitProps {
  /** Player display name — the accessible name, and where the initials come from. */
  name: string;
  /** Stable player id (the registration). The identity derives from it; the name is the fallback. */
  seed?: string;
  /**
   * Photo URL. Absent, null (no photo, or consent withheld — DPDP §5), still
   * loading or failed → the large identity card. Never a silhouette.
   */
  src?: string | null | undefined;
  /**
   * The name is printed over or beside the portrait already (the auction card
   * overlays it), so the image hides from assistive tech and the reader hears
   * the name once.
   */
  decorative?: boolean;
  className?: string;
}

/** Each pattern at poster size, in the player's accent tone. */
function PosterPattern({ card, stroke }: { card: IdentityCard; stroke: string }) {
  switch (card.pattern) {
    case "beams":
      return (
        <g transform={card.transform}>
          <circle cx={0} cy={0} r={220} fill={stroke} fillOpacity={0.1} />
          {[-50, -34, -20, -8, 4, 16, 30].map((deg) => {
            const rad = ((deg + 40) * Math.PI) / 180;
            return (
              <line
                key={deg}
                x1={0}
                y1={0}
                x2={Math.round(760 * Math.cos(rad))}
                y2={Math.round(760 * Math.sin(rad))}
                stroke={stroke}
                strokeOpacity={0.16}
                strokeWidth={3}
              />
            );
          })}
        </g>
      );
    case "arcs":
      return (
        <g transform={card.transform} fill="none" stroke={stroke} strokeWidth={2.5}>
          {[70, 130, 190, 250, 310, 370, 430].map((r) => (
            <circle key={r} cx={330} cy={440} r={r} strokeOpacity={0.14} />
          ))}
        </g>
      );
    case "crease":
      return (
        <g transform={card.transform} stroke={stroke}>
          {[-200, -120, -40, 40, 120, 200, 280, 360, 440, 520].map((y) => (
            <line key={y} x1={-200} y1={y} x2={600} y2={y} strokeOpacity={0.07} strokeWidth={30} />
          ))}
          <line x1={-200} y1={170} x2={600} y2={170} strokeOpacity={0.3} strokeWidth={3} />
          <line x1={-200} y1={330} x2={600} y2={330} strokeOpacity={0.3} strokeWidth={3} />
        </g>
      );
    case "contour":
      return (
        <g transform={card.transform} fill="none" stroke={stroke} strokeWidth={2.5}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
            const y = i * 52;
            return (
              <path
                key={i}
                d={`M-100 ${String(60 + y)} C 60 ${String(20 + y)}, 140 ${String(110 + y)}, 260 ${String(60 + y)} S 460 ${String(20 + y)}, 560 ${String(70 + y)}`}
                strokeOpacity={0.08 + (i % 3) * 0.04}
              />
            );
          })}
        </g>
      );
  }
}

/**
 * The no-photo face at poster size: the player's seeded pattern, lit from
 * above, with their initials struck in gold foil. The same identity as their
 * roster mark (`placeholderIdentity`), drawn large.
 */
function IdentityPoster({
  name,
  seed,
  decorative,
}: {
  name: string;
  seed: string;
  decorative: boolean;
}) {
  const card = identityCardOf(seed, name);
  const uid = useId().replace(/:/g, "");
  const foilId = `pp-foil-${uid}`;
  const washId = `pp-wash-${uid}`;
  const accent =
    card.accent === "primary" ? "var(--identity-accent)" : "var(--identity-accent-soft)";
  const { width, height } = IDENTITY_CARD_VIEW;
  return (
    <svg
      className={styles["poster"]}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      preserveAspectRatio="xMidYMid slice"
      data-pattern={card.pattern}
      data-accent={card.accent}
      {...(decorative
        ? { "aria-hidden": true, focusable: "false" }
        : { role: "img", "aria-label": name.trim() === "" ? "Player" : name })}
    >
      <defs>
        {/* Foil: a highlight at the top edge of the letters, the player's
            accent through the middle, burnished gold at the foot. */}
        <linearGradient id={foilId} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="var(--accent-sheen)" />
          <stop offset="0.12" stopColor="var(--identity-accent-soft)" />
          <stop offset="0.5" stopColor={accent} />
          <stop offset="1" stopColor="var(--ceremony-gold-deep)" />
        </linearGradient>
        {/* The floodlight: a pool of light behind the initials, in the tone. */}
        <radialGradient id={washId} cx="50%" cy="38%" r="70%">
          <stop
            offset="0"
            stopColor={accent}
            stopOpacity={card.accent === "primary" ? 0.2 : 0.16}
          />
          <stop offset="0.55" stopColor={accent} stopOpacity={0.05} />
          <stop offset="1" stopColor={accent} stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill="var(--identity-field)" />
      <rect width={width} height={height} fill={`url(#${washId})`} />
      <PosterPattern card={card} stroke={accent} />
      {card.initials !== null ? (
        <g
          className={styles["glyph"]}
          data-script={card.script}
          fontSize={card.fontSize}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {/* The stamp's shadow first, then the foil over it. */}
          <text x={200} y={card.glyphY + 5} className={styles["glyph-shadow"]}>
            {card.initials}
          </text>
          <text x={200} y={card.glyphY} fill={`url(#${foilId})`} data-testid="portrait-initials">
            {card.initials}
          </text>
        </g>
      ) : (
        <path
          d="M200 150 L262 212 L200 274 L138 212 Z"
          fill="none"
          stroke={`url(#${foilId})`}
          strokeWidth={8}
        />
      )}
    </svg>
  );
}

/**
 * A player's portrait for a card the CALLER sizes: the photo when one exists
 * and loads, the large identity card otherwise. It fills its box in both
 * states, so the card never moves when a photo arrives or fails.
 */
export function PlayerPortrait({
  name,
  seed = "",
  src,
  decorative = false,
  className,
}: PlayerPortraitProps) {
  // Remembered per URL (as PlayerImage does): the same card is re-rendered for
  // the next player, and the last player's failure must not decide this one.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const photo = src === undefined || src === null || src === "" ? null : src;
  const showPhoto = photo !== null && failedSrc !== photo;
  const loaded = photo !== null && loadedSrc === photo;
  return (
    <span
      className={[styles["frame"], className].filter(Boolean).join(" ")}
      data-testid="player-portrait"
      data-state={showPhoto ? (loaded ? "photo" : "loading") : "identity"}
    >
      {/* The identity sits under a loading photo, so a slow upload shows the
          player's own face-card rather than a blank box, and a failure simply
          leaves it there. */}
      {!showPhoto || !loaded ? (
        <IdentityPoster name={name} seed={seed} decorative={decorative || showPhoto} />
      ) : null}
      {showPhoto ? (
        <img
          className={styles["photo"]}
          src={photo}
          alt={decorative ? "" : name}
          decoding="async"
          data-loaded={loaded ? "true" : "false"}
          ref={(node) => {
            if (node !== null && node.complete && node.naturalWidth > 0 && !loaded) {
              setLoadedSrc(photo);
            }
          }}
          onLoad={() => {
            setLoadedSrc(photo);
          }}
          onError={() => {
            setFailedSrc(photo);
          }}
        />
      ) : null}
    </span>
  );
}
