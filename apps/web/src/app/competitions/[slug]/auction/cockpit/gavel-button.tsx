"use client";

import { useHoldGate } from "@desiauction/ui";
import { forwardRef, useImperativeHandle } from "react";

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
  { onConfirm: () => void; disabled?: boolean; holdMs?: number }
>(function GavelButton({ onConfirm, disabled = false, holdMs = 600 }, ref) {
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
      className="cockpit-gavel"
      data-testid="cockpit-gavel"
      data-holding={gate.holding ? "true" : "false"}
      disabled={disabled}
      aria-describedby="cockpit-gavel-hint"
      {...gate.bind}
    >
      {/* Presentation only — the gate is the clock, not this bar. */}
      <span
        className="cockpit-gavel-fill"
        style={{ transform: `scaleX(${String(gate.progress)})` }}
        aria-hidden="true"
      />
      <span className="cockpit-gavel-label">
        {gate.holding ? "Hold…" : "Gavel — hold to close"}
        <kbd>Space</kbd>
      </span>
    </button>
  );
});
