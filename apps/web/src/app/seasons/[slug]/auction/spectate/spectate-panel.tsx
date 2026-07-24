"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { Badge, Card } from "@desiauction/ui";
import { useEffect, useState } from "react";

import { CeremonyStage } from "../ceremony-stage";
import {
  AuctionProgress,
  AuctionSummaryCard,
  AuctionTimeline,
  useLiveFeed,
} from "../live-experience";
import { LotHero } from "../lot-hero";
import { PurseBoard } from "../purse-board";
import { PoolSummary, SquadBoard } from "../squad-board";
import { StatusRibbon } from "../status-ribbon";
import { useAuctionSocket } from "../use-auction-socket";

import type { TeamIdentity } from "../purse-board";
import type {
  AuctionRules,
  PreSignedPlayer,
  ResolvedLot,
} from "../../../../../server/auction/live-summary";

// The spectator panel: the same lot hero, feed and purse board the owner room
// reads, ALL derived from the broadcast AuctionSnapshot — minus every control.
// No command sender exists in this component tree.

export function SpectatePanel({
  wsUrl,
  slug,
  resolved,
  teams,
  rules,
  preSigned,
}: {
  wsUrl: string;
  slug: string;
  resolved: ResolvedLot[];
  teams: TeamIdentity[];
  rules: AuctionRules;
  preSigned: PreSignedPlayer[];
}) {
  const { snapshot, connection, remainingMs, ceremony } = useAuctionSocket(wsUrl);
  const feed = useLiveFeed(resolved, snapshot);
  const [hydrated, setHydrated] = useState(false);
  // PX-6 large-screen mode: the projector view — ceremony only, huge type.
  const [stage, setStage] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const lot = snapshot?.currentLot ?? null;
  const lotDurationMs =
    ((lot?.extensions ?? 0) > 0 ? rules.extensionSeconds : rules.initialSeconds) * 1000;
  const leadColor =
    teams.find((team) => team.name === lot?.currentBid?.teamName)?.primaryColor ?? null;

  return (
    <div
      className={`competitions-stack${stage ? " stage-mode" : ""}`}
      data-testid="spectate-panel"
      data-stage={stage ? "true" : "false"}
      data-hydrated={hydrated ? "true" : "false"}
    >
      <div className="stage-toggle-row stage-hide">
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
      <StatusRibbon snapshot={snapshot} connection={connection} remainingMs={remainingMs} />

      {/* Big-screen mode is the ceremony ALONE, filling the projector — which is
          why every panel below carries `stage-hide`.
          The two never share the page: CeremonyStage renders the SAME lot the
          hero does while one is open, so showing both put "Vikram Patel · base
          ₹50,000 · 9s" on screen twice, one above the other. The hero is the
          windowed view; the ceremony is the big screen and the between-lot
          SOLD/UNSOLD splash. */}
      {stage || lot === null ? (
        <CeremonyStage snapshot={snapshot} ceremony={ceremony} remainingMs={remainingMs} />
      ) : (
        <div className="stage-hide">
          <LotHero
            lot={lot}
            remainingMs={remainingMs}
            lotDurationMs={lotDurationMs}
            leadColor={leadColor}
            testId="spectate-lot"
          />
        </div>
      )}

      {snapshot !== null && snapshot.auctionStatus === "completed" ? (
        <div className="stage-hide">
          <AuctionSummaryCard
            snapshot={snapshot}
            feed={feed}
            slug={slug}
            canConduct={false}
            viewerTeamName={null}
          />
        </div>
      ) : null}

      <div className="live-grid stage-hide">
        <div className="live-col">
          <Card data-testid="spectate-history">
            <div className="competition-head">
              <h2>Bid feed</h2>
              {connection === "open" ? <span className="live-pulse" aria-hidden /> : null}
            </div>
            {lot === null || lot.bidHistory.length === 0 ? (
              <p className="competitions-hint" data-testid="spectate-feed-empty">
                {lot === null
                  ? "Bids appear here once a lot opens."
                  : "Bids will appear here the moment they land."}
              </p>
            ) : (
              <ol className="timeline">
                {[...lot.bidHistory].reverse().map((entry) => (
                  <li key={entry.bidId}>
                    <Badge tone="neutral">{entry.paddleNumber}</Badge>
                    <span>{entry.teamName}</span>
                    <span className="timeline-at">{formatPaiseINR(paise(entry.amount))}</span>
                  </li>
                ))}
              </ol>
            )}
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
            />
          </div>
          <PoolSummary snapshot={snapshot} resolved={feed.resolved} preSigned={preSigned} />
          {snapshot !== null ? (
            <span data-testid="spectate-progress">
              <AuctionProgress snapshot={snapshot} />
            </span>
          ) : null}
        </div>
      </div>

      <div className="stage-hide">
        <SquadBoard
          teams={teams}
          preSigned={preSigned}
          resolved={feed.resolved}
          snapshot={snapshot}
          squadMax={rules.squadMax}
        />
      </div>
    </div>
  );
}
