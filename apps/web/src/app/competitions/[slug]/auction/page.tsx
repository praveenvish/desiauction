import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { auctionDashboard } from "../../../../server/auction/actions";
import { AuctionPanel } from "./auction-panel";
import "../../competitions.css";

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
              <ButtonLink href={`/competitions/${slug}`} variant="secondary">
                Competition
              </ButtonLink>
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
