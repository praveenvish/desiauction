"use client";

import { useMemo } from "react";

import { roleLabeller } from "../../../../../lib/role-label";
import { formatPaiseINR, paise } from "@desiauction/core";
import { PlayerImage } from "@desiauction/ui";
import type { CSSProperties } from "react";

import { OUTCOME_TITLE, outcomeMeta } from "../ceremony-stage";
import { useLiveFeed } from "../live-experience";
import { useAuctionSocket } from "../use-auction-socket";

import type { LotMedia, ResolvedLot } from "../../../../../server/auction/live-summary";

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
  roles,
  wsUrl,
  resolved,
  auctionName,
  sponsor,
  watchUrl,
  lotMedia,
}: {
  /** The season's roles, so a football night is not named in cricket. */
  roles: readonly { key: string; label: string }[];
  wsUrl: string;
  resolved: ResolvedLot[];
  auctionName: string;
  sponsor: string | null;
  watchUrl: string;
  /**
   * The player's face and registration number for every lot, keyed by lot id
   * and carried BESIDE the snapshot: the engine hashes the snapshot to prove
   * its fold is deterministic, and a media URL signed at read would move the
   * bytes. Photos are consent-gated (DPDP §5), so a null photo is the ordinary
   * case and the branded mark — not an empty slot — is what goes to air.
   */
  lotMedia: Record<string, LotMedia>;
}) {
  const labelOf = useMemo(() => roleLabeller(roles), [roles]);
  // DA-20: this read `connection !== "open"` and ignored `stale`/`offline`
  // outright, so a device that went offline mid-auction kept broadcasting a
  // pulsing "Live" strip and a running price to air with no warning at all.
  const { snapshot, remainingMs, ceremony, stale, offline } = useAuctionSocket(wsUrl);
  const feed = useLiveFeed(resolved, snapshot);

  const lot = snapshot?.currentLot ?? null;
  const outcome = snapshot?.lastOutcome ?? null;
  const status = snapshot?.auctionStatus ?? null;
  const paused = status === "paused";
  const finished = status === "completed" || status === "reconciled" || status === "abandoned";
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const showTimer = lot !== null && lot.endsAtMs !== null && seconds !== null && !paused && !stale;

  // The ticker: the auction's sold history, newest last. Falls back to a title
  // card before the first sale so the strip is never empty on air.
  const sold = feed.resolved.filter((entry) => entry.status === "sold");
  const watchLabel = watchUrl.replace(/^https?:\/\//, "");

  // Which lower-third to show: the live lot, else the last outcome, else "up next".
  // The TONE now consults the auction's own status first. A paused auction used
  // to go out with tone "live", a green accent, a lot on the block and simply no
  // clock — the stream showing a stopped room as a running one.
  const tone = stale
    ? "stale"
    : paused
      ? "paused"
      : lot !== null
        ? "live"
        : (outcome?.kind ?? "idle");
  const nextUp = snapshot !== null && snapshot.queue.length > 0 ? snapshot.queue[0] : null;

  // WHOSE FACE THE LOWER THIRD IS CARRYING. One subject, resolved ONCE — the lot
  // on the block, else the lot that just resolved, else the one up next — so it
  // cannot drift from the three-way choice the text below makes and put a
  // photograph beside somebody else's name. Reading the id and the name from
  // separate expressions is exactly how that drift happens: a lot with no name
  // on it would fall through and borrow the previous player's face.
  // `lotMedia` is keyed by lot id, the one key the socket's lot and the
  // server-rendered media have in common — the lot NUMBER is a queue position
  // and the registration number is the player's own identity.
  const facing = lot ?? outcome ?? nextUp ?? null;
  const face = facing === null ? null : (lotMedia[facing.lotId] ?? null);
  const facePhoto = face?.photoUrl ?? null;
  const faceNumber = face?.number ?? null;

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
        {/* The strip asserted "Live" over a paused, finished or dead feed. */}
        <span className="obs-ticker-live" data-state={tone === "live" ? "live" : "other"}>
          {stale ? "No feed" : paused ? "Paused" : finished ? "Ended" : "Live"}
        </span>
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

      {/* THE STALENESS BAR, sized to be read on a stream rather than a 12px chip
          nobody watching a broadcast could resolve. */}
      {stale ? (
        <div className="obs-stale" role="alert" data-testid="obs-stale">
          <b>{offline ? "Feed offline" : "Feed lost"}</b>
          <span>Figures below are the last we heard — the clock is stopped.</span>
        </div>
      ) : null}

      {/* --- lower third --- */}
      <div className="obs-foot">
        <div className="obs-lowerthird" data-tone={tone} data-testid="obs-lowerthird">
          <span className="obs-accent" aria-hidden="true" />
          {/* The face and the words are ONE column-pair inside the lower third,
              not two siblings of it: below 720px — vertical Reels/Shorts, the
              dominant format here — the panel breaks into rows, and a face
              pinned as a sibling would claim a row of its own and double the
              height of the overlay on exactly the streams that can least afford
              it. */}
          <div className="obs-lt-who">
            {facing !== null ? (
              // Compact by design: a lower third is furniture at the bottom of
              // someone else's video, so this is the 96px step, not the hall
              // portrait /board carries. Photo or branded mark, same box.
              <figure className="obs-lt-face" data-testid="obs-lt-face">
                <PlayerImage
                  name={facing.playerName ?? facing.lotNumber}
                  seed={faceNumber ?? facing.lotId}
                  size="xl"
                  {...(facePhoto !== null ? { src: facePhoto } : {})}
                />
                {/* The REGISTRATION number — the identity the player already
                    carries on their public page. The eyebrow above keeps
                    `lotNumber`, which is only where in the queue we are. */}
                {faceNumber !== null ? (
                  <figcaption className="obs-lt-number">#{faceNumber}</figcaption>
                ) : null}
              </figure>
            ) : null}
            <div className="obs-lt-main">
              {lot !== null ? (
                <>
                  <span className="obs-lt-eyebrow">
                    {paused ? "Paused" : "On the block"} · {lot.lotNumber}
                  </span>
                  <span className="obs-lt-name">{lot.playerName ?? "Unnamed"}</span>
                  {/* `role.replace(/_/g, " ")` put "all rounder" and "wicket
                      keeper" on air. The shared formatter is the one place
                      those labels are decided. */}
                  <span className="obs-lt-meta">
                    {labelOf(lot.role)} · base {money(lot.basePrice)}
                  </span>
                </>
              ) : outcome !== null ? (
                <>
                  {/* This printed `outcome.kind` — the engine's own enum — to
                      air: a frozen lot went out as "HELD", and an undone sale
                      would have gone out as "REOPENED". The ceremony already
                      owned the human words. */}
                  <span className="obs-lt-eyebrow">{OUTCOME_TITLE[outcome.kind]}</span>
                  <span className="obs-lt-name">{outcome.playerName ?? outcome.lotNumber}</span>
                  {/* And every non-sold outcome fell back to the AUCTION'S OWN
                      NAME as its explanation, so the audience was told nothing
                      about what had just happened. */}
                  <span className="obs-lt-meta">{outcomeMeta(outcome)}</span>
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
              {/* The clock's absence used to be the ONLY sign that the auction
                  was paused, and an absence broadcasts as nothing at all. */}
              {showTimer ? (
                <span className="obs-lt-timer" data-hot={seconds <= 15}>
                  {seconds}s{lot.extensions > 0 ? ` · +${String(lot.extensions)}` : ""}
                </span>
              ) : (
                <span className="obs-lt-timer obs-lt-timer--stopped">
                  {paused ? "Clock stopped" : stale ? "No feed" : "—"}
                </span>
              )}
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
        {/* Both of these used to be independently pinned to `bottom: 28px`, so
            below ~800px the lower third and the brand cluster overlapped by
            73px. They share one flex footer now and can never collide. */}
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
    </div>
  );
}
