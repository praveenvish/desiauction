import { LoadingState, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { platformAdminPageGate } from "../../../server/admin/authz";
import { adminNotificationCenter } from "../../../server/admin/notification-views";
import { NotificationsPanel } from "./notifications-panel";
import "../../seasons/seasons.css";
import "../admin.css";
import "./notifications.css";

export const metadata = { title: "Notifications · Platform admin · DesiAuction" };

/**
 * THE NOTIFICATION CONTROL CENTER (Phase 1).
 *
 * Every message DesiAuction sends, on every channel, with the platform's switch
 * for it: a kill switch per channel, a switch per kind per channel, and who
 * else may switch each kind off. Behind `platform.admin` and nothing new
 * (founder decision, 2026-09-23); a not-found for everyone else, like every
 * other admin surface. Changes publish directly, land on the audit log with
 * their reason, and can be reverted from the list at the bottom.
 */
export default async function AdminNotificationsPage() {
  if ((await platformAdminPageGate("notifications")) === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack admin-stack">
          <header className="dash-head">
            <p className="dash-hint">
              What DesiAuction sends, on which channel, and who may stop it. A switch here stops a
              message for everyone at once; people and clubs keep their own switches only where you
              leave them. Sign-in codes are never stopped. Every change is on the audit log with
              your name, and can be reverted below.
            </p>
          </header>
          <Suspense fallback={<LoadingState variant="page" />}>
            <Center />
          </Suspense>
        </div>
      </main>
    </ToastProvider>
  );
}

async function Center() {
  const center = await adminNotificationCenter();
  if (center === null) {
    notFound();
  }
  return <NotificationsPanel center={center} />;
}
