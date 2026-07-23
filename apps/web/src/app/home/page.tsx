import { Badge, ButtonLink, Card, EmptyState, PageHeader, SectionHeader } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

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

/* Tile glyphs live here rather than the icon set: the dashboard needs a
   calendar and a review clipboard, which the shell's rail icons do not carry. */
const IconTrophyTile = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M7 4h10v3a5 5 0 0 1-10 0V4ZM4 5H2v2a3 3 0 0 0 3 3M20 5h2v2a3 3 0 0 1-3 3M9 15h6v5H9z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconUsersTile = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M16 11a4 4 0 1 0-8 0M4 20a6 6 0 0 1 16 0"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);
const IconReviewTile = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="m9 11 3 3L22 4M21 12v7H3V5h12"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconCalendarTile = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M7 3v4M17 3v4M4 9h16M5 5h14v16H5z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function StatTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "accent" | "info" | "warn" | "gold";
  icon: ReactNode;
}) {
  return (
    <div className="home-tile">
      <span className={`home-tile-ic home-tile-ic--${tone}`}>{icon}</span>
      <span className="home-tile-body">
        <span className="home-tile-label">{label}</span>
        <span className="home-tile-value">{value}</span>
      </span>
    </div>
  );
}

/** Two-letter monogram for a competition/org crest. */
function monogram(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "—"
  );
}

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
  // Aggregated from the SAME reads the attention scan already performs — the
  // tiles add no queries and invent no numbers.
  let pendingReviews = 0;
  for (const competition of view.competitions.slice(0, ATTENTION_SCAN_LIMIT)) {
    if (competition.status === "registration_open") {
      const dashboard = await registrationDashboard(competition.slug, {});
      if (dashboard !== null && dashboard.viewer.canReview) {
        pendingReviews += dashboard.stats.submitted;
        if (dashboard.stats.submitted > 0) {
          attention.push({
            key: `reg-${competition.id}`,
            label: `${String(dashboard.stats.submitted)} registration${dashboard.stats.submitted === 1 ? "" : "s"} to review`,
            detail: competition.name,
            href: `/competitions/${competition.slug}/registrations`,
          });
        }
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
  const isEmpty =
    view.orgs.length === 0 && view.competitions.length === 0 && registrationsMine.length === 0;

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

      {isEmpty ? (
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
          <div className="home-stats" data-testid="home-stats">
            <StatTile
              label="Competitions"
              value={view.competitions.length}
              tone="accent"
              icon={IconTrophyTile}
            />
            <StatTile
              label="Organizations"
              value={view.orgs.length}
              tone="info"
              icon={IconUsersTile}
            />
            <StatTile
              label="To review"
              value={pendingReviews}
              tone="warn"
              icon={IconReviewTile}
            />
            <StatTile
              label="Upcoming fixtures"
              value={schedule.length}
              tone="gold"
              icon={IconCalendarTile}
            />
          </div>

          <div className="home-columns">
            <div className="home-col">
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
                        <span className="home-comp">
                          <span className="home-crest" aria-hidden>
                            {monogram(competition.name)}
                          </span>
                          <span className="home-comp-text">
                            <strong>{competition.name}</strong>
                            <span className="home-card-sub">{competition.orgName}</span>
                          </span>
                        </span>
                        <Badge tone={STATUS_TONE[competition.status]}>
                          {competition.status.replace(/_/g, " ")}
                        </Badge>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}

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
            </div>

            <div className="home-col home-col--side">
              {schedule.length > 0 ? (
                <Card>
                  <SectionHeader title="Upcoming fixtures" />
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
              ) : null}

              <Card>
                <SectionHeader title="Your organizations" />
                <ul className="home-org-list" data-testid="home-orgs">
                  {view.orgs.map((org) => (
                    <li key={org.id} className="home-org-row">
                      <span className="home-crest home-crest--sm" aria-hidden>
                        {monogram(org.name)}
                      </span>
                      <strong>{org.name}</strong>
                    </li>
                  ))}
                </ul>
                <Link href="/orgs" className="home-side-link">
                  Manage or create organizations →
                </Link>
              </Card>
            </div>
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
