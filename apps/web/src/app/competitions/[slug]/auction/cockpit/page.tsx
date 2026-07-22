import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { cockpitView } from "../../../../../server/auction/conduct-actions";
import { CockpitPanel } from "./cockpit-panel";
import "../../../competitions.css";
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
          <header className="dash-head">
            <div className="competition-title-row">
              <h1>{view.auctionName}</h1>
              <span className="date-row">
                <ButtonLink href={`/competitions/${slug}/auction/ledger`} variant="secondary">
                  Ledger
                </ButtonLink>
                <ButtonLink href={`/competitions/${slug}/auction/replay`} variant="secondary">
                  Replay
                </ButtonLink>
                <ButtonLink href={`/competitions/${slug}/auction/engine`} variant="secondary">
                  Engine
                </ButtonLink>
                <ButtonLink href={`/competitions/${slug}/auction/spectate`} variant="secondary">
                  Spectate
                </ButtonLink>
                <ButtonLink href={`/competitions/${slug}/auction`} variant="secondary">
                  Setup
                </ButtonLink>
              </span>
            </div>
            <p className="competitions-hint">
              Open lots, take bids, and call the gavel — every screen stays in sync.
            </p>
          </header>
          <CockpitPanel slug={slug} view={view} />
        </div>
      </main>
    </ToastProvider>
  );
}
