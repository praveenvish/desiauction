import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "../../../../../env";
import { publicSpectatorView, spectatorView } from "../../../../../server/auction/conduct-actions";
import { OverlayPanel } from "./overlay-panel";
import "../auction.css";
import "./overlay.css";

// OBS / stream overlay: a transparent, chrome-free broadcast composite of the
// live AuctionSnapshot, built to be dropped into OBS as a browser source over
// camera or video. It consumes the SAME read-only, spectator-safe stream as
// /spectate — no commands, no owner data, no diagnostics — so it is purely a
// new PRESENTATION of state that already ships. The shell renders it "bare"
// (nav.ts), and overlay.css makes the page body transparent for compositing.
export const metadata: Metadata = {
  title: "Broadcast overlay · DesiAuction",
  robots: { index: false, follow: false },
};

export default async function OverlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sponsor?: string | string[] }>;
}) {
  const { slug } = await params;
  const { sponsor } = await searchParams;
  // Published auctions are publicly watchable (PX-6); the member-gated path
  // remains for unpublished ones — identical to /spectate.
  const view = (await publicSpectatorView(slug)) ?? (await spectatorView(slug));
  if (view === null) {
    notFound();
  }
  const sponsorName = typeof sponsor === "string" && sponsor.trim() !== "" ? sponsor.trim() : null;
  return (
    // A `bare` shell renders no chrome, so this page owned NO landmark and NO
    // h1 at all — the sibling /board page fixed exactly that (board/page.tsx)
    // and the overlay was never brought along. The heading is off-screen
    // because the whole point of this surface is that it composites over video:
    // it must exist for orientation, and must not print to air.
    // `lotMedia` — the face and the registration number — rides BESIDE the
    // snapshot rather than on it: the engine hashes the snapshot to prove its
    // fold is deterministic, and a URL signed at read would move those bytes.
    <main>
      <h1 className="auction-sr-only">{view.auctionName} — broadcast overlay</h1>
      <OverlayPanel
        wsUrl={view.wsUrl}
        resolved={view.resolved}
        auctionName={view.auctionName}
        sponsor={sponsorName}
        watchUrl={`${env.PUBLIC_BASE_URL}/c/${slug}`}
        lotMedia={view.lotMedia}
      />
    </main>
  );
}
