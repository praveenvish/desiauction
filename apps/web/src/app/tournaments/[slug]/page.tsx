import { Card, EmptyState, IconArrowLeft, PageIntro, SectionHeader } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

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
 * The tab and every shared link used to read the literal "Tournament ·
 * DesiAuction" for every tournament in the product, so a person with three of
 * these open could not tell them apart and a pasted link named nothing. The
 * header read is deduped per request, so this costs no extra query.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const header = await tournamentHeader(slug);
  return header === null
    ? { title: "Tournament · DesiAuction" }
    : {
        title: `${header.tournament.name} · DesiAuction`,
        description: `The seasons of ${header.tournament.name}, run by ${header.tournament.orgName} on DesiAuction.`,
      };
}

/** What this page is for, in one sentence. */
const WHAT_A_TOURNAMENT_IS =
  "A tournament holds the editions that actually run. Add the first one to take registrations, pick teams and run auction night.";

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
  const { slug } = await params;
  const header = await tournamentHeader(slug);
  if (header === null) {
    notFound();
  }
  const { tournament, viewer } = header;

  const addSeasonForm = (
    <CreateCompetitionForm
      orgs={[{ id: tournament.orgId, name: tournament.orgName }]}
      tournamentId={tournament.id}
    />
  );

  return (
    <main className="competitions">
      <div className="competitions-stack">
        {/* This page had no way back but the browser's own button. */}
        <p className="tg-backlink">
          <Link href="/tournaments">
            <IconArrowLeft width={14} height={14} aria-hidden />
            All tournaments
          </Link>
        </p>
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
        {/* The best sentence in the journey used to vanish the moment it worked:
            it lived only in the empty state, so once a season existed the whole
            of the page's explanation of itself was "Demo Cricket Club · 5
            seasons". */}
        <p className="tg-what">{WHAT_A_TOURNAMENT_IS}</p>

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

  if (seasons.length === 0) {
    return (
      <Card>
        <EmptyState
          headingLevel={2}
          title="No seasons yet"
          description={
            canCreateSeason
              ? WHAT_A_TOURNAMENT_IS
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
    );
  }

  return (
    <section className="seasons-section">
      <SectionHeader
        title={`Seasons (${String(seasons.length)})`}
        {...(canCreateSeason
          ? {}
          : {
              actions: (
                <span className="tg-cannot" data-testid="tournament-cannot-create">
                  Ask an owner to add a season.
                </span>
              ),
            })}
      />
      <div className="competitions-grid" data-testid="tournament-seasons">
        {seasons.map((season) => (
          <SeasonCard key={season.id} season={season} />
        ))}
      </div>
    </section>
  );
}
