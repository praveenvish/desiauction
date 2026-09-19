import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { teamsWorkspaceView } from "../../../../server/competition/actions";
import {
  appointmentsPanelView,
  squadSheetsPanelView,
} from "../../../../server/competition/appointment-actions";
import { AppointmentsPanel } from "./appointments-panel";
import { SquadSheetsPanel } from "./squad-sheets-panel";
import { TeamsPanel } from "./teams-panel";
import "../../seasons.css";
import "./teams.css";

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
  const [view, appointments, squadSheets] = await Promise.all([
    teamsWorkspaceView(slug),
    appointmentsPanelView(slug),
    squadSheetsPanelView(slug),
  ]);
  if (view === null) {
    notFound();
  }
  const selectedTeam = view.teams.find((team) => team.id === sp.team) ?? null;
  return (
    <ToastProvider>
      <main className="registrations-dash tm-page">
        <div className="dash-stack tm-stack">
          <TeamsPanel view={view} slug={slug} selected={selectedTeam} />
          {/* Only for whoever may set the roles (team.manage); null otherwise. */}
          {appointments !== null && selectedTeam === null ? (
            <AppointmentsPanel slug={slug} view={appointments} />
          ) : null}
          {squadSheets !== null && selectedTeam === null ? (
            <SquadSheetsPanel slug={slug} view={squadSheets} />
          ) : null}
        </div>
      </main>
    </ToastProvider>
  );
}
