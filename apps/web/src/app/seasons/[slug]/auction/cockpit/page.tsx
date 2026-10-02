import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { MoneyUnitProvider } from "../../../../../components/money-unit";
import { cockpitView } from "../../../../../server/auction/conduct-actions";
import { PracticeBar } from "../practice-bar";
import { CockpitPanel } from "./cockpit-panel";
import "../../../seasons.css";
import "../auction.css";
// The shared player card and the room's one-line phone header live with the
// owner's room (stage 1); the desk's own layout is beside this page.
import "../live/live.css";
import "./desk.css";

export const metadata = { title: "Auction cockpit" };

export default async function CockpitPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await cockpitView(slug);
  if (view === null) {
    notFound();
  }
  const status = view.view.auction.status;
  const finished = status === "completed" || status === "reconciled" || status === "abandoned";
  // A practice (0101) counts in points, and its records are not the night's.
  const inPractice = view.practice?.inPractice === true;
  const room = (
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
            <PracticeBar
              slug={slug}
              practice={view.practice}
              watch={view.practice !== null || status === "scheduled"}
            />
            <CockpitPanel slug={slug} view={view} />
            {/* After the night the closing card carries every door (the auction
                page, ledger, replay, recap); the row below is the live room's. */}
            {finished ? null : inPractice ? (
              <nav className="live-exits" aria-label="Other views">
                <ButtonLink href={`/seasons/${slug}/auction`} variant="secondary">
                  Practice settings
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
  return inPractice ? <MoneyUnitProvider unit="points">{room}</MoneyUnitProvider> : room;
}
