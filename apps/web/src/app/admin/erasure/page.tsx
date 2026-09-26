import { IconTrash, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../server/admin/access-log";
import { platformPrivacyGate } from "../../../server/admin/authz";
import { erasureDesk } from "../../../server/privacy/desk";
import { AdminEmpty, AdminPageHead } from "../admin-ui";
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
        <div className="dash-stack admin-stack">
          <AdminPageHead>
            Deletion requests, oldest first. Each is promised a reply within seven days.
          </AdminPageHead>
          {desk.open.length === 0 && desk.decided.length === 0 ? (
            <div className="admin-panel">
              <AdminEmpty icon={<IconTrash size={24} weight="duotone" />} title="Nobody has asked">
                When somebody asks to delete their account from the account page, the request
                appears here.
              </AdminEmpty>
            </div>
          ) : (
            // A server render: the clock cannot disagree with a client pass.
            // eslint-disable-next-line react-hooks/purity
            <ErasureDeskPanel desk={desk} nowMs={Date.now()} />
          )}
        </div>
      </main>
    </ToastProvider>
  );
}
