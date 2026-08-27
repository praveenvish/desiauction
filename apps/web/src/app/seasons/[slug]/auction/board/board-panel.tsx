"use client";

import { formatPaiseINR, paise, roleLabel, type AuctionStatus } from "@desiauction/core";
import { PlayerImage, paintOnFill } from "@desiauction/ui";
import { useState } from "react";

import { OUTCOME_TITLE, outcomeMeta } from "../ceremony-stage";
import { useLiveFeed } from "../live-experience";
import { purseRowKey, teamPurseRows, type TeamIdentity } from "../purse-board";
import { useAuctionSocket } from "../use-auction-socket";

import type { LotMedia, ResolvedLot } from "../../../../../server/auction/live-summary";

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

/**
 * The crest monogram: the organizer's short name if they set one, otherwise the
 * initials of the franchise — the same rule the shared purse chip follows.
 *
 * Duplicated rather than imported because `purse-board` does not export it, and
 * the board cannot simply render `TeamChip`: that is a 30px console element, and
 * 30px on a hall projector is a smudge. Everything about this treatment except
 * the SCALE is the shared one.
 */
function crestInitials(team: TeamIdentity | undefined, fallback: string): string {
  if (team?.shortName != null && team.shortName !== "") {
    return team.shortName.slice(0, 3).toUpperCase();
  }
  return (team?.name ?? fallback)
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

/**
 * A franchise's crest, or its colours when there is no crest to show.
 *
 * The fallback is NOT a spacer: `paintOnFill` picks a label colour from the
 * organizer's own hex (the same contract the purse chip uses), so a club with
 * no uploaded logo still owns its square in the standings grid in its own
 * colour rather than going anonymous on the wall.
 *
 * `onError` matters more here than anywhere else in the product. This screen is
 * projected unattended for three hours; an object the bucket cannot serve would
 * otherwise print a browser's broken-image glyph in front of the whole hall,
 * and the monogram is a better answer than a torn page icon.
 */
function BoardCrest({ team, fallback }: { team: TeamIdentity | undefined; fallback: string }) {
  const [broken, setBroken] = useState(false);
  const logoUrl = team?.logoUrl ?? null;
  if (logoUrl !== null && logoUrl !== "" && !broken) {
    return (
      <img
        className="board-crest"
        src={logoUrl}
        alt=""
        onError={() => {
          setBroken(true);
        }}
      />
    );
  }
  return (
    <span
      className="board-crest board-crest-mark"
      style={paintOnFill(team?.primaryColor)}
      aria-hidden
    >
      {crestInitials(team, fallback)}
    </span>
  );
}

export function BoardPanel({
  wsUrl,
  resolved,
  auctionName,
  competitionName,
  orgName,
  location,
  watchUrl,
  teamIdentities,
  lotMedia,
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
  /**
   * The face and the registration number for every lot, keyed by LOT ID and
   * carried BESIDE the snapshot rather than on it: the engine hashes the
   * snapshot to prove its fold is deterministic, and a media URL signed at read
   * would make two honest engines disagree on the bytes. Photos are
   * consent-gated (DPDP §5), so `photoUrl` is null far more often than not and
   * the branded mark is the normal case, not the error case.
   */
  lotMedia: Record<string, LotMedia>;
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
  // Money the viewer may not see arrives as null (the engine redacts per
  // audience — P1-6). A total over a redacted board would be a wrong number
  // presented confidently, so it sums only what this viewer was actually sent —
  // and when it was sent NOTHING, which is every anonymous watcher of this
  // page, the answer is "sealed", not "₹0". The projector used to read
  // "TOTAL SPEND ₹0" beside "PLAYERS SOLD 78" and "MOST EXPENSIVE ₹60,000".
  const visibleCommitted =
    snapshot === null
      ? []
      : snapshot.paddles
          .map((paddle) => paddle.committed)
          .filter((value): value is number => value !== null);
  const totalSpend =
    snapshot === null || visibleCommitted.length === 0
      ? null
      : visibleCommitted.reduce((sum, value) => sum + value, 0);
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
        .sort(
          (a, b) =>
            (b.committed ?? -1) - (a.committed ?? -1) || a.teamName.localeCompare(b.teamName),
        );

  // A projector is ONE frame, so the board has to spend its height rather than
  // overflow it. When a player is under the hammer the room is watching the
  // block, not the history — so recent sales stand down for the duration of a
  // lot and come back between lots, which is exactly when they are read.
  const recent = [...soldLots].reverse().slice(0, 6);

  const status = snapshot?.auctionStatus ?? null;
  const lot = snapshot?.currentLot ?? null;
  // THE FACE ON THE BLOCK. `lotMedia` is keyed by lot id, which is the one key
  // the live socket's `currentLot` and the server-rendered media both carry —
  // the lot NUMBER is a queue position ("L001") and the registration number is
  // the player's own identity, so neither can join the two.
  const face = lot === null ? null : (lotMedia[lot.lotId] ?? null);
  const facePhoto = face?.photoUrl ?? null;
  const faceNumber = face?.number ?? null;
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
          {/* THE FACE. The room was being asked to bid on a name in a font:
              every rival projector opens a lot with the player's photograph and
              this board had no face on it anywhere.
              The frame is the SAME box whether a photo exists or not — the
              primitive falls back to the branded mark — because a consent-gated
              null is the ORDINARY case here (DPDP §5) and it must not resize a
              projected frame halfway through a bid. */}
          <figure className="board-block-face" data-testid="board-block-face">
            <PlayerImage
              name={lot.playerName ?? "Unnamed"}
              /* The registration number is the player's identity across the
                 whole product, so seeding the mark with it gives the same
                 person the same monogram here, on /c and on their share card.
                 The lot id is only the fallback for a lot with no number. */
              seed={faceNumber ?? lot.lotId}
              size="hero"
              {...(facePhoto !== null ? { src: facePhoto } : {})}
            />
            {/* The REGISTRATION number, not `lot.lotNumber` — that one is the
                queue position and it stays in the kicker above. This is the
                number called out in the room and printed on the player's own
                public page, so it is the badge the hall can act on. */}
            {faceNumber !== null ? (
              <figcaption className="board-block-number" data-testid="board-block-number">
                #{faceNumber}
              </figcaption>
            ) : null}
          </figure>
          <div className="board-block-who">
            <p className="board-block-kicker">
              On the block · {lot.lotNumber}
              {lot.extensions > 0 ? ` · extended ×${String(lot.extensions)}` : ""}
            </p>
            <h2 className="board-block-name" data-testid="board-block-name">
              {lot.playerName ?? "Unnamed"}
            </h2>
            {/* `role.replace(/_/g, " ")` printed "all rounder" and "wicket
                keeper" to a room of two hundred people. The shared formatter
                is the one place those labels are decided. */}
            <p className="board-block-meta">
              {roleLabel(lot.role)} · base {money(lot.basePrice)}
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
            <span
              className={
                totalSpend === null ? "board-tile-value board-tile-muted" : "board-tile-value"
              }
            >
              {totalSpend === null ? "sealed" : money(totalSpend)}
            </span>
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
              {/* CREST FIRST, PADDLE LAST. A franchise is recognised across a
                  hall by its colours long before anyone reads its name, and the
                  paddle number is an administrative label — it was holding the
                  left anchor, which is the position the eye lands on. */}
              <div className="board-team-top">
                <BoardCrest team={team.team} fallback={team.teamName} />
                <h3 className="board-team-name">{team.teamName}</h3>
                <span className="board-paddle">
                  {team.activePaddles.length > 0 ? team.activePaddles.join(" · ") : "—"}
                </span>
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
                  <dd>
                    {connecting ? "—" : team.committed === null ? "sealed" : money(team.committed)}
                  </dd>
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
