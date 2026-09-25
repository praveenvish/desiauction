import { teamsWorkspaceView } from "../../../../../server/competition/actions";
import { AddTeam } from "../../../../seasons/[slug]/teams/add-team";

/**
 * /seasons/[slug]/teams — "+ Add team", beside the page's title.
 *
 * The read is the page's own (`teamsWorkspaceView` is memoised per request), so
 * the slot costs no query. Shown to whoever holds `team.manage` — the
 * capability `createTeamAction` enforces — and only on the grid: a team's own
 * page (`?team=`) is about that team.
 */
export default async function TeamsAction({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ team?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const view = await teamsWorkspaceView(slug);
  if (view === null || !view.viewer.canManageTeams) {
    return null;
  }
  if (sp.team !== undefined && view.teams.some((team) => team.id === sp.team)) {
    return null;
  }
  // Absent, not disabled (nav.ts LAW 3): once the auction has left `scheduled`
  // the team set is locked for good, and a gold "Add team" that cannot be
  // pressed — full-width on a phone — was the loudest thing on the page. The
  // lock notice on the page says why there is no button.
  if (view.rulesSource?.locked === true) {
    return null;
  }
  return <AddTeam slug={slug} taken={view.teams.map((team) => team.color)} locked={false} />;
}
