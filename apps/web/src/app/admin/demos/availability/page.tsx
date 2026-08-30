import { Card, ToastProvider } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../../server/admin/access-log";
import { platformDemoGate } from "../../../../server/admin/authz";
import { publishedAvailability, publishedBlackouts } from "../../../../server/admin/demo-views";
import { AvailabilityPanel } from "./availability-panel";
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

  const [windows, blackouts] = await Promise.all([publishedAvailability(), publishedBlackouts()]);

  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <header className="dash-head">
            <p className="competitions-hint">
              Times published here are offered on{" "}
              <Link href="/schedule-demo" className="prose-link">
                the public demo page
              </Link>
              , minus anything already booked and anything blocked below. Nothing is offered inside
              the next two hours.
            </p>
          </header>

          {windows.length === 0 ? (
            <Card>
              <p className="demo-empty-warning">
                <strong>No times published — and that is a working state.</strong> The demo page is
                currently promising that a person will come back within a working day, and the
                request form behind it works exactly as it should. Publish windows below only if you
                will keep them: a calendar offering a slot nobody attends is worse than no calendar
                at all.
              </p>
            </Card>
          ) : null}

          <AvailabilityPanel windows={windows} blackouts={blackouts} />
        </div>
      </main>
    </ToastProvider>
  );
}
