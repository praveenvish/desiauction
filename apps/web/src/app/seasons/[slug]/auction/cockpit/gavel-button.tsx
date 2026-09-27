"use client";

import { useHoldGate } from "@desiauction/ui";
import { forwardRef, useImperativeHandle, type ReactNode } from "react";

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
 */

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
  },
  ref,
) {
  const gate = useHoldGate({ durationMs: holdMs, onConfirm, disabled });
  const { onPointerDown, onPointerUp } = gate.bind;

  // The page-level Space shortcut drives the same gate — one source of truth for
  // "is a hold in progress", so a pointer hold and a key hold can never disagree.
  useImperativeHandle(ref, () => ({ start: onPointerDown, stop: onPointerUp }), [
    onPointerDown,
    onPointerUp,
  ]);

  return (
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
  );
});
