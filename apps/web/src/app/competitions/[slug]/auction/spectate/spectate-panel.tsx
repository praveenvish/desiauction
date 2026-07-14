"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { Badge, Card } from "@desiauction/ui";
import { useEffect, useState } from "react";

import { CeremonyStage } from "../ceremony-stage";
import { StatusRibbon } from "../status-ribbon";
import { useAuctionSocket } from "../use-auction-socket";

// The spectator panel: ceremony + ribbon + purse board, ALL derived from the
// broadcast AuctionSnapshot. No command sender exists in this component tree.

export function SpectatePanel({ wsUrl }: { wsUrl: string }) {
  const { snapshot, connection, remainingMs, ceremony } = useAuctionSocket(wsUrl);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div
      className="competitions-stack"
      data-testid="spectate-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <StatusRibbon snapshot={snapshot} connection={connection} remainingMs={remainingMs} />
      <CeremonyStage snapshot={snapshot} ceremony={ceremony} remainingMs={remainingMs} />

      {snapshot !== null && snapshot.currentLot !== null ? (
        <Card data-testid="spectate-history">
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

      {snapshot !== null ? (
        <Card data-testid="spectate-purses">
          <div className="competition-head">
            <h2>Teams</h2>
            <span className="competitions-hint" data-testid="spectate-progress">
              {snapshot.lotsResolved}/{snapshot.lotsTotal} lots resolved
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
