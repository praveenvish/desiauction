import { IconFlag, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../server/admin/access-log";
import { platformSupportGate } from "../../../server/admin/authz";
import { reportQueue } from "../../../server/admin/report-views";
import { ReportQueuePanel } from "./report-queue-panel";
import { AdminEmpty, AdminPageHead } from "../admin-ui";
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
          <AdminPageHead>
            Problems people reported from inside the product, newest first.
          </AdminPageHead>
          {queue.open.length === 0 && queue.closed.length === 0 ? (
            <div className="admin-panel">
              <AdminEmpty icon={<IconFlag size={24} weight="duotone" />} title="No reports yet">
                When somebody uses Report a problem, it lands here with the page they were on and,
                if they kept it, a screenshot.
              </AdminEmpty>
            </div>
          ) : (
            <ReportQueuePanel queue={queue} />
          )}
        </div>
      </main>
    </ToastProvider>
  );
}
