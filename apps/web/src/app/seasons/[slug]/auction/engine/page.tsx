import { ToastProvider } from "@desiauction/ui";
import { notFound, redirect } from "next/navigation";

import { cockpitView } from "../../../../../server/auction/conduct-actions";
import { EnginePanel } from "./engine-panel";
import "../../../seasons.css";
import "../auction.css";

export const metadata = { title: "Engine" };

export default async function EnginePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await cockpitView(slug);
  if (view === null) {
    notFound();
  }
  // After the night the engine has no job — nothing runs, nothing can be
  // recovered — and the page was one sentence over four figures the auction
  // page already shows. It sends you there (census 2026-09-28).
  if (["completed", "reconciled", "abandoned"].includes(view.view.auction.status)) {
    redirect(`/seasons/${slug}/auction`);
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          {/* No head band: the identity bar names the page, and the one door
              (Cockpit) rides in the health card. First data used to start at
              y≈400 on a laptop. */}
          <EnginePanel
            slug={slug}
            auctionId={view.auctionId}
            record={{
              status: view.view.auction.status,
              events: view.view.eventCount,
              lots: view.view.lots.length,
            }}
          />
        </div>
      </main>
    </ToastProvider>
  );
}
