import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { MoneyUnitOverride } from "../../../../../components/money-unit";
import { liveAuctionView } from "../../../../../server/auction/live-actions";
import { PracticeBar } from "../practice-bar";
import { LivePanel } from "./live-panel";
import "../../../seasons.css";
import "../auction.css";
import "../plan/plan.css";

export const metadata = { title: "Live auction" };

export default async function LiveAuctionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await liveAuctionView(slug);
  if (view === null) {
    notFound();
  }
  // The server's read of the status: a finished room offers the recap, not the plan.
  const finished =
    view.status === "completed" || view.status === "reconciled" || view.status === "abandoned";
  // A practice (0101) counts in points and is nobody's public record.
  const inPractice = view.practice?.inPractice === true;
  const room = (
    // `live-room` scopes the room's own toast placement (live.css): on a phone
    // the paddle is pinned to the foot, and notices rise above it.
    <div className="live-room">
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
          what a bidder came here to do.

          Live-room stage 1: on a phone the bid button now lives in a bar pinned
          to the foot of the screen (live.css `.owner-bidbar`), so it is above
          the fold by construction, at every height. */}
        <main className="registrations-dash live-page">
          <div className="dash-stack">
            <h1 className="auction-sr-only">{view.competition.name} — live auction</h1>
            <PracticeBar
              slug={slug}
              practice={view.practice}
              realStarted={view.practice === null && view.status !== "scheduled"}
              watch={view.practice !== null || view.status === "scheduled"}
            />
            {/* Keyed by the auction it shows: when the room moves (a practice
              ends, the night opens) the panel starts over on the new auction —
              its own socket and state — instead of holding the old one's last
              snapshot. The bar above stays mounted, so its "why" line survives. */}
            <LivePanel
              key={view.auctionId}
              slug={slug}
              view={view}
              exits={
                // Keyed: an element handed across to a client component is
                // checked as a list child when it renders there.
                <nav key="exits" className="live-exits" aria-label="Other auction views">
                  {view.viewer.canConduct ? (
                    <ButtonLink
                      href={`/seasons/${slug}/auction/cockpit`}
                      data-testid="open-cockpit"
                    >
                      Cockpit
                    </ButtonLink>
                  ) : null}
                  {/* WR-1: the owner's plan — a door only for someone who holds a
                    team here while planning is on; /auction/plan 404s for
                    everyone else. */}
                  {/* After the night the plan is the squad again — the room shows it. */}
                  {view.planAvailable && !finished ? (
                    <ButtonLink
                      href={`/seasons/${slug}/auction/plan`}
                      variant="secondary"
                      data-testid="open-plan"
                    >
                      My plan
                    </ButtonLink>
                  ) : null}
                  {inPractice ? null : (
                    <ButtonLink href={`/seasons/${slug}/auction/spectate`} variant="secondary">
                      {finished ? "Public recap" : "Spectate"}
                    </ButtonLink>
                  )}
                  {/* The setup page is the organizer's desk. An owner reached a
                    page that is not theirs from the foot of their own room. */}
                  {view.viewer.canConduct ? (
                    <ButtonLink href={`/seasons/${slug}/auction`} variant="secondary">
                      Auction setup
                    </ButtonLink>
                  ) : null}
                </nav>
              }
            />
          </div>
        </main>
      </ToastProvider>
    </div>
  );
  return <MoneyUnitOverride unit={inPractice ? "points" : null}>{room}</MoneyUnitOverride>;
}
