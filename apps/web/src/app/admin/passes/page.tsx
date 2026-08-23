import { EmptyState, Card, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../server/admin/access-log";
import { platformBillingGate } from "../../../server/admin/authz";
import { adminPassQueue } from "../../../server/admin/pass-views";
import { PassQueuePanel } from "./pass-queue-panel";
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
        <div className="dash-stack">
          <header className="dash-head">
            <p className="competitions-hint">
              Season pass requests. Granting moves the season&apos;s tier and lifts its ceilings;
              declining answers the organizer without changing anything. Both land on the audit log
              against your name.
            </p>
          </header>
          {queue.open.length === 0 && queue.recent.length === 0 ? (
            <Card>
              <EmptyState
                headingLevel={2}
                title="No pass requests"
                description="When an organizer runs out of room on their pass and asks for more, it appears here."
              />
            </Card>
          ) : (
            <PassQueuePanel queue={queue} />
          )}
        </div>
      </main>
    </ToastProvider>
  );
}
