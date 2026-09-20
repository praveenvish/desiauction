import {
  ButtonLink,
  IconChart,
  IconGavel,
  IconImage,
  IconPlay,
  IconUser,
  Pill,
  ToastProvider,
  type KitTone,
} from "@desiauction/ui";
import { notFound } from "next/navigation";

import { PageTitle } from "../../../../components/shell/page-title";
import { auctionDashboard } from "../../../../server/auction/actions";
import { auctioneerPanelView } from "../../../../server/auction/auctioneer-actions";
import { appointmentsPanelView } from "../../../../server/competition/appointment-actions";
import { requireOnboarded } from "../../../../server/auth/onboarding-gate";
import { AuctionPanel } from "./auction-panel";
import { AuctioneerPanel } from "./auctioneer-panel";
import "../../seasons.css";
// The hub renders <BroadcastLinks>, and every rule that dresses it —
// `.broadcast-row`, `.share-auction-button`, `.broadcast-url` — lives in
// auction.css, which each of the eight SIBLING auction routes imports and this
// one did not. Three separate defects were the same missing line: "Open board"
// painted the user agent's #0000EE (1.92:1 on the floodlit surface), it was 19px
// tall instead of the 44px its rule specifies, and the un-wrapped board URL
// scrolled the whole page sideways at 320px.
import "./auction.css";
import "./plan/plan.css";

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

// Labels are the status words themselves (capitalized in CSS): the pill is
// also the page's one machine-readable status, `auction-status`.
const PILL_OF: Record<string, { label: string; tone: KitTone }> = {
  scheduled: { label: "scheduled", tone: "blue" },
  live: { label: "live", tone: "green" },
  paused: { label: "paused", tone: "amber" },
  completed: { label: "completed", tone: "green" },
  reconciled: { label: "settled", tone: "green" },
  abandoned: { label: "abandoned", tone: "red" },
};

export default async function AuctionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // See /seasons: `auction/spectate` next door is public, so no gate layout.
  await requireOnboarded();
  const [dashboard, auctioneers, appointments] = await Promise.all([
    auctionDashboard(slug),
    auctioneerPanelView(slug),
    // Captains & icons still to be told — null unless this viewer may set them.
    appointmentsPanelView(slug),
  ]);
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
          {/* Before an auction exists every control here is absent, and the
              empty header drew a stray rule and a blank band at the top. */}
          {status !== null ? (
            <header className="auc-head">
              {pill !== null ? (
                <span className="auc-status">
                  <Pill tone={pill.tone} dot testId="auction-status">
                    {pill.label}
                  </Pill>
                </span>
              ) : null}
              <div className="auc-head-actions">
                <span className="date-row">
                  {inProgress ? (
                    <ButtonLink
                      href={`/seasons/${slug}/auction/live`}
                      variant="secondary"
                      size="sm"
                      data-testid="open-live"
                    >
                      <IconPlay size={16} />
                      Go live
                    </ButtonLink>
                  ) : null}
                  {status !== "completed" &&
                  status !== "reconciled" &&
                  status !== "abandoned" &&
                  dashboard.viewer.canConduct ? (
                    <ButtonLink
                      href={`/seasons/${slug}/auction/cockpit`}
                      variant="secondary"
                      size="sm"
                      data-testid="open-cockpit"
                    >
                      <IconGavel size={16} />
                      Cockpit
                    </ButtonLink>
                  ) : null}
                  {/* WR-1: the owner's private plan. Shown only to someone who holds a
                    team in this auction, and only while planning is switched on —
                    `planView` 404s for everyone else, so the door must not exist for
                    them either. */}
                  {dashboard.viewer.planAvailable ? (
                    <ButtonLink
                      href={`/seasons/${slug}/auction/plan`}
                      variant="secondary"
                      size="sm"
                      data-testid="open-plan"
                    >
                      <IconUser size={16} />
                      My plan
                    </ButtonLink>
                  ) : null}
                  {status === "completed" || status === "reconciled" ? (
                    <ButtonLink
                      href={`/seasons/${slug}/auction/replay`}
                      variant="secondary"
                      size="sm"
                      data-testid="open-replay"
                    >
                      <IconChart size={16} />
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
                      size="sm"
                      data-testid="open-posters"
                    >
                      <IconImage size={16} />
                      Share results
                    </ButtonLink>
                  ) : null}
                </span>
              </div>
            </header>
          ) : null}
          <AuctionPanel
            slug={slug}
            dashboard={dashboard}
            appointments={appointments}
            auctioneersSlot={
              auctioneers !== null ? (
                <AuctioneerPanel key="auctioneers" slug={slug} view={auctioneers} />
              ) : null
            }
          />
        </div>
      </main>
    </ToastProvider>
  );
}
