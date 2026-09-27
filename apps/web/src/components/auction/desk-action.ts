/**
 * THE CONDUCTOR'S NEXT STEP (live-room stage 2).
 *
 * The conductor's desk has ONE primary button, and it always names what
 * pressing it will do: "Open next: Rohan Kulkarni", "Hold to sell to Pune ·
 * 1,500 pts", "Hold to pass — no bids". This module is the pure half of that
 * button — which act the room is waiting for, and the words for it — so the
 * order of the questions is unit-tested rather than folded into JSX.
 *
 * It decides nothing the engine decides. Every act it names is a command the
 * cockpit already sent from its own buttons (QueueLots, OpenAuction,
 * ResumeAuction, CloseLot, OpenLot, CompleteAuction); the engine's ack is still
 * what makes any of them happen. Closing a lot is still a HOLD through the
 * gavel's own gate — this only chooses its label.
 */

export type DeskAction =
  /** No snapshot yet: nothing on screen can be trusted enough to act on. */
  | { readonly kind: "connecting" }
  /** A scheduled auction with nothing queued: the order has to exist first. */
  | { readonly kind: "queue-lots" }
  /** A scheduled auction with its order ready. */
  | { readonly kind: "open-auction" }
  /** Paused: the clock is stopped until the conductor restarts it. */
  | { readonly kind: "resume" }
  /** A lot with a bid on it: the gavel sells it to the leader. */
  | { readonly kind: "sell"; readonly teamName: string; readonly amount: number }
  /** A lot with no bid: the gavel passes it unsold. */
  | { readonly kind: "pass" }
  /** Between lots, with someone waiting in the queue. */
  | {
      readonly kind: "open-next";
      readonly lotId: string;
      readonly lotNumber: string;
      readonly playerName: string | null;
    }
  /** Between lots, and nobody left in the queue: the night can close. */
  | { readonly kind: "complete" }
  /** Completed, reconciled or abandoned — nothing left to conduct. */
  | { readonly kind: "finished" };

export interface DeskInput {
  /** The engine's status when a snapshot exists, else the server's record. */
  readonly status: string;
  /** A snapshot has arrived from the engine. */
  readonly connected: boolean;
  readonly lot: {
    readonly currentBid: { readonly teamName: string; readonly amount: number } | null;
  } | null;
  readonly queue: readonly {
    readonly lotId: string;
    readonly lotNumber: string;
    readonly playerName: string | null;
  }[];
}

const FINISHED = new Set(["completed", "reconciled", "abandoned"]);

/** Which act the room is waiting for. Asked in this order, first answer wins. */
export function deskActionOf(input: DeskInput): DeskAction {
  if (FINISHED.has(input.status)) {
    return { kind: "finished" };
  }
  if (!input.connected) {
    return { kind: "connecting" };
  }
  if (input.status === "paused") {
    return { kind: "resume" };
  }
  if (input.status === "scheduled") {
    return input.queue.length === 0 ? { kind: "queue-lots" } : { kind: "open-auction" };
  }
  if (input.status !== "live") {
    return { kind: "connecting" };
  }
  if (input.lot !== null) {
    const bid = input.lot.currentBid;
    return bid === null
      ? { kind: "pass" }
      : { kind: "sell", teamName: bid.teamName, amount: bid.amount };
  }
  const next = input.queue[0];
  return next === undefined
    ? { kind: "complete" }
    : {
        kind: "open-next",
        lotId: next.lotId,
        lotNumber: next.lotNumber,
        playerName: next.playerName,
      };
}

/** A gavel act: the button is the hold gate, not a click. */
export function isGavelAction(
  action: DeskAction,
): action is Extract<DeskAction, { kind: "sell" | "pass" }> {
  return action.kind === "sell" || action.kind === "pass";
}

export interface DeskWords {
  /** The button's label — always the act, never "Submit". */
  readonly label: string;
  /**
   * The same act in the fewest words, for a phone's thumb bar ("Hold to sell
   * · Pune 1,500 pts"). Equal to `label` wherever the label already fits.
   */
  readonly shortLabel: string;
  /** The line under the facts that says why this is the next step. */
  readonly why: string;
}

/**
 * The words for an act. `amount` formats money the way the season does;
 * `teamLabel` shortens a franchise to the name a hall calls it by (its short
 * name, else its first word) for the phone's label; the full label names it in
 * full.
 */
export function deskActionWords(
  action: DeskAction,
  format: {
    readonly amount: (value: number) => string;
    readonly teamLabel?: (teamName: string) => string;
  },
): DeskWords {
  switch (action.kind) {
    case "connecting":
      return {
        label: "Connecting to the room…",
        shortLabel: "Connecting to the room…",
        why: "Nothing can be conducted until the auction room answers.",
      };
    case "queue-lots":
      return {
        label: "Queue the players",
        shortLabel: "Queue the players",
        why: "Puts every approved player in the order they will be called.",
      };
    case "open-auction":
      return {
        label: "Open the auction",
        shortLabel: "Open the auction",
        why: "The room goes live. Nobody can bid until you open a lot.",
      };
    case "resume":
      return {
        label: "Resume the auction",
        shortLabel: "Resume the auction",
        why: "The auction is paused — every clock is stopped until you resume.",
      };
    case "sell": {
      const team = format.teamLabel?.(action.teamName) ?? action.teamName;
      const amount = format.amount(action.amount);
      return {
        label: `Hold to sell to ${action.teamName} · ${amount}`,
        shortLabel: `Hold to sell · ${team} ${amount}`,
        why: "Hold the button (or Space) until it fills. Letting go early does nothing.",
      };
    }
    case "pass":
      return {
        label: "Hold to pass — no bids",
        shortLabel: "Hold to pass — no bids",
        why: "No paddle has bid. Holding closes the lot unsold.",
      };
    case "open-next":
      return {
        label: `Open next: ${action.playerName ?? action.lotNumber}`,
        shortLabel: `Open next: ${action.playerName ?? action.lotNumber}`,
        why: `${action.lotNumber} goes on the block and the clock starts.`,
      };
    case "complete":
      return {
        label: "Complete the auction",
        shortLabel: "Complete the auction",
        why: "The queue is empty. Requeue anyone unsold below, or close the night.",
      };
    case "finished":
      return { label: "", shortLabel: "", why: "" };
  }
}

/**
 * WHAT A GAVEL HOLD IS FOR: the lot, who leads it and at what price. The gavel
 * passes this to its hold gate as the `resetKey`, so a new bid landing mid-hold
 * (a new leader, a new amount, pass → sell) aborts the hold and the conductor
 * holds again for what the label now says. Stage 4, a founder decision: before,
 * a hold begun as "sell to Pune" completed as a sale to whoever led when it
 * filled. With no lot the key is empty (the gavel is disabled then).
 */
export function gavelResetKey(
  lot: {
    readonly lotId: string;
    readonly currentBid: { readonly paddleNumber: string; readonly amount: number } | null;
  } | null,
): string {
  if (lot === null) {
    return "";
  }
  const bid = lot.currentBid;
  return `${lot.lotId}:${bid?.paddleNumber ?? "none"}:${bid === null ? "none" : String(bid.amount)}`;
}
