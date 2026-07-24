import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { PageTitle } from "../../../../components/shell/page-title";
import { auctionDashboard } from "../../../../server/auction/actions";
import { AuctionOverviewPanel } from "./auction-overview-panel";
import { AuctionPanel } from "./auction-panel";
import "../../seasons.css";

export const metadata = { title: "Auction · DesiAuction" };

export default async function AuctionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dashboard = await auctionDashboard(slug);
  if (dashboard === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          {/* An auction in progress renames the surface — the tab still says
              "Auction", the title says what is happening on it. */}
          {dashboard.view !== null ? <PageTitle title="Live auction" /> : null}
          <header className="dash-head">
            <div className="competition-title-row title-row-actions">
              <span className="date-row">
                {dashboard.view !== null ? (
                  <span className="season-live-pill auc-title-pill">Live</span>
                ) : null}
                {dashboard.view !== null ? (
                  <ButtonLink href={`/seasons/${slug}/auction/live`} data-testid="open-live">
                    Go live
                  </ButtonLink>
                ) : null}
                {dashboard.view !== null && dashboard.viewer.canConduct ? (
                  <ButtonLink
                    href={`/seasons/${slug}/auction/cockpit`}
                    variant="secondary"
                    data-testid="open-cockpit"
                  >
                    Cockpit
                  </ButtonLink>
                ) : null}
              </span>
            </div>
          </header>
          {dashboard.overview !== null ? (
            <AuctionOverviewPanel overview={dashboard.overview} />
          ) : null}
          <AuctionPanel slug={slug} dashboard={dashboard} />
        </div>
      </main>
    </ToastProvider>
  );
}
