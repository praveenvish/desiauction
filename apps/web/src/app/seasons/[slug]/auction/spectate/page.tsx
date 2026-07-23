import { notFound } from "next/navigation";

import { publicSpectatorView, spectatorView } from "../../../../../server/auction/conduct-actions";
import { SpectatePanel } from "./spectate-panel";
import "../../../seasons.css";
import "../auction.css";

export const metadata = { title: "Live auction · DesiAuction" };

// Spectator mode (M-IP4-3): read-only. Consumes the AuctionSnapshot stream and
// NOTHING else — no commands, no diagnostics, no owner data, no audit.

export default async function SpectatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // PX-6: published competitions are publicly watchable (no sign-in); the
  // member-gated path remains for unpublished auctions.
  const view = (await publicSpectatorView(slug)) ?? (await spectatorView(slug));
  if (view === null) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <header className="dash-head">
          <h1>{view.auctionName}</h1>
          <p className="competitions-hint">{view.competitionName} — spectator view</p>
        </header>
        <SpectatePanel wsUrl={view.wsUrl} slug={slug} resolved={view.resolved} />
      </div>
    </main>
  );
}
