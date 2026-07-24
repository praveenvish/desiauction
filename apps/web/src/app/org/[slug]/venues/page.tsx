import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { venuesView } from "../../../../server/competition/fixture-actions";
import { VenuesPanel } from "./venues-panel";
import "../../../seasons/seasons.css";

export const metadata = { title: "Venues · DesiAuction" };

export default async function VenuesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await venuesView(slug);
  if (view === null) {
    // Non-members and unknown slugs are indistinguishable (tenancy, IP-2 pattern).
    notFound();
  }
  return (
    <ToastProvider>
      <main className="competitions">
        <div className="competitions-stack">
          <header className="dash-head">
            <p className="competitions-hint" data-testid="venues-heading">
              {view.org.name} · grounds and availability
            </p>
          </header>
          <VenuesPanel slug={slug} venues={view.venues} canManage={view.viewer.canManage} />
        </div>
      </main>
    </ToastProvider>
  );
}
