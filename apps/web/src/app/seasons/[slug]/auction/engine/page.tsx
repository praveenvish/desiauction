import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { cockpitView } from "../../../../../server/auction/conduct-actions";
import { EnginePanel } from "./engine-panel";
import "../../../seasons.css";
import "../auction.css";

export const metadata = { title: "Engine · DesiAuction" };

export default async function EnginePage({ params }: { params: Promise<{ slug: string }> }) {
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
            <div className="competition-title-row title-row-actions">
              <ButtonLink href={`/seasons/${slug}/auction/cockpit`} variant="secondary">
                Cockpit
              </ButtonLink>
            </div>
            <p className="competitions-hint">
              {view.auctionName} — read-only engine truth: replay, queue, hashes, watchdog
            </p>
          </header>
          <EnginePanel slug={slug} />
        </div>
      </main>
    </ToastProvider>
  );
}
