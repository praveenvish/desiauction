import { sportPackFor } from "@desiauction/core";
import { ButtonLink, Card, IconTrophy } from "@desiauction/ui";
import { enabledSports } from "../../server/competition/sports";
import { redirect } from "next/navigation";

import { FormDialog } from "../../components/form-dialog";
import { currentSession } from "../../server/auth/actions";
import { organizerScheduleView } from "../../server/competition/fixture-actions";
import { nowWallClock } from "../../server/competition/fixtures";
import { tournamentsView } from "../../server/competition/tournament-actions";
import { CreateCompetitionForm } from "../seasons/create-competition-form";
import { CreateTournamentForm } from "./create-tournament-form";
import { NeedsYou } from "./needs-you";
import { needsYou } from "./season-stage";
import type { BrowsableGroup } from "./tournament-card";
import { TournamentsBrowser, type ViewMode } from "./tournaments-browser";
import "../seasons/seasons.css";
import "./tournaments.css";

export const metadata = { title: "Tournaments · DesiAuction" };

/**
 * The tournaments index — rail slot 2, built to Tournaments & Orgs.dc.html.
 *
 * The hierarchy organizers actually use: a tournament ("BPL") holds the seasons
 * that run ("BPL 1", "BPL 2"). One-off seasons belong to no tournament and get
 * their own group rather than being hidden or forced under a fake parent.
 *
 * It is also the ONLY index over this dataset. /seasons was a second one —
 * same rows, different vocabulary, no shared model, both under one rail slot —
 * left answering by a migration nobody finished. It is now the "All seasons"
 * VIEW of this page (`?view=seasons`), and /seasons redirects here. Grouping is
 * a way of looking at one dataset, not a second destination.
 */
export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The sports currently switched on — the picker renders only when there is
  // more than one (SP-1 Phase 1).
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/tournaments");
  }
  // Independent reads, together (they were four awaits in series).
  const [sportOptions, params, view] = await Promise.all([
    enabledSports(),
    searchParams,
    tournamentsView(),
  ]);
  // `?view=seasons` and nothing else; anything unrecognised means the default,
  // so a mangled link lands on the hierarchy rather than an error.
  const mode: ViewMode = params.view === "seasons" ? "seasons" : "grouped";
  const isEmpty = view.tournaments.length === 0 && view.standalone.length === 0;
  // Membership is not permission. Every create affordance on this page is gated
  // on the orgs this person may actually create in — `org:staff` holds
  // `registration.review` but not `competition.create`, so belonging to a club
  // and being able to open a season in it are genuinely different facts.
  const canCreate = view.creatableOrgs.length > 0;
  // The forms are handed the creatable list too, so a multi-org picker cannot
  // offer an org the server will refuse.
  const createIn = view.creatableOrgs;

  const today = nowWallClock().slice(0, 10);
  const allSeasons = [
    ...view.tournaments.flatMap((tournament) => tournament.seasons),
    ...view.standalone,
  ];
  const tournamentNames = Object.fromEntries(
    view.tournaments.map((tournament) => [tournament.id, tournament.name]),
  );
  // What is waiting on this person, and the next few matches across every
  // season they run — the band at the top (see needs-you.tsx).
  const waiting = needsYou(allSeasons, today);
  const upcoming = isEmpty ? [] : (await organizerScheduleView()).slice(0, 3);

  const groups: BrowsableGroup[] = [
    ...view.tournaments.map((tournament) => ({
      key: tournament.slug,
      name: tournament.name,
      sportLabel:
        tournament.seasons[0] !== undefined
          ? sportPackFor(tournament.seasons[0].sport).label
          : undefined,
      // The accordion appends the season count — see AccordionGroup.meta.
      meta: tournament.orgName,
      seasons: tournament.seasons,
      kind: "tournament" as const,
      createdAt: tournament.createdAt,
      href: `/tournaments/${tournament.slug}`,
      seasonDialogTitle: `New season in ${tournament.name}`,
      canCreateSeason: view.creatableOrgs.some((org) => org.id === tournament.orgId),
      // A season under this tournament: org fixed, tournament pre-set.
      seasonForm: (
        <CreateCompetitionForm
          sports={sportOptions}
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
            canCreateSeason: canCreate,
            // No tournament: a standalone season across any of the person's orgs.
            seasonForm: <CreateCompetitionForm sports={sportOptions} orgs={createIn} />,
          },
        ]
      : []),
  ];

  /* The "All seasons" view is about editions, so it carries "New season" as
     its own secondary button beside the list — the identity bar's one primary
     action stays "New tournament" in both views. Every inbound /seasons link
     arrives expecting this door, under this test id. */
  const newSeason = (
    <FormDialog
      title="New season"
      triggerLabel="+ New season"
      variant="secondary"
      size="sm"
      triggerTestId="new-season"
    >
      <CreateCompetitionForm sports={sportOptions} orgs={createIn} />
    </FormDialog>
  );

  // Only what THIS person may decide (`registration.review`).
  const pending = view.canReviewAnywhere ? view.totals.pending : 0;

  /* The dashed card that closes the grid: the next tournament, or a one-off
     season. It fills the row a single tournament leaves empty. */
  const startCard = canCreate ? (
    <article className="tx-start" data-testid="tx-start">
      <span className="tx-start-glyph" aria-hidden>
        <IconTrophy size={22} />
      </span>
      <h3>Run another tournament</h3>
      <p>
        A tournament is the league that comes back every year. Each year is a new season with its
        own registration, auction and fixtures.
      </p>
      <div className="tx-start-go">
        <FormDialog
          title="New tournament"
          triggerLabel="+ New tournament"
          variant="secondary"
          size="sm"
          triggerTestId="start-tournament"
        >
          <CreateTournamentForm orgs={createIn} />
        </FormDialog>
        <FormDialog
          title="New one-off season"
          triggerLabel="or a one-off season"
          triggerAsLink
          triggerClassName="tx-start-alt"
          triggerTestId="start-one-off"
        >
          <CreateCompetitionForm sports={sportOptions} orgs={createIn} />
        </FormDialog>
      </div>
    </article>
  ) : null;

  return (
    <main className="competitions">
      <div className="competitions-stack">
        {isEmpty ? (
          /* First run decides activation, so it gets the whole canvas and the
             one gold action — not a "nothing here" line. */
          <Card>
            <div className="tg-firstrun" data-testid="tournaments-empty">
              <span className="tg-firstrun-glyph" aria-hidden>
                <IconTrophy size={32} />
              </span>
              <h2>Run your first auction</h2>
              <p>
                Create a tournament, open a season for registration, then run the live player
                auction your night deserves.
              </p>
              {canCreate ? (
                <>
                  <FormDialog
                    title="New tournament"
                    triggerLabel="+ Create your first tournament"
                    size="lg"
                    triggerTestId="firstrun-tournament"
                  >
                    <CreateTournamentForm orgs={createIn} />
                  </FormDialog>
                  <FormDialog
                    title="New one-off season"
                    triggerLabel="or start a one-off season"
                    triggerAsLink
                    triggerClassName="tg-firstrun-alt"
                    /* The same handle the populated page's "+ New season"
                       carries: on an empty index this IS that action, and a
                       caller arriving from /seasons must find it either way. */
                    triggerTestId="new-season"
                  >
                    <CreateCompetitionForm sports={sportOptions} orgs={createIn} />
                  </FormDialog>
                </>
              ) : view.orgs.length > 0 ? (
                /* A member who holds no `competition.create` anywhere. They are
                   in the right place and simply are not the one who starts
                   these — say so, rather than offering a button the server has
                   already decided to refuse. */
                <p className="tg-firstrun-cannot" data-testid="tournaments-cannot-create">
                  Nothing has been set up here yet. Ask an owner to create the first tournament.
                </p>
              ) : (
                <ButtonLink href="/orgs" size="lg">
                  Create your club
                </ButtonLink>
              )}
            </div>
          </Card>
        ) : (
          <>
            <NeedsYou
              seasons={waiting}
              tournamentNames={new Map(Object.entries(tournamentNames))}
              upcoming={upcoming}
              today={today}
            />
            <TournamentsBrowser
              groups={groups}
              initialMode={mode}
              today={today}
              pendingReview={pending}
              tournamentNames={tournamentNames}
              {...(startCard !== null ? { startCard } : {})}
              {...(canCreate ? { newSeason } : {})}
            />
          </>
        )}
      </div>
    </main>
  );
}
