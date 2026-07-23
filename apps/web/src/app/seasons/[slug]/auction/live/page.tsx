import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { liveAuctionView } from "../../../../../server/auction/live-actions";
import { LivePanel } from "./live-panel";
import "../../../seasons.css";
import "../auction.css";

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
              <span className="date-row">
                {view.viewer.canConduct ? (
                  <ButtonLink
                    href={`/seasons/${slug}/auction/cockpit`}
                    data-testid="open-cockpit"
                  >
                    Cockpit
                  </ButtonLink>
                ) : null}
                <ButtonLink href={`/seasons/${slug}/auction/spectate`} variant="ghost">
                  Spectate
                </ButtonLink>
                <ButtonLink href={`/seasons/${slug}/auction`} variant="secondary">
                  Auction setup
                </ButtonLink>
              </span>
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
