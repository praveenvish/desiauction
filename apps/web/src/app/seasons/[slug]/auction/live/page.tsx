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
      {/* THE FOLD IS THE BUDGET. Measured at 390×844 with a lot on the block,
          463 of 844 pixels went by before the player's name appeared and the
          raise button — the primary action of the entire product — rendered 31px
          BELOW the fold on the device the product was designed for.

          What used to fill that space: an <h1> repeating the competition name
          (already in the browser tab and one tap away in the nav), a tab pair to
          two OTHER pages, and the sentence "Live auction — every window
          converges to the same server snapshot", which is a note to the
          engineers who built the socket occupying the most valuable pixels the
          product owns. The links now sit at the FOOT of the page: leaving is not
          what a bidder came here to do. */}
      <main className="registrations-dash live-page">
        <div className="dash-stack">
          <h1 className="auction-sr-only">{view.competition.name} — live auction</h1>
          <LivePanel slug={slug} view={view} />
          <nav className="live-exits" aria-label="Other auction views">
            {view.viewer.canConduct ? (
              <ButtonLink href={`/seasons/${slug}/auction/cockpit`} data-testid="open-cockpit">
                Cockpit
              </ButtonLink>
            ) : null}
            <ButtonLink href={`/seasons/${slug}/auction/spectate`} variant="ghost">
              Spectate
            </ButtonLink>
            <ButtonLink href={`/seasons/${slug}/auction`} variant="secondary">
              Auction setup
            </ButtonLink>
          </nav>
        </div>
      </main>
    </ToastProvider>
  );
}
