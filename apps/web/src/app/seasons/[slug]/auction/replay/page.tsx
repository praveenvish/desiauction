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
        <header className="dash-head replay-head">
          <div className="competition-title-row">
            <div className="replay-title">
              <h1>Replay viewer</h1>
              {/* Reader's words, not the implementation's — and one line: the
                  lede used to take a band of its own under the title. */}
              <p className="competitions-hint">
                {data.auctionName} · every bid and hammer, exactly as recorded. Read-only.
              </p>
            </div>
            {/* One action group, hard right. */}
            <div className="replay-head-actions">
              <ButtonLink href={`/seasons/${slug}/auction/cockpit`} variant="secondary" size="sm">
                Cockpit
              </ButtonLink>
              <ButtonLink href={`/seasons/${slug}/auction/ledger`} variant="secondary" size="sm">
                Ledger
              </ButtonLink>
            </div>
          </div>
        </header>
        <ReplayPanel data={data} />
      </div>
    </main>
  );
}
