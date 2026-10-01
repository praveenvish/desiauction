import { EmptyState, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { platformAdminPageGate } from "../../../../server/admin/authz";
import { adminSuppressionDesk } from "../../../../server/admin/suppression-views";
import { SUPPRESSION_SCOPES } from "../../../../server/messaging/suppression-contact";
import { RecentFold, RelativeTime } from "../../admin-ui";
import {
  AddSuppressionForm,
  SuppressionRevertButton,
  SuppressionSearchPanel,
} from "./suppression-desk";
import { AdminPageHead } from "../../admin-ui";
import { NotifySubnav } from "../notify-subnav";
import "../../../seasons/seasons.css";
import "../../admin.css";
import "../notifications.css";

export const metadata = { title: "Suppressions · Notifications · Platform admin" };

/**
 * THE SUPPRESSION DESK (Notification Control Center, Phase 4).
 *
 * Who DesiAuction must not contact, one contact at a time: look a contact up,
 * lift a suppression with a written reason, add one by hand, revert either.
 * Behind `platform.admin` and nothing new; a not-found for everyone else.
 *
 * There is deliberately no list of every suppressed contact here — /admin/
 * messaging shows counts and a masked recent few. This page shows the contact
 * the operator typed and that contact's rows, which is all a lift needs.
 *
 * Rendered whole, no Suspense: the page is changed by its own actions (the
 * Phase 1 lesson — a streamed boundary kept showing the view from before).
 */
export default async function AdminSuppressionsPage() {
  if ((await platformAdminPageGate("suppressions")) === null) {
    notFound();
  }
  const desk = await adminSuppressionDesk();
  if (desk === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack admin-stack">
          <AdminPageHead>
            <NotifySubnav current="suppressions" />
          </AdminPageHead>
          <p className="admin-lede admin-lede-under">
            Contacts we must not send to. Sign-in codes still go; every lift and addition is
            audited, and can be reverted while nothing has changed since.
          </p>

          {/* Lookup first: the question this page answers is "is this contact
              suppressed, and why?". Adding one by hand and the recent changes
              sit in the side column, as on Messages. */}
          <div className="msg-layout spr-layout">
            <div className="msg-list">
              <section
                className="msg-card"
                aria-labelledby="spr-lookup-title"
                data-testid="suppression-lookup"
              >
                <header className="msg-group-head">
                  <h2 id="spr-lookup-title" className="spr-title">
                    Look up a contact
                  </h2>
                  <span>Only the contact you type is shown</span>
                </header>
                <SuppressionSearchPanel />
              </section>
            </div>

            <div className="msg-side">
              <section
                className="msg-card"
                aria-labelledby="spr-add-title"
                data-testid="suppression-add-card"
              >
                <header className="msg-recent-head spr-add-head">
                  <h2 id="spr-add-title">Suppress a contact</h2>
                  <span>
                    A request that did not come by STOP. It stops that channel until lifted.
                  </span>
                </header>
                <AddSuppressionForm scopes={SUPPRESSION_SCOPES} />
              </section>

              <section
                className="msg-card msg-recent"
                aria-labelledby="spr-recent-title"
                data-testid="suppression-recent"
              >
                <header className="msg-recent-head">
                  <h2 id="spr-recent-title">Recent changes</h2>
                  <span>
                    Lifts and additions, newest first · Revert shows while a change still stands
                  </span>
                </header>
                {desk.recent.length === 0 ? (
                  <EmptyState
                    size="compact"
                    headingLevel={3}
                    title="Nothing changed by hand yet"
                    description="Lifts and manual suppressions appear here with who made them and why."
                  />
                ) : (
                  <RecentFold items={desk.recent} className="msg-recent-list">
                    {(change) => (
                      <li key={change.id} data-testid={`suppression-change-${change.id}`}>
                        <span className="msg-recent-dot" aria-hidden />
                        <span className="msg-recent-text">
                          <span className="msg-change-line" data-private>
                            {change.summary}
                          </span>
                          <span className="msg-change-meta">
                            {change.actorName ?? "An operator"} · <RelativeTime at={change.at} />
                            {change.revertOf === null ? null : " · a revert"}
                            {change.reason === null ? null : ` · “${change.reason}”`}
                          </span>
                        </span>
                        {change.revertable ? (
                          <SuppressionRevertButton auditId={change.id} summary={change.summary} />
                        ) : null}
                      </li>
                    )}
                  </RecentFold>
                )}
              </section>
            </div>
          </div>
        </div>
      </main>
    </ToastProvider>
  );
}
