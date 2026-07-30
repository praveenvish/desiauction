import {
  ButtonLink,
  Card,
  IconAlert,
  IconCalendar,
  IconExternal,
  IconMatch,
  IconTrophy,
  IconUsers,
  Stat,
  StatRow,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FormDialog } from "../../components/form-dialog";
import { currentSession } from "../../server/auth/actions";
import { tournamentsView } from "../../server/competition/tournament-actions";
import { CreateCompetitionForm } from "../seasons/create-competition-form";
import { CreateTournamentForm } from "./create-tournament-form";
import { TournamentsBrowser, type BrowsableGroup, type ViewMode } from "./tournaments-browser";
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
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/tournaments");
  }
  const params = await searchParams;
  // `?view=seasons` and nothing else; anything unrecognised means the default,
  // so a mangled link lands on the hierarchy rather than an error.
  const mode: ViewMode = params.view === "seasons" ? "seasons" : "grouped";
  const view = await tournamentsView();
  const isEmpty = view.tournaments.length === 0 && view.standalone.length === 0;
  // Membership is not permission. Every create affordance on this page is gated
  // on the orgs this person may actually create in — `org:staff` holds
  // `registration.review` but not `competition.create`, so belonging to a club
  // and being able to open a season in it are genuinely different facts.
  const canCreate = view.creatableOrgs.length > 0;
  // The forms are handed the creatable list too, so a multi-org picker cannot
  // offer an org the server will refuse.
  const createIn = view.creatableOrgs;

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
            seasonForm: <CreateCompetitionForm orgs={createIn} />,
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
      <CreateCompetitionForm orgs={createIn} />
    </FormDialog>
  );

  const bandGrouped = (
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
        /* Not "Across all tournaments": some of these belong to no
           tournament at all, and the page renders that group two
           inches below. The hint says what the figure actually is. */
        hint={
          view.totals.standalone === 0
            ? "Across all tournaments"
            : `${count(view.totals.seasons - view.totals.standalone)} in tournaments · ${count(view.totals.standalone)} one-off`
        }
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
          is the only one allowed to go warm — and only when non-zero.
          It counts what THIS person may decide: a viewer holding no
          `registration.review` was being shown "2 awaiting your
          decision" in warning orange over a decision that was never
          theirs to make. */}
      <Stat
        icon={<IconAlert />}
        value={count(view.canReviewAnywhere ? view.totals.pending : 0)}
        label="Registrations to review"
        hint={
          !view.canReviewAnywhere
            ? "Owners and staff review these"
            : view.totals.pending === 0
              ? "Nothing waiting"
              : "Awaiting your decision"
        }
        tone={view.canReviewAnywhere && view.totals.pending > 0 ? "warning" : "neutral"}
      />
    </StatRow>
  );

  /* The season-centric four /seasons carried. A union of the two bands would
     have described neither view, so the band follows the view instead. */
  const bandSeasons = (
    <StatRow label="Season summary">
      <Stat
        icon={<IconCalendar />}
        value={count(view.totals.seasons)}
        label="Seasons"
        hint="Every edition you can see"
        tone="accent"
      />
      <Stat
        icon={<IconUsers />}
        value={count(view.totals.open)}
        label="Accepting entries"
        hint={view.totals.open === 0 ? "Nobody taking entries" : "Registration open"}
        tone={view.totals.open > 0 ? "success" : "neutral"}
      />
      <Stat
        icon={<IconMatch />}
        value={count(view.totals.inFlight)}
        label="In flight"
        hint="In setup or open"
        tone="info"
      />
      {/* Organizations was the fourth tile /seasons carried, and it lost the
          slot deliberately. "All seasons" is the show-me-everything view, and
          the thing you most need when looking at everything is what is waiting
          on YOU — the one figure here that is a to-do rather than a fact. An
          org count is static, almost never actionable, and already the whole
          subject of /orgs. Losing the pending tile in this view would mean an
          organizer who prefers the flat list never sees that two registrations
          need a decision. Same capability-aware behaviour as the grouped band:
          it counts only what this person may decide, and only goes warm when
          there is something to do. */}
      <Stat
        icon={<IconAlert />}
        value={count(view.canReviewAnywhere ? view.totals.pending : 0)}
        label="Registrations to review"
        hint={
          !view.canReviewAnywhere
            ? "Owners and staff review these"
            : view.totals.pending === 0
              ? "Nothing waiting"
              : "Awaiting your decision"
        }
        tone={view.canReviewAnywhere && view.totals.pending > 0 ? "warning" : "neutral"}
      />
    </StatRow>
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
                🏆
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
                    triggerLabel="or start a one-off season →"
                    triggerAsLink
                    triggerClassName="tg-firstrun-alt"
                    /* The same handle the populated page's "+ New season"
                       carries: on an empty index this IS that action, and a
                       caller arriving from /seasons must find it either way. */
                    triggerTestId="new-season"
                  >
                    <CreateCompetitionForm orgs={createIn} />
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
                  Create your organization
                </ButtonLink>
              )}
            </div>
          </Card>
        ) : (
          <>
            <TournamentsBrowser
              groups={groups}
              initialMode={mode}
              bandGrouped={bandGrouped}
              bandSeasons={bandSeasons}
              {...(canCreate ? { actionGrouped: newTournament, actionSeasons: newSeason } : {})}
            />

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
