import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { fixtureDashboard } from "../../../../server/competition/fixture-actions";
import { FixturesPanel } from "./fixtures-panel";
import "../../seasons.css";

export const metadata = { title: "Fixtures · DesiAuction" };

export default async function FixturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const dashboard = await fixtureDashboard(slug, {
    ...(sp["status"] !== undefined ? { status: sp["status"] } : {}),
    ...(sp["team"] !== undefined ? { team: sp["team"] } : {}),
    ...(sp["ground"] !== undefined ? { ground: sp["ground"] } : {}),
    ...(sp["q"] !== undefined ? { q: sp["q"] } : {}),
    ...(sp["sort"] !== undefined ? { sort: sp["sort"] } : {}),
    ...(sp["page"] !== undefined ? { page: sp["page"] } : {}),
  });
  if (dashboard === null) {
    notFound();
  }
  // How many rounds this schedule spans — the design's "N fixtures across M
  // rounds". Counted over the SCHEDULE (fixtureStats), not over the 25 rows of
  // the current page, which reported a 30-round season as 4 rounds.
  const rounds = dashboard.stats.rounds;
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <header className="dash-head">
            <div className="competition-title-row title-row-actions">
              <span className="date-row">
                <ButtonLink
                  href={`/seasons/${slug}/fixtures/calendar`}
                  variant="secondary"
                  data-testid="open-calendar"
                >
                  Calendar
                </ButtonLink>
                <ButtonLink
                  href={`/seasons/${slug}/fixtures/match-day`}
                  variant="secondary"
                  data-testid="open-match-day"
                >
                  Match day
                </ButtonLink>
              </span>
            </div>
            {dashboard.stats.total > 0 ? (
              <p className="competitions-hint">
                {dashboard.stats.total} fixture{dashboard.stats.total === 1 ? "" : "s"}
                {rounds > 0 ? ` across ${String(rounds)} round${rounds === 1 ? "" : "s"}` : ""}
              </p>
            ) : null}
          </header>
          <FixturesPanel
            slug={slug}
            orgSlug={dashboard.orgSlug}
            isPublic={dashboard.competition.visibility === "public"}
            stats={dashboard.stats}
            page={dashboard.page}
            teams={dashboard.teams}
            grounds={dashboard.grounds}
            conflicts={dashboard.conflicts}
            canManage={dashboard.viewer.canManage}
            filters={{
              status: sp["status"] ?? "",
              team: sp["team"] ?? "",
              ground: sp["ground"] ?? "",
              q: sp["q"] ?? "",
              sort: sp["sort"] ?? "kickoff",
            }}
          />
        </div>
      </main>
    </ToastProvider>
  );
}
