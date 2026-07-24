"use client";

import { formatPaiseINR, paise } from "@desiauction/core";

import { useLiveFeed } from "../live-experience";
import { useAuctionSocket } from "../use-auction-socket";

import type { ResolvedLot } from "../../../../../server/auction/live-summary";

// The public live board: standings + headline economy tiles + recent sales, ALL
// derived from the read-only AuctionSnapshot. No command sender exists here.
// Squad counts are matched by TEAM NAME, not id: a live sale arrives via the
// snapshot's lastOutcome with only the team's name (no id), so name is the one
// key present for both the server-seeded history and live deltas.

function money(amount: number): string {
  return formatPaiseINR(paise(amount));
}

const BOARD_KICKER: Record<string, string> = {
  scheduled: "Auction starting soon",
  live: "Live auction",
  paused: "Auction paused",
  completed: "Auction complete",
  reconciled: "Auction settled",
  abandoned: "Auction abandoned",
};

export function BoardPanel({
  wsUrl,
  resolved,
  auctionName,
  competitionName,
}: {
  wsUrl: string;
  resolved: ResolvedLot[];
  auctionName: string;
  competitionName: string;
}) {
  const { snapshot, connection } = useAuctionSocket(wsUrl);
  const feed = useLiveFeed(resolved, snapshot);

  const soldLots = feed.resolved.filter((entry) => entry.status === "sold");
  const unsoldCount = feed.resolved.filter((entry) => entry.status === "unsold").length;
  const totalSpend =
    snapshot !== null ? snapshot.paddles.reduce((sum, paddle) => sum + paddle.committed, 0) : 0;
  const topBuy = soldLots.reduce<ResolvedLot | null>(
    (best, lot) => ((lot.soldPrice ?? 0) > (best?.soldPrice ?? -1) ? lot : best),
    null,
  );

  const teams =
    snapshot !== null
      ? snapshot.paddles
          .map((paddle) => ({
            ...paddle,
            squad: soldLots.filter((lot) => lot.teamName === paddle.teamName).length,
          }))
          .sort((a, b) => b.committed - a.committed)
      : [];

  const recent = [...soldLots].reverse().slice(0, 8);

  return (
    <div className="board" data-theme="floodlight" data-testid="board">
      <header className="board-head">
        <div className="board-head-main">
          {/* DA-15: this said "Live auction" whatever the auction was doing —
              including on a board projected after the night had finished. */}
          <p className="board-kicker">
            {snapshot === null || snapshot.auctionStatus === "live" ? (
              <i className="board-live-dot" aria-hidden="true" />
            ) : null}
            {BOARD_KICKER[snapshot?.auctionStatus ?? "live"]}
          </p>
          <h1 className="board-title">{auctionName}</h1>
          <p className="board-sub">{competitionName}</p>
        </div>
        {snapshot !== null ? (
          <div className="board-progress" data-testid="board-progress">
            <span className="board-progress-count">
              {snapshot.lotsResolved}
              <span className="board-progress-total">/{snapshot.lotsTotal}</span>
            </span>
            <span className="board-progress-label">lots settled</span>
            <span className="board-progress-bar" aria-hidden="true">
              <i
                style={{
                  width: `${String(
                    snapshot.lotsTotal > 0
                      ? Math.round((snapshot.lotsResolved / snapshot.lotsTotal) * 100)
                      : 0,
                  )}%`,
                }}
              />
            </span>
          </div>
        ) : null}
      </header>

      <section className="board-tiles" aria-label="Auction headlines">
        <div className="board-tile">
          <span className="board-tile-label">Total spend</span>
          <span className="board-tile-value">{money(totalSpend)}</span>
        </div>
        <div className="board-tile">
          <span className="board-tile-label">Players sold</span>
          <span className="board-tile-value">{soldLots.length}</span>
        </div>
        <div className="board-tile">
          <span className="board-tile-label">Unsold</span>
          <span className="board-tile-value">{unsoldCount}</span>
        </div>
        <div className="board-tile board-tile--wide">
          <span className="board-tile-label">Most expensive</span>
          {topBuy !== null && topBuy.soldPrice !== null ? (
            <span className="board-tile-value board-tile-top">
              {money(topBuy.soldPrice)}
              <span className="board-tile-note">
                {topBuy.playerName ?? topBuy.lotNumber}
                {topBuy.teamName !== null ? ` · ${topBuy.teamName}` : ""}
              </span>
            </span>
          ) : (
            <span className="board-tile-value board-tile-muted">—</span>
          )}
        </div>
      </section>

      <section className="board-standings" aria-label="Team standings">
        <h2 className="board-section-title">Team standings</h2>
        <div className="board-team-grid">
          {teams.map((team) => (
            <article
              key={team.paddleId}
              className="board-team"
              data-released={team.released}
              data-testid={`board-team-${team.paddleNumber}`}
            >
              <div className="board-team-top">
                <span className="board-paddle">{team.paddleNumber}</span>
                <h3 className="board-team-name">{team.teamName}</h3>
              </div>
              <div className="board-team-purse">
                <span className="board-purse-value">{money(team.purseRemaining)}</span>
                <span className="board-purse-label">purse remaining</span>
              </div>
              <dl className="board-team-stats">
                <div>
                  <dt>Spent</dt>
                  <dd>{money(team.committed)}</dd>
                </div>
                <div>
                  <dt>Squad</dt>
                  <dd>{team.squad}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      {recent.length > 0 ? (
        <section className="board-recent" aria-label="Recent sales">
          <h2 className="board-section-title">Recent sales</h2>
          <ul className="board-recent-list">
            {recent.map((lot) => (
              <li key={lot.lotId}>
                <span className="board-recent-name">{lot.playerName ?? lot.lotNumber}</span>
                <span className="board-recent-team">{lot.teamName ?? "—"}</span>
                <span className="board-recent-price">
                  {lot.soldPrice !== null ? money(lot.soldPrice) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {connection !== "open" ? <p className="board-conn">Reconnecting…</p> : null}
    </div>
  );
}
