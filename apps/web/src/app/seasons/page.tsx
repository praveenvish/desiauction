import { Badge, Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { competitionsView } from "../../server/competition/actions";
import { organizerScheduleView } from "../../server/competition/fixture-actions";
import { CreateCompetitionForm } from "./create-competition-form";
import "./seasons.css";

export const metadata = { title: "Seasons · DesiAuction" };

const STATUS_TONE = {
  draft: "neutral",
  setup: "info",
  registration_open: "success",
  registration_closed: "warning",
} as const;

export default async function CompetitionsPage() {
  const session = await currentSession();
  if (session === null) {
    // PX-3 session-expiry UX: come back exactly here after signing in.
    redirect("/login?next=/seasons");
  }
  const [view, schedule] = await Promise.all([competitionsView(), organizerScheduleView()]);
  return (
    <main className="competitions">
      <div className="competitions-stack">
        <h1>Seasons</h1>
        {schedule.length > 0 ? (
          <Card data-testid="organizer-schedule">
            <h2>Your schedule</h2>
            <ul className="calendar-day-list">
              {schedule.map((fixture) => (
                <li className="calendar-fixture" key={fixture.id}>
                  <span className="reg-number">{fixture.number}</span>
                  <span className="registration-name">
                    {fixture.homeTeamName} vs {fixture.awayTeamName}
                  </span>
                  <span className="registration-phone">
                    {fixture.kickoffAt?.replace("T", " ") ?? ""}
                    {fixture.groundName !== null ? ` · ${fixture.groundName}` : ""}
                  </span>
                  <Link href={`/seasons/${fixture.competitionSlug}/fixtures`}>
                    {fixture.competitionName}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        {view.competitions.length === 0 ? (
          <Card>
            <EmptyState
              headingLevel={2}
              title="No seasons yet"
              description="Create one inside an organization to add teams and open registration."
            />
          </Card>
        ) : (
          <div className="competitions-grid" data-testid="competitions-list">
            {view.competitions.map((competition) => (
              <Link
                key={competition.id}
                href={`/seasons/${competition.slug}`}
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
          <h2>Create a season</h2>
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
