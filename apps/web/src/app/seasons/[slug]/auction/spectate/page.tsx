import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { publicSpectatorView, spectatorView } from "../../../../../server/auction/conduct-actions";
import { SpectatePanel } from "./spectate-panel";
import "../../../seasons.css";
import "../auction.css";

import type { Metadata } from "next";

// Spectator mode (M-IP4-3): read-only. Consumes the AuctionSnapshot stream and
// NOTHING else — no commands, no diagnostics, no owner data, no audit.

async function viewOf(slug: string) {
  // PX-6: published competitions are publicly watchable (no sign-in); the
  // member-gated path remains for unpublished auctions.
  return (await publicSpectatorView(slug)) ?? (await spectatorView(slug));
}

/**
 * The title used to be the constant "Live auction · DesiAuction" — the same
 * string for every auction on the platform, naming neither the tournament nor
 * its state. It is what a browser tab, a bookmark and a pasted link all read
 * from, on the one screen this product is shared from.
 *
 * The card itself is the colocated `opengraph-image` route: this route emitted
 * no OG or Twitter metadata at all, so a live auction pasted into WhatsApp — the
 * distribution channel for this market — previewed as a naked URL while
 * `/c/<slug>` next door rendered a full 1200x630 card.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const view = await viewOf(slug);
  if (view === null) {
    return { title: "Live auction · DesiAuction" };
  }
  const where = [view.orgName, view.location]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
  const title = `${view.auctionName} — watch live`;
  const description =
    where === ""
      ? `Follow every lot of ${view.competitionName} live. No account needed.`
      : `Follow every lot of ${view.competitionName} live — ${where}. No account needed.`;
  return {
    title: `${title} · DesiAuction`,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SpectatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await viewOf(slug);
  if (view === null) {
    notFound();
  }
  return (
    // No VISIBLE <h1> and no subtitle: the page's name was rendered here, 78px
    // tall on a phone, and then again word for word in the status ribbon two
    // rows below. The ribbon is the identity bar now and rides in the Live shell
    // header. The heading still has to EXIST, though — a document with no h1 is
    // a document a screen-reader user cannot orient in, and axe says so.
    <main className="registrations-dash">
      <div className="dash-stack">
        <h1 className="auction-sr-only">{view.auctionName} — live</h1>
        <ToastProvider>
          <SpectatePanel
            wsUrl={view.wsUrl}
            slug={slug}
            resolved={view.resolved}
            teams={view.teams}
            rules={view.rules}
            preSigned={view.preSigned}
            auctionName={view.auctionName}
            orgName={view.orgName}
            location={view.location}
          />
        </ToastProvider>
      </div>
    </main>
  );
}
