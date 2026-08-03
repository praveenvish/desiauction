import { addDays } from "@desiauction/core";
import { ButtonLink, Card, ToastProvider } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatWallDate } from "../../../../../lib/format-date";
import { matchDayView } from "../../../../../server/competition/fixture-actions";
import { MatchDayPanel } from "./match-day-panel";
import "../../../seasons.css";

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
          <header className="dash-head">
            <div className="competition-title-row title-row-actions">
              <ButtonLink href={`/seasons/${slug}/fixtures`} variant="secondary">
                Fixtures
              </ButtonLink>
            </div>
          </header>

          <Card>
            <nav className="calendar-nav" aria-label="Match day">
              <span className="date-row">
                <Link href={dayHref(addDays(view.date, -1))} className="calendar-tab">
                  ← previous day
                </Link>
                <strong data-testid="match-day-date">{formatWallDate(view.date)}</strong>
                <Link href={dayHref(addDays(view.date, 1))} className="calendar-tab">
                  next day →
                </Link>
              </span>
            </nav>
          </Card>

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
