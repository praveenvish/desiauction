import { ButtonLink } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { replayViewerData } from "../../../../../server/auction/conduct-actions";
import { ReplayPanel } from "./replay-panel";
import "../../../seasons.css";
import "../auction.css";

export const metadata = { title: "Replay viewer · DesiAuction" };

export default async function ReplayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await replayViewerData(slug);
  if (data === null) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <header className="dash-head">
          <div className="competition-title-row">
            <h1>Replay viewer</h1>
            <ButtonLink href={`/seasons/${slug}/auction/cockpit`} variant="secondary">
              Cockpit
            </ButtonLink>
          </div>
          <p className="competitions-hint">
            {data.auctionName} — pure visualization: fold the immutable log, observe every state,
            compare against the live snapshot. No mutation exists on this page.
          </p>
        </header>
        <ReplayPanel data={data} />
      </div>
    </main>
  );
}
