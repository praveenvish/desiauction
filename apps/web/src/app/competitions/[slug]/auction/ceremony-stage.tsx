"use client";

import { formatPaiseINR, paise, type AuctionSnapshot, type CeremonyState } from "@desiauction/core";

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

export function CeremonyStage({
  snapshot,
  ceremony,
  remainingMs,
}: {
  snapshot: AuctionSnapshot | null;
  ceremony: CeremonyState;
  remainingMs: number | null;
}) {
  if (snapshot === null) {
    return (
      <section className="ceremony ceremony-idle" data-testid="ceremony">
        <p className="ceremony-title">Waiting for the first snapshot…</p>
      </section>
    );
  }
  const lot = snapshot.currentLot;
  const outcome = snapshot.lastOutcome;
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);

  return (
    <section
      key={ceremony.key}
      className={`ceremony ceremony-${ceremony.phase}`}
      data-testid="ceremony"
      data-phase={ceremony.phase}
    >
      <p className="ceremony-title" data-testid="ceremony-title">
        {PHASE_TITLE[ceremony.phase]}
      </p>
      {lot !== null ? (
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
          {seconds !== null && ceremony.phase !== "paused" ? (
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
        <div className="ceremony-lot">
          <p className="ceremony-meta" data-testid="ceremony-progress">
            {snapshot.lotsResolved}/{snapshot.lotsTotal} lots resolved
          </p>
        </div>
      )}
    </section>
  );
}
