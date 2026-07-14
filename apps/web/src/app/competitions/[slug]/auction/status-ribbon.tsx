"use client";

import { formatPaiseINR, paise, type AuctionSnapshot } from "@desiauction/core";
import { Badge } from "@desiauction/ui";

import type { ConnectionState } from "./use-auction-socket";

// The live status ribbon (M-IP4-3): the persistent operational strip every
// auction surface wears. Pure presentation of the broadcast snapshot plus the
// local connection state — sticky, never blocking interaction. The engine
// health slot is OPTIONAL and only ever fed on conduct surfaces (spectators
// never receive engine internals).

const AUCTION_TONE = {
  scheduled: "info",
  live: "success",
  paused: "warning",
  completed: "neutral",
  reconciled: "neutral",
  abandoned: "danger",
} as const;

export interface RibbonHealth {
  label: string;
  tone: "success" | "warning" | "danger";
}

export function StatusRibbon({
  snapshot,
  connection,
  remainingMs,
  health,
}: {
  snapshot: AuctionSnapshot | null;
  connection: ConnectionState;
  remainingMs: number | null;
  health?: RibbonHealth | undefined;
}) {
  const lot = snapshot?.currentLot ?? null;
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  return (
    <div className="status-ribbon" data-testid="status-ribbon" role="status">
      <span className="ribbon-cell ribbon-auction">
        {snapshot !== null ? (
          <>
            <Badge tone={AUCTION_TONE[snapshot.auctionStatus]} data-testid="ribbon-status">
              {snapshot.auctionStatus}
            </Badge>
            <span className="ribbon-name">{snapshot.auctionName}</span>
          </>
        ) : (
          <span className="ribbon-name">Connecting…</span>
        )}
      </span>
      {lot !== null ? (
        <span className="ribbon-cell" data-testid="ribbon-lot">
          <strong>{lot.lotNumber}</strong>
          <span>{lot.playerName ?? "Unnamed"}</span>
        </span>
      ) : null}
      {lot?.currentBid != null ? (
        <span className="ribbon-cell" data-testid="ribbon-bid">
          <strong>{formatPaiseINR(paise(lot.currentBid.amount))}</strong>
          <span>{lot.currentBid.teamName}</span>
        </span>
      ) : null}
      {seconds !== null ? (
        <span
          className={`ribbon-cell ribbon-timer${seconds <= 15 ? " ribbon-timer-hot" : ""}`}
          data-testid="ribbon-timer"
        >
          {seconds}s{lot !== null && lot.extensions > 0 ? ` · +${String(lot.extensions)}` : ""}
        </span>
      ) : null}
      {snapshot !== null && snapshot.recoveries > 0 ? (
        <span className="ribbon-cell" data-testid="ribbon-recoveries" title="Engine recoveries">
          ⟲ {snapshot.recoveries}
        </span>
      ) : null}
      <span className="ribbon-cell ribbon-right">
        {health !== undefined ? (
          <Badge tone={health.tone} data-testid="ribbon-health">
            {health.label}
          </Badge>
        ) : null}
        <Badge tone={connection === "open" ? "success" : "warning"} data-testid="ribbon-network">
          {connection}
        </Badge>
        <span className="ribbon-version" data-testid="ribbon-version">
          v{snapshot?.version ?? 0}
        </span>
      </span>
    </div>
  );
}
