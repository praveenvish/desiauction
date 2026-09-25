/**
 * THE TEAM CARD — a squad, as the public sees it.
 *
 * The season page used to answer "who is in this tournament?" with one grid of
 * 200 player tiles and a colour swatch per team at the bottom. The thing a
 * visitor actually arrives for — which players ended up in which squad — was
 * behind a toggle, and the team's own identity (its colour, its crest, its
 * count) was three sections apart from its players.
 *
 * The card is the team: colours at the head, the first few players in it, and
 * a way to see the rest. It shows names and playing roles. Purses and phone
 * numbers are not in the read model it is given.
 */
import { IconStar } from "@desiauction/ui";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import "./team-card.css";

export interface TeamCardPlayer {
  name: string;
  /** The registration number, e.g. "R4QD52B" — public, and how a player is found. */
  number: string;
  /** Pre-signed before the auction (icon or captain). */
  preSigned?: boolean;
  /**
   * The playing role in the season's words ("Batter"). Shown in the row's
   * trailing slot in place of the registration number when given.
   */
  role?: string;
  photo?: ReactNode;
}

export interface TeamCardData {
  id: string;
  name: string;
  /** The team's own colour. Absent teams fall back to the accent. */
  color?: string | null;
  crest?: ReactNode;
  coachName?: string | null;
  players: TeamCardPlayer[];
}

/** Initials for a player with no photograph, or a team with no crest. */
export function teamCardInitials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map((word) => word.charAt(0).toUpperCase()).join("");
}

export function TeamCard({
  team,
  /** How many players to list before "+N more". */
  preview = 4,
  /** Where "View squad" goes — the page decides (an anchor, a dialog id). */
  href,
}: {
  team: TeamCardData;
  preview?: number;
  href?: string | undefined;
}) {
  const { name, color, crest, coachName, players } = team;
  const shown = players.slice(0, preview);
  const rest = players.length - shown.length;

  return (
    <article
      className="team-card"
      style={
        color == null || color === "" ? undefined : ({ "--team-color": color } as CSSProperties)
      }
    >
      <header className="team-card-head">
        <span className="team-card-crest" aria-hidden>
          {crest ?? teamCardInitials(name)}
        </span>
        <div className="team-card-id">
          <h3 className="team-card-name">{name}</h3>
          <p className="team-card-count">
            {players.length} {players.length === 1 ? "player" : "players"}
            {coachName == null || coachName === "" ? null : ` · Coach ${coachName}`}
          </p>
        </div>
      </header>

      {players.length === 0 ? (
        <p className="team-card-empty">No players signed yet.</p>
      ) : (
        <ul className="team-card-players">
          {shown.map((player) => (
            <li className="team-card-player" key={player.number}>
              <span className="team-card-avatar" aria-hidden>
                {player.photo ?? teamCardInitials(player.name)}
              </span>
              <span className="team-card-player-name">{player.name}</span>
              {/* A star, not the word "Pre-signed": the word cost about 70px
                  on a row that already carries a name and a number, and every
                  name in a squad of pre-signed players was truncated to make
                  room for a label repeated down the whole card. The meaning is
                  kept for anyone not reading visually. */}
              {player.preSigned === true ? (
                <span className="team-card-tag" title="Pre-signed">
                  <IconStar width={13} height={13} aria-hidden />
                  <span className="team-card-sr">Pre-signed</span>
                </span>
              ) : null}
              {player.role !== undefined ? (
                player.role === "" ? null : (
                  <span className="team-card-number team-card-role">{player.role}</span>
                )
              ) : (
                <span className="team-card-number">#{player.number}</span>
              )}
            </li>
          ))}
          {rest > 0 ? (
            <li className="team-card-more">
              +{rest} more {rest === 1 ? "player" : "players"}
            </li>
          ) : null}
        </ul>
      )}

      {href === undefined ? null : (
        <Link className="team-card-link" href={href}>
          View squad
        </Link>
      )}
    </article>
  );
}

/** The grid team cards sit in. */
export function TeamGrid({ children }: { children: ReactNode }) {
  return <div className="team-grid">{children}</div>;
}
