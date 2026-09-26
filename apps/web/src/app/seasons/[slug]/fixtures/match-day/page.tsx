import { addDays } from "@desiauction/core";
import {
  ButtonLink,
  EmptyState,
  IconArrowLeft,
  IconArrowRight,
  IconCalendar,
  SectionCard,
  ToastProvider,
} from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatWallDate } from "../../../../../lib/format-date";
import { calendarView, matchDayView } from "../../../../../server/competition/fixture-actions";
import { emptyScheduleStep } from "../empty-schedule-step";
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
  // An empty day offers the next one that has a match — read from the
  // calendar's own upcoming list (the same action, no new query).
  const upcoming =
    view.groundGroups.length === 0 ? ((await calendarView(slug, {}))?.upcoming ?? []) : [];
  const nextDate =
    upcoming
      .map((fixture) => fixture.kickoffAt?.slice(0, 10) ?? null)
      .find((day): day is string => day !== null && day > view.date) ?? null;
  const step =
    view.groundGroups.length === 0 && upcoming.length === 0 ? await emptyScheduleStep(slug) : null;
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
              /* One day, not a week: the week strip and the round-robin
                 preview are the Calendar's (round-5 review: Match day read as
                 its copy). A day with nothing on it says so and offers the
                 next match day, or the step that makes one. */
              <SectionCard
                title="No matches on this day"
                hideHeader
                size="feature"
                data-testid="match-day-empty"
              >
                <EmptyState
                  icon={<IconCalendar />}
                  title="No matches on this day"
                  description={
                    nextDate !== null
                      ? `The next match day is ${formatWallDate(nextDate)}.`
                      : upcoming.length === 0
                        ? `Nothing is scheduled yet. ${step?.why ?? ""} Each match day then gathers its grounds here.`
                        : "No more match days after this one."
                  }
                  {...(nextDate !== null
                    ? {
                        action: (
                          <ButtonLink href={dayHref(nextDate)} size="sm">
                            Next match day
                            <IconArrowRight size={16} className="icon-trail" />
                          </ButtonLink>
                        ),
                      }
                    : step !== null
                      ? {
                          action: (
                            <ButtonLink href={step.href} size="sm">
                              {step.label}
                            </ButtonLink>
                          ),
                        }
                      : {})}
                />
              </SectionCard>
            }
          />
        </div>
      </main>
    </ToastProvider>
  );
}
