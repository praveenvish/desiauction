import { ButtonLink, Card, EmptyState, PageHeader } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { organizerScheduleView } from "../../server/competition/fixture-actions";
import "../workspace.css";

export const metadata = { title: "Fixtures · DesiAuction" };

export default async function FixturesPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/fixtures");
  }
  const schedule = await organizerScheduleView();
  return (
    <main className="ws">
      <PageHeader title="Fixtures" subtitle="Your schedule across every competition." />
      <Card padding={schedule.length === 0 ? "default" : "dense"}>
        {schedule.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title="Nothing scheduled"
            description="Generate a schedule inside a competition and its matches appear here."
            action={<ButtonLink href="/competitions">Open competitions</ButtonLink>}
          />
        ) : (
          <ul className="ws-list" data-testid="fixtures-list">
            {schedule.map((fixture) => {
              const when = fixture.kickoffAt !== null ? new Date(fixture.kickoffAt) : null;
              return (
                <li key={fixture.id}>
                  <Link
                    href={`/competitions/${fixture.competitionSlug}/fixtures`}
                    className="ws-row"
                  >
                    <span className="ws-crest" aria-hidden>
                      {when !== null ? String(when.getDate()).padStart(2, "0") : "--"}
                    </span>
                    <span className="ws-text">
                      <strong>
                        {fixture.homeTeamName} vs {fixture.awayTeamName}
                      </strong>
                      <span>
                        {fixture.competitionName}
                        {fixture.groundName !== null ? ` · ${fixture.groundName}` : ""}
                      </span>
                    </span>
                    <span className="ws-meta">
                      <span className="ws-stat">
                        <b>
                          {when !== null
                            ? when.toLocaleString("en-IN", {
                                day: "2-digit",
                                month: "short",
                              })
                            : "TBD"}
                        </b>
                        <span>Kickoff</span>
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </main>
  );
}
