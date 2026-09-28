import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { cockpitView } from "../../../../../server/auction/conduct-actions";
import { CockpitPanel } from "./cockpit-panel";
import "../../../seasons.css";
import "../auction.css";
// The shared player card and the room's one-line phone header live with the
// owner's room (stage 1); the desk's own layout is beside this page.
import "../live/live.css";
import "./desk.css";

export const metadata = { title: "Auction cockpit · DesiAuction" };

export default async function CockpitPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await cockpitView(slug);
  if (view === null) {
    notFound();
  }
  const status = view.view.auction.status;
  const finished = status === "completed" || status === "reconciled" || status === "abandoned";
  return (
    // `cockpit-room` scopes the toast placement (desk.css): on a phone the gavel
    // bar is pinned to the foot, and notices rise above it.
    <div className="cockpit-room">
      <ToastProvider>
        <main className="registrations-dash cockpit-page">
          <div className="dash-stack">
            {/* Eight chrome stops stood between the keyboard and the auctioneer's
              first control — five links to OTHER pages, ahead of the gavel. The
              title stays (it is the page's heading); the doors move to the foot,
              where leaving belongs on the surface you leave last. */}
            <h1 className="auction-sr-only">{view.auctionName} — cockpit</h1>
            <CockpitPanel slug={slug} view={view} />
            {finished ? (
              /* After the night the record card above is the door to the ledger
                 and the replay, and the engine has nothing to show. */
              <nav className="live-exits" aria-label="Other auction views">
                <ButtonLink href={`/seasons/${slug}/auction/spectate`} variant="secondary">
                  Public recap
                </ButtonLink>
                <ButtonLink href={`/seasons/${slug}/auction`} variant="secondary">
                  Auction page
                </ButtonLink>
              </nav>
            ) : (
              <nav className="live-exits" aria-label="Auction records and other views">
                <span className="live-exits-label" aria-hidden>
                  Records &amp; other views
                </span>
                <ButtonLink href={`/seasons/${slug}/auction/ledger`} variant="secondary">
                  Ledger
                </ButtonLink>
                <ButtonLink href={`/seasons/${slug}/auction/replay`} variant="secondary">
                  Replay
                </ButtonLink>
                <ButtonLink href={`/seasons/${slug}/auction/engine`} variant="secondary">
                  Engine
                </ButtonLink>
                <ButtonLink href={`/seasons/${slug}/auction/spectate`} variant="secondary">
                  Spectate
                </ButtonLink>
                <ButtonLink href={`/seasons/${slug}/auction`} variant="secondary">
                  Setup
                </ButtonLink>
              </nav>
            )}
          </div>
        </main>
      </ToastProvider>
    </div>
  );
}
