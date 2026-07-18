import { Badge, ButtonLink, Card, EmptyState, PageHeader, SectionHeader } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auctionDashboard } from "../../server/auction/actions";
import { currentSession } from "../../server/auth/actions";
import { competitionsView, registrationDashboard } from "../../server/competition/actions";
import { organizerScheduleView } from "../../server/competition/fixture-actions";
import { myRegistrations } from "../../server/competition/public";
import { HomeShortcuts } from "./home-shortcuts";
import "./home.css";

export const metadata = { title: "Home · DesiAuction" };

const REG_TONE: Record<string, "info" | "success" | "warning" | "danger" | "neutral"> = {
  submitted: "info",
  approved: "success",
  waitlisted: "warning",
  rejected: "danger",
  withdrawn: "neutral",
  draft: "neutral",
};

const STATUS_TONE = {
  draft: "neutral",
  setup: "info",
  registration_open: "success",
  registration_closed: "warning",
} as const;

interface AttentionRow {
  key: string;
  label: string;
  detail: string;
  href: string;
}

/** Attention scan is bounded: newest competitions first, at most this many. */
const ATTENTION_SCAN_LIMIT = 8;

export default async function HomePage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/home");
  }
  // PX-3: first-time onboarding — a nameless account completes its profile
  // before the console greets it. Token paths (/join, register) are never
  // hijacked; only the home destination enforces this.
  if (session.name === null || session.name.trim() === "") {
    redirect("/onboarding");
  }
  const [view, schedule, registrationsMine] = await Promise.all([
    competitionsView(),
    organizerScheduleView(),
    myRegistrations(session.personId),
  ]);

  const attention: AttentionRow[] = [];
  for (const competition of view.competitions.slice(0, ATTENTION_SCAN_LIMIT)) {
    if (competition.status === "registration_open") {
      const dashboard = await registrationDashboard(competition.slug, {});
      if (dashboard !== null && dashboard.viewer.canReview && dashboard.stats.submitted > 0) {
        attention.push({
          key: `reg-${competition.id}`,
          label: `${String(dashboard.stats.submitted)} registration${dashboard.stats.submitted === 1 ? "" : "s"} to review`,
          detail: competition.name,
          href: `/competitions/${competition.slug}/registrations`,
        });
      }
    } else if (competition.status === "registration_closed") {
      const dashboard = await auctionDashboard(competition.slug);
      if (dashboard !== null && dashboard.viewer.canConduct) {
        if (dashboard.view === null) {
          const blockers = dashboard.ready.checks.filter((check) => !check.pass).length;
          attention.push({
            key: `auction-${competition.id}`,
            label:
              blockers > 0
                ? `Auction readiness: ${String(blockers)} blocker${blockers === 1 ? "" : "s"}`
                : "Ready — create the auction",
            detail: competition.name,
            // PX-4: blockers land on the Readiness Center, not the auction hub.
            href:
              blockers > 0
                ? `/competitions/${competition.slug}/readiness`
                : `/competitions/${competition.slug}/auction`,
          });
        }
      }
    }
  }

  const greeting = greetingFor(new Date(), session.name);

  return (
    <main className="home">
      <PageHeader
        title={greeting}
        subtitle="Here's what needs you."
        actions={
          view.orgs.length > 0 ? (
            <ButtonLink href="/competitions">Create a competition</ButtonLink>
          ) : undefined
        }
      />

      {view.orgs.length === 0 &&
      view.competitions.length === 0 &&
      registrationsMine.length === 0 ? (
        <Card>
          <EmptyState
            headingLevel={2}
            title="Welcome to DesiAuction"
            description="Your auction night starts with an organization."
            action={<ButtonLink href="/orgs">Create your organization</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          <Card data-testid="attention-queue">
            <SectionHeader title="Needs attention" />
            {attention.length === 0 ? (
              <p className="home-hint">All clear — nothing is waiting on you.</p>
            ) : (
              <ul className="home-attention-list">
                {attention.map((row) => (
                  <li key={row.key}>
                    <Link href={row.href} className="home-attention-row">
                      <span className="home-attention-label">{row.label}</span>
                      <span className="home-attention-detail">{row.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {registrationsMine.length > 0 ? (
            <>
              <SectionHeader title="My registrations" />
              <Card data-testid="home-registrations">
                <ul className="home-attention-list">
                  {registrationsMine.map((registration) => (
                    <li key={registration.competitionSlug}>
                      <Link
                        href={`/competitions/${registration.competitionSlug}/register`}
                        className="home-attention-row"
                      >
                        <span className="home-attention-label">
                          {registration.competitionName}
                          <Badge tone={REG_TONE[registration.status] ?? "neutral"}>
                            {registration.status}
                          </Badge>
                        </span>
                        <span className="home-attention-detail">
                          {registration.orgName} · {registration.role.replace(/_/g, " ")} ·{" "}
                          {registration.number}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          ) : null}

          <HomeShortcuts
            competitions={view.competitions.map((competition) => ({
              slug: competition.slug,
              name: competition.name,
              orgName: competition.orgName,
            }))}
          />

          <SectionHeader title="Your competitions" />
          {view.competitions.length === 0 ? (
            <Card>
              <EmptyState
                headingLevel={3}
                title="No competitions yet"
                description="Create one inside an organization to add teams and open registration."
                action={<ButtonLink href="/competitions">Create a competition</ButtonLink>}
              />
            </Card>
          ) : (
            <div className="home-grid" data-testid="home-competitions">
              {view.competitions.map((competition) => (
                <Link
                  key={competition.id}
                  href={`/competitions/${competition.slug}`}
                  className="home-card-link"
                >
                  <Card>
                    <strong>{competition.name}</strong>
                    <span className="home-card-sub">{competition.orgName}</span>
                    <Badge tone={STATUS_TONE[competition.status]}>
                      {competition.status.replace(/_/g, " ")}
                    </Badge>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          {schedule.length > 0 ? (
            <>
              <SectionHeader title="Your schedule" />
              <Card>
                <ul className="home-schedule">
                  {schedule.slice(0, 5).map((fixture) => (
                    <li key={fixture.id} className="home-schedule-row">
                      <span className="home-schedule-teams">
                        {fixture.homeTeamName} vs {fixture.awayTeamName}
                      </span>
                      <span className="home-schedule-when">
                        {fixture.kickoffAt?.replace("T", " ") ?? "Unscheduled"}
                        {fixture.groundName !== null ? ` · ${fixture.groundName}` : ""}
                      </span>
                      <Link href={`/competitions/${fixture.competitionSlug}/fixtures`}>
                        {fixture.competitionName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          ) : null}

          <SectionHeader title="Your organizations" />
          <div className="home-grid" data-testid="home-orgs">
            {view.orgs.map((org) => (
              <Card key={org.id}>
                <strong>{org.name}</strong>
              </Card>
            ))}
            <Link href="/orgs" className="home-card-link">
              <Card>
                <span className="home-hint">Manage or create organizations →</span>
              </Card>
            </Link>
          </div>
        </>
      )}
    </main>
  );
}

function greetingFor(now: Date, name: string | null): string {
  const hour = now.getHours();
  const daypart = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return name !== null && name.trim() !== "" ? `${daypart}, ${name.trim()}` : daypart;
}
