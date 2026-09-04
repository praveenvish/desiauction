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
            {/* One action group, hard right — the bare buttons sat at flex
                extremes, scattering "Cockpit" into the middle of the page. */}
            <div className="replay-head-actions">
              <ButtonLink href={`/seasons/${slug}/auction/cockpit`} variant="secondary">
                Cockpit
              </ButtonLink>
              <ButtonLink href={`/seasons/${slug}/auction/ledger`} variant="secondary">
                Ledger
              </ButtonLink>
            </div>
          </div>
          <p className="competitions-hint">
            {/* Reader's words, not the implementation's: "fold the immutable
                log" described the code to an organizer reviewing their night. */}
            {data.auctionName} — step through the auction event by event, exactly as it was
            recorded. Read-only: nothing on this page can change the record.
          </p>
        </header>
        <ReplayPanel data={data} />
      </div>
    </main>
  );
}
