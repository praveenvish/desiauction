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
import { StatusRibbon } from "../status-ribbon";
import { useAuctionSocket } from "../use-auction-socket";

import type { ResolvedLot } from "../../../../../server/auction/live-summary";

// The spectator panel: ceremony + ribbon + purse board, ALL derived from the
// broadcast AuctionSnapshot. No command sender exists in this component tree.

export function SpectatePanel({
  wsUrl,
  slug,
  resolved,
}: {
  wsUrl: string;
  slug: string;
  resolved: ResolvedLot[];
}) {
  const { snapshot, connection, remainingMs, ceremony } = useAuctionSocket(wsUrl);
  const feed = useLiveFeed(resolved, snapshot);
  const [hydrated, setHydrated] = useState(false);
  // PX-6 large-screen mode: the projector view — ceremony only, huge type.
  const [stage, setStage] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

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
      <CeremonyStage snapshot={snapshot} ceremony={ceremony} remainingMs={remainingMs} />

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

      {snapshot !== null && snapshot.currentLot !== null ? (
        <Card data-testid="spectate-history" className="stage-hide">
          <h2>Bid history</h2>
          <ol className="timeline">
            {[...snapshot.currentLot.bidHistory].reverse().map((entry) => (
              <li key={entry.bidId}>
                <Badge tone="neutral">{entry.paddleNumber}</Badge>
                <span>{entry.teamName}</span>
                <span className="timeline-at">{formatPaiseINR(paise(entry.amount))}</span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <div className="stage-hide">
        <AuctionTimeline feed={feed} />
      </div>

      {snapshot !== null ? (
        <Card data-testid="spectate-purses" className="stage-hide">
          <div className="competition-head">
            <h2>Teams</h2>
            <span data-testid="spectate-progress">
              <AuctionProgress snapshot={snapshot} />
            </span>
          </div>
          <ul className="conflict-list">
            {snapshot.paddles.map((paddle) => (
              <li key={paddle.paddleId} data-testid={`spectate-team-${paddle.paddleNumber}`}>
                <Badge tone={paddle.released ? "neutral" : "info"}>{paddle.paddleNumber}</Badge>
                <span>{paddle.teamName}</span>
                <span className="registration-phone">
                  {formatPaiseINR(paise(paddle.purseRemaining))} remaining
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
