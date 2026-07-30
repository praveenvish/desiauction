import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { venuesView } from "../../../../server/competition/fixture-actions";
import { VenuesPanel } from "./venues-panel";
import "../../../seasons/seasons.css";

export const metadata = { title: "Venues · DesiAuction" };

export default async function VenuesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await venuesView(slug);
  // Non-members and unknown slugs are indistinguishable (tenancy, IP-2 pattern),
  // and so is a member with no `venue.manage`: this page is a management desk,
  // and it returned 200 to a plain viewer while /money and /settlement — the
  // same shape of desk — correctly returned 404. Absent, not locked.
  if (view === null || !view.viewer.canManage) {
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
