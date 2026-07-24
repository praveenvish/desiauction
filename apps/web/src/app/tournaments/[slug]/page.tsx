import { Card, EmptyState, PageIntro, SectionHeader } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { FormDialog } from "../../../components/form-dialog";
import { PageTitle } from "../../../components/shell/page-title";
import { tournamentDetail } from "../../../server/competition/tournament-actions";
import { CreateCompetitionForm } from "../../seasons/create-competition-form";
import { SeasonCard } from "../season-card";
import "../../seasons/seasons.css";

export const metadata = { title: "Tournament · DesiAuction" };

/**
 * One tournament and its seasons. This is where a season is added to a
 * tournament — the create form arrives with the tournament fixed, which is the
 * only way an edition gets a parent (the standalone form on /seasons leaves it
 * null on purpose). Creation opens in a modal, so the same fixed-tournament form
 * is reused for the header action and the empty-state CTA.
 */
export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await tournamentDetail(slug);
  if (detail === null) {
    notFound();
  }
  const { tournament, seasons } = detail;

  const addSeasonForm = (
    <CreateCompetitionForm
      orgs={[{ id: tournament.orgId, name: tournament.orgName }]}
      tournamentId={tournament.id}
    />
  );

  return (
    <main className="competitions">
      <div className="competitions-stack">
        <PageTitle title={tournament.name} />
        <PageIntro
          subtitle={`${tournament.orgName} · ${
            seasons.length === 0
              ? "no seasons yet"
              : `${String(seasons.length)} season${seasons.length === 1 ? "" : "s"}`
          }`}
          actions={
            <FormDialog
              title={`New season in ${tournament.name}`}
              triggerLabel="Add a season"
              triggerTestId="add-season"
            >
              {addSeasonForm}
            </FormDialog>
          }
        />

        {seasons.length === 0 ? (
          <Card>
            <EmptyState
              headingLevel={2}
              title="No seasons yet"
              description="A tournament holds the editions that actually run. Add the first one to take registrations, pick teams and run auction night."
              action={
                <FormDialog
                  title={`New season in ${tournament.name}`}
                  triggerLabel="Add the first season"
                  size="lg"
                  triggerTestId="add-first-season"
                >
                  {addSeasonForm}
                </FormDialog>
              }
            />
          </Card>
        ) : (
          <section className="seasons-section">
            <SectionHeader title="Seasons" />
            <div className="competitions-grid" data-testid="tournament-seasons">
              {seasons.map((season) => (
                <SeasonCard key={season.id} season={season} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
