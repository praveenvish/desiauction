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
  return (
    <AddTeam
      slug={slug}
      taken={view.teams.map((team) => team.color)}
      locked={view.rulesSource?.locked ?? false}
    />
  );
}
