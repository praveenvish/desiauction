"use client";

import { PlayerImage } from "@desiauction/ui";
import { useMemo } from "react";

import { TeamCard, TeamGrid, teamCardInitials } from "../../../components/public/team-card";
import { CrestImage } from "../../../components/team/crest-image";
import { groupSquads } from "../../../components/showcase/showcase-filter";
import type { ShowcasePlayer } from "../../../server/competition/public";

/**
 * Public Squads view (parity §3.3): the team sheets, grouped from the same
 * showcase data via the pure `groupSquads` core (unit-tested).
 *
 * It now renders the shared `TeamCard`, and it is given the season's TEAMS as
 * well as its players. That is the change that let the page drop its separate
 * "Teams" section: a team's colour, crest and coach were listed three sections
 * away from the players in it, and a team nobody had been sold to yet appeared
 * only in that other list. One card per team, including the empty ones.
 */
export interface SquadTeam {
  id: string;
  name: string;
  primaryColor: string | null;
  logoUrl: string | null;
  coachName: string | null;
  /** The team's own public page (`/c/[slug]/t/[team]`), built on the server. */
  href?: string;
}

/**
 * WHO A CARD LEADS WITH. The card previews four players, and it took them in
 * registration-number order — so a squad's marquee buy was usually behind
 * "+8 more" while the four who registered first stood in for the team. The
 * captain and the icon lead (they are who a team is known by), then the room's
 * purchases most expensive first, then anyone else by name.
 */
const MARK_ORDER: Record<string, number> = { captain: 0, icon: 1, retained: 2 };

function squadOrder(a: ShowcasePlayer, b: ShowcasePlayer): number {
  const markA = a.preSignedAs === null ? 3 : (MARK_ORDER[a.preSignedAs] ?? 3);
  const markB = b.preSignedAs === null ? 3 : (MARK_ORDER[b.preSignedAs] ?? 3);
  return (
    markA - markB ||
    (b.soldPrice ?? -1) - (a.soldPrice ?? -1) ||
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

export function SquadsView({
  players,
  teams,
  roleLabel,
}: {
  players: ShowcasePlayer[];
  teams: readonly SquadTeam[];
  /** The SEASON's role words — see `ShowcaseGrid`. */
  roleLabel: (role: string | null) => string;
}) {
  const squads = useMemo(() => groupSquads(players), [players]);

  const cards = useMemo(() => {
    const byName = new Map(squads.map((squad) => [squad.teamName, squad.players]));
    const named = teams.map((team) => ({ team, players: byName.get(team.name) ?? [] }));
    // A team sheet the season does not list as a team (renamed mid-season, or
    // a squad row that outlived its team) still has real players on it, so it
    // is shown rather than silently dropped.
    const orphans = squads
      .filter((squad) => !teams.some((team) => team.name === squad.teamName))
      .map((squad) => ({
        // No team row means no team page to link to.
        team: {
          href: undefined,
          id: squad.teamName,
          name: squad.teamName,
          primaryColor: null,
          logoUrl: null,
          coachName: null,
        },
        players: squad.players,
      }));
    return [...named, ...orphans].sort((a, b) => b.players.length - a.players.length);
  }, [squads, teams]);

  if (cards.length === 0) {
    return <p className="showcase-empty">Squads appear here as players are sold.</p>;
  }

  // The second anonymous bulk export lived here ("Download squads (CSV)"). It
  // is gone for the same reason as the one on the Players tab — see the note in
  // showcase-grid.tsx. A public page shows rosters; it does not hand them over
  // as a file to an actor it cannot name.
  return (
    <TeamGrid>
      {cards.map(({ team, players: squad }) => (
        <TeamCard
          key={team.id}
          href={team.href}
          team={{
            id: team.id,
            name: team.name,
            color: team.primaryColor,
            coachName: team.coachName,
            crest:
              team.logoUrl === null ? undefined : (
                // A signed storage URL, already sized by the card; next/image
                // would add a proxy hop for a 40px crest. A file that fails
                // falls back to the initials the card draws without one.
                <CrestImage
                  src={team.logoUrl}
                  width={40}
                  height={40}
                  loading="lazy"
                  fallback={teamCardInitials(team.name)}
                />
              ),
            players: [...squad].sort(squadOrder).map((player) => ({
              name: player.name,
              number: player.number,
              // The playing role, not "#R3D8ZHA": the registration number is an
              // internal handle, and a squad sheet is read by what people play.
              role: roleLabel(player.role),
              preSigned: player.status === "retained",
              photo: (
                <PlayerImage
                  name={player.name}
                  seed={player.registrationId}
                  size="sm"
                  shape="round"
                  src={player.photoUrl}
                  decorative
                />
              ),
            })),
          }}
        />
      ))}
    </TeamGrid>
  );
}
