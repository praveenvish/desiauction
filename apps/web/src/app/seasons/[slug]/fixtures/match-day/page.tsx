import { addDays } from "@desiauction/core";
import { ButtonLink, IconArrowLeft, IconArrowRight, ToastProvider } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatWallDate } from "../../../../../lib/format-date";
import { calendarView, matchDayView } from "../../../../../server/competition/fixture-actions";
import { nowWallClock } from "../../../../../server/competition/fixtures";
import { EmptyWeek } from "../empty-week";
import { ScheduleViews } from "../../sibling-link";
import { MatchDayPanel } from "./match-day-panel";
import "../../../seasons.css";
import "../../_tabs/tabs.css";
import "../fixtures.css";

export const metadata = { title: "Match day · DesiAuction" };

export default async function MatchDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const view = await matchDayView(slug, {
    ...(sp["date"] !== undefined ? { date: sp["date"] } : {}),
  });
  if (view === null) {
    notFound();
  }
  const today = nowWallClock().slice(0, 10);
  // An empty day offers the next one that has a match — read from the
  // calendar's own upcoming list (the same action, no new query).
  const upcoming =
    view.groundGroups.length === 0 ? ((await calendarView(slug, {}))?.upcoming ?? []) : [];
  const nextDate =
    upcoming
      .map((fixture) => fixture.kickoffAt?.slice(0, 10) ?? null)
      .find((day): day is string => day !== null && day > view.date) ?? null;
  const dayHref = (date: string) => `/seasons/${slug}/fixtures/match-day?date=${date}`;
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <div className="st-head cal-head">
            <div className="cal-left">
              <ScheduleViews slug={slug} active="match-day" />
              <span className="cal-pager">
                <Link
                  href={dayHref(addDays(view.date, -1))}
                  className="cal-step"
                  aria-label="Previous day"
                >
                  <IconArrowLeft size={16} aria-hidden />
                </Link>
                <strong data-testid="match-day-date">{formatWallDate(view.date)}</strong>
                <Link
                  href={dayHref(addDays(view.date, 1))}
                  className="cal-step"
                  aria-label="Next day"
                >
                  <IconArrowRight size={16} aria-hidden />
                </Link>
              </span>
            </div>
          </div>

          <MatchDayPanel
            slug={slug}
            groundGroups={view.groundGroups}
            canManage={view.viewer.canManage}
            empty={
              <EmptyWeek
                date={view.date}
                today={today}
                testId="match-day-empty"
                title="No matches on this day"
                body={
                  nextDate !== null
                    ? `The next match day is ${formatWallDate(nextDate)}.`
                    : upcoming.length === 0
                      ? "Nothing is scheduled yet. Build the schedule from the list; each match day then gathers its grounds here."
                      : "No more match days after this one."
                }
                actions={
                  nextDate !== null ? (
                    <ButtonLink href={dayHref(nextDate)} size="sm">
                      Next match day
                      <IconArrowRight size={16} className="icon-trail" />
                    </ButtonLink>
                  ) : upcoming.length === 0 ? (
                    <ButtonLink href={`/seasons/${slug}/fixtures`} size="sm">
                      Build the schedule
                    </ButtonLink>
                  ) : undefined
                }
              />
            }
          />
        </div>
      </main>
    </ToastProvider>
  );
}
