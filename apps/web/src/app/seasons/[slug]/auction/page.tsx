import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { auctionDashboard } from "../../../../server/auction/actions";
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
          <header className="dash-head">
            <div className="competition-title-row">
              <h1>{dashboard.competition.name}</h1>
              <span className="date-row">
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
                <ButtonLink href={`/seasons/${slug}`} variant="secondary">
                  Season
                </ButtonLink>
              </span>
            </div>
            <p className="competitions-hint">
              Auction engine foundation — architecture, not ceremony
            </p>
          </header>
          <AuctionPanel slug={slug} dashboard={dashboard} />
        </div>
      </main>
    </ToastProvider>
  );
}
