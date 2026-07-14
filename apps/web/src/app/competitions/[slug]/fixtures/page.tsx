import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { fixtureDashboard } from "../../../../server/competition/fixture-actions";
import { FixturesPanel } from "./fixtures-panel";
import "../../competitions.css";

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
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <header className="dash-head">
            <div className="competition-title-row">
              <h1>{dashboard.competition.name}</h1>
              <span className="date-row">
                <ButtonLink
                  href={`/competitions/${slug}/fixtures/calendar`}
                  variant="secondary"
                  data-testid="open-calendar"
                >
                  Calendar
                </ButtonLink>
                <ButtonLink
                  href={`/competitions/${slug}/fixtures/match-day`}
                  variant="secondary"
                  data-testid="open-match-day"
                >
                  Match day
                </ButtonLink>
              </span>
            </div>
            <p className="competitions-hint">Fixtures &amp; scheduling</p>
          </header>
          <FixturesPanel
            slug={slug}
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
