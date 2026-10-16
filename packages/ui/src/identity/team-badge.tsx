"use client";

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

import {
  DEFAULT_TEAM_BADGE,
  SHIELD_RATIO,
  shieldColourFor,
  shieldDataUri,
  shieldTones,
  type TeamBadge,
} from "./team-shield";

/**
 * The season's choice for teams with no logo (0111), handed down once in the
 * season's layout — like `NoPhotoStyleProvider` — instead of threaded through
 * the thirty places a team's badge is drawn. Outside a season it is the
 * default, the shield.
 */
const TeamBadgeContext = createContext<TeamBadge>(DEFAULT_TEAM_BADGE);

export function TeamBadgeProvider({ badge, children }: { badge: TeamBadge; children: ReactNode }) {
  return <TeamBadgeContext.Provider value={badge}>{children}</TeamBadgeContext.Provider>;
}

export function useTeamBadge(): TeamBadge {
  return useContext(TeamBadgeContext);
}

/**
 * THE DEFAULT TEAM LOGO — a shield in the team's colour with its initials on
 * it. `size` is the HEIGHT in pixels (the box the circle used to fill), so it
 * drops into any existing square slot without moving the layout.
 */
export function TeamShield({
  initials,
  color,
  size,
  className,
  style,
}: {
  initials: string;
  color: string | null;
  size: number;
  className?: string;
  style?: CSSProperties;
}) {
  const fill = shieldColourFor(color, initials.trim());
  const tones = shieldTones(fill);
  const width = Math.round(size / SHIELD_RATIO);
  const letters = initials.trim();
  // Two letters fill the field; three (a short name) need a smaller face.
  const fontSize = Math.round(size * (letters.length >= 3 ? 0.27 : 0.34));
  return (
    <span
      className={className}
      data-team-shield=""
      aria-hidden
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width,
        height: size,
        ...style,
      }}
    >
      {/* A data: URI the page draws itself — nothing to fetch, no next/image. */}
      <img
        src={shieldDataUri(fill)}
        alt=""
        width={width}
        height={size}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <span
        style={{
          position: "relative",
          marginTop: -Math.round(size * 0.06),
          fontSize,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: "0.02em",
          color: tones.ink,
          whiteSpace: "nowrap",
        }}
      >
        {letters}
      </span>
    </span>
  );
}
