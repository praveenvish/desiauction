"use client";

import { PlayerImage } from "@desiauction/ui";
import { useMemo } from "react";

import { groupSquads } from "../../../components/showcase/showcase-filter";
import type { ShowcasePlayer } from "../../../server/competition/public";

/**
 * Public Squads view (parity §3.3): final team rosters, grouped from the same
 * showcase data via the pure `groupSquads` core (unit-tested). Pre-auction (no
 * sold players) shows an honest empty state.
 */
export function SquadsView({ players }: { players: ShowcasePlayer[] }) {
  const squads = useMemo(() => groupSquads(players), [players]);

  if (squads.length === 0) {
    return <p className="showcase-empty">Squads appear here as players are sold.</p>;
  }

  return (
    <div className="squads">
      {squads.map((squad) => (
        <section key={squad.teamName} className="squad" aria-label={squad.teamName}>
          <header className="squad-head">
            <h3 className="squad-name">{squad.teamName}</h3>
            <span className="squad-count">
              {squad.players.length} {squad.players.length === 1 ? "player" : "players"}
            </span>
          </header>
          <ul className="squad-list">
            {squad.players.map((p) => (
              <li key={p.number} className="squad-player">
                <PlayerImage
                  name={p.name}
                  seed={p.number}
                  size="sm"
                  shape="round"
                  {...(p.photoUrl !== null ? { src: p.photoUrl } : {})}
                />
                <span className="squad-player-name">{p.name}</span>
                <span className="squad-player-num">#{p.number}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
