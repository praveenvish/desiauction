import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { teamsWorkspaceView } from "../../../../server/competition/actions";
import { TeamsPanel } from "./teams-panel";
import "../../seasons.css";

export const metadata = { title: "Teams · DesiAuction" };

// PX-4 Team Workspace: the franchise grid and, for a URL-selected team (?team=…),
// the roster detail with buy prices. All derived from EXISTING reads (teams, the
// resolved auction lots, the approved roster) — server rendered, shareable.
export default async function TeamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ team?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const view = await teamsWorkspaceView(slug);
  if (view === null) {
    notFound();
  }
  const selectedTeam = view.teams.find((team) => team.id === sp.team) ?? null;
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <TeamsPanel view={view} slug={slug} selected={selectedTeam} />
        </div>
      </main>
    </ToastProvider>
  );
}
