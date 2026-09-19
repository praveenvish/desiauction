import { EmptyState, IconFlag, SectionCard, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../server/admin/access-log";
import { platformSupportGate } from "../../../server/admin/authz";
import { reportQueue } from "../../../server/admin/report-views";
import { ReportQueuePanel } from "./report-queue-panel";
import "../../seasons/seasons.css";
import "../admin.css";
import "./reports.css";

export const metadata = { title: "Reports · Platform admin · DesiAuction" };

/**
 * THE REPORT DESK (FR-1 Phase 1) — what people told us was broken, and what we
 * did about it.
 *
 * Behind `platform:support`, which no other grant implies. The reads are
 * projections; the one write lives in `server/support/report-desk.ts`, so the
 * read-only proofs over administration keep holding.
 */
export default async function AdminReportsPage() {
  const operator = await platformSupportGate();
  if (operator === null) {
    notFound();
  }
  await recordAdminAccess(operator, "reports", null);

  const queue = await reportQueue();

  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack admin-stack">
          <header className="dash-head">
            <p className="dash-hint">
              Problems people reported from inside the product, newest first. Mark each one when you
              pick it up and again when it&apos;s settled — a status is how &ldquo;somebody told
              us&rdquo; becomes something we can check.
            </p>
          </header>
          {queue.open.length === 0 && queue.closed.length === 0 ? (
            <SectionCard icon={<IconFlag />} tone="neutral" title="Reports">
              <EmptyState
                headingLevel={3}
                title="No reports yet"
                description="When somebody uses Report a problem, it lands here with the page they were on and, if they kept it, a screenshot."
              />
            </SectionCard>
          ) : (
            <ReportQueuePanel queue={queue} />
          )}
        </div>
      </main>
    </ToastProvider>
  );
}
