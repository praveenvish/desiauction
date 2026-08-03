"use client";

import {
  formatPaiseINR,
  paise,
  type AuctionSnapshot,
  type CeremonyState,
  type LotOutcomeKind,
} from "@desiauction/core";
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

/**
 * THE BROADCAST VOCABULARY for a lot outcome (DA-20).
 *
 * `lastOutcome.kind` is an engine enum — `held`, `reopened` — and the OBS
 * overlay was printing it raw to air, so a frozen lot went out as "HELD" and an
 * undone sale would have gone out as "REOPENED". This file already owned the
 * human words for exactly these moments; they are exported so the overlay says
 * the same thing the stage does rather than inventing a second dialect.
 */
export const OUTCOME_TITLE: Record<LotOutcomeKind, string> = {
  sold: "SOLD",
  unsold: "UNSOLD",
  withdrawn: "WITHDRAWN",
  held: "LOT FROZEN",
  reopened: "BACK ON THE BLOCK",
};

/**
 * The one-line explanation under an outcome. Non-sold outcomes used to fall
 * back to the auction's own name — the overlay announcing "Nikhil Joshi /
 * Demo Premier League Auction" and telling the audience nothing about what had
 * just happened to him.
 */
export function outcomeMeta(outcome: NonNullable<AuctionSnapshot["lastOutcome"]>): string {
  switch (outcome.kind) {
    case "sold":
      return outcome.teamName === null ? "Sold" : `to ${outcome.teamName}`;
    case "unsold":
      return "No bids — back in the pool";
    case "withdrawn":
      return "Withdrawn from the auction";
    case "held":
      return "Clock stopped for the auctioneer";
    case "reopened":
      return "Result undone — bidding reopens";
  }
}

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
        /* The big screen for a frozen or undone lot used to be two words and a
           name: 28px "LOT FROZEN" over a 129px player, with the price, the
           clock and any explanation all suppressed, because a price rendered
           only for `sold`. Every phase has a price worth showing (the money the
           lot had reached) and a reason worth naming. */
        <div className="ceremony-lot">
          <h2 className="ceremony-player" data-testid="ceremony-player">
            {outcome.playerName ?? outcome.lotNumber}
          </h2>
          {outcome.amount !== null ? (
            <p className="ceremony-bid" data-testid="ceremony-bid">
              {formatPaiseINR(paise(outcome.amount))}
              {outcome.kind === "sold" ? (
                <span className="ceremony-leader" data-testid="ceremony-leader">
                  {[outcome.teamName, outcome.paddleNumber]
                    .filter((part): part is string => part !== null && part !== "")
                    .join(" · ")}
                </span>
              ) : null}
            </p>
          ) : null}
          <p className="ceremony-frozen" data-testid="ceremony-outcome-reason">
            {outcomeMeta(outcome)}
          </p>
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
            {/* This read "0 players in the queue" on the pre-auction stage —
                under "0/2 lots resolved", on a night with two players to sell.
                `queue` is what the ENGINE has loaded, which is empty until the
                auction opens; `lotsTotal` is the promise the evening actually
                makes. */}
            {snapshot.lotsResolved === 0
              ? snapshot.lotsTotal > 0
                ? `Doors open. ${String(snapshot.lotsTotal)} ${
                    snapshot.lotsTotal === 1 ? "player goes" : "players go"
                  } under the hammer tonight.`
                : "Waiting for the auctioneer to open the first lot."
              : "The next lot is coming up"}
          </p>
        </div>
      )}
    </section>
  );
}
