import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { cockpitView } from "../../../../../server/auction/conduct-actions";
import { CockpitPanel } from "./cockpit-panel";
import "../../../seasons.css";
import "../auction.css";

export const metadata = { title: "Auction cockpit · DesiAuction" };

export default async function CockpitPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await cockpitView(slug);
  if (view === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          {/* Eight chrome stops stood between the keyboard and the auctioneer's
              first control — five links to OTHER pages, ahead of the gavel. The
              title stays (it is the page's heading); the doors move to the foot,
              where leaving belongs on the surface you leave last. */}
          <h1 className="auction-sr-only">{view.auctionName} — cockpit</h1>
          <CockpitPanel slug={slug} view={view} />
          <nav className="live-exits" aria-label="Auction records and other views">
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
        </div>
      </main>
    </ToastProvider>
  );
}
