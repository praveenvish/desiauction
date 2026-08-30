import { EmptyState, Card, ToastProvider } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../server/admin/access-log";
import { platformDemoGate } from "../../../server/admin/authz";
import { demoQueue } from "../../../server/admin/demo-views";
import { DemoQueuePanel } from "./demo-queue-panel";
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
        <div className="dash-stack">
          <header className="dash-head">
            <p className="competitions-hint">
              People who asked for a demo. Answer them, then record what happened — an outcome is
              how &ldquo;nobody replied&rdquo; becomes something we can see rather than something we
              assume.{" "}
              <Link href="/admin/demos/availability" className="prose-link">
                Publish the times you&apos;re free
              </Link>{" "}
              and they can book themselves.
            </p>
          </header>
          {queue.open.length === 0 && queue.answered.length === 0 ? (
            <Card>
              <EmptyState
                headingLevel={2}
                title="Nobody has asked yet"
                description="When somebody fills in the form on /schedule-demo, they appear here with their tournament, their number and whatever they told us."
              />
            </Card>
          ) : (
            <DemoQueuePanel queue={queue} />
          )}
        </div>
      </main>
    </ToastProvider>
  );
}
