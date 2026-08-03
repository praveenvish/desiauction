"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { useSyncExternalStore } from "react";

import type { AuctionClock } from "./use-auction-socket";
import type { AuctionSnapshot } from "@desiauction/core";

// THE LOT HERO — the one thing every live surface leads with: what is on the
// block, how long is left, and what it is worth right now.
//
// Before this, /live opened with a metadata card (name, badges, a small "12s")
// while /spectate opened with the ceremony, so the same moment read as two
// different products depending on which door you came through.

/** Circumference of the r=54 ring below; the dash offset animates against it. */
const RING_LENGTH = 2 * Math.PI * 54;

/** The countdown turns from gold to danger inside the last 15 seconds. */
const HOT_SECONDS = 15;

/** Stable no-op store: `useSyncExternalStore` must not be called conditionally. */
const noopSubscribe = () => () => undefined;
const nullSnapshot = (): number | null => null;

/**
 * The ring is the ONE consumer that wants sub-second resolution — everything
 * else on these pages renders whole seconds. It therefore subscribes to the
 * socket's isolated 10Hz clock itself, so the smooth sweep costs a re-render of
 * this component and nothing above it. Without a clock (replay, tests) it falls
 * back to the quantised prop and simply steps once a second.
 */
export function CountdownRing({
  remainingMs,
  totalMs,
  clock,
}: {
  remainingMs: number | null;
  totalMs: number;
  clock?: AuctionClock | undefined;
}) {
  const smooth = useSyncExternalStore(
    clock?.subscribe ?? noopSubscribe,
    clock?.getSnapshot ?? nullSnapshot,
    nullSnapshot,
  );
  const ms = clock === undefined ? remainingMs : smooth;
  const seconds = ms === null ? null : Math.max(0, Math.ceil(ms / 1000));
  const hot = seconds !== null && seconds <= HOT_SECONDS;
  // Guard the divisor: a lot whose duration is unknown draws a full ring
  // rather than dividing by zero and vanishing.
  const fraction = totalMs <= 0 || ms === null ? 1 : Math.min(1, ms / totalMs);
  return (
    <div className="lot-ring" data-hot={hot ? "true" : "false"} data-testid="countdown-ring">
      <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden>
        <circle cx="66" cy="66" r="54" className="lot-ring-track" />
        <circle
          cx="66"
          cy="66"
          r="54"
          className="lot-ring-value"
          strokeDasharray={RING_LENGTH.toFixed(2)}
          strokeDashoffset={(RING_LENGTH * (1 - fraction)).toFixed(2)}
          transform="rotate(-90 66 66)"
        />
      </svg>
      <div className="lot-ring-face">
        {/* The figure carries the label for assistive tech; the ring is decorative. */}
        <span className="lot-ring-num" data-testid="countdown">
          {seconds === null ? "—" : seconds}
        </span>
        <span className="lot-ring-unit">SECONDS</span>
      </div>
    </div>
  );
}

export function LotHero({
  lot,
  remainingMs,
  lotDurationMs,
  leadColor,
  frozen = false,
  clock,
  testId = "current-lot",
}: {
  lot: NonNullable<AuctionSnapshot["currentLot"]>;
  remainingMs: number | null;
  lotDurationMs: number;
  /** Passed straight through to the ring's own 10Hz subscription. */
  clock?: AuctionClock | undefined;
  /** The leading franchise's identity colour, when it has one. */
  leadColor: string | null;
  /**
   * The auction is paused (or otherwise not taking bids). The hero used to
   * read "ON THE BLOCK" in gold over a giant em dash where the countdown
   * should be, while the raise button stayed live — the room inviting a bid it
   * would then refuse with the wrong reason.
   */
  frozen?: boolean;
  /**
   * `current-lot` is the long-standing handle for "the lot on the block", kept
   * as the default so the live-auction suites keep pointing at the thing they
   * were written against. Spectate overrides it: a suite there matches
   * `current-lot` OR `spectate-panel`, and an element answering to both would
   * resolve to two nodes and trip Playwright's strict mode.
   */
  testId?: string;
}) {
  const bid = lot.currentBid;
  return (
    <section className="lot-hero" data-testid={testId} data-frozen={frozen ? "true" : undefined}>
      <div className="lot-hero-top">
        <div className="lot-hero-id">
          <p className="lot-hero-kicker">
            {lot.lotNumber} · {frozen ? "clock stopped" : "on the block"}
          </p>
          <h2 className="lot-hero-name">{lot.playerName ?? "Unnamed"}</h2>
          <p className="lot-hero-meta">
            <span className="lot-hero-role">{lot.role.replace(/_/g, " ")}</span>
            <span>Base {formatPaiseINR(paise(lot.basePrice))}</span>
          </p>
        </div>
        {frozen ? (
          <p className="lot-hero-paused" data-testid="lot-paused">
            The clock is stopped. Bidding resumes when the auctioneer restarts it.
          </p>
        ) : (
          <CountdownRing remainingMs={remainingMs} totalMs={lotDurationMs} clock={clock} />
        )}
      </div>

      <div className="lot-hero-money">
        <div>
          <p className="lot-hero-label">Current bid</p>
          {/* An em dash set in display type at 52px reads as a solid bar, so the
              no-bid state shows the opening ask instead — the number the room is
              actually waiting on — clearly marked as not-yet-bid. */}
          <p
            className={bid === null ? "lot-hero-bid lot-hero-bid--none" : "lot-hero-bid"}
            data-testid="leading-bid"
          >
            {bid === null
              ? formatPaiseINR(paise(lot.basePrice))
              : formatPaiseINR(paise(bid.amount))}
          </p>
          {bid === null ? (
            <p className="lot-hero-lead lot-hero-lead--none">
              Opening ask · awaiting the first paddle…
            </p>
          ) : (
            <p className="lot-hero-lead">
              <span
                className="lot-hero-dot"
                style={leadColor === null ? undefined : { background: leadColor }}
                aria-hidden
              />
              Leading · <strong>{bid.teamName}</strong> ({bid.paddleNumber})
            </p>
          )}
        </div>
        {lot.extensions > 0 ? (
          <span className="lot-hero-ext" data-testid="lot-extensions">
            +{lot.extensions} extension{lot.extensions === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
    </section>
  );
}
