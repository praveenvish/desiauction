import { addDays } from "@desiauction/core";
import {
  ButtonLink,
  IconArrowLeft,
  IconArrowRight,
  IconCalendar,
  IconList,
  ToastProvider,
} from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatWallDate } from "../../../../../lib/format-date";
import { matchDayView } from "../../../../../server/competition/fixture-actions";
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
  const dayHref = (date: string) => `/seasons/${slug}/fixtures/match-day?date=${date}`;
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <div className="st-head">
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
            <div className="st-actions">
              <ButtonLink href={`/seasons/${slug}/fixtures`} variant="secondary" size="sm">
                <IconList size={16} aria-hidden />
                Fixture list
              </ButtonLink>
              <ButtonLink href={`/seasons/${slug}/fixtures/calendar`} variant="secondary" size="sm">
                <IconCalendar size={16} aria-hidden />
                Calendar
              </ButtonLink>
            </div>
          </div>

          <MatchDayPanel
            slug={slug}
            groundGroups={view.groundGroups}
            canManage={view.viewer.canManage}
          />
        </div>
      </main>
    </ToastProvider>
  );
}
