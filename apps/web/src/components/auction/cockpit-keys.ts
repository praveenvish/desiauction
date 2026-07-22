/**
 * v1.1 — cockpit keyboard control (Tier 1 · gap G1).
 *
 * The auctioneer drives the cockpit for hours; before this, no auction surface
 * had a single keyboard handler. This module is the PURE decision half — given a
 * keystroke and the room's state, which operator action (if any) does it mean? —
 * so every guard is unit-testable without a DOM.
 *
 * The guards are the whole point. A stray keystroke on auction night must never
 * close a lot:
 *   • typing in a field is never a shortcut (the organizer names a team, types
 *     an amount, searches a queue);
 *   • a focused control keeps its NATIVE behaviour — Space on a focused button
 *     activates that button, exactly as a browser user expects, so we never
 *     steal it;
 *   • modifier chords belong to the browser and the OS, never to us;
 *   • the destructive action (closing a lot) is a HOLD, never a tap — this
 *     module only ever starts/stops the hold; `useHoldGate` decides when real
 *     elapsed time has passed.
 */

export type CockpitKeyAction = "open-next" | "toggle-pause" | "hold-start" | "hold-stop";

export interface CockpitKeyEvent {
  readonly key: string;
  readonly repeat?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  /** Lower-cased tag name of the event target ("input", "button", "div"…). */
  readonly targetTag?: string;
  readonly isContentEditable?: boolean;
}

export interface CockpitKeyContext {
  /** Engine auction status — only a live/paused room accepts these. */
  readonly status: string;
  /** Is a lot currently on the block? */
  readonly hasOpenLot: boolean;
  /** Is there at least one queued lot to open? */
  readonly hasQueue: boolean;
  /** A command is already in flight — ignore input rather than double-submit. */
  readonly busy: boolean;
}

/** Controls whose native keyboard behaviour we must not steal. */
const INTERACTIVE = new Set(["input", "textarea", "select", "button", "a", "option"]);

function isTyping(event: CockpitKeyEvent): boolean {
  return event.isContentEditable === true || INTERACTIVE.has((event.targetTag ?? "").toLowerCase());
}

function hasModifier(event: CockpitKeyEvent): boolean {
  return event.ctrlKey === true || event.metaKey === true || event.altKey === true;
}

/**
 * Which action does this KEYDOWN mean? Returns null when the keystroke is not
 * ours — the caller must then leave the event completely alone.
 */
export function resolveKeyDown(
  event: CockpitKeyEvent,
  context: CockpitKeyContext,
): CockpitKeyAction | null {
  if (isTyping(event) || hasModifier(event)) {
    return null;
  }
  if (context.busy) {
    return null;
  }
  const key = event.key.toLowerCase();

  // Space begins the gavel HOLD — never an immediate close.
  if (event.key === " " || event.key === "Spacebar") {
    if (event.repeat === true) {
      return null; // auto-repeat must not restart the hold
    }
    return context.status === "live" && context.hasOpenLot ? "hold-start" : null;
  }
  if (key === "o") {
    return context.status === "live" && !context.hasOpenLot && context.hasQueue
      ? "open-next"
      : null;
  }
  if (key === "p") {
    return context.status === "live" || context.status === "paused" ? "toggle-pause" : null;
  }
  return null;
}

/**
 * KEYUP only ever ABORTS a hold. Releasing early is harmless by design, so this
 * is deliberately unguarded by state: if the key comes up, the hold stops.
 */
export function resolveKeyUp(event: CockpitKeyEvent): CockpitKeyAction | null {
  if (isTyping(event)) {
    return null;
  }
  return event.key === " " || event.key === "Spacebar" ? "hold-stop" : null;
}

/** The legend the cockpit shows, so the shortcuts are discoverable, not folklore. */
export const COCKPIT_SHORTCUTS: readonly { keys: string; label: string }[] = [
  { keys: "O", label: "open next lot" },
  { keys: "Space", label: "hold to close" },
  { keys: "P", label: "pause / resume" },
];
