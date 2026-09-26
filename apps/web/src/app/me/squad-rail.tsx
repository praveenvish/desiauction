import { SquadList } from "../../components/team/squad-list";
import { publicTeam, teamSlugOf } from "../../server/competition/public";
import type { CareerSeason } from "../../server/player/career";

/** Faces shown before "See all" — enough to fill the rail, not the page. */
const SHOWN = 8;

/**
 * THE SECOND OBJECT on /me and /me/[sport] (round 3C). A player's career page
 * was a hero, four tiles and one season row, with half a laptop blank beside
 * it. The rail now holds the squad of their newest team — the people they
 * play with — from the same public read the season's team page publishes (a
 * private season returns null, and the rail is simply absent). Their own row
 * is marked, and it is always among the faces shown.
 */
export async function LatestSquad({
  seasons,
  owned = null,
  limit = SHOWN,
}: {
  seasons: CareerSeason[];
  /** A team this person owns — the rail's team when they play for none. */
  owned?: { competitionSlug: string; teamName: string } | null;
  /** Rows before "+N more" — shorter where the rail sits beside a short column. */
  limit?: number;
}) {
  const latest = [...seasons]
    .filter((season) => season.teamName !== null)
    .sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""))[0];
  const source =
    latest !== undefined && latest.teamName !== null
      ? {
          competitionSlug: latest.competitionSlug,
          teamName: latest.teamName,
          selfId: latest.registrationId,
        }
      : owned !== null
        ? { ...owned, selfId: null }
        : null;
  if (source === null) return null;
  const team = await publicTeam(source.competitionSlug, teamSlugOf(source.teamName));
  if (team === null || team.members.length === 0) return null;
  return (
    <SquadList
      team={team}
      selfId={source.selfId}
      limit={limit}
      headingId="me-squad-title"
      testId="me-squad"
      caption={team.competitionName}
    />
  );
}
