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

/**
 * The transport state in the room's words, not the socket's.
 *
 * `open` is a WebSocket readyState spelled out to a guest who has no socket.
 * Worse, it rendered as a SECOND GREEN BADGE beside the auction's own `live`,
 * so one ribbon carried two green words that meant different things.
 *
 * Both halves of that are fixed here. The label says which live it means — the
 * feed, not the auction — and when the feed is healthy the badge steps down to
 * neutral so exactly one green badge is left on the strip: the auction's own
 * state, which is the one a guest came to read. A pulsing green dot carries the
 * "we are connected" reassurance without competing for the same colour.
 * Trouble, by contrast, is loud: amber, and named.
 */
function connectionLabel(connection: ConnectionState, offline: boolean): string {
  if (offline) {
    return "Offline";
  }
  return connection === "open"
    ? "Live feed"
    : connection === "connecting"
      ? "Connecting…"
      : "Reconnecting…";
}

/**
 * A separator that exists ONLY for the ear. The ribbon read out as
 * "livedemo premier league auctionlive feedv58": adjacent inline elements have
 * no whitespace between them in the accessibility tree, so every cell ran into
 * the next. A period and a space give the reader a sentence boundary; the
 * comma-width span is invisible on screen (zero size, no layout).
 */
function RibbonGap() {
  return <span className="auction-sr-only">. </span>;
}

export function StatusRibbon({
  snapshot,
  connection,
  remainingMs,
  health,
  /**
   * `shell` is the same ribbon promoted into the Live shell's header strip
   * (PX: the spectator page has no <h1> of its own — this IS the identity bar),
   * so it drops the card treatment and its own sticky positioning.
   */
  variant = "page",
  /**
   * `public` is a surface with guests on it: the engine's snapshot version is
   * operator diagnostics and stays a tooltip there rather than "v47" in the
   * chrome of the product's most-shared screen.
   */
  audience = "operator",
  /** The device itself has no network — a stronger statement than "reconnecting". */
  offline = false,
}: {
  snapshot: AuctionSnapshot | null;
  connection: ConnectionState;
  remainingMs: number | null;
  health?: RibbonHealth | undefined;
  variant?: "page" | "shell";
  audience?: "operator" | "public";
  offline?: boolean;
}) {
  const lot = snapshot?.currentLot ?? null;
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const version = snapshot?.version ?? 0;
  const live = connection === "open" && !offline;
  return (
    // `role="status"` makes the whole strip a polite live region, which is what
    // a spectator needs — the lot, the leading bid and the transport state are
    // exactly the changes worth hearing. The COUNTDOWN is the one child excluded
    // (aria-hidden below): it changes every second, and a region that
    // re-announces itself every second announces nothing else ever again.
    // `aria-atomic` because a strip read a cell at a time is not a sentence:
    // the region announced "livedemo premier league auctionlive feedv58" — six
    // facts run together with no separator and no boundary. Atomic re-reads the
    // whole strip as one utterance, and the separators below give it the pauses
    // a screen reader needs to make words out of it.
    <div
      className={`status-ribbon${variant === "shell" ? " status-ribbon--shell" : ""}`}
      data-testid="status-ribbon"
      role="status"
      aria-atomic="true"
    >
      <span className="ribbon-cell ribbon-auction">
        {snapshot !== null ? (
          <>
            <Badge tone={AUCTION_TONE[snapshot.auctionStatus]} data-testid="ribbon-status">
              {snapshot.auctionStatus}
            </Badge>
            <RibbonGap />
            <span className="ribbon-name">{snapshot.auctionName}</span>
          </>
        ) : (
          <span className="ribbon-name">Connecting…</span>
        )}
      </span>
      {lot !== null ? (
        <span className="ribbon-cell" data-testid="ribbon-lot">
          <RibbonGap />
          <strong>{lot.lotNumber}</strong>
          <RibbonGap />
          <span>{lot.playerName ?? "Unnamed"}</span>
        </span>
      ) : null}
      {lot?.currentBid != null ? (
        <span className="ribbon-cell" data-testid="ribbon-bid">
          <RibbonGap />
          <strong>{formatPaiseINR(paise(lot.currentBid.amount))}</strong>
          <RibbonGap />
          <span>{lot.currentBid.teamName}</span>
        </span>
      ) : null}
      {seconds !== null ? (
        <span
          className={`ribbon-cell ribbon-timer${seconds <= 15 ? " ribbon-timer-hot" : ""}`}
          data-testid="ribbon-timer"
          // Out of the live region: see the note on the container. The same
          // number is on the countdown ring, which is not in a live region and
          // so can be read on demand instead of shouted once a second.
          aria-hidden="true"
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
        <RibbonGap />
        {health !== undefined ? (
          <Badge tone={health.tone} data-testid="ribbon-health">
            {health.label}
          </Badge>
        ) : null}
        <Badge tone={live ? "neutral" : "warning"} data-testid="ribbon-network">
          {live ? <span className="ribbon-network-dot" aria-hidden /> : null}
          {connectionLabel(connection, offline)}
        </Badge>
        {/* The version is the operator's convergence check across surfaces. It
            stays machine-readable everywhere (`data-version`) and stays out of
            a guest's chrome. */}
        <span
          className="ribbon-version"
          data-testid="ribbon-version"
          data-version={String(version)}
          title={`Snapshot v${String(version)}`}
        >
          {audience === "operator" ? `v${String(version)}` : null}
        </span>
      </span>
    </div>
  );
}
