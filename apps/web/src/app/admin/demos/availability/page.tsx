import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../../server/admin/access-log";
import { platformDemoGate } from "../../../../server/admin/authz";
import { publishedAvailability, publishedBlackouts } from "../../../../server/admin/demo-views";
import { HORIZON_DAYS, bookableDays } from "../../../../server/marketing/demo-slots";
import { AvailabilityPanel } from "./availability-panel";
import { AdminPageHead } from "../../admin-ui";
import "../../../seasons/seasons.css";
import "../../admin.css";
import "../demos.css";

export const metadata = { title: "Demo availability · Platform admin · DesiAuction" };

/**
 * THE HOURS SOMEBODY WILL ANSWER A CALL.
 *
 * This screen is the honesty mechanism for the entire feature, and it is worth
 * saying so where the person editing it will read it: what is published here is
 * what `/schedule-demo` PROMISES. Empty, the public page does not draw a
 * calendar with nothing in it — it says a human will come back to you within a
 * day, which is a promise a person can keep. Full of windows nobody honours, it
 * offers times that burn somebody's evening.
 *
 * So the empty state here is not an error. It is a supported configuration, and
 * the page says which of the two products is currently live.
 */
export default async function AdminDemoAvailabilityPage() {
  const operator = await platformDemoGate();
  if (operator === null) {
    notFound();
  }
  await recordAdminAccess(operator, "demos", "availability");

  // The status band asks the public page's OWN function what it offers, so
  // the two can never disagree (bookings, blocked days and the two-hour lead
  // are already taken out there).
  const [windows, blackouts, days] = await Promise.all([
    publishedAvailability(),
    publishedBlackouts(),
    bookableDays().catch(() => null),
  ]);
  const firstDay = days?.[0];
  const firstSlot = firstDay?.slots[0];
  const offer =
    days === null
      ? null
      : {
          slots: days.reduce((sum, day) => sum + day.slots.length, 0),
          horizonDays: HORIZON_DAYS,
          next:
            firstDay !== undefined && firstSlot !== undefined
              ? `${firstDay.label}, ${firstSlot.label}`
              : null,
        };

  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack admin-stack">
          <AdminPageHead>
            The hours somebody will answer a demo call. What is published here is what the public
            demo page promises.
          </AdminPageHead>

          <AvailabilityPanel windows={windows} blackouts={blackouts} offer={offer} />
        </div>
      </main>
    </ToastProvider>
  );
}
