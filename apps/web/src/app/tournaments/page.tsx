import { ButtonLink, Card, IconTrophy } from "@desiauction/ui";
import { enabledSports } from "../../server/competition/sports";
import { redirect } from "next/navigation";

import { FormDialog } from "../../components/form-dialog";
import { currentSession } from "../../server/auth/actions";
import { seasonOverviewView } from "../../server/competition/actions";
import { tournamentsView } from "../../server/competition/tournament-actions";
import { CreateCompetitionForm } from "../seasons/create-competition-form";
import { CreateTournamentForm } from "./create-tournament-form";
import { FeaturedSeason, pickFeatured } from "./featured-season";
import { TournamentsBrowser, type BrowsableGroup, type ViewMode } from "./tournaments-browser";
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

  // The season the page leads with, and its overview — the one extra read on
  // this page, and only when there is a season to feature.
  const featuredSeason = pickFeatured([
    ...view.tournaments.flatMap((tournament) => tournament.seasons),
    ...view.standalone,
  ]);
  const featured =
    featuredSeason === null
      ? null
      : {
          season: featuredSeason,
          tournamentName:
            view.tournaments.find((tournament) => tournament.id === featuredSeason.tournamentId)
              ?.name ?? null,
        };
  const featuredOverview =
    featuredSeason === null ? null : await seasonOverviewView(featuredSeason.slug);

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

  const newTournament = (
    <FormDialog
      title="New tournament"
      triggerLabel="+ New tournament"
      // `touch`, not `sm`. The page's primary action was a 32px rung while
      // /home sends people here to perform it — the same regression already
      // corrected on the earlier console screens.
      size="touch"
      triggerTestId="new-tournament"
    >
      <CreateTournamentForm orgs={createIn} />
    </FormDialog>
  );

  /* The "All seasons" view's primary action is the thing that view is about —
     one edition, under no particular tournament. Same slot, same rung. */
  const newSeason = (
    <FormDialog
      title="New season"
      triggerLabel="+ New season"
      size="touch"
      triggerTestId="new-season"
    >
      <CreateCompetitionForm sports={sportOptions} orgs={createIn} />
    </FormDialog>
  );

  // Only what THIS person may decide (`registration.review`).
  const pending = view.canReviewAnywhere ? view.totals.pending : 0;

  const featuredNode =
    featured === null ? null : (
      <FeaturedSeason
        season={featured.season}
        tournamentName={featured.tournamentName}
        overview={featuredOverview}
      />
    );

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
          <TournamentsBrowser
            groups={groups}
            initialMode={mode}
            pendingReview={pending}
            featured={featuredNode}
            {...(canCreate ? { actionGrouped: newTournament, actionSeasons: newSeason } : {})}
          />
        )}
      </div>
    </main>
  );
}
