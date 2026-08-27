import { ButtonLink, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { PageTitle } from "../../../../components/shell/page-title";
import { auctionDashboard } from "../../../../server/auction/actions";
import { requireOnboarded } from "../../../../server/auth/onboarding-gate";
import { AuctionOverviewPanel } from "./auction-overview-panel";
import { AuctionPanel } from "./auction-panel";
import { BroadcastLinks } from "./broadcast-links";
import "../../seasons.css";
// The hub renders <BroadcastLinks>, and every rule that dresses it —
// `.broadcast-row`, `.share-auction-button`, `.broadcast-url` — lives in
// auction.css, which each of the eight SIBLING auction routes imports and this
// one did not. Three separate defects were the same missing line: "Open board"
// painted the user agent's #0000EE (1.92:1 on the floodlit surface), it was 19px
// tall instead of the 44px its rule specifies, and the un-wrapped board URL
// scrolled the whole page sideways at 320px.
import "./auction.css";

export const metadata = { title: "Auction · DesiAuction" };

/**
 * The header used to key off "an auction row exists" — so a COMPLETED auction
 * and a SCHEDULED one both wore the LIVE pill, the gold "Go live" button and
 * the title "Live auction", while the truth (SCHEDULED / COMPLETED) sat some
 * 1,500px further down the same page. Everything above the fold is now keyed
 * off the status itself.
 */
const TITLE_OF: Record<string, string> = {
  scheduled: "Auction setup",
  live: "Live auction",
  paused: "Auction paused",
  completed: "Auction results",
  reconciled: "Auction settled",
  abandoned: "Auction abandoned",
};

const PILL_OF: Record<string, { label: string; className: string }> = {
  scheduled: { label: "Scheduled", className: "auc-title-pill is-scheduled" },
  live: { label: "Live", className: "auc-title-pill is-live" },
  paused: { label: "Paused", className: "auc-title-pill is-paused" },
  completed: { label: "Completed", className: "auc-title-pill is-done" },
  reconciled: { label: "Settled", className: "auc-title-pill is-done" },
  abandoned: { label: "Abandoned", className: "auc-title-pill is-abandoned" },
};

export default async function AuctionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // See /seasons: `auction/spectate` next door is public, so no gate layout.
  await requireOnboarded();
  const dashboard = await auctionDashboard(slug);
  if (dashboard === null) {
    notFound();
  }
  const status = dashboard.view?.auction.status ?? null;
  const title = status === null ? null : (TITLE_OF[status] ?? null);
  const pill = status === null ? null : (PILL_OF[status] ?? null);
  // "Go live" leads to a room that is actually open. Before that there is
  // nothing to watch, and after it there is nothing to bid on.
  const inProgress = status === "live" || status === "paused";
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          {/* An auction renames the surface — the tab still says "Auction",
              the title says what is happening on it, which is not always
              "live". */}
          {title !== null ? <PageTitle title={title} /> : null}
          <header className="dash-head">
            <div className="competition-title-row title-row-actions">
              <span className="date-row">
                {pill !== null ? (
                  <span className={pill.className} data-testid="auction-header-status">
                    {pill.label}
                  </span>
                ) : null}
                {inProgress ? (
                  <ButtonLink
                    href={`/seasons/${slug}/auction/live`}
                    size="touch"
                    data-testid="open-live"
                  >
                    Go live
                  </ButtonLink>
                ) : null}
                {status !== null &&
                status !== "completed" &&
                status !== "reconciled" &&
                status !== "abandoned" &&
                dashboard.viewer.canConduct ? (
                  <ButtonLink
                    href={`/seasons/${slug}/auction/cockpit`}
                    variant="secondary"
                    size="touch"
                    data-testid="open-cockpit"
                  >
                    Cockpit
                  </ButtonLink>
                ) : null}
                {status === "completed" || status === "reconciled" ? (
                  <ButtonLink
                    href={`/seasons/${slug}/auction/replay`}
                    variant="secondary"
                    size="touch"
                    data-testid="open-replay"
                  >
                    Review the night
                  </ButtonLink>
                ) : null}
                {/* The poster studio had the same problem the board and the
                    overlay had: a finished surface with no door. It belongs
                    here, beside "Review the night" — the squads are final, and
                    the hour after the hammer is the only hour anyone wants to
                    post them. Gated on `registration.review`, which is what the
                    studio itself checks. */}
                {(status === "completed" || status === "reconciled") &&
                dashboard.viewer.canPoster ? (
                  <ButtonLink
                    href={`/seasons/${slug}/posters`}
                    variant="secondary"
                    size="touch"
                    data-testid="open-posters"
                  >
                    Share the squads
                  </ButtonLink>
                ) : null}
              </span>
            </div>
          </header>
          {dashboard.overview !== null ? (
            <AuctionOverviewPanel overview={dashboard.overview} />
          ) : null}
          {/* The board and the overlay were unreachable from anywhere in the
              product. The dashboard is where an organizer sets the night up, so
              it is where they collect the two URLs they will open elsewhere. */}
          {dashboard.viewer.canConduct ? <BroadcastLinks slug={slug} /> : null}
          <AuctionPanel slug={slug} dashboard={dashboard} />
        </div>
      </main>
    </ToastProvider>
  );
}
