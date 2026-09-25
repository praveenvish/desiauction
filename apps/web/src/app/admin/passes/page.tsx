import { IconWallet, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../server/admin/access-log";
import { platformBillingGate } from "../../../server/admin/authz";
import { adminPassQueue } from "../../../server/admin/pass-views";
import { PassQueuePanel } from "./pass-queue-panel";
import { AdminEmpty, AdminPageHead } from "../admin-ui";
import "../../seasons/seasons.css";
import "../admin.css";

export const metadata = { title: "Passes · Platform admin · DesiAuction" };

/**
 * THE PASS QUEUE — the one surface in administration that can change something.
 *
 * Behind `platform:billing`, not `platform:admin`: seeing every organization's
 * money and changing what a customer is entitled to are different acts of
 * trust, and nobody acquires the second by being handed the first. A person
 * with only `platform:admin` gets the same not-found as a stranger — the
 * console does not advertise doors that are shut to you.
 *
 * The read is a projection like every other; the write lives in its own module
 * so the runtime read-only proof keeps holding everything else in this folder.
 */
export default async function AdminPassesPage() {
  const operator = await platformBillingGate();
  if (operator === null) {
    notFound();
  }
  // Opening a commercial queue is worth a row for the same reason opening a
  // person's record is: it is somebody's data, read by somebody with power.
  await recordAdminAccess(operator, "passes", null);
  const queue = await adminPassQueue();
  if (queue === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack admin-stack">
          <AdminPageHead>
            Season pass requests. Granting lifts the season&apos;s ceilings; both answers are
            audited.
          </AdminPageHead>
          {queue.open.length === 0 && queue.recent.length === 0 ? (
            <div className="admin-panel">
              <AdminEmpty icon={<IconWallet size={24} weight="duotone" />} title="No pass requests">
                When an organizer runs out of room on their pass and asks for more, it appears here.
              </AdminEmpty>
            </div>
          ) : (
            <PassQueuePanel queue={queue} />
          )}
        </div>
      </main>
    </ToastProvider>
  );
}
