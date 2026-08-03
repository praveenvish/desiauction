import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "../../../../../env";
import { publicSpectatorView, spectatorView } from "../../../../../server/auction/conduct-actions";
import { BoardPanel } from "./board-panel";
import "../auction.css";
import "./board.css";

// Public live board (PX-6 lineage): a standings-first scoreboard for a venue
// screen or a public share link — team purses, squads, spend, top buys and
// recent sales, all derived from the SAME read-only, spectator-safe snapshot as
// /spectate. Where spectate is the ceremony (one lot, huge), the board is the
// economy at a glance. Rendered "bare" (nav.ts); no commands, no owner data.
export const metadata: Metadata = {
  title: "Live board · DesiAuction",
  robots: { index: false, follow: false },
};

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = (await publicSpectatorView(slug)) ?? (await spectatorView(slug));
  if (view === null) {
    notFound();
  }
  return (
    // A `bare` shell renders no chrome at all, so this page owned no landmark:
    // the whole projector board was floating outside any region axe could name.
    <main>
      {/* `orgName` and `location` were already on SpectatorView and this page
          simply dropped them, so a photograph of the projector six months later
          had nothing on it naming whose night it was or where. */}
      <BoardPanel
        wsUrl={view.wsUrl}
        resolved={view.resolved}
        auctionName={view.auctionName}
        competitionName={view.competitionName}
        orgName={view.orgName}
        location={view.location}
        watchUrl={`${env.PUBLIC_BASE_URL}/c/${slug}`.replace(/^https?:\/\//, "")}
        teamIdentities={view.teams}
      />
    </main>
  );
}
