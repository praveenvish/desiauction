import { notFound } from "next/navigation";

import { platformAdminPageGate } from "../../../server/admin/authz";
import { adminLiveBoard } from "../../../server/admin/live-watch";
import { LiveBoard } from "./live-board";
import "../../seasons/seasons.css";
import "../admin.css";
import { AdminPageHead } from "../admin-ui";

export const metadata = { title: "Live · Platform admin · DesiAuction" };

/**
 * THE LIVE BOARD — every auction running right now, refreshing itself.
 *
 * Gate first (a real 404 for anyone without platform:admin, and ONE access-log
 * row for the visit), then the first board is rendered on the server so the
 * page is useful before any script runs. The refreshes that follow are server
 * actions and log nothing — see live-watch.ts.
 *
 * Administration watches; it cannot conduct. Every repair — pausing, closing,
 * recovering a room — happens in the organizer's cockpit, under their grants.
 */
export default async function AdminLivePage() {
  if ((await platformAdminPageGate("live")) === null) {
    notFound();
  }
  const board = await adminLiveBoard();
  if (board === null) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <AdminPageHead readOnly>
          Every auction running now, busiest first. Watching never touches the room.
        </AdminPageHead>
        <LiveBoard initial={board} />
      </div>
    </main>
  );
}
