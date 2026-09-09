"use client";

import { formatPaiseINR, paise, type AuctionSnapshot, type AuctionStatus } from "@desiauction/core";
import { Badge, Card } from "@desiauction/ui";
import { useEffect, useState } from "react";

import { PageStatus } from "../../../../../components/shell/page-status";
import { CeremonyStage } from "../ceremony-stage";
import {
  AuctionProgress,
  AuctionSummaryCard,
  AuctionTimeline,
  RulesCard,
  UpNext,
  useLiveFeed,
} from "../live-experience";
import { LotHero } from "../lot-hero";
import { PurseBoard } from "../purse-board";
import { PoolSummary, SquadBoard, squadSizesOf } from "../squad-board";
import { StatusRibbon } from "../status-ribbon";
import { useAuctionSocket } from "../use-auction-socket";
import { ShareAuction } from "./share-auction";

import type { TeamIdentity } from "../purse-board";
import type {
  AuctionRules,
  LotMedia,
  PreSignedPlayer,
  ResolvedLot,
} from "../../../../../server/auction/live-summary";

// The spectator panel: the same lot hero, feed and purse board the owner room
// reads, ALL derived from the broadcast AuctionSnapshot — minus every control.
// No command sender exists in this component tree.

type BidEntry = NonNullable<AuctionSnapshot["currentLot"]>["bidHistory"][number];

interface RetainedBids {
  lotId: string;
  playerName: string;
  history: BidEntry[];
}

/**
 * THE ONE ASSERTIVE ANNOUNCEMENT: a lot resolved.
 *
 * This page used to have exactly one live region — the status ribbon — and it
 * contained the per-second countdown, so it re-announced the whole strip every
 * second and buried everything else under it. A blind spectator was never told
 * that a player had sold: the SOLD ceremony, the confetti, the bid feed and the
 * timeline were all silent. A sale is the moment of the night, it happens a
 * handful of times an hour, and it interrupts nothing else worth hearing —
 * which is exactly what `assertive` is for. Fires ONCE per resolution, keyed on
 * the outcome's sequence number (reconnect replays repeat it; `atSeq` does not).
 */
function SaleAnnouncer({ snapshot }: { snapshot: AuctionSnapshot | null }) {
  const [message, setMessage] = useState("");
  const [seenSeq, setSeenSeq] = useState<number | null>(null);

  useEffect(() => {
    const outcome = snapshot?.lastOutcome ?? null;
    if (outcome === null || outcome.atSeq === seenSeq) {
      return;
    }
    setSeenSeq(outcome.atSeq);
    const who = outcome.playerName ?? outcome.lotNumber;
    setMessage(
      outcome.kind === "sold"
        ? `Sold. ${who} to ${outcome.teamName ?? "the leading team"}${
            outcome.amount === null ? "" : ` for ${formatPaiseINR(paise(outcome.amount))}`
          }.`
        : outcome.kind === "unsold"
          ? `${who} goes unsold.`
          : outcome.kind === "withdrawn"
            ? `${who} withdrawn from the auction.`
            : `${who} is back on the block.`,
    );
  }, [snapshot, seenSeq]);

  return (
    <p
      className="spectate-announce"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-testid="sale-announcement"
    >
      {message}
    </p>
  );
}

/**
 * What this page IS, per state. It used to be the constant "Watching live",
 * printed under a SCHEDULED badge and over a completed auction alike.
 */
const WATCHING: Record<AuctionStatus, string> = {
  scheduled: "Starting soon",
  live: "Watching live",
  paused: "Paused — the clock is stopped",
  completed: "Auction complete",
  reconciled: "Auction settled",
  abandoned: "Auction abandoned",
};

/** The bids that decided the lot just resolved — kept, not wiped. */
function ResolvedBidHeader({ outcome }: { outcome: NonNullable<AuctionSnapshot["lastOutcome"]> }) {
  const parts = [
    outcome.kind.toUpperCase(),
    outcome.playerName ?? outcome.lotNumber,
    outcome.amount === null ? null : formatPaiseINR(paise(outcome.amount)),
    outcome.teamName,
  ].filter((part): part is string => part !== null && part !== "");
  return (
    <p className="feed-resolved" data-testid="feed-resolved">
      {parts.join(" · ")}
    </p>
  );
}

export function SpectatePanel({
  wsUrl,
  slug,
  roles,
  resolved,
  teams,
  rules,
  preSigned,
  lotMedia,
  auctionName,
  auctionStatus,
  orgName,
  location,
}: {
  wsUrl: string;
  slug: string;
  /** The season's roles — the stage named a footballer's in cricket. */
  roles: readonly { key: string; label: string }[];
  resolved: ResolvedLot[];
  teams: TeamIdentity[];
  rules: AuctionRules;
  preSigned: PreSignedPlayer[];
  /**
   * Faces and numbers, keyed by lot id — the spectator's half of what the room
   * sees. Consent-gated (DPDP §5) and spectator-safe by the same rule as the
   * resolved history: a photo the player agreed to publish and the number
   * already printed on their own public page.
   */
  lotMedia: Readonly<Record<string, LotMedia>>;
  auctionName: string;
  /**
   * The auction's state as the SERVER knows it — the honest answer before the
   * first snapshot lands, and the one the share text uses. The identity line
   * read "Watching live" under a SCHEDULED badge.
   */
  auctionStatus: AuctionStatus;
  orgName: string | null;
  location: string | null;
}) {
  const { snapshot, connection, remainingMs, ceremony, stale, offline, clock } =
    useAuctionSocket(wsUrl);
  const feed = useLiveFeed(resolved, snapshot);
  const [hydrated, setHydrated] = useState(false);
  // PX-6 large-screen mode: the projector view — ceremony only, huge type.
  const [stage, setStage] = useState(false);
  // The bids that built the last price. They used to vanish the instant the
  // gavel fell, because the feed rendered `currentLot.bidHistory` and the lot
  // became null — so the four bids that made the drama were replaced by "Bids
  // appear here once a lot opens." directly under the confetti.
  const [lastBids, setLastBids] = useState<RetainedBids | null>(null);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const lot = snapshot?.currentLot ?? null;
  const outcome = snapshot?.lastOutcome ?? null;

  useEffect(() => {
    const current = snapshot?.currentLot ?? null;
    if (current !== null && current.bidHistory.length > 0) {
      setLastBids({
        lotId: current.lotId,
        playerName: current.playerName ?? "Unnamed",
        history: [...current.bidHistory],
      });
    }
  }, [snapshot]);

  // Escape leaves fullscreen without touching React, so `data-stage` used to
  // stay "true" over a windowed page: the toggle then read "Exit big screen"
  // while the chrome was already back. The browser's own event is the truth.
  useEffect(() => {
    const sync = () => {
      if (document.fullscreenElement === null) {
        setStage(false);
      }
    };
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
    };
  }, []);

  // Big screen must be the ceremony and NOTHING else: the shell strip, the page
  // padding and the document's own min-height all have to stand down, or a
  // 1920x1080 projector renders a 1439px document and cuts the clock off the
  // bottom of the wall.
  useEffect(() => {
    document.documentElement.dataset.stage = stage ? "true" : "false";
    return () => {
      delete document.documentElement.dataset.stage;
    };
  }, [stage]);

  const lotDurationMs =
    ((lot?.extensions ?? 0) > 0 ? rules.extensionSeconds : rules.initialSeconds) * 1000;
  const leadColor =
    teams.find((team) => team.name === lot?.currentBid?.teamName)?.primaryColor ?? null;
  const status = snapshot?.auctionStatus ?? null;
  const finished = status === "completed" || status === "reconciled" || status === "abandoned";
  // A PAUSED auction is not an auction in progress. The hero renders green "on
  // the block", the leading team and a full gold countdown ring — which reads as
  // "plenty of time left" at the exact moment the clock is stopped. The ceremony
  // already has the correct treatment for this and it was unreachable unless the
  // guest happened to turn on Big screen.
  const frozen = status === "paused";
  const showCeremony = stage || lot === null || frozen || finished;
  const identity = [orgName, location].filter(
    (part): part is string => part !== null && part !== "",
  );

  const liveBids = lot !== null && lot.bidHistory.length > 0 ? [...lot.bidHistory] : null;
  const heldBids =
    lot === null && outcome !== null && lastBids !== null && lastBids.lotId === outcome.lotId
      ? lastBids.history
      : null;
  const bids = liveBids ?? heldBids;

  return (
    <div
      className={`competitions-stack${stage ? " stage-mode" : ""}`}
      data-testid="spectate-panel"
      data-stage={stage ? "true" : "false"}
      data-hydrated={hydrated ? "true" : "false"}
      data-stale={stale ? "true" : "false"}
    >
      {/* The ribbon IS this page's identity bar — it rides in the Live shell's
          header rather than under a page <h1> that repeated its own first cell
          word for word. */}
      <PageStatus>
        <StatusRibbon
          snapshot={snapshot}
          connection={connection}
          remainingMs={remainingMs}
          variant="shell"
          audience="public"
          offline={offline}
        />
      </PageStatus>
      <SaleAnnouncer snapshot={snapshot} />

      {/* Not `stage-hide` itself: the big screen keeps exactly one control, the
          way back out, and hiding the row's parent would hide that too. */}
      <div className="spectate-head">
        <p className="spectate-identity stage-hide" data-testid="spectate-identity">
          {WATCHING[snapshot?.auctionStatus ?? auctionStatus]}
          {identity.length > 0 ? ` · ${identity.join(" · ")}` : ""}
        </p>
        <div className="stage-toggle-row">
          <button
            type="button"
            className="stage-toggle"
            data-testid="stage-toggle"
            aria-pressed={stage}
            onClick={() => {
              setStage((value) => {
                const next = !value;
                if (next) {
                  void document.documentElement.requestFullscreen().catch(() => undefined);
                } else if (document.fullscreenElement !== null) {
                  void document.exitFullscreen().catch(() => undefined);
                }
                return next;
              });
            }}
          >
            {stage ? "Exit big screen" : "Big screen"}
          </button>
        </div>
      </div>

      {stale && snapshot !== null ? (
        <p className="spectate-stale stage-hide" data-testid="spectate-stale">
          {offline ? "This device is offline." : "Lost the auction room."} The figures below are the
          last we heard — the clock is stopped until we reconnect.
        </p>
      ) : null}

      {/* Big-screen mode is the ceremony ALONE, filling the projector — which is
          why every panel below carries `stage-hide`.
          The two never share the page: CeremonyStage renders the SAME lot the
          hero does while one is open, so showing both put "Vikram Patel · base
          ₹50,000 · 9s" on screen twice, one above the other. The hero is the
          windowed view; the ceremony is the big screen, the paused freeze, the
          completed wrap and the between-lot SOLD/UNSOLD splash. */}
      {showCeremony ? (
        <CeremonyStage
          roles={roles}
          snapshot={snapshot}
          ceremony={ceremony}
          remainingMs={remainingMs}
          lotMedia={lotMedia}
        />
      ) : (
        <div className="stage-hide">
          <LotHero
            roles={roles}
            lot={lot}
            remainingMs={remainingMs}
            lotDurationMs={lotDurationMs}
            leadColor={leadColor}
            clock={clock}
            media={lotMedia[lot.lotId]}
            testId="spectate-lot"
          />
        </div>
      )}

      <div className="stage-hide">
        <ShareAuction
          slug={slug}
          auctionName={auctionName}
          auctionStatus={snapshot?.auctionStatus ?? auctionStatus}
        />
      </div>

      {snapshot !== null && finished ? (
        <div className="stage-hide">
          <AuctionSummaryCard
            snapshot={snapshot}
            feed={feed}
            slug={slug}
            canConduct={false}
            viewerTeamName={null}
            canReplay={false}
          />
        </div>
      ) : null}

      <div className="live-grid stage-hide">
        <div className="live-col">
          <Card data-testid="spectate-history">
            <div className="competition-head">
              <h2>Bid feed</h2>
              {connection === "open" && status === "live" ? (
                <span className="live-pulse" aria-hidden />
              ) : null}
            </div>
            {/* A log region, permanently mounted (a screen reader only tracks
                regions that existed at load), so bids are heard as they land
                rather than discovered afterwards. The role goes on the wrapper,
                never on the <ol> — `role="log"` there replaces the list's own
                role and orphans every <li> under it. */}
            <div role="log" aria-live="polite" aria-label="Bid feed, newest first">
              {heldBids !== null && outcome !== null ? (
                <ResolvedBidHeader outcome={outcome} />
              ) : null}
              {bids === null ? (
                <p className="competitions-hint" data-testid="spectate-feed-empty">
                  {lot !== null
                    ? "Bids will appear here the moment they land."
                    : finished
                      ? // There is no next player. Promising one under a
                        // COMPLETED ribbon is the same lie the ceremony used to
                        // tell in 44px type.
                        "The auction is over — every lot is settled."
                      : // "The next player is coming up" rendered 400px from
                        // "REMAINING 0" and "2/2 lots · 0 in queue": the guard
                        // asked whether the AUCTION was over, not whether there
                        // was anyone left to sell.
                        (snapshot?.queue.length ?? 0) > 0
                        ? "That lot is done. The next player is coming up."
                        : (snapshot?.lotsResolved ?? 0) > 0
                          ? "That was the last player in the queue."
                          : "Bids appear here once a lot opens."}
                </p>
              ) : (
                <ol className="timeline">
                  {[...bids].reverse().map((entry) => (
                    <li key={entry.bidId}>
                      <Badge tone="neutral">{entry.paddleNumber}</Badge>
                      <span>{entry.teamName}</span>
                      <span className="timeline-at">{formatPaiseINR(paise(entry.amount))}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>

          <AuctionTimeline feed={feed} />
        </div>

        <div className="live-col">
          {/* Same board the owner and the auctioneer read, minus anything that
              could act on it. `spectate-purses` stays the handle the suite uses. */}
          <div data-testid="spectate-purses">
            <PurseBoard
              snapshot={snapshot}
              teams={teams}
              heading="Teams"
              rowTestIdPrefix="spectate-team"
              rules={rules}
              squadSizes={squadSizesOf(teams, preSigned, feed.resolved)}
            />
          </div>
          <UpNext snapshot={snapshot} />
          <PoolSummary snapshot={snapshot} resolved={feed.resolved} preSigned={preSigned} />
          {/* Same reason as the live room and the cockpit: the component renders
              its own connecting state, so guarding it here would move everything
              below when the socket answers. */}
          <span data-testid="spectate-progress">
            <AuctionProgress snapshot={snapshot} />
          </span>
          {/* The rules were already on the wire and read only for the lot window.
              "Why did that stop at ₹5L?" is answerable from here. */}
          <RulesCard rules={rules} />
        </div>
      </div>

      <div className="stage-hide">
        <SquadBoard
          roles={roles}
          teams={teams}
          preSigned={preSigned}
          resolved={feed.resolved}
          snapshot={snapshot}
          squadMax={rules.squadMax}
        />
      </div>

      <p className="spectate-footer stage-hide" data-testid="spectate-footer">
        <span>This auction is running on DesiAuction. Yours can too.</span>
        <a href="/" data-testid="spectate-footer-cta">
          Run your own auction →
        </a>
      </p>
    </div>
  );
}
