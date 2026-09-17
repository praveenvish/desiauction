import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../server/admin/access-log";
import { platformSupportGate } from "../../../server/admin/authz";
import { reviewDesk } from "../../../server/admin/review-views";
import { ReviewDeskPanel } from "./review-desk-panel";
import "../../seasons/seasons.css";
import "../admin.css";
import "./reviews.css";

export const metadata = { title: "Reviews · Platform admin · DesiAuction" };

/**
 * THE REVIEW DESK (FR-1 Phase 2) — ask for a review, then decide what is shown.
 *
 * Behind `platform:support`, like Reports: both are what people told us.
 * Nothing here is public until it is published, and publishing does not make it
 * quotable — only its author's own permission does.
 */
export default async function AdminReviewsPage() {
  const operator = await platformSupportGate();
  if (operator === null) {
    notFound();
  }
  await recordAdminAccess(operator, "reviews", null);
  const desk = await reviewDesk();

  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <header className="dash-head">
            <p className="competitions-hint">
              Ask the people who ran a tournament how it went, then publish the reviews worth
              standing behind. A published review is only ever quoted if its author said we may.
            </p>
          </header>
          <ReviewDeskPanel desk={desk} />
        </div>
      </main>
    </ToastProvider>
  );
}
