import { IconCalendar, IconExternal, ToastProvider } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../server/admin/access-log";
import { platformDemoGate } from "../../../server/admin/authz";
import { demoQueue } from "../../../server/admin/demo-views";
import { DemoQueuePanel } from "./demo-queue-panel";
import { AdminEmpty, AdminPageHead } from "../admin-ui";
import "../../seasons/seasons.css";
import "../admin.css";
import "./demos.css";

export const metadata = { title: "Demos · Platform admin · DesiAuction" };

/**
 * THE DEMO DESK — who asked to be shown the product, and what we did about it.
 *
 * Behind `platform:demo`, which is neither `platform:admin` nor
 * `platform:billing`. What is on this page is the name and mobile number of
 * somebody who is not a customer, has no account here, and typed them into a
 * public form on the understanding that we would ring once. Reading the
 * platform does not license that and neither does answering a pass request; an
 * operator who does all three holds all three grants, on purpose.
 *
 * The reads are projections like every other; the writes live in their own
 * module outside administration, so the runtime and source-level read-only
 * proofs over this folder keep holding.
 */
export default async function AdminDemosPage() {
  const operator = await platformDemoGate();
  if (operator === null) {
    notFound();
  }
  // Opening a list of strangers' phone numbers is exactly the read this log
  // exists for.
  await recordAdminAccess(operator, "demos", null);

  const queue = await demoQueue();

  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack admin-stack">
          <AdminPageHead
            actions={
              <Link href="/admin/demos/availability" className="admin-head-button">
                Publish availability
              </Link>
            }
          >
            People who asked for a demo. Answer them, then record what happened.
          </AdminPageHead>
          {queue.open.length === 0 && queue.answered.length === 0 ? (
            <div className="admin-panel">
              <AdminEmpty
                icon={<IconCalendar size={24} weight="duotone" />}
                title="Nobody has asked yet"
                actions={
                  <>
                    <Link href="/admin/demos/availability" className="admin-head-button">
                      Publish availability
                    </Link>
                    <a
                      href="/schedule-demo"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="admin-head-button"
                    >
                      Open the demo page
                      <IconExternal size={16} />
                    </a>
                  </>
                }
              >
                Requests from /schedule-demo land here with the tournament, a number and whatever
                they told us.
              </AdminEmpty>
            </div>
          ) : (
            <DemoQueuePanel queue={queue} />
          )}
        </div>
      </main>
    </ToastProvider>
  );
}
