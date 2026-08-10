import { LoadingState } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { adminMessaging } from "../../../server/admin/actions";
import { platformAdminPageGate } from "../../../server/admin/authz";
import { MessagingPanel } from "./messaging-panel";
import "../../seasons/seasons.css";
import "../admin.css";

export const metadata = { title: "Messaging · Platform admin · DesiAuction" };

/**
 * Messaging configuration, as administration is entitled to see it.
 *
 * The plan's Phase 3 called this "platform template administration behind
 * `messaging.manage`". It is deliberately smaller than that name, because §9 of
 * the same plan forbids the thing the name implies: nobody edits template text,
 * on any surface, because the gateway matches the registered sentence character
 * for character and the platform carries the regulatory risk. Strip the editing
 * and what is left is OBSERVATION — which is exactly what /admin is for, needs
 * no new capability, and is the part that was actually missing.
 *
 * So there is no `messaging.manage` grant. Inventing a capability whose only
 * power is to read a table would be governance theatre, and this platform's
 * capability partition is not decorative.
 */
export default async function AdminMessagingPage() {
  if ((await platformAdminPageGate("messaging")) === null) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <header className="dash-head">
          <p className="dash-hint">
            Which message shapes have a registered DLT id, the text each one sends, and the contacts
            the platform must never send to.
          </p>
        </header>
        <Suspense fallback={<LoadingState variant="page" />}>
          <Messaging />
        </Suspense>
      </div>
    </main>
  );
}

async function Messaging() {
  const overview = await adminMessaging();
  if (overview === null) {
    notFound();
  }
  return <MessagingPanel overview={overview} />;
}
