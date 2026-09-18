import { notFound } from "next/navigation";

import { platformAdminPageGate } from "../../../../server/admin/authz";
import { adminAuctionExists, adminAuctionWatch } from "../../../../server/admin/live-watch";
import { AuctionWatchView } from "./auction-watch";
import "../../../seasons/seasons.css";
import "../../admin.css";

export const metadata = { title: "Auction · Platform admin · DesiAuction" };

/**
 * ONE AUCTION, WATCHED — live while it runs, its report once it has closed.
 *
 * Gate, then existence, then render: both misses are real HTTP 404s, and there
 * is no loading boundary above this page to commit a 200 first (PX-2). One
 * access-log row names the auction opened; the refreshes behind it log nothing.
 */
export default async function AdminAuctionPage({
  params,
}: {
  params: Promise<{ auctionId: string }>;
}) {
  const { auctionId } = await params;
  if ((await platformAdminPageGate("auction", auctionId)) === null) {
    notFound();
  }
  if (!(await adminAuctionExists(auctionId))) {
    notFound();
  }
  const watch = await adminAuctionWatch(auctionId);
  if (watch === null) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack admin-stack">
        <AuctionWatchView initial={watch} />
      </div>
    </main>
  );
}
