"use client";

import { IconPause, PlayerPortrait } from "@desiauction/ui";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type { AuctionClock } from "./use-auction-socket";

// THE PLAYER CARD — the one picture of the lot every role shares (live-room
// stage 1). The player fills it: their photo when they consented to one, and
// otherwise their seeded identity at poster size (`PlayerPortrait`) — never a
// silhouette. The name sits over the foot of the card, and the clock lives ON
// the card: a big seconds badge in the corner and a bar draining along the
// bottom edge, so an owner reads who, and how long, in one glance.
//
// Built for the owner's room first; the conductor, the spectator and the big
// screen move onto it in later stages, which is why it takes plain facts
// (name, seed, labels) rather than a snapshot.

/** Under this many seconds the clock turns red and pulses. */
const CRITICAL_SECONDS = 5;
/** How long the "time extended" flag stays on the card after an extension. */
const EXTENSION_FLAG_MS = 1800;

/** Stable no-op store: `useSyncExternalStore` must not be called conditionally. */
const noopSubscribe = () => () => undefined;
const nullSnapshot = (): number | null => null;

export interface LotCardClock {
  /** The socket's quantised remaining time — the fallback when there is no 10Hz clock. */
  remainingMs: number | null;
  /** The window the lot is running against (an extended lot runs on the anti-snipe window). */
  totalMs: number;
  /** The socket's isolated 10Hz clock; the card subscribes to it itself. */
  clock?: AuctionClock | undefined;
  /** The auction is paused: the clock is stopped, and the card says so. */
  frozen: boolean;
  /** Anti-snipe extensions so far on this lot — a rise raises the "time extended" flag. */
  extensions: number;
}

/**
 * The clock on the card. Same semantics as the countdown ring it succeeds: it
 * subscribes to the socket's 10Hz clock on its own, so the sweep re-renders
 * this component and nothing above it, and it shows exactly what the socket
 * says — which already freezes the moment the feed goes stale.
 */
function CardClock({ remainingMs, totalMs, clock, frozen, extensions }: LotCardClock) {
  const smooth = useSyncExternalStore(
    clock?.subscribe ?? noopSubscribe,
    clock?.getSnapshot ?? nullSnapshot,
    nullSnapshot,
  );
  const ms = clock === undefined ? remainingMs : smooth;
  const seconds = ms === null ? null : Math.max(0, Math.ceil(ms / 1000));
  const critical = seconds !== null && seconds <= CRITICAL_SECONDS;
  // A lot whose window is unknown draws a full bar rather than dividing by zero.
  const fraction = totalMs <= 0 || ms === null ? 1 : Math.max(0, Math.min(1, ms / totalMs));

  // THE BID BOUGHT TIME. The flag rises when the extension count does — on the
  // same lot only, since the card is keyed per lot by its parent.
  const seen = useRef(extensions);
  const [flag, setFlag] = useState<number | null>(null);
  useEffect(() => {
    if (extensions > seen.current) {
      setFlag(extensions);
      const timer = setTimeout(() => {
        setFlag(null);
      }, EXTENSION_FLAG_MS);
      seen.current = extensions;
      return () => {
        clearTimeout(timer);
      };
    }
    seen.current = extensions;
    return undefined;
  }, [extensions]);

  if (frozen) {
    return (
      <>
        <p className="lot-card-clock lot-card-clock--paused" data-testid="lot-paused">
          <IconPause size={20} weight="fill" />
          <span>Paused</span>
        </p>
        <span className="lot-card-drain" data-tier="paused" aria-hidden>
          <span style={{ transform: `scaleX(${fraction.toFixed(4)})` }} />
        </span>
      </>
    );
  }
  return (
    <>
      <p
        className="lot-card-clock"
        data-tier={critical ? "critical" : "calm"}
        data-testid="countdown-badge"
      >
        {/* The figure is readable on demand; it sits in no live region. The
            announcer (auction-announcer) owns every spoken moment. */}
        <span className="lot-card-secs" data-testid="countdown">
          {seconds === null ? "—" : seconds}
        </span>
        <span className="lot-card-unit">sec</span>
      </p>
      {flag !== null ? (
        // Decorative: "Time extended" is announced by the room's announcer.
        <span key={flag} className="lot-card-flag" data-testid="lot-extended" aria-hidden>
          Time extended
        </span>
      ) : null}
      <span className="lot-card-drain" data-tier={critical ? "critical" : "calm"} aria-hidden>
        <span style={{ transform: `scaleX(${fraction.toFixed(4)})` }} />
      </span>
    </>
  );
}

export function LotCard({
  name,
  seed,
  photoUrl,
  roleLabel,
  kicker,
  clock,
  stamp,
  onBlock = false,
  className,
}: {
  name: string;
  /** The registration id (the lot id only when the page's media never saw this lot). */
  seed: string;
  /** Consent-gated (DPDP §5); null far more often than not. */
  photoUrl: string | null;
  /** The season's word for the player's role, when the sport has roles. */
  roleLabel: string | null;
  /** The small line over the name: lot, number, base price. */
  kicker: ReactNode;
  /** The lot's clock, while the lot is on the block. */
  clock?: LotCardClock | undefined;
  /** A verdict struck across the card (the SOLD stamp on a win). */
  stamp?: ReactNode;
  /**
   * The lot is on the block. Its name then carries the long-standing
   * `lot-hero-name` handle the suites read the player off.
   */
  onBlock?: boolean;
  className?: string;
}) {
  return (
    <div className={["lot-card", className].filter(Boolean).join(" ")} data-testid="lot-card">
      {/* Decorative: the name is printed over the card in display type. */}
      <PlayerPortrait name={name} seed={seed} src={photoUrl} decorative />
      <span className="lot-card-scrim" aria-hidden />
      {roleLabel !== null && roleLabel.trim() !== "" ? (
        <span className="lot-card-role">{roleLabel}</span>
      ) : null}
      {clock !== undefined ? <CardClock {...clock} /> : null}
      <div className="lot-card-id">
        <p className="lot-card-kicker">{kicker}</p>
        <h2 className={onBlock ? "lot-hero-name lot-card-name" : "lot-card-name"}>{name}</h2>
      </div>
      {stamp !== undefined ? <div className="lot-card-stamp">{stamp}</div> : null}
    </div>
  );
}
