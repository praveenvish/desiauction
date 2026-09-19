import { ToastProvider } from "@desiauction/ui";
import { SportTermsProvider } from "../../../../components/sport-terms";
import { notFound } from "next/navigation";

import { fixtureDashboard } from "../../../../server/competition/fixture-actions";
import { FixturesPanel } from "./fixtures-panel";
import "../../seasons.css";
import "../_tabs/tabs.css";
import "./fixtures.css";

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
          <SportTermsProvider terms={dashboard.terms}>
            <FixturesPanel
              scoreFields={dashboard.scoreFields}
              fixtureShape={dashboard.fixtureShape}
              slug={slug}
              orgSlug={dashboard.orgSlug}
              isPublic={dashboard.competition.visibility === "public"}
              seasonStartsOn={dashboard.competition.startsOn}
              seasonEndsOn={dashboard.competition.endsOn}
              stats={dashboard.stats}
              next={dashboard.next}
              page={dashboard.page}
              teams={dashboard.teams}
              grounds={dashboard.grounds}
              conflicts={dashboard.conflicts}
              results={dashboard.results}
              canManage={dashboard.viewer.canManage}
              filters={{
                status: sp["status"] ?? "",
                team: sp["team"] ?? "",
                ground: sp["ground"] ?? "",
                q: sp["q"] ?? "",
                sort: sp["sort"] ?? "kickoff",
              }}
            />
          </SportTermsProvider>
        </div>
      </main>
    </ToastProvider>
  );
}
