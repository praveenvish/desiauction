import { IconMegaphone, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { teamsWorkspaceView } from "../../../../server/competition/actions";
import {
  appointmentsPanelView,
  squadSheetsPanelView,
} from "../../../../server/competition/appointment-actions";
import { currentSession } from "../../../../server/auth/actions";
import { rolesOf } from "../../../../server/roles/roles";
import { AppointmentsPanel } from "./appointments-panel";
import { OwnSquad } from "./own-squad";
import { PublishByHand } from "./hand-entry";
import { ResultsSheet } from "./results-sheet";
import { SquadSheetsPanel } from "./squad-sheets-panel";
import { TeamsPanel } from "./teams-panel";
import "../../seasons.css";
import "./teams.css";

export const metadata = { title: "Teams" };

// PX-4 Team Workspace: the franchise grid and, for a URL-selected team (?team=…),
// the roster detail with buy prices. All derived from EXISTING reads (teams, the
// resolved auction lots, the approved roster) — server rendered, shareable.
export default async function TeamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ team?: string; view?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const [view, appointments, squadSheets, session] = await Promise.all([
    teamsWorkspaceView(slug),
    appointmentsPanelView(slug),
    squadSheetsPanelView(slug),
    currentSession(),
  ]);
  if (view === null) {
    notFound();
  }
  /*
   * THE OWNER'S OWN TEAM (wow pass, round 2): somebody who cannot see rosters
   * here but owns one of these teams gets their squad inline, and their card
   * leads the grid. The roles read is the same one the rail is built from.
   */
  const owned =
    session === null || view.viewer.canSeeRoster
      ? undefined
      : (await rolesOf(session.personId)).owns.find((team) => team.competitionSlug === slug);
  const ownCard =
    owned === undefined ? undefined : view.teams.find((team) => team.id === owned.teamId);
  const selectedTeam = view.teams.find((team) => team.id === sp.team) ?? null;
  // Typing an offline auction in: every player on one screen (?view=results).
  if (
    sp.view === "results" &&
    view.handEntry === "open" &&
    view.viewer.canSeeRoster &&
    view.teams.length > 0
  ) {
    return (
      <ToastProvider>
        <main className="registrations-dash tm-page">
          <div className="dash-stack tm-stack">
            <ResultsSheet
              slug={slug}
              teams={view.teams.map((team) => ({
                id: team.id,
                name: team.name,
                color: team.color,
              }))}
              roleLabels={Object.fromEntries(view.roles.map((role) => [role.key, role.label]))}
            />
            <PublishByHand
              slug={slug}
              teams={view.teams}
              imported={view.auctionSource === "imported"}
              inList
              suggestedPurse={view.suggestedPurse ?? null}
            />
          </div>
        </main>
      </ToastProvider>
    );
  }
  /*
   * TELL YOUR PLAYERS — announcing captains & icons, and sending squad sheets.
   * Only for whoever may set the roles (team.manage). While somebody is still
   * waiting to be told, both jobs sit side by side in ONE strip above the team
   * cards (they were two tall cards that pushed the teams below the fold);
   * once everyone has heard, the strip becomes one quiet line under the grid.
   */
  const announcePending = appointments !== null && appointments.pending.length > 0;
  const sheetsPending =
    squadSheets !== null && squadSheets.blocked === null && squadSheets.pending > 0;
  const waiting = (announcePending ? 1 : 0) + (sheetsPending ? 1 : 0);
  const tellStrip =
    selectedTeam === null && waiting > 0 ? (
      <section className="tm-tell" aria-labelledby="tm-tell-title" data-testid="tell-players">
        <header className="tm-tell-head">
          <h2 id="tm-tell-title">Tell your players</h2>
          <span>· {waiting === 1 ? "1 thing waiting" : "2 things waiting"}</span>
        </header>
        <div className="tm-tell-rows">
          {appointments !== null ? (
            <AppointmentsPanel slug={slug} view={appointments} layout="row" />
          ) : null}
          {squadSheets !== null ? (
            <SquadSheetsPanel slug={slug} view={squadSheets} layout="row" />
          ) : null}
        </div>
      </section>
    ) : null;
  const toldEver = (appointments?.told ?? 0) > 0 || (squadSheets?.sent ?? 0) > 0;
  const tellQuiet =
    selectedTeam === null && waiting === 0 && (appointments !== null || squadSheets !== null) ? (
      <p className="tm-tell-quiet" data-testid="tell-players-quiet">
        <IconMegaphone size={16} aria-hidden />
        <span>
          <strong>Tell your players</strong> —{" "}
          {toldEver
            ? [
                appointments !== null && appointments.told > 0
                  ? `everyone named has been told (${String(appointments.told)})`
                  : null,
                squadSheets !== null && squadSheets.sent > 0
                  ? `every squad member has their sheet (${String(squadSheets.sent)})`
                  : null,
              ]
                .filter((part): part is string => part !== null)
                .join("; ") + ". Anyone named or moved later shows up here."
            : "announcing captains and sending squad sheets open here once teams have players."}
        </span>
      </p>
    ) : null;
  return (
    <ToastProvider>
      <main className="registrations-dash tm-page">
        <div className="dash-stack tm-stack">
          {ownCard !== undefined && (selectedTeam === null || selectedTeam.id === ownCard.id) ? (
            <OwnSquad
              slug={slug}
              teamId={ownCard.id}
              teamName={ownCard.name}
              color={ownCard.color}
            />
          ) : null}
          <TeamsPanel
            view={view}
            slug={slug}
            selected={selectedTeam}
            {...(ownCard !== undefined ? { ownTeamId: ownCard.id } : {})}
            {...(tellStrip !== null ? { beforeGrid: tellStrip } : {})}
          />
          {tellQuiet}
        </div>
      </main>
    </ToastProvider>
  );
}
