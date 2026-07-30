"use client";

import { formatPaiseINR, paise, type AuctionSnapshot, type CeremonyState } from "@desiauction/core";
import { useEffect, useState, type CSSProperties } from "react";

// The FLOODLIGHT ceremony stage (M-IP4-3). Presentation ONLY: renders the
// deterministic ceremony phase derived from consecutive AuctionSnapshots.
// Transitions key on `ceremony.key` — the same moment renders the same frame
// on every connected surface. Motion collapses to plain state changes under
// prefers-reduced-motion (IP-1 motion grammar, doc 11).

const PHASE_TITLE: Record<CeremonyState["phase"], string> = {
  idle: "",
  opening: "ON THE BLOCK",
  bid: "CURRENT BID",
  extension: "ANTI-SNIPE — TIME EXTENDED",
  hold: "LOT FROZEN",
  sold: "SOLD",
  unsold: "UNSOLD",
  withdrawn: "WITHDRAWN",
  reopened: "UNDONE — BACK ON THE BLOCK",
  paused: "AUCTION PAUSED",
  recovered: "ENGINE RECOVERED — STATE VERIFIED",
  completed: "AUCTION COMPLETE",
};

// The SOLD celebration is 30 fixed confetti pieces — a fixed count, no
// randomness, so every connected surface (cockpit, stage, spectate, live)
// renders the identical burst for the same moment, exactly as the ceremony
// phases already do (each keyed on `ceremony.key`). The whole layer is
// decorative (aria-hidden) and collapses to nothing under prefers-reduced-
// motion; the static gold border on `.ceremony-sold` remains the non-motion
// marker, so nothing about the announced outcome depends on animation.
const CONFETTI = Array.from({ length: 30 }, (_, i) => i);

/** How long a blank stage stays hopeful before it admits it cannot get through. */
const PATIENCE_MS = 8_000;

export function CeremonyStage({
  snapshot,
  ceremony,
  remainingMs,
}: {
  snapshot: AuctionSnapshot | null;
  ceremony: CeremonyState;
  remainingMs: number | null;
}) {
  // "Waiting for the first snapshot…" told a guest, in the product's own
  // internals, that something they have no name for has not happened. Eight
  // seconds in it stops being a wait and becomes information: the room may not
  // have opened yet, and we are still trying.
  const [patienceSpent, setPatienceSpent] = useState(false);
  useEffect(() => {
    if (snapshot !== null) {
      return;
    }
    const timer = setTimeout(() => {
      setPatienceSpent(true);
    }, PATIENCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [snapshot]);

  if (snapshot === null) {
    return (
      <section className="ceremony ceremony-idle" data-testid="ceremony" data-phase="connecting">
        <p className="ceremony-title">
          {patienceSpent ? "Not connected" : "Connecting to the auction room…"}
        </p>
        {patienceSpent ? (
          <p className="ceremony-waiting-hint" data-testid="ceremony-unreachable">
            Can&apos;t reach the auction room. It may not have started yet — we&apos;ll keep trying.
          </p>
        ) : null}
      </section>
    );
  }
  const lot = snapshot.currentLot;
  const outcome = snapshot.lastOutcome;
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  // The auction is OVER. Everything below this line — "Between lots", "The next
  // lot is coming up" — describes an interval before a next lot that will never
  // come, and it used to render directly beneath a ribbon reading COMPLETED and
  // a title reading AUCTION COMPLETE, in 44px display type.
  const finished =
    snapshot.auctionStatus === "completed" ||
    snapshot.auctionStatus === "reconciled" ||
    snapshot.auctionStatus === "abandoned";

  return (
    <section
      key={ceremony.key}
      className={`ceremony ceremony-${ceremony.phase}`}
      data-testid="ceremony"
      data-phase={ceremony.phase}
    >
      {ceremony.phase === "sold" ? (
        <div className="ceremony-celebration" aria-hidden="true">
          <span className="ceremony-glow" />
          {CONFETTI.map((i) => (
            <i key={i} className="ceremony-confetti" style={{ "--i": i } as CSSProperties} />
          ))}
        </div>
      ) : null}
      <p className="ceremony-title" data-testid="ceremony-title">
        {PHASE_TITLE[ceremony.phase]}
      </p>
      {finished ? (
        <div className="ceremony-lot ceremony-waiting" data-testid="ceremony-finished">
          <p className="ceremony-waiting-title" data-testid="ceremony-progress">
            {snapshot.lotsResolved}/{snapshot.lotsTotal} lots resolved
          </p>
          <p className="ceremony-waiting-hint">Every lot is settled. Final squads below.</p>
        </div>
      ) : lot !== null ? (
        <div className="ceremony-lot">
          <h2 className="ceremony-player" data-testid="ceremony-player">
            {lot.playerName ?? "Unnamed"}
          </h2>
          <p className="ceremony-meta">
            {lot.lotNumber} · {lot.role.replace(/_/g, " ")} · base{" "}
            {formatPaiseINR(paise(lot.basePrice))}
          </p>
          {lot.currentBid !== null ? (
            <p className="ceremony-bid" data-testid="ceremony-bid">
              {formatPaiseINR(paise(lot.currentBid.amount))}
              <span className="ceremony-leader" data-testid="ceremony-leader">
                {lot.currentBid.teamName} · {lot.currentBid.paddleNumber}
              </span>
            </p>
          ) : (
            <p className="ceremony-bid ceremony-bid-open">
              Opening at {formatPaiseINR(paise(lot.nextMinimumBid))}
            </p>
          )}
          {ceremony.phase === "paused" ? (
            <p className="ceremony-frozen" data-testid="ceremony-frozen">
              The clock is stopped. Bidding resumes when the auctioneer restarts it.
            </p>
          ) : seconds !== null ? (
            <p
              className={`ceremony-timer${seconds <= 15 ? " ceremony-timer-hot" : ""}`}
              data-testid="ceremony-timer"
            >
              {seconds}s{lot.extensions > 0 ? ` · extended ×${String(lot.extensions)}` : ""}
            </p>
          ) : null}
        </div>
      ) : outcome !== null ? (
        <div className="ceremony-lot">
          <h2 className="ceremony-player" data-testid="ceremony-player">
            {outcome.playerName ?? outcome.lotNumber}
          </h2>
          {outcome.kind === "sold" && outcome.amount !== null ? (
            <p className="ceremony-bid" data-testid="ceremony-bid">
              {formatPaiseINR(paise(outcome.amount))}
              <span className="ceremony-leader">
                {outcome.teamName ?? ""} · {outcome.paddleNumber ?? ""}
              </span>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="ceremony-lot ceremony-waiting">
          <span className="ceremony-waiting-dot" aria-hidden />
          <p className="ceremony-waiting-title">
            {snapshot.lotsResolved === 0 ? "Ready" : "Between lots"}
          </p>
          <p className="ceremony-meta" data-testid="ceremony-progress">
            {snapshot.lotsResolved}/{snapshot.lotsTotal} lots resolved
          </p>
          <p className="ceremony-waiting-hint">
            {snapshot.lotsResolved === 0
              ? `${String(snapshot.queue.length)} players in the queue — waiting for the auctioneer to open the first lot`
              : "The next lot is coming up"}
          </p>
        </div>
      )}
    </section>
  );
}
