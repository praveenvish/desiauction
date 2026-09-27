import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { platformAdminPageGate } from "../../../server/admin/authz";
import { adminNotificationCenter } from "../../../server/admin/notification-views";
import { NotificationsPanel } from "./notifications-panel";
import { AdminPageHead } from "../admin-ui";
import { NotifySubnav } from "./notify-subnav";
import "../../seasons/seasons.css";
import "../admin.css";
import "./notifications.css";

export const metadata = { title: "Notifications · Platform admin · DesiAuction" };

/**
 * THE NOTIFICATION CONTROL CENTER — "Messages" (redesign stage 1, 2026-09-27).
 *
 * Every message DesiAuction sends, on every channel, with the platform's switch
 * for it: a kill switch per channel, a switch per kind per channel, and who
 * else may switch each kind off. Behind `platform.admin` and nothing new
 * (founder decision, 2026-09-23); a not-found for everyone else, like every
 * other admin surface. Changes publish directly, land on the audit log with
 * their reason, and can be reverted from the list at the bottom.
 */
export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if ((await platformAdminPageGate("notifications")) === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack admin-stack">
          <AdminPageHead>
            <NotifySubnav current="messages" />
          </AdminPageHead>
          <p className="admin-lede admin-lede-under msg-lede">
            Every message DesiAuction sends, and where it goes. Sign-in codes are never stopped;
            every change is audited and can be reverted.
          </p>
          {/* No Suspense here, unlike the read-only desks: this page is
              changed by its own actions, and a refresh that re-renders a
              streamed boundary kept showing the switch from before the
              change. Rendered whole, like /admin/moderation. */}
          <Center kind={kindParam(await searchParams)} />
        </div>
      </main>
    </ToastProvider>
  );
}

/** `?kind=` opens one message in the side panel; anything else opens none. */
function kindParam(params: Record<string, string | string[] | undefined>): string | undefined {
  const value = params["kind"];
  return typeof value === "string" ? value : undefined;
}

async function Center({ kind }: { kind: string | undefined }) {
  const center = await adminNotificationCenter();
  if (center === null) {
    notFound();
  }
  return <NotificationsPanel center={center} kind={kind} />;
}
