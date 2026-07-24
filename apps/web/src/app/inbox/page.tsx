import { Card, EmptyState } from "@desiauction/ui";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { listSecurityEvents } from "../../server/auth/security-events";
import { InboxList } from "./inbox-list";
import "./inbox.css";

export const metadata = { title: "Notifications · DesiAuction" };

// PX-3: notifications over EXISTING events (the person-scoped security ledger).
// No notification storage was invented: rows come from audit_log via
// listSecurityEvents; read-state is device-local (same contract as pins).
// Competition/money dispatches join this list when their surfaces ship.
export default async function InboxPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/inbox");
  }
  const events = await listSecurityEvents(session.personId);
  return (
    <main>
      <Card>
        {events.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title="Nothing yet"
            description="Registration decisions and account activity land here."
          />
        ) : (
          <InboxList
            events={events.map((event) => ({
              action: event.action,
              at: event.at.toISOString(),
            }))}
          />
        )}
      </Card>
    </main>
  );
}
