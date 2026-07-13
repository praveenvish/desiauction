"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { Badge, type BadgeTone } from "../primitives/badge";
import styles from "./player-card.module.css";
import { PlayerImage, type PlayerImageProps } from "./player-image";

export type PlayerRole = "batter" | "bowler" | "all-rounder" | "keeper";

const ROLE_MARKS: Record<PlayerRole, string> = {
  batter: "BAT",
  bowler: "BOWL",
  "all-rounder": "AR",
  keeper: "WK",
};

export type PlayerStatus = "registered" | "verified" | "sold" | "passed";

// C-23: "passed" is a neutral fact — never danger-toned, never loud.
const STATUS_TONE: Record<PlayerStatus, BadgeTone> = {
  registered: "neutral",
  verified: "success",
  sold: "success",
  passed: "neutral",
};

const STATUS_LABEL: Record<PlayerStatus, string> = {
  registered: "Registered",
  verified: "Verified",
  sold: "Sold",
  passed: "Passes",
};

export interface PlayerCardProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  seed?: string;
  photoSrc?: string;
  teamColor?: string;
  role?: PlayerRole;
  captain?: boolean;
  status?: PlayerStatus;
  /** Secondary line: team, base price, village — caller's words. */
  detail?: string;
  /** Right-aligned slot — usually a <Money>. */
  trailing?: ReactNode;
  imageSize?: PlayerImageProps["size"];
}

/** The identity composition used by Roster, Profile header and Search rows. */
export const PlayerCard = forwardRef<HTMLDivElement, PlayerCardProps>(function PlayerCard(
  {
    name,
    seed,
    photoSrc,
    teamColor,
    role,
    captain = false,
    status,
    detail,
    trailing,
    imageSize = "lg",
    className,
    ...rest
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={[styles["card"], className].filter(Boolean).join(" ")}
      data-testid="player-card"
      {...rest}
    >
      <PlayerImage
        name={name}
        {...(seed !== undefined ? { seed } : {})}
        {...(photoSrc !== undefined ? { src: photoSrc } : {})}
        {...(teamColor !== undefined ? { teamColor } : {})}
        size={imageSize}
      />
      <div className={styles["body"]}>
        <div className={styles["nameRow"]}>
          <h3
            className={[styles["name"], name.length > 24 ? styles["long"] : undefined]
              .filter(Boolean)
              .join(" ")}
          >
            {name}
          </h3>
          {captain ? (
            <span className={styles["leader"]} title="Captain" aria-label="Captain">
              C
            </span>
          ) : null}
          {role !== undefined ? (
            <span className={styles["roleMark"]} aria-label={role}>
              {ROLE_MARKS[role]}
            </span>
          ) : null}
        </div>
        <div className={styles["meta"]}>
          {status !== undefined ? (
            <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
          ) : null}
          {detail !== undefined ? <span>{detail}</span> : null}
        </div>
      </div>
      {trailing !== undefined ? <div className={styles["trailing"]}>{trailing}</div> : null}
    </div>
  );
});
