import { notFound } from "next/navigation";

import { platformAdminPageGate } from "../../../server/admin/authz";
import { adminLiveBoard } from "../../../server/admin/live-watch";
import { LiveBoard } from "./live-board";
import "../../seasons/seasons.css";
import "../admin.css";
import "./live.css";
import { AdminPageHead } from "../admin-ui";

export const metadata = { title: "Live · Platform admin" };

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
export default async function AdminLivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if ((await platformAdminPageGate("live")) === null) {
    notFound();
  }
  const board = await adminLiveBoard((await searchParams).page);
  if (board === null) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <AdminPageHead readOnly>
          Open auctions, busiest first, in pages of 50. Counts describe this page; live activity can
          change page order. Watching never touches the room.
        </AdminPageHead>
        <LiveBoard key={board.pagination?.page ?? 1} initial={board} />
      </div>
    </main>
  );
}
