import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { SportTermsProvider } from "../../../../components/sport-terms";
import { scheduleView } from "../../../../server/competition/fixture-actions";
import { SchedulePanel } from "./schedule-panel";
import "../../seasons.css";
import "../_tabs/tabs.css";
import "../lineups/lineups.css";
import "./fixtures.css";

export const metadata = { title: "Matches" };

/**
 * THE SCHEDULE TAB — one screen of matches (see schedule-panel.tsx). The
 * address is the view: `?date=` picks the week, `?team=`/`?ground=` narrow
 * it, `?q=` finds a match by number across the season, and `?match=` opens
 * one match in the side panel.
 */
export default async function FixturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const filters = {
    date: sp["date"] ?? "",
    team: sp["team"] ?? "",
    ground: sp["ground"] ?? "",
    q: sp["q"] ?? "",
    match: sp["match"] ?? "",
  };
  const view = await scheduleView(slug, filters);
  if (view === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <SportTermsProvider terms={view.terms}>
            <SchedulePanel slug={slug} view={view} filters={filters} />
          </SportTermsProvider>
        </div>
      </main>
    </ToastProvider>
  );
}
