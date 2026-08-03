import { addDays } from "@desiauction/core";
import { Badge, ButtonLink, Card } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatKickoff, formatWallDate } from "../../../../../lib/format-date";
import { calendarView } from "../../../../../server/competition/fixture-actions";
import type { FixtureSnapshot } from "../../../../../server/competition/fixtures";
import "../../../seasons.css";

export const metadata = { title: "Fixture calendar · DesiAuction" };

// Server-driven calendar (M-IP3-3): day view, week view, competition timeline
// and upcoming fixtures. Navigation is plain links — no client scheduling logic.

const FIXTURE_TONE = {
  draft: "neutral",
  scheduled: "info",
  published: "success",
  in_progress: "warning",
  completed: "neutral",
  cancelled: "danger",
} as const;

function FixtureLine({ fixture }: { fixture: FixtureSnapshot }) {
  return (
    <li className="calendar-fixture" data-testid={`cal-${fixture.number}`}>
      <span className="reg-number">{fixture.number}</span>
      <span className="registration-name">
        {fixture.homeTeamName} vs {fixture.awayTeamName}
      </span>
      <span className="registration-phone">
        {fixture.kickoffAt !== null ? formatKickoff(fixture.kickoffAt) : "unscheduled"}
        {fixture.groundName !== null ? ` · ${fixture.groundName}` : ""}
        {fixture.venueName !== null ? ` (${fixture.venueName})` : ""}
      </span>
      <Badge tone={FIXTURE_TONE[fixture.status]}>{fixture.status.replace(/_/g, " ")}</Badge>
    </li>
  );
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const view = await calendarView(slug, {
    ...(sp["view"] !== undefined ? { view: sp["view"] } : {}),
    ...(sp["date"] !== undefined ? { date: sp["date"] } : {}),
  });
  if (view === null) {
    notFound();
  }
  const step = view.view === "week" ? 7 : 1;
  const href = (patch: { view?: string; date?: string }) => {
    const next = new URLSearchParams();
    next.set("view", patch.view ?? view.view);
    next.set("date", patch.date ?? view.date);
    return `/seasons/${slug}/fixtures/calendar?${next.toString()}`;
  };
  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <header className="dash-head">
          <div className="competition-title-row title-row-actions">
            <ButtonLink href={`/seasons/${slug}/fixtures`} variant="secondary">
              Fixtures
            </ButtonLink>
          </div>
        </header>

        <Card>
          <nav className="calendar-nav" aria-label="Calendar view">
            <span className="date-row">
              {(["day", "week", "timeline"] as const).map((name) => (
                <Link
                  key={name}
                  href={href({ view: name })}
                  className={view.view === name ? "calendar-tab active" : "calendar-tab"}
                  data-testid={`view-${name}`}
                  aria-current={view.view === name ? "page" : undefined}
                >
                  {name}
                </Link>
              ))}
            </span>
            {view.view !== "timeline" ? (
              <span className="date-row">
                <Link href={href({ date: addDays(view.date, -step) })} className="calendar-tab">
                  ← previous
                </Link>
                <strong data-testid="calendar-date">{formatWallDate(view.date)}</strong>
                <Link
                  href={href({ date: addDays(view.date, step) })}
                  className="calendar-tab"
                  data-testid="calendar-next"
                >
                  next →
                </Link>
              </span>
            ) : null}
          </nav>
        </Card>

        {view.view === "timeline" ? (
          <Card data-testid="timeline-view">
            <h2>Season timeline</h2>
            {view.timeline.length === 0 ? (
              <p className="competitions-hint">No scheduled fixtures yet.</p>
            ) : (
              <ul className="calendar-day-list">
                {view.timeline.map((fixture) => (
                  <FixtureLine key={fixture.id} fixture={fixture} />
                ))}
              </ul>
            )}
          </Card>
        ) : (
          view.days.map((day) => (
            <Card key={day.date} data-testid={`day-${day.date}`}>
              {/* A calendar that never names a weekday is not a calendar. */}
              <h2>{formatWallDate(day.date)}</h2>
              {day.fixtures.length === 0 ? (
                <p className="competitions-hint">No fixtures.</p>
              ) : (
                <ul className="calendar-day-list">
                  {day.fixtures.map((fixture) => (
                    <FixtureLine key={fixture.id} fixture={fixture} />
                  ))}
                </ul>
              )}
            </Card>
          ))
        )}

        <Card data-testid="upcoming-panel">
          <h2>Upcoming fixtures</h2>
          {view.upcoming.length === 0 ? (
            <p className="competitions-hint">Nothing upcoming.</p>
          ) : (
            <ul className="calendar-day-list">
              {view.upcoming.map((fixture) => (
                <FixtureLine key={fixture.id} fixture={fixture} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
