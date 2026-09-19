"use client";

import { useState } from "react";

import { placeholderIdentity, type PlaceholderIdentity } from "./placeholder";
import styles from "./player-image.module.css";

export type PlayerImageSize = "xs" | "sm" | "md" | "lg" | "xl" | "hero";

const SIZES: Record<PlayerImageSize, number> = {
  xs: 24,
  sm: 32,
  md: 48,
  lg: 64,
  xl: 96,
  hero: 160,
};

export interface PlayerImageProps {
  /** Player display name — always the accessible name. */
  name: string;
  /** Stable player id; identity derives from it (name as fallback seed). */
  seed?: string;
  /**
   * Photo URL. Absent, null (no photo, or consent withheld), still-loading or
   * failed → the branded mark (C-25). Null is accepted so a consent-gated view
   * model's `photoUrl: string | null` passes straight through.
   */
  src?: string | null | undefined;
  size?: PlayerImageSize;
  shape?: "square" | "round";
  /** Team color hex once the player belongs to a squad; volt until then. */
  teamColor?: string | undefined;
  /**
   * The player's name is already printed beside the image (a roster row, a
   * ribbon, a card title). The image then hides from assistive tech — empty
   * alt, no role — so a screen reader reads the name once, not twice.
   */
  decorative?: boolean;
  /**
   * Fill a square box the CALLER sizes (a responsive hero whose edge is a
   * `clamp()`), instead of the fixed `size` box. `size` then only picks the
   * intrinsic resolution. The caller owns the box, so the zero-layout-shift
   * guarantee holds exactly when that box has a definite size.
   */
  fluid?: boolean;
}

function Pattern({ identity, px }: { identity: PlaceholderIdentity; px: number }) {
  const stroke = "var(--identity-line)";
  const soft = "var(--identity-line-soft)";
  const center = px / 2;
  switch (identity.pattern) {
    case "beams":
      return (
        <g
          transform={`rotate(${String(identity.angle)} ${String(center)} ${String(center)})`}
          stroke={stroke}
          strokeWidth={px / 24}
        >
          <line x1={-px} y1={px * 0.25} x2={px * 2} y2={px * 0.25} opacity={0.7} />
          <line x1={-px} y1={px * 0.45} x2={px * 2} y2={px * 0.45} stroke={soft} />
          <line x1={-px} y1={px * 0.7} x2={px * 2} y2={px * 0.7} opacity={0.5} />
        </g>
      );
    case "arcs":
      return (
        <g fill="none" stroke={stroke} strokeWidth={px / 24}>
          <circle cx={px * 0.85} cy={px * 0.15} r={px * 0.45} opacity={0.7} />
          <circle cx={px * 0.85} cy={px * 0.15} r={px * 0.7} stroke={soft} />
          <circle cx={px * 0.85} cy={px * 0.15} r={px * 0.95} opacity={0.4} />
        </g>
      );
    case "crease":
      return (
        <g stroke={stroke} strokeWidth={px / 26}>
          <line x1={px * 0.2} y1={0} x2={px * 0.2} y2={px} opacity={0.55} />
          <line x1={px * 0.32} y1={0} x2={px * 0.32} y2={px} stroke={soft} />
          <line x1={px * 0.8} y1={0} x2={px * 0.8} y2={px} opacity={0.35} />
        </g>
      );
    case "contour":
      return (
        <g fill="none" stroke={stroke} strokeWidth={px / 26}>
          <path
            d={`M0 ${String(px * 0.75)} Q ${String(px * 0.3)} ${String(px * 0.55)} ${String(px * 0.6)} ${String(px * 0.7)} T ${String(px)} ${String(px * 0.6)}`}
            opacity={0.7}
          />
          <path
            d={`M0 ${String(px * 0.9)} Q ${String(px * 0.4)} ${String(px * 0.7)} ${String(px * 0.75)} ${String(px * 0.85)} T ${String(px)} ${String(px * 0.78)}`}
            stroke={soft}
          />
        </g>
      );
  }
}

/** The branded mark — never a silhouette (C-25). */
function Mark({
  name,
  seed,
  px,
  teamColor,
  decorative,
}: {
  name: string;
  seed: string;
  px: number;
  teamColor?: string | undefined;
  decorative: boolean;
}) {
  const identity = placeholderIdentity(seed, name);
  const edge =
    teamColor ??
    (identity.accent === "primary" ? "var(--identity-accent)" : "var(--identity-accent-soft)");
  const fontSize =
    identity.initials !== null && identity.initials.length > 1 ? px * 0.34 : px * 0.42;
  return (
    <svg
      className={styles["mark"]}
      viewBox={`0 0 ${String(px)} ${String(px)}`}
      width={px}
      height={px}
      {...(decorative
        ? { "aria-hidden": true, focusable: "false" }
        : { role: "img", "aria-label": name.trim() === "" ? "Player" : name })}
      data-pattern={identity.pattern}
    >
      <rect width={px} height={px} fill="var(--identity-field)" />
      <Pattern identity={identity} px={px} />
      <rect
        x={0}
        y={px - Math.max(2, px / 16)}
        width={px}
        height={Math.max(2, px / 16)}
        fill={edge}
      />
      {identity.initials !== null ? (
        <text
          className={styles["glyph"]}
          x="50%"
          y="52%"
          dominantBaseline="central"
          textAnchor="middle"
          fontSize={fontSize}
        >
          {identity.initials}
        </text>
      ) : (
        <path
          d={`M ${String(px / 2)} ${String(px * 0.3)} L ${String(px * 0.68)} ${String(px / 2)} L ${String(px / 2)} ${String(px * 0.7)} L ${String(px * 0.32)} ${String(px / 2)} Z`}
          fill="none"
          stroke="var(--identity-glyph)"
          strokeWidth={px / 28}
        />
      )}
    </svg>
  );
}

/**
 * Photo when it exists and loads; the branded mark otherwise. Fixed square
 * dimensions in both states — zero layout shift by construction (C-25).
 */
export function PlayerImage({
  name,
  seed = "",
  src,
  size = "md",
  shape = "square",
  teamColor,
  decorative = false,
  fluid = false,
}: PlayerImageProps) {
  const px = SIZES[size];
  // Remembered per URL, not as bare booleans: a live surface re-renders the
  // same frame for the next player, and a failure (or a finished load) for the
  // last player's photo must not decide what the next one shows.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const photo = src === undefined || src === null || src === "" ? null : src;
  const failed = photo !== null && failedSrc === photo;
  const loaded = photo !== null && loadedSrc === photo;
  const showPhoto = photo !== null && !failed;

  return (
    <span
      className={[
        styles["frame"],
        shape === "round" ? styles["round"] : undefined,
        fluid ? styles["fluid"] : undefined,
        showPhoto && !loaded ? styles["loading"] : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
      style={fluid ? undefined : { width: px, height: px }}
      data-testid="player-image"
      data-state={showPhoto ? (loaded ? "photo" : "loading") : "mark"}
    >
      {showPhoto ? (
        <>
          {!loaded ? <span className={styles["shimmer"]} aria-hidden /> : null}
          <img
            className={styles["photo"]}
            src={photo}
            alt={decorative ? "" : name}
            width={px}
            height={px}
            loading="lazy"
            onLoad={() => {
              setLoadedSrc(photo);
            }}
            onError={() => {
              setFailedSrc(photo);
            }}
          />
        </>
      ) : (
        <Mark name={name} seed={seed} px={px} teamColor={teamColor} decorative={decorative} />
      )}
    </span>
  );
}
