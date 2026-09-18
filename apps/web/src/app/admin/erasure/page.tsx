import { Card, EmptyState, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../server/admin/access-log";
import { platformPrivacyGate } from "../../../server/admin/authz";
import { erasureDesk } from "../../../server/privacy/desk";
import { ErasureDeskPanel } from "./erasure-desk-panel";
import "../../seasons/seasons.css";
import "../admin.css";

export const metadata = { title: "Erasure · Platform admin · DesiAuction" };

/**
 * THE PRIVACY DESK — people who asked for their account to be deleted.
 *
 * Behind `platform:privacy`, which no other platform grant implies. The page
 * shows names and numbers and holds the one irreversible act on this platform,
 * so it 404s without the grant, records every opening, and keeps its writes in
 * `server/privacy`, outside administration.
 */
export default async function AdminErasurePage() {
  const operator = await platformPrivacyGate();
  if (operator === null) {
    notFound();
  }
  await recordAdminAccess(operator, "erasure", null);
  const desk = await erasureDesk(operator.personId);

  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <header className="dash-head">
            <p className="competitions-hint">
              Account deletion requests, oldest first. The account page promises a reply within
              seven days. Erasing deletes the person&apos;s own profile and anonymizes them in every
              shared record; declining needs a reason they will read.
            </p>
          </header>
          {desk.open.length === 0 && desk.decided.length === 0 ? (
            <Card>
              <EmptyState
                headingLevel={2}
                title="Nobody has asked"
                description="When somebody asks to delete their account from the account page, the request appears here."
              />
            </Card>
          ) : (
            <ErasureDeskPanel desk={desk} />
          )}
        </div>
      </main>
    </ToastProvider>
  );
}
