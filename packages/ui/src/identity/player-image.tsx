"use client";

import { useId, useState, type CSSProperties } from "react";

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
  /**
   * Team color hex once the player belongs to a squad; gold until then. The
   * mark takes a wash of it (the initials portrait reads as that team's player,
   * not a generic navy disc) and its bottom edge.
   */
  teamColor?: string | undefined;
  /**
   * Draw a ring in the team colour around the frame — photo or mark alike. For
   * the broadcast surfaces (spectate, the big screen), where the face is the
   * news and the team it went to is the other half of it. Needs `teamColor`.
   */
  ring?: boolean;
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
  // Gradient ids must be unique per instance: a page draws dozens of marks.
  const uid = useId().replace(/:/g, "");
  const washId = `pi-wash-${uid}`;
  const shadeId = `pi-shade-${uid}`;
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
      <defs>
        {/* THE WASH: light falling from the upper left, in the team's colour
            once the player has one and in a whisper of gold before that — so
            the portrait has depth instead of reading as a flat navy disc. */}
        <radialGradient id={washId} cx="28%" cy="18%" r="95%">
          <stop
            offset="0"
            stopColor={teamColor ?? "var(--identity-accent)"}
            stopOpacity={teamColor === undefined ? 0.2 : 0.62}
          />
          <stop
            offset="0.55"
            stopColor={teamColor ?? "var(--identity-accent)"}
            stopOpacity={teamColor === undefined ? 0.05 : 0.2}
          />
          <stop offset="1" stopColor={teamColor ?? "var(--identity-accent)"} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={shadeId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor="var(--identity-field-deep)" stopOpacity={0} />
          <stop offset="1" stopColor="var(--identity-field-deep)" stopOpacity={0.7} />
        </linearGradient>
      </defs>
      <rect width={px} height={px} fill="var(--identity-field)" />
      <rect width={px} height={px} fill={`url(#${washId})`} />
      <Pattern identity={identity} px={px} />
      <rect width={px} height={px} fill={`url(#${shadeId})`} />
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
  ring = false,
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
  const teamed = ring && teamColor !== undefined && teamColor !== "";
  // The ring's width scales with the step, so a 24px row face and a 160px
  // stage portrait carry the same visual weight of team colour.
  const frameStyle: CSSProperties | undefined =
    fluid && !teamed
      ? undefined
      : {
          ...(fluid ? {} : { width: px, height: px }),
          // Custom properties are not in `CSSProperties`; React passes them
          // through untouched.
          ...(teamed
            ? ({
                "--pi-team": teamColor,
                "--pi-ring": `${String(Math.max(1.5, px / 28))}px`,
              } as CSSProperties)
            : {}),
        };

  return (
    <span
      className={[
        styles["frame"],
        shape === "round" ? styles["round"] : undefined,
        fluid ? styles["fluid"] : undefined,
        showPhoto && !loaded ? styles["loading"] : undefined,
        teamed ? styles["ringed"] : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
      style={frameStyle}
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
            // A server-rendered photo can finish loading BEFORE hydration
            // attaches `onLoad`, and React never replays that event — the frame
            // then sat in its loading state (photo at opacity 0) forever, which
            // on the big screen read as an empty disc where a face belonged.
            // The ref sees an image that is already complete and settles it.
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
        </>
      ) : (
        <Mark name={name} seed={seed} px={px} teamColor={teamColor} decorative={decorative} />
      )}
    </span>
  );
}
