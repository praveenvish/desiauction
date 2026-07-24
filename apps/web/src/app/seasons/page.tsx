import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageIntro,
  SectionHeader,
  Stat,
  StatRow,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FormDialog } from "../../components/form-dialog";
import { PageAction } from "../../components/shell/page-action";
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

const STATUS_LABEL = {
  draft: "Draft",
  setup: "In setup",
  registration_open: "Registration open",
  registration_closed: "Registration closed",
} as const;

/** "1 Aug – 15 Aug 2026", or a single dated end, or nothing. Days arrive as ISO. */
function dateRange(startsOn: string | null, endsOn: string | null): string | null {
  const day = (iso: string, withYear: boolean): string =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  if (startsOn === null && endsOn === null) {
    return null;
  }
  if (startsOn === null) {
    return day(endsOn ?? "", true);
  }
  if (endsOn === null) {
    return day(startsOn, true);
  }
  return `${day(startsOn, false)} – ${day(endsOn, true)}`;
}

export default async function CompetitionsPage() {
  const session = await currentSession();
  if (session === null) {
    // PX-3 session-expiry UX: come back exactly here after signing in.
    redirect("/login?next=/seasons");
  }
  const [view, schedule] = await Promise.all([competitionsView(), organizerScheduleView()]);

  // Counted from the rows already in hand — the summary row costs no extra query.
  const open = view.competitions.filter((c) => c.status === "registration_open").length;
  const inFlight = view.competitions.filter(
    (c) => c.status === "setup" || c.status === "registration_open",
  ).length;

  return (
    <main className="competitions">
      <div className="competitions-stack">
        <PageIntro subtitle="Every season you run or play in, across your organizations." />
        <PageAction>
          {view.orgs.length > 0 ? (
            <FormDialog
              title="New season"
              triggerLabel="New season"
              size="sm"
              triggerTestId="new-season"
            >
              <CreateCompetitionForm orgs={view.orgs} />
            </FormDialog>
          ) : (
            <ButtonLink href="/orgs" variant="secondary" size="sm">
              Create an organization
            </ButtonLink>
          )}
        </PageAction>

        {view.competitions.length > 0 ? (
          <div data-testid="seasons-summary">
            <StatRow label="Season summary">
              <Stat label="Seasons" value={view.competitions.length} />
              <Stat
                label="Accepting entries"
                value={open}
                tone={open > 0 ? "success" : "neutral"}
              />
              <Stat label="In flight" value={inFlight} />
              <Stat label="Organizations" value={view.orgs.length} />
            </StatRow>
          </div>
        ) : null}

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
          <section className="seasons-section">
            <SectionHeader title="All seasons" />
            <div className="competitions-grid" data-testid="competitions-list">
              {view.competitions.map((competition) => {
                const when = dateRange(competition.startsOn, competition.endsOn);
                const hasMeta = when !== null || competition.location !== null;
                return (
                  <Link
                    key={competition.id}
                    href={`/seasons/${competition.slug}`}
                    className="competition-link"
                  >
                    <Card padding="none">
                      <article className="season-card">
                        <div className="season-card-top">
                          <Badge tone={STATUS_TONE[competition.status]}>
                            {STATUS_LABEL[competition.status]}
                          </Badge>
                        </div>
                        <strong>{competition.name}</strong>
                        <span className="competition-org">{competition.orgName}</span>
                        {hasMeta ? (
                          <dl className="season-card-meta">
                            {when !== null ? (
                              <div>
                                <dt>When</dt>
                                <dd>{when}</dd>
                              </div>
                            ) : null}
                            {competition.location !== null ? (
                              <div>
                                <dt>Where</dt>
                                <dd>{competition.location}</dd>
                              </div>
                            ) : null}
                          </dl>
                        ) : null}
                      </article>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* Creation lives in the header modal now. The only thing left to say
            here is the one blocker — no org yet. */}
        {view.orgs.length === 0 ? (
          <Card>
            <p className="competitions-hint">
              You need an organization first. <Link href="/orgs">Create or join one</Link>, then
              come back to run a season.
            </p>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
