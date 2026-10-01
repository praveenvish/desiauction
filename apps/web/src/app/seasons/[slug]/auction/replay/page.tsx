import { ButtonLink } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { replayViewerData } from "../../../../../server/auction/conduct-actions";
import { ReplayPanel } from "./replay-panel";
import "../../../seasons.css";
import "../auction.css";
import "./replay.css";

export const metadata = { title: "Replay" };

export default async function ReplayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await replayViewerData(slug);
  if (data === null) {
    notFound();
  }
  return (
    <main className="rp-page">
      {/* One line: what this is and whose night — then the night itself. */}
      <header className="rp-head">
        <div className="rp-head-text">
          <h1>Replay</h1>
          <p>{data.auctionName} · every bid and hammer, exactly as recorded</p>
        </div>
        <div className="rp-head-actions">
          <ButtonLink href={`/seasons/${slug}/auction/cockpit`} variant="ghost" size="sm">
            Cockpit
          </ButtonLink>
          <ButtonLink href={`/seasons/${slug}/auction/ledger`} variant="secondary" size="sm">
            Ledger
          </ButtonLink>
        </div>
      </header>
      <ReplayPanel data={data} />
    </main>
  );
}
