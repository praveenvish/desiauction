import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { competitionView, registrationDashboard } from "../../../../server/competition/actions";
import { TeamsPanel } from "./teams-panel";
import "../../seasons.css";

export const metadata = { title: "Teams · DesiAuction" };

// PX-4 Team Workspace: teams + rosters over EXISTING reads. The roster is the
// registration query with a team filter, addressed by URL (?team=…) — server
// rendered, shareable, refresh-proof. Owner assignment remains the
// auction-scoped invite flow (linked, never duplicated).
export default async function TeamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ team?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const view = await competitionView(slug);
  if (view === null) {
    notFound();
  }
  const selectedTeam = view.teams.find((team) => team.id === sp.team) ?? null;
  const rosterDashboard =
    selectedTeam !== null ? await registrationDashboard(slug, { teamId: selectedTeam.id }) : null;
  const roster =
    rosterDashboard?.page.rows.filter((row) => row.teamId === selectedTeam?.id) ?? null;
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <header className="dash-head">
            <h1>{view.competition.name}</h1>
            <p className="competitions-hint">Teams &amp; rosters</p>
          </header>
          <TeamsPanel
            slug={slug}
            teams={view.teams}
            canManage={view.viewer.canManage}
            approvedCount={view.registrations.filter((row) => row.status === "approved").length}
            selectedTeamId={selectedTeam?.id ?? null}
            roster={roster}
          />
        </div>
      </main>
    </ToastProvider>
  );
}
