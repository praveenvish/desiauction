import { addDays } from "@desiauction/core";
import {
  ButtonLink,
  IconArrowLeft,
  IconArrowRight,
  IconCalendar,
  IconClock,
  SectionCard,
  SegmentedTabs,
  TeamChip,
} from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatWallDate, formatWallTime } from "../../../../../lib/format-date";
import { calendarView } from "../../../../../server/competition/fixture-actions";
import { nowWallClock, type FixtureSnapshot } from "../../../../../server/competition/fixtures";
import { EmptyWeek } from "../empty-week";
import { FixtureStatusPill } from "../../_tabs/fixture-status";
import { ScheduleViews } from "../../sibling-link";
import "../../../seasons.css";
import "../../_tabs/tabs.css";
import "../fixtures.css";

export const metadata = { title: "Fixture calendar · DesiAuction" };

// Server-driven calendar (M-IP3-3): day view, week view, competition timeline
// and upcoming fixtures. Navigation is plain links — no client scheduling logic.

const VIEW_TITLE = { day: "Day", week: "Week", timeline: "Season timeline" } as const;
const VIEW_LABEL = { day: "Day", week: "Week", timeline: "Timeline" } as const;

/** One match on a day: when, who, where, and where it stands. */
function FixtureLine({ fixture, withDate }: { fixture: FixtureSnapshot; withDate: boolean }) {
  return (
    <li className="cal-line" data-testid={`cal-${fixture.number}`}>
      <span className="cal-line-time">
        {fixture.kickoffAt !== null ? (
          <>
            {withDate ? (
              <span className="st-sub">{formatWallDate(fixture.kickoffAt.slice(0, 10))}</span>
            ) : null}
            <strong>{formatWallTime(fixture.kickoffAt)}</strong>
          </>
        ) : (
          <span className="st-muted">unscheduled</span>
        )}
      </span>
      <span className="cal-line-main">
        <span className="fx-teams">
          {fixture.homeTeamId === null ? (
            <TeamChip color={null}>{fixture.squadCount} squads</TeamChip>
          ) : (
            <>
              <TeamChip color={fixture.homeTeamColor}>{fixture.homeTeamName}</TeamChip>
              <span className="fx-vs">vs</span>
              <TeamChip color={fixture.awayTeamColor}>{fixture.awayTeamName}</TeamChip>
            </>
          )}
        </span>
        <span className="cal-line-where">
          <span className="st-mono">{fixture.number}</span>
          {fixture.groundName !== null ? ` · ${fixture.groundName}` : ""}
          {fixture.venueName !== null ? ` (${fixture.venueName})` : ""}
        </span>
      </span>
      <FixtureStatusPill status={fixture.status} />
    </li>
  );
}

function Lines({
  fixtures,
  empty,
  withDate = false,
}: {
  fixtures: readonly FixtureSnapshot[];
  empty: string;
  withDate?: boolean;
}) {
  return fixtures.length === 0 ? (
    <p className="cal-none">{empty}</p>
  ) : (
    <ul className="cal-lines">
      {fixtures.map((fixture) => (
        <FixtureLine key={fixture.id} fixture={fixture} withDate={withDate} />
      ))}
    </ul>
  );
}

function count(n: number): string {
  return `${String(n)} match${n === 1 ? "" : "es"}`;
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
  const today = nowWallClock().slice(0, 10);
  const nothingHere =
    view.view !== "timeline" && view.days.every((day) => day.fixtures.length === 0);
  // The next match after the day on screen — the one jump an empty page offers.
  const next = view.upcoming.find(
    (fixture) => fixture.kickoffAt !== null && fixture.kickoffAt.slice(0, 10) > view.date,
  );
  const nextDate = next?.kickoffAt?.slice(0, 10) ?? null;
  const href = (patch: { view?: string; date?: string }) => {
    const next = new URLSearchParams();
    next.set("view", patch.view ?? view.view);
    next.set("date", patch.date ?? view.date);
    return `/seasons/${slug}/fixtures/calendar?${next.toString()}`;
  };
  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        {/* ONE ROW: the Schedule views, the range, the date — every control
            on the same 36px rung (it was 46 / 38 / 32). */}
        <div className="st-head cal-head">
          <div className="cal-left">
            <ScheduleViews slug={slug} active="calendar" />
            <SegmentedTabs
              label="Calendar view"
              items={(["day", "week", "timeline"] as const).map((name) => ({
                key: name,
                label: VIEW_LABEL[name],
                href: href({ view: name }),
                active: view.view === name,
                testId: `view-${name}`,
              }))}
            />
            {view.view !== "timeline" ? (
              <span className="cal-pager">
                <Link
                  href={href({ date: addDays(view.date, -step) })}
                  className="cal-step"
                  aria-label={view.view === "week" ? "Previous week" : "Previous day"}
                >
                  <IconArrowLeft size={16} aria-hidden />
                </Link>
                <strong data-testid="calendar-date">
                  {view.view === "week" ? "Week of " : ""}
                  {formatWallDate(view.date)}
                </strong>
                <Link
                  href={href({ date: addDays(view.date, step) })}
                  className="cal-step"
                  data-testid="calendar-next"
                  aria-label={view.view === "week" ? "Next week" : "Next day"}
                >
                  <IconArrowRight size={16} aria-hidden />
                </Link>
                {view.date !== today ? (
                  <Link href={href({ date: today })} className="cal-today">
                    Today
                  </Link>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>

        {view.view === "timeline" ? (
          <SectionCard
            icon={<IconCalendar />}
            title={VIEW_TITLE.timeline}
            description={
              view.timeline.length === 0
                ? "No scheduled fixtures yet."
                : `${count(view.timeline.length)}, in kickoff order`
            }
            flush={view.timeline.length > 0}
            data-testid="timeline-view"
          >
            {view.timeline.length > 0 ? (
              <Lines fixtures={view.timeline} empty="" withDate />
            ) : undefined}
          </SectionCard>
        ) : nothingHere ? (
          <EmptyWeek
            date={view.date}
            today={today}
            testId="calendar-empty"
            title={view.view === "week" ? "Nothing this week" : "Nothing on this day"}
            body={
              nextDate !== null
                ? `The next match is on ${formatWallDate(nextDate)}.`
                : view.upcoming.length === 0
                  ? "No matches are scheduled yet. Build the schedule from the list, then every match lands here by day."
                  : "No more matches after this date."
            }
            actions={
              <>
                {nextDate !== null ? (
                  <ButtonLink href={href({ date: nextDate })} size="sm">
                    Jump to {formatWallDate(nextDate)}
                    <IconArrowRight size={16} className="icon-trail" />
                  </ButtonLink>
                ) : null}
                {view.upcoming.length === 0 ? (
                  <ButtonLink href={`/seasons/${slug}/fixtures`} size="sm">
                    Build the schedule
                  </ButtonLink>
                ) : null}
              </>
            }
          />
        ) : (
          view.days.map((day) => (
            /* A calendar that never names a weekday is not a calendar. */
            <SectionCard
              key={day.date}
              icon={<IconCalendar />}
              tone={day.fixtures.length > 0 ? "gold" : "neutral"}
              title={formatWallDate(day.date)}
              description={day.fixtures.length === 0 ? "No fixtures" : count(day.fixtures.length)}
              flush={day.fixtures.length > 0}
              data-testid={`day-${day.date}`}
            >
              {day.fixtures.length > 0 ? <Lines fixtures={day.fixtures} empty="" /> : undefined}
            </SectionCard>
          ))
        )}

        {view.upcoming.length > 0 ? (
          <SectionCard
            icon={<IconClock />}
            concept="fixtures"
            title="Upcoming fixtures"
            description={
              view.upcoming.length === 0 ? "Nothing upcoming." : "The next matches to be played"
            }
            flush={view.upcoming.length > 0}
            data-testid="upcoming-panel"
          >
            <Lines fixtures={view.upcoming} empty="" withDate />
          </SectionCard>
        ) : null}
      </div>
    </main>
  );
}
