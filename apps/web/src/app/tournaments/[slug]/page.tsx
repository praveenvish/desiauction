import { Card, EmptyState, PageIntro } from "@desiauction/ui";
import { enabledSports } from "../../../server/competition/sports";
import { notFound } from "next/navigation";
import { cache, Suspense, type ReactNode } from "react";

import { FormDialog } from "../../../components/form-dialog";
import { PageTitle } from "../../../components/shell/page-title";
import {
  tournamentHeader,
  tournamentSeasons,
} from "../../../server/competition/tournament-actions";
import { CreateCompetitionForm } from "../../seasons/create-competition-form";
import { SeasonCard } from "../season-card";
import { TournamentsSkeleton } from "../tournament-accordion";
import "../../seasons/seasons.css";
import "../tournaments.css";

/**
 * `generateMetadata` and the page both need this read, and Next runs them as
 * two calls in one request — so it was fetched twice per render. React
 * `cache` makes the second a memo hit for the rest of the request (wrapped
 * here, not in the server module, because a "use server" file may only export
 * async functions).
 */
const headerOf = cache(tournamentHeader);

/**
 * The tab and every shared link used to read the literal "Tournament ·
 * DesiAuction" for every tournament in the product, so a person with three of
 * these open could not tell them apart and a pasted link named nothing. The
 * header read is deduped per request, so this costs no extra query.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const header = await headerOf(slug);
  return header === null
    ? { title: "Tournament · DesiAuction" }
    : {
        title: `${header.tournament.name} · DesiAuction`,
        description: `The seasons of ${header.tournament.name}, run by ${header.tournament.orgName} on DesiAuction.`,
      };
}

/**
 * What this page is for, in one sentence — which depends on whether it has
 * anything on it yet. "Add the first one" used to sit above a list that already
 * held a season, so the line is now decided where the seasons are known.
 */
const WHAT_A_TOURNAMENT_IS =
  "A tournament holds the editions that actually run. Add the first one to take registrations, pick teams and run auction night.";

function whatThisIs(tournamentName: string, seasons: number): string {
  return seasons === 0
    ? WHAT_A_TOURNAMENT_IS
    : `Every edition of ${tournamentName}. Add a season when the next one is ready.`;
}

/**
 * One tournament and its seasons. This is where a season is added to a
 * tournament — the create form arrives with the tournament fixed, which is the
 * only way an edition gets a parent (the standalone form on /seasons leaves it
 * null on purpose). Creation opens in a modal, so the same fixed-tournament form
 * is reused for the header action and the empty-state CTA.
 *
 * The gate is awaited HERE, before anything is committed: a non-member must get
 * a 404 with no payload, and neither a `loading.tsx` nor a Suspense boundary
 * around this call could keep that promise — both send a 200 first. Only the
 * season list, which is unbounded and the slow half of the page, streams.
 */
export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  // The sports currently switched on — the picker renders only when there is
  // more than one (SP-1 Phase 1).
  const sportOptions = await enabledSports();
  const { slug } = await params;
  const header = await headerOf(slug);
  if (header === null) {
    notFound();
  }
  const { tournament, viewer } = header;

  const addSeasonForm = (
    <CreateCompetitionForm
      sports={sportOptions}
      orgs={[{ id: tournament.orgId, name: tournament.orgName }]}
      tournamentId={tournament.id}
      suggestedName={`${tournament.name} ${String(new Date().getFullYear())}`}
    />
  );

  return (
    <main className="competitions">
      <div className="competitions-stack">
        {/* The way back is the identity bar's trail ("Tournaments"); the
            separate "← All tournaments" row repeated it. */}
        <PageTitle title={tournament.name} />
        <PageIntro
          subtitle={tournament.orgName}
          {...(viewer.canCreateSeason
            ? {
                actions: (
                  <FormDialog
                    title={`New season in ${tournament.name}`}
                    triggerLabel="Add a season"
                    size="touch"
                    triggerTestId="add-season"
                  >
                    {addSeasonForm}
                  </FormDialog>
                ),
              }
            : {})}
        />
        <Suspense fallback={<TournamentsSkeleton rows={3} />}>
          <SeasonsSection
            tournamentId={tournament.id}
            tournamentName={tournament.name}
            canCreateSeason={viewer.canCreateSeason}
            addSeasonForm={addSeasonForm}
          />
        </Suspense>
      </div>
    </main>
  );
}

async function SeasonsSection({
  tournamentId,
  tournamentName,
  canCreateSeason,
  addSeasonForm,
}: {
  tournamentId: string;
  tournamentName: string;
  canCreateSeason: boolean;
  addSeasonForm: ReactNode;
}) {
  const seasons = await tournamentSeasons(tournamentId);
  /* The best sentence in the journey used to vanish the moment it worked: it
     lived only in the empty state, so once a season existed the whole of the
     page's explanation of itself was "Demo Cricket Club · 5 seasons". It is
     drawn here, beside the seasons, so it can say the right thing about them. */
  const what = <p className="tg-what">{whatThisIs(tournamentName, seasons.length)}</p>;

  if (seasons.length === 0) {
    return (
      <>
        {what}
        <Card>
          <EmptyState
            headingLevel={2}
            title="No seasons yet"
            description={
              canCreateSeason
                ? // The line above the list already says what a tournament is;
                  // repeating it here printed the same sentence twice.
                  "Start with this year's season — dates, sport and teams come next."
                : "This tournament has no editions yet. Ask an owner to add a season."
            }
            {...(canCreateSeason
              ? {
                  action: (
                    <FormDialog
                      title={`New season in ${tournamentName}`}
                      triggerLabel="Add the first season"
                      size="lg"
                      triggerTestId="add-first-season"
                    >
                      {addSeasonForm}
                    </FormDialog>
                  ),
                }
              : {})}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <section className="seasons-section" aria-labelledby="tg-seasons-title">
        <div className="tg-section-head">
          <h2 id="tg-seasons-title" className="tg-section-title">
            Seasons <span className="tg-section-count">{seasons.length}</span>
          </h2>
          {what}
          {canCreateSeason ? null : (
            <span className="tg-cannot" data-testid="tournament-cannot-create">
              Ask an owner to add a season.
            </span>
          )}
        </div>
        <div className="competitions-grid da-stagger" data-testid="tournament-seasons">
          {seasons.map((season) => (
            <SeasonCard key={season.id} season={season} />
          ))}
        </div>
      </section>
    </>
  );
}
