"use client";

import { formatPaiseINR, paise, type AuctionStatus } from "@desiauction/core";

import { OUTCOME_TITLE, outcomeMeta } from "../ceremony-stage";
import { useLiveFeed } from "../live-experience";
import { purseRowKey, teamPurseRows, type TeamIdentity } from "../purse-board";
import { useAuctionSocket } from "../use-auction-socket";

import type { ResolvedLot } from "../../../../../server/auction/live-summary";

// The public live board: the lot on the block, standings, headline economy
// tiles and recent sales, ALL derived from the read-only AuctionSnapshot. No
// command sender exists here.
// Squad counts are matched by TEAM NAME, not id: a live sale arrives via the
// snapshot's lastOutcome with only the team's name (no id), so name is the one
// key present for both the server-seeded history and live deltas.

function money(amount: number): string {
  return formatPaiseINR(paise(amount));
}

/**
 * The board's own status vocabulary, and — new — its own colour per status.
 *
 * `.board-kicker` had a single hard-coded `color: var(--live)`, so "AUCTION
 * PAUSED" printed in the same #3DD68C as "LIVE AUCTION": across a whole
 * 1920x1080 frame the only difference between a running auction and a stopped
 * one was a 9px dot. `"Auction abandoned"` printed in live-green too. The tone
 * rides on `data-status` and board.css branches on it.
 */
const BOARD_KICKER: Record<AuctionStatus, string> = {
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
  orgName,
  location,
  watchUrl,
  teamIdentities,
}: {
  wsUrl: string;
  resolved: ResolvedLot[];
  auctionName: string;
  competitionName: string;
  /**
   * Who is running this and where. Both were already on `SpectatorView` and the
   * board's page simply dropped them, so a photograph of the projector six
   * months later had nothing on it identifying the event.
   */
  orgName: string | null;
  location: string | null;
  /** Where the room can follow along on their phones. */
  watchUrl: string;
  teamIdentities: TeamIdentity[];
}) {
  // DA-20: the board read `connection !== "open"` and ignored `stale`/`offline`
  // entirely, so six seconds offline left the projector byte-identical to the
  // online frame — pulsing green dot, "LIVE AUCTION", live money, no warning.
  const { snapshot, remainingMs, stale, offline } = useAuctionSocket(wsUrl);
  const feed = useLiveFeed(resolved, snapshot);

  const soldLots = feed.resolved.filter((entry) => entry.status === "sold");
  const unsoldCount = feed.resolved.filter((entry) => entry.status === "unsold").length;
  // Money the viewer may not see arrives as null (the engine redacts per
  // audience — P1-6). A total over a redacted board would be a wrong number
  // presented confidently, so it sums only what this viewer was actually sent.
  const totalSpend =
    snapshot !== null
      ? snapshot.paddles.reduce((sum, paddle) => sum + (paddle.committed ?? 0), 0)
      : 0;
  const topBuy = soldLots.reduce<ResolvedLot | null>(
    (best, lot) => ((lot.soldPrice ?? 0) > (best?.soldPrice ?? -1) ? lot : best),
    null,
  );

  // ONE ROW PER TEAM. This grid used to map paddles: on the projector two
  // hundred people watch, a franchise that had handed a paddle back and taken
  // another appeared three times, each card repeating the team's whole purse
  // and its whole squad — the hall read three times the money and three times
  // the players. Released paddles rendered as live purses too.
  /**
   * THE FRANCHISES ARE KNOWN BEFORE THE SOCKET IS.
   *
   * `teamIdentities` is a server prop, so the board has the team list in its
   * first paint and only the NUMBERS have to wait for the snapshot. This used
   * to fall back to `[]`, which meant the standings grid rendered zero cards
   * until the socket answered ~400ms later and then four appeared at once —
   * the largest part of a measured CLS of 0.751 on a screen that is projected
   * in front of a hall.
   *
   * The repair is not a shimmer. A skeleton would reserve the space and say
   * nothing; the real card with its real crest and an em dash where a figure
   * will go reserves the same space AND tells a filling room which franchises
   * are playing tonight. Same pixels, more information.
   *
   * Sorting is by committed spend, which is 0 for every row while connecting —
   * so the tiebreak (name) is what orders them, and the order the room sees
   * first is alphabetical rather than arbitrary.
   */
  const connecting = snapshot === null;
  const teams = connecting
    ? teamIdentities
        .map((team) => ({
          teamId: team.id,
          teamName: team.name,
          team,
          committed: 0,
          purseRemaining: null,
          total: null,
          activePaddles: [],
          leading: false,
          squad: 0,
        }))
        .sort((a, b) => a.teamName.localeCompare(b.teamName))
    : teamPurseRows(snapshot, teamIdentities)
        .map((row) => ({
          ...row,
          squad: soldLots.filter((lot) => lot.teamName === row.teamName).length,
        }))
        .sort((a, b) => b.committed - a.committed || a.teamName.localeCompare(b.teamName));

  // A projector is ONE frame, so the board has to spend its height rather than
  // overflow it. When a player is under the hammer the room is watching the
  // block, not the history — so recent sales stand down for the duration of a
  // lot and come back between lots, which is exactly when they are read.
  const recent = [...soldLots].reverse().slice(0, 6);

  const status = snapshot?.auctionStatus ?? null;
  const lot = snapshot?.currentLot ?? null;
  const seconds = remainingMs === null ? null : Math.max(0, Math.ceil(remainingMs / 1000));
  // The clock is a memory the instant the feed goes quiet — never count down
  // over a snapshot the engine has stopped confirming.
  const showTimer = !stale && status === "live" && lot !== null && seconds !== null;
  // A board projected before the first lot opens: the tiles below are all zero
  // and the frame says nothing about the night. `scheduled` is the honest test —
  // not "no snapshot", which is simply "not connected yet".
  const preAuction = status === "scheduled";
  const identity = [orgName, location, competitionName].filter(
    (part): part is string => part !== null && part !== "",
  );

  // What the room is being told, in one sentence, for anyone who cannot read
  // the wall. /board had NO live region at all.
  const announcement =
    snapshot === null
      ? ""
      : lot !== null
        ? `On the block: ${lot.playerName ?? lot.lotNumber}. ${
            lot.currentBid === null
              ? `Opening at ${money(lot.nextMinimumBid)}.`
              : `${money(lot.currentBid.amount)} to ${lot.currentBid.teamName}.`
          }`
        : snapshot.lastOutcome !== null
          ? // Never the raw engine enum: "Amit Verma: held." is not English.
            `${snapshot.lastOutcome.playerName ?? snapshot.lastOutcome.lotNumber} — ${
              OUTCOME_TITLE[snapshot.lastOutcome.kind]
            }${
              snapshot.lastOutcome.amount === null
                ? ""
                : ` at ${money(snapshot.lastOutcome.amount)}`
            }. ${outcomeMeta(snapshot.lastOutcome)}.`
          : "";

  return (
    <div
      className="board"
      data-theme="floodlight"
      data-testid="board"
      data-status={status ?? "connecting"}
      data-stale={stale ? "true" : "false"}
    >
      <header className="board-head">
        <div className="board-head-main">
          {/* DA-15: this said "Live auction" whatever the auction was doing —
              including on a board projected after the night had finished.
              DA-20: and with NO snapshot at all it still defaulted to "live",
              pulsing dot included, so a board that had never reached the engine
              asserted a live auction to the room. */}
          <p className="board-kicker" data-testid="board-kicker">
            {status === "live" && !stale ? (
              <i className="board-live-dot" aria-hidden="true" />
            ) : null}
            {snapshot === null
              ? "Connecting to the auction room"
              : BOARD_KICKER[snapshot.auctionStatus]}
          </p>
          <h1 className="board-title">{auctionName}</h1>
          {identity.length > 0 ? (
            <p className="board-sub" data-testid="board-identity">
              {identity.join(" · ")}
            </p>
          ) : null}
        </div>
        {/* Rendered while connecting too, with em dashes for the counts. It is
            the right-hand half of the header: absent, the title block had the
            whole width and re-flowed when the socket answered. */}
        <div className="board-progress" data-testid="board-progress" data-connecting={connecting}>
          {connecting ? (
            <span className="board-progress-count">
              &mdash;<span className="board-progress-total">/&mdash;</span>
            </span>
          ) : (
            <span className="board-progress-count">
              {snapshot.lotsResolved}
              <span className="board-progress-total">/{snapshot.lotsTotal}</span>
            </span>
          )}
          <span className="board-progress-label">lots settled</span>
          <span className="board-progress-bar" aria-hidden="true">
            <i
              style={{
                width: `${String(
                  snapshot !== null && snapshot.lotsTotal > 0
                    ? Math.round((snapshot.lotsResolved / snapshot.lotsTotal) * 100)
                    : 0,
                )}%`,
              }}
            />
          </span>
        </div>
      </header>

      {/* THE STALENESS BANNER. Sized for the back of the room, not a 12px chip
          in a corner: if the numbers behind it are a memory, that is the most
          important fact on the wall. */}
      {stale && snapshot !== null ? (
        <p className="board-stale" role="alert" data-testid="board-stale">
          <span className="board-stale-head">
            {offline ? "This screen is offline" : "Lost the auction room"}
          </span>
          <span className="board-stale-body">
            Everything below is the last we heard — the clock is stopped until we reconnect.
          </span>
        </p>
      ) : null}

      {/* The one sentence the wall is saying, for assistive tech. */}
      <p className="board-sr-only" role="status" aria-live="polite" data-testid="board-announce">
        {announcement}
      </p>

      {/* THE LOT ON THE BLOCK. The board never read `snapshot.currentLot` at
          all: opening a lot live produced a frame byte-identical to the one
          taken before it opened, while the OBS overlay next door carried the
          player, the price and the clock. This is the surface the ROOM watches;
          it led with aggregate spend and never named who was being sold. */}
      {lot !== null ? (
        <section className="board-block" aria-label="On the block" data-testid="board-block">
          <div className="board-block-who">
            <p className="board-block-kicker">
              On the block · {lot.lotNumber}
              {lot.extensions > 0 ? ` · extended ×${String(lot.extensions)}` : ""}
            </p>
            <h2 className="board-block-name" data-testid="board-block-name">
              {lot.playerName ?? "Unnamed"}
            </h2>
            <p className="board-block-meta">
              {lot.role.replace(/_/g, " ")} · base {money(lot.basePrice)}
            </p>
          </div>
          <div className="board-block-money">
            <span className="board-block-label">
              {lot.currentBid !== null ? "Current bid" : "Opening at"}
            </span>
            <span className="board-block-amount" data-testid="board-block-amount">
              {money(lot.currentBid?.amount ?? lot.nextMinimumBid)}
            </span>
            <span className="board-block-leader" data-testid="board-block-leader">
              {lot.currentBid !== null ? lot.currentBid.teamName : "No bids yet"}
            </span>
          </div>
          <div className="board-block-clock">
            {showTimer ? (
              <>
                <span
                  className="board-block-seconds"
                  data-hot={seconds <= 15}
                  data-testid="board-block-timer"
                >
                  {seconds}
                </span>
                <span className="board-block-label">seconds</span>
              </>
            ) : (
              <span className="board-block-stopped" data-testid="board-block-stopped">
                {status === "paused" ? "Clock stopped" : stale ? "Clock stopped" : "—"}
              </span>
            )}
          </div>
        </section>
      ) : null}

      {/* THE 6PM BOARD. Before the first lot this was ₹0 / 0 / 0 / — over 40%
          empty frame: a projector in a filling hall telling the room nothing
          about the evening it was there for. */}
      {preAuction ? (
        <section className="board-doors" aria-label="Before the auction" data-testid="board-doors">
          <p className="board-doors-lede">
            {snapshot !== null && snapshot.lotsTotal > 0
              ? `${String(snapshot.lotsTotal)} ${
                  snapshot.lotsTotal === 1 ? "player goes" : "players go"
                } under the hammer tonight.`
              : "The auction is about to begin."}
          </p>
          <dl className="board-doors-facts">
            <div>
              <dt>Players</dt>
              <dd>{snapshot?.lotsTotal ?? 0}</dd>
            </div>
            <div>
              <dt>Franchises</dt>
              <dd>{teamIdentities.length}</dd>
            </div>
            <div>
              <dt>Paddles claimed</dt>
              <dd>{snapshot?.paddles.filter((paddle) => !paddle.released).length ?? 0}</dd>
            </div>
          </dl>
          <p className="board-doors-watch">
            <span className="board-doors-watch-label">Follow every lot on your phone</span>
            <span className="board-doors-watch-url">{watchUrl}</span>
          </p>
        </section>
      ) : (
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
          <div className="board-tile">
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
      )}

      <section className="board-standings" aria-label="Team standings">
        <h2 className="board-section-title">Team standings</h2>
        <div className="board-team-grid">
          {teams.map((team) => (
            <article
              key={team.teamId}
              className="board-team"
              data-testid={`board-team-${purseRowKey(team)}`}
            >
              <div className="board-team-top">
                <span className="board-paddle">
                  {team.activePaddles.length > 0 ? team.activePaddles.join(" · ") : "—"}
                </span>
                <h3 className="board-team-name">{team.teamName}</h3>
              </div>
              <div className="board-team-purse">
                <span className="board-purse-value">
                  {/* "sealed" means the engine withheld this team's money from
                      this viewer. Before the socket answers, nothing has been
                      withheld — it simply is not known yet, and saying "sealed"
                      there would state a permission fact that is not true. */}
                  {connecting
                    ? "—"
                    : team.purseRemaining === null
                      ? "sealed"
                      : money(team.purseRemaining)}
                </span>
                <span className="board-purse-label">purse remaining</span>
              </div>
              <dl className="board-team-stats">
                <div>
                  <dt>Spent</dt>
                  <dd>{connecting ? "—" : money(team.committed)}</dd>
                </div>
                <div>
                  <dt>Squad</dt>
                  <dd>{connecting ? "—" : team.squad}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      {recent.length > 0 && lot === null ? (
        <section className="board-recent" aria-label="Recent sales">
          <h2 className="board-section-title">Recent sales</h2>
          <ul className="board-recent-list">
            {recent.map((lotRow) => (
              <li key={lotRow.lotId}>
                <span className="board-recent-name">{lotRow.playerName ?? lotRow.lotNumber}</span>
                <span className="board-recent-team">{lotRow.teamName ?? "—"}</span>
                <span className="board-recent-price">
                  {lotRow.soldPrice !== null ? money(lotRow.soldPrice) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
