import {
  ButtonLink,
  Card,
  IconAlert,
  IconCalendar,
  IconExternal,
  IconTrophy,
  IconUsers,
  Stat,
  StatRow,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FormDialog } from "../../components/form-dialog";
import { PageAction } from "../../components/shell/page-action";
import { currentSession } from "../../server/auth/actions";
import { tournamentsView } from "../../server/competition/tournament-actions";
import { CreateCompetitionForm } from "../seasons/create-competition-form";
import { CreateTournamentForm } from "./create-tournament-form";
import { TournamentsBrowser, type BrowsableGroup } from "./tournaments-browser";
import "../seasons/seasons.css";
import "./tournaments.css";

export const metadata = { title: "Tournaments · DesiAuction" };

/** `Stat` never formats a number itself (C-7) — the caller owns the locale. */
function count(value: number): string {
  return value.toLocaleString("en-IN");
}

/**
 * The tournaments index — rail slot 2, built to Tournaments & Orgs.dc.html.
 *
 * The hierarchy organizers actually use: a tournament ("BPL") holds the seasons
 * that run ("BPL 1", "BPL 2"). One-off seasons belong to no tournament and get
 * their own group rather than being hidden or forced under a fake parent.
 */
export default async function TournamentsPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/tournaments");
  }
  const view = await tournamentsView();
  const isEmpty = view.tournaments.length === 0 && view.standalone.length === 0;

  const groups: BrowsableGroup[] = [
    ...view.tournaments.map((tournament) => ({
      key: tournament.slug,
      name: tournament.name,
      // The accordion appends the season count — see AccordionGroup.meta.
      meta: tournament.orgName,
      seasons: tournament.seasons,
      kind: "tournament" as const,
      createdAt: tournament.createdAt,
      href: `/tournaments/${tournament.slug}`,
      seasonDialogTitle: `New season in ${tournament.name}`,
      // A season under this tournament: org fixed, tournament pre-set.
      seasonForm: (
        <CreateCompetitionForm
          orgs={[{ id: tournament.orgId, name: tournament.orgName }]}
          tournamentId={tournament.id}
        />
      ),
    })),
    ...(view.standalone.length > 0
      ? [
          {
            key: "one-off",
            name: "One-off seasons",
            meta: "Seasons with no recurring tournament",
            seasons: view.standalone,
            kind: "standalone" as const,
            // The bucket has no birthday of its own; it is pinned last anyway.
            createdAt: 0,
            seasonDialogTitle: "New one-off season",
            // No tournament: a standalone season across any of the person's orgs.
            seasonForm: <CreateCompetitionForm orgs={view.orgs} />,
          },
        ]
      : []),
  ];

  const newTournament = (
    <FormDialog
      title="New tournament"
      triggerLabel="+ New tournament"
      size="sm"
      triggerTestId="new-tournament"
    >
      <CreateTournamentForm orgs={view.orgs} />
    </FormDialog>
  );

  return (
    <main className="competitions">
      <div className="competitions-stack">
        {/* The page's one primary action rides the identity bar (PageAction) —
            same place on every surface. The empty state keeps its own. */}
        {view.orgs.length > 0 && !isEmpty ? <PageAction>{newTournament}</PageAction> : null}
        {isEmpty ? (
          /* First run decides activation, so it gets the whole canvas and the
             one gold action — not a "nothing here" line. */
          <Card>
            <div className="tg-firstrun" data-testid="tournaments-empty">
              <span className="tg-firstrun-glyph" aria-hidden>
                🏆
              </span>
              <h2>Run your first auction</h2>
              <p>
                Create a tournament, open a season for registration, then run the live player
                auction your night deserves.
              </p>
              {view.orgs.length > 0 ? (
                <>
                  <FormDialog
                    title="New tournament"
                    triggerLabel="+ Create your first tournament"
                    size="lg"
                    triggerTestId="firstrun-tournament"
                  >
                    <CreateTournamentForm orgs={view.orgs} />
                  </FormDialog>
                  <FormDialog
                    title="New one-off season"
                    triggerLabel="or start a one-off season →"
                    triggerAsLink
                    triggerClassName="tg-firstrun-alt"
                  >
                    <CreateCompetitionForm orgs={view.orgs} />
                  </FormDialog>
                </>
              ) : (
                <ButtonLink href="/orgs" size="lg">
                  Create your organization
                </ButtonLink>
              )}
            </div>
          </Card>
        ) : (
          <>
            <StatRow label="Tournament summary">
              <Stat
                icon={<IconTrophy />}
                value={count(view.totals.tournaments)}
                label="Tournaments"
                hint="Total"
                tone="accent"
              />
              <Stat
                icon={<IconCalendar />}
                value={count(view.totals.seasons)}
                label="Seasons"
                hint="Across all tournaments"
                tone="info"
              />
              <Stat
                icon={<IconUsers />}
                value={count(view.totals.teams)}
                label="Teams"
                hint="Participating"
                tone="success"
              />
              {/* The only figure here that is a to-do rather than a fact, so it
                  is the only one allowed to go warm — and only when non-zero. */}
              <Stat
                icon={<IconAlert />}
                value={count(view.totals.pending)}
                label="Registrations to review"
                hint={view.totals.pending === 0 ? "Nothing waiting" : "Awaiting your decision"}
                tone={view.totals.pending > 0 ? "warning" : "neutral"}
              />
            </StatRow>

            <TournamentsBrowser groups={groups} />

            <p className="tg-footnote">
              Need help managing tournaments?{" "}
              <Link href="/help">
                Visit our help center
                <IconExternal width={14} height={14} />
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
