"use client";

import { useHoldGate } from "@desiauction/ui";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";

/**
 * v1.1 — the gavel (Tier 1 · gap G2).
 *
 * Closing a lot is the one act of the night that feels irreversible to the room:
 * a name, a price, and a team, announced. It used to be a single click. It is
 * now a HOLD — real elapsed time on a clock, per `useHoldGate` (F-AX-1). Reduced
 * motion changes how progress LOOKS, never how long it takes, and releasing,
 * leaving or blurring aborts harmlessly.
 *
 * The primitive's own `bind` already handles Space/Enter while the button is
 * focused, so keyboard hold works natively here with no global handler. The
 * cockpit additionally exposes a page-level Space via an imperative handle, so
 * the auctioneer never has to tab to this button mid-lot.
 *
 * This changes NO command semantics: it still submits exactly `CloseLot`, and
 * the engine's ack is still what decides.
 *
 * Stage 4 (founder decision): the hold is for WHAT THE LABEL SAYS. The caller
 * passes a `resetKey` naming the lot, the leader and the amount; a new bid that
 * changes any of them while the gavel is held aborts the hold, empties the
 * fill, and says why ("New bid — hold again") in a polite live region beside
 * the button — never inside it, so the button's box cannot change under the
 * pointer. Before, the hold carried on and sold to whoever led when it filled.
 */

/** How long the "hold again" cue stands after a hold is aborted by a new bid. */
const RESTART_CUE_MS = 2500;

export interface GavelHandle {
  start: () => void;
  stop: () => void;
}

export const GavelButton = forwardRef<
  GavelHandle,
  {
    onConfirm: () => void;
    disabled?: boolean;
    holdMs?: number;
    testId?: string;
    /** Id of the element explaining the hold. Must EXIST on the page. */
    describedBy?: string;
    /**
     * What releasing the hold will do (the conductor's desk names it: "Hold to
     * sell to Pune · 1,500 pts"). It may change between holds — a new bid
     * renames the leader — so the CALLER must give the button a box that does
     * not follow its text (the desk's is full-width, one line): the two labels
     * below keep the width of the longer only for a content-sized button.
     */
    label?: ReactNode;
    /** Shown while the hold is filling. Laid out at all times, like `label`. */
    holdingLabel?: string;
    /** Decorative mark before the words. */
    icon?: ReactNode;
    /** Extra classes on the button (the desk's primary treatment). */
    className?: string;
    /** The key hint drawn inside the button; null draws none. */
    shortcut?: string | null;
    /**
     * What the hold would close on — `gavelResetKey(lot)`: lot, leader and
     * amount. A change mid-hold aborts it (see `useHoldGate`).
     */
    resetKey?: string;
    /** The cue shown and announced when a new bid aborts a hold. */
    restartCue?: string;
  }
>(function GavelButton(
  {
    onConfirm,
    disabled = false,
    holdMs = 600,
    testId = "cockpit-gavel",
    describedBy = "cockpit-gavel-hint",
    label = "Gavel — hold to close",
    holdingLabel = "Hold…",
    icon,
    className,
    shortcut = "Space",
    resetKey = "",
    restartCue = "New bid — hold again",
  },
  ref,
) {
  // Each abort is a new number, so the cue's node is new each time and a
  // second abort is announced again rather than being a silent DOM no-op.
  const [restarts, setRestarts] = useState(0);
  const [cueShown, setCueShown] = useState(false);
  const onReset = useCallback(() => {
    setRestarts((count) => count + 1);
    setCueShown(true);
  }, []);
  const gate = useHoldGate({ durationMs: holdMs, onConfirm, disabled, resetKey, onReset });
  const { onPointerDown, onPointerUp } = gate.bind;

  useEffect(() => {
    if (!cueShown) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setCueShown(false);
    }, RESTART_CUE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [cueShown, restarts]);

  // A fresh hold is the answer to the cue: it goes as the next hold begins.
  const holding = gate.holding;
  const [wasHolding, setWasHolding] = useState(holding);
  if (holding !== wasHolding) {
    setWasHolding(holding);
    if (holding && cueShown) {
      setCueShown(false);
    }
  }

  // The page-level Space shortcut drives the same gate — one source of truth for
  // "is a hold in progress", so a pointer hold and a key hold can never disagree.
  useImperativeHandle(ref, () => ({ start: onPointerDown, stop: onPointerUp }), [
    onPointerDown,
    onPointerUp,
  ]);

  return (
    <>
      <button
        type="button"
        className={["cockpit-gavel", className].filter(Boolean).join(" ")}
        data-testid={testId}
        data-holding={gate.holding ? "true" : "false"}
        disabled={disabled}
        aria-describedby={describedBy}
        {...gate.bind}
      >
        {/* Presentation only — the gate is the clock, not this bar. */}
        <span
          className="cockpit-gavel-fill"
          style={{ transform: `scaleX(${String(gate.progress)})` }}
          aria-hidden="true"
        />
        {/* BOTH labels are always laid out, one hidden: the button keeps the
          width of the longer one. Swapping the text shrank a content-sized
          button under the pointer the instant it was pressed, the browser
          fired pointerleave 2ms later, and the gate stopped — the gavel on
          /live could not be held with a mouse at all. */}
        <span className="cockpit-gavel-label">
          {icon === undefined ? null : (
            <span className="cockpit-gavel-icon" aria-hidden>
              {icon}
            </span>
          )}
          <span className="cockpit-gavel-texts">
            <span data-shown={gate.holding ? "false" : "true"}>{label}</span>
            <span data-shown={gate.holding ? "true" : "false"}>{holdingLabel}</span>
          </span>
          {shortcut === null ? null : <kbd>{shortcut}</kbd>}
        </span>
      </button>
      {/* OUTSIDE the button and out of flow (absolutely placed against the
        caller's positioned container), so neither the cue nor its going can
        move or resize the button under a held pointer — the pointerleave trap.
        Always mounted: a polite region must exist before it speaks. */}
      <span className="gavel-restart" role="status" aria-live="polite" aria-atomic="true">
        {cueShown ? (
          <span key={restarts} className="gavel-restart-cue" data-testid={`${testId}-restart`}>
            {restartCue}
          </span>
        ) : null}
      </span>
    </>
  );
});
