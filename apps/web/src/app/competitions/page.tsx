import { Badge, Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { competitionsView } from "../../server/competition/actions";
import { CreateCompetitionForm } from "./create-competition-form";
import "./competitions.css";

export const metadata = { title: "Competitions · DesiAuction" };

const STATUS_TONE = {
  draft: "neutral",
  setup: "info",
  registration_open: "success",
  registration_closed: "warning",
} as const;

export default async function CompetitionsPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  const view = await competitionsView();
  return (
    <main className="competitions">
      <div className="competitions-stack">
        <h1>Competitions</h1>
        {view.competitions.length === 0 ? (
          <Card>
            <EmptyState
              headingLevel={2}
              title="No competitions yet"
              description="Create one inside an organization to add teams and open registration."
            />
          </Card>
        ) : (
          <div className="competitions-grid" data-testid="competitions-list">
            {view.competitions.map((competition) => (
              <Link
                key={competition.id}
                href={`/competitions/${competition.slug}`}
                className="competition-link"
              >
                <Card>
                  <strong>{competition.name}</strong>
                  <span className="competition-org">{competition.orgName}</span>
                  <Badge tone={STATUS_TONE[competition.status]}>
                    {competition.status.replace(/_/g, " ")}
                  </Badge>
                </Card>
              </Link>
            ))}
          </div>
        )}
        <Card>
          <h2>Create a competition</h2>
          {view.orgs.length === 0 ? (
            <p className="competitions-hint">
              You need an organization first. <Link href="/orgs">Create or join one</Link>, then
              come back.
            </p>
          ) : (
            <CreateCompetitionForm orgs={view.orgs} />
          )}
        </Card>
      </div>
    </main>
  );
}
