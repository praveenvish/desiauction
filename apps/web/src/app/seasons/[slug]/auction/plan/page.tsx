import { AnnouncerProvider, ButtonLink } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { planView } from "../../../../../server/auction/owner-plan-actions";
import { PlanPanel } from "./plan-panel";
import "../../../seasons.css";
import "../auction.css";
import "./plan.css";

export const metadata = { title: "My plan · DesiAuction" };

/**
 * MY PLAN (WR-1): the owner's private list of the players they mean to bid
 * for, the most they mean to pay, and who they fall back to — compared with
 * where their purse actually stands.
 *
 * NULL IS 404. Not in the room, a team that is not yours, the feature switched
 * off: `planView` answers the same absence for all of them, and this page does
 * not tell them apart. The team is chosen server-side from the caller's own
 * participation; `?team=` only picks among teams the caller already holds.
 */
export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ team?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const requested = typeof query.team === "string" && query.team !== "" ? query.team : null;
  const view = await planView(slug, requested);
  if (view === null) {
    notFound();
  }
  return (
    <main className="registrations-dash live-page">
      <div className="dash-stack">
        {/* The Live shell carries no announcer of its own (the room renders its
            own aria-live regions), so the plan mounts one for its polite
            "saved" / "added" confirmations. */}
        <AnnouncerProvider>
          <PlanPanel slug={slug} view={view} />
        </AnnouncerProvider>
        <nav className="live-exits" aria-label="Other auction views">
          <ButtonLink href={`/seasons/${slug}/auction/live`} data-testid="plan-open-live">
            Owner room
          </ButtonLink>
          <ButtonLink href={`/seasons/${slug}/auction`} variant="secondary">
            Auction
          </ButtonLink>
        </nav>
      </div>
    </main>
  );
}
