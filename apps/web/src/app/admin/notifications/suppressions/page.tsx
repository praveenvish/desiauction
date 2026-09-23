import {
  EmptyState,
  IconArrowLeft,
  IconClock,
  IconLock,
  IconPlus,
  SectionCard,
  ToastProvider,
} from "@desiauction/ui";
import { notFound } from "next/navigation";

import { platformAdminPageGate } from "../../../../server/admin/authz";
import { adminSuppressionDesk } from "../../../../server/admin/suppression-views";
import { SUPPRESSION_SCOPES } from "../../../../server/messaging/suppression-contact";
import { NavButton } from "../../../players/nav-button";
import { RelativeTime } from "../../admin-ui";
import {
  AddSuppressionForm,
  SuppressionRevertButton,
  SuppressionSearchPanel,
} from "./suppression-desk";
import "../../../seasons/seasons.css";
import "../../admin.css";
import "../notifications.css";

export const metadata = { title: "Suppressions · Notifications · Platform admin · DesiAuction" };

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
          <header className="dash-head ntc-page-head">
            <NavButton href="/admin/notifications" variant="ghost" className="ntc-back">
              <IconArrowLeft size={18} aria-hidden />
              All notifications
            </NavButton>
            <p className="dash-hint">
              Contacts DesiAuction must not send to: people who texted STOP, addresses that bounced
              or complained, and ones added by hand. A suppression stops queued messages on its
              channel; sign-in codes still go. Every lift and addition is on the audit log with your
              name and reason, and can be reverted below.
            </p>
          </header>

          <SectionCard
            icon={<IconLock />}
            tone="neutral"
            title="Look up a contact"
            description="Is this address or number suppressed, and why? Only the contact you type is shown."
            flush
            data-testid="suppression-lookup"
          >
            <SuppressionSearchPanel />
          </SectionCard>

          <SectionCard
            icon={<IconPlus />}
            tone="neutral"
            title="Suppress a contact"
            description="For a request that did not come by STOP — an email to support, a call. It stops that channel until lifted."
            flush
            data-testid="suppression-add-card"
          >
            <AddSuppressionForm scopes={SUPPRESSION_SCOPES} />
          </SectionCard>

          <SectionCard
            icon={<IconClock />}
            tone="neutral"
            title="Recent changes"
            description="The last twenty lifts and additions, newest first. Revert puts the suppression back as it was, and is itself recorded."
            flush
            data-testid="suppression-recent"
          >
            {desk.recent.length === 0 ? (
              <div className="admin-card-empty">
                <EmptyState
                  headingLevel={3}
                  title="Nothing changed by hand yet"
                  description="Lifts and manual suppressions appear here with who made them and why."
                />
              </div>
            ) : (
              <ul className="admin-rows is-stacked">
                {desk.recent.map((change) => (
                  <li key={change.id} data-testid={`suppression-change-${change.id}`}>
                    <span className="admin-cell-main">
                      <span className="admin-name" data-private>
                        {change.summary}
                      </span>
                      <span className="admin-meta">
                        {change.actorName ?? "An operator"} · <RelativeTime at={change.at} />
                        {change.revertOf === null ? null : " · a revert"}
                      </span>
                      {change.reason === null ? null : (
                        <span className="admin-meta">Reason: {change.reason}</span>
                      )}
                    </span>
                    {change.revertable ? (
                      <SuppressionRevertButton auditId={change.id} summary={change.summary} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </main>
    </ToastProvider>
  );
}
