import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { liveAuctionView } from "../../../../../server/auction/live-actions";
import { LivePanel } from "./live-panel";
import "../../../competitions.css";

export const metadata = { title: "Live auction · DesiAuction" };

export default async function LiveAuctionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await liveAuctionView(slug);
  if (view === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <header className="dash-head">
            <div className="competition-title-row">
              <h1>{view.competition.name}</h1>
              <ButtonLink href={`/competitions/${slug}/auction`} variant="secondary">
                Auction setup
              </ButtonLink>
            </div>
            <p className="competitions-hint">
              Live auction — every window converges to the same server snapshot
            </p>
          </header>
          <LivePanel slug={slug} view={view} />
        </div>
      </main>
    </ToastProvider>
  );
}
