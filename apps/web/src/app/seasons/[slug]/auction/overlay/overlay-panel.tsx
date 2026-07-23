"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import type { CSSProperties } from "react";

import { useLiveFeed } from "../live-experience";
import { useAuctionSocket } from "../use-auction-socket";

import type { ResolvedLot } from "../../../../../server/auction/live-summary";

// The broadcast overlay: ticker + lower-third + sponsor/watch cluster, ALL
// derived from the read-only AuctionSnapshot. No command sender exists in this
// tree. The SOLD confetti reuses the exact celebration layer from auction.css
// (`.ceremony-celebration` / `.ceremony-confetti`), so a sale lights up the OBS
// feed with the same burst as the cockpit and the stage. Fully decorative and
// collapses under prefers-reduced-motion; nothing about the announced outcome
// depends on motion.

const CONFETTI = Array.from({ length: 30 }, (_, i) => i);

function money(amount: number): string {
  return formatPaiseINR(paise(amount));
}

export function OverlayPanel({
  wsUrl,
  resolved,
  auctionName,
  sponsor,
  watchUrl,
}: {
  wsUrl: string;
  resolved: ResolvedLot[];
  auctionName: string;
  sponsor: string | null;
  watchUrl: string;
}) {
  const { snapshot, connection, remainingMs, ceremony } = useAuctionSocket(wsUrl);
  const feed = useLiveFeed(resolved, snapshot);

  const lot = snapshot?.currentLot ?? null;
  const outcome = snapshot?.lastOutcome ?? null;
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const showTimer =
    lot !== null &&
    lot.endsAtMs !== null &&
    seconds !== null &&
    snapshot?.auctionStatus !== "paused";

  // The ticker: the auction's sold history, newest last. Falls back to a title
  // card before the first sale so the strip is never empty on air.
  const sold = feed.resolved.filter((entry) => entry.status === "sold");
  const watchLabel = watchUrl.replace(/^https?:\/\//, "");

  // Which lower-third to show: the live lot, else the last outcome, else "up next".
  const tone = lot !== null ? "live" : (outcome?.kind ?? "idle");
  const nextUp = snapshot !== null && snapshot.queue.length > 0 ? snapshot.queue[0] : null;

  return (
    <div className="obs-overlay" data-theme="floodlight" data-testid="obs-overlay">
      {ceremony.phase === "sold" ? (
        <div className="ceremony-celebration obs-celebration" aria-hidden="true">
          <span className="ceremony-glow" />
          {CONFETTI.map((index) => (
            <i
              key={index}
              className="ceremony-confetti"
              style={{ "--i": index } as CSSProperties}
            />
          ))}
        </div>
      ) : null}

      {/* --- top ticker --- */}
      <div className="obs-ticker">
        <span className="obs-ticker-live">Live</span>
        <div className="obs-ticker-track">
          <div className="obs-ticker-move">
            {sold.length > 0
              ? [...sold, ...sold].map((entry, index) => (
                  <span className="obs-ticker-item" key={`${entry.lotId}-${String(index)}`}>
                    <span className="obs-ticker-tag">Sold</span>
                    <b>{entry.playerName ?? entry.lotNumber}</b>
                    {entry.teamName !== null ? <span>→ {entry.teamName}</span> : null}
                    {entry.soldPrice !== null ? (
                      <span className="obs-ticker-price">{money(entry.soldPrice)}</span>
                    ) : null}
                  </span>
                ))
              : [0, 1].map((index) => (
                  <span className="obs-ticker-item" key={index}>
                    <b>{auctionName}</b>
                    <span>live player auction</span>
                  </span>
                ))}
          </div>
        </div>
      </div>

      {connection !== "open" ? <div className="obs-conn">Reconnecting…</div> : null}

      {/* --- lower third --- */}
      <div className="obs-lowerthird" data-tone={tone} data-testid="obs-lowerthird">
        <span className="obs-accent" aria-hidden="true" />
        <div className="obs-lt-main">
          {lot !== null ? (
            <>
              <span className="obs-lt-eyebrow">On the block · {lot.lotNumber}</span>
              <span className="obs-lt-name">{lot.playerName ?? "Unnamed"}</span>
              <span className="obs-lt-meta">
                {lot.role.replace(/_/g, " ")} · base {money(lot.basePrice)}
              </span>
            </>
          ) : outcome !== null ? (
            <>
              <span className="obs-lt-eyebrow">{outcome.kind}</span>
              <span className="obs-lt-name">{outcome.playerName ?? outcome.lotNumber}</span>
              <span className="obs-lt-meta">
                {outcome.kind === "sold" && outcome.teamName !== null
                  ? `to ${outcome.teamName}`
                  : auctionName}
              </span>
            </>
          ) : (
            <>
              <span className="obs-lt-eyebrow">{nextUp !== null ? "Up next" : "Auction"}</span>
              <span className="obs-lt-name">
                {nextUp?.playerName ?? nextUp?.lotNumber ?? auctionName}
              </span>
              <span className="obs-lt-meta">
                {snapshot !== null
                  ? `${String(snapshot.lotsResolved)}/${String(snapshot.lotsTotal)} lots settled`
                  : "Connecting…"}
              </span>
            </>
          )}
        </div>

        {/* Right block: the money — live bid, or the winning price on a sale. */}
        {lot !== null ? (
          <div className="obs-lt-bid">
            <span className="obs-lt-bid-label">
              {lot.currentBid !== null ? "Current bid" : "Opening"}
            </span>
            <span className="obs-lt-bid-amount">
              {money(lot.currentBid?.amount ?? lot.nextMinimumBid)}
            </span>
            {lot.currentBid !== null ? (
              <span className="obs-lt-leader">
                {lot.currentBid.teamName} · {lot.currentBid.paddleNumber}
              </span>
            ) : null}
            {showTimer ? (
              <span className="obs-lt-timer" data-hot={seconds <= 15}>
                {seconds}s{lot.extensions > 0 ? ` · +${String(lot.extensions)}` : ""}
              </span>
            ) : null}
          </div>
        ) : outcome !== null && outcome.kind === "sold" && outcome.amount !== null ? (
          <div className="obs-lt-bid">
            <span className="obs-lt-bid-label">Sold for</span>
            <span className="obs-lt-bid-amount">{money(outcome.amount)}</span>
            {outcome.paddleNumber !== null ? (
              <span className="obs-lt-leader">Paddle {outcome.paddleNumber}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* --- brand / watch cluster --- */}
      <div className="obs-brand">
        {sponsor !== null ? (
          <div className="obs-sponsor">
            <span>Presented by</span>
            {sponsor}
          </div>
        ) : null}
        <div className="obs-watch">
          <span className="obs-watch-label">Watch live</span>
          <span className="obs-watch-url">{watchLabel}</span>
        </div>
      </div>
    </div>
  );
}
