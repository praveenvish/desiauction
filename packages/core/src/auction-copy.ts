/**
 * Human sentences for every machine refusal the auction can produce (DA-11).
 *
 * Owners were reading `ALREADY_LEADING`, `Rejected: SQUAD_FULL` and
 * `undo_window_closed` mid-auction — identifiers meant for a log, shown to a
 * person under time pressure with money on the line. The money module had
 * already solved this locally ("That is more than the team still owes"); this
 * is the same standard, applied where it was missing.
 *
 * The maps are exhaustive `Record`s on purpose: adding a rejection code
 * without copy fails the build rather than shipping the enum to a user.
 */

import type { BidRejectionCode } from "./auction";

const BID_REJECTION_COPY: Record<BidRejectionCode, string> = {
  LOT_NOT_OPEN: "That lot has already closed.",
  NOT_AUTHORIZED: "You need a paddle to bid on this lot.",
  ALREADY_LEADING: "You're already the highest bidder.",
  INVALID_AMOUNT: "That bid amount isn't valid.",
  BELOW_BASE: "That's below the player's base price.",
  BELOW_CURRENT: "Someone has already bid that much or more.",
  INVALID_INCREMENT: "Bids move in set steps — pick one of the amounts shown.",
  BUDGET_EXCEEDED: "That would take you past your remaining purse.",
  RESERVE_VIOLATION: "You must keep enough purse to fill your minimum squad.",
  SQUAD_FULL: "Your squad is full.",
  ROLE_LIMIT: "You've reached the limit for players in that role.",
};

export function bidRejectionMessage(code: string): string {
  // Widened on purpose: the map is exhaustive over the union (so a new code
  // fails the build), but the caller hands us whatever the wire said.
  const table: Record<string, string | undefined> = BID_REJECTION_COPY;
  return table[code] ?? "That bid couldn't be accepted.";
}

/**
 * Everything else a command can come back with — lifecycle guards, paddle and
 * lot refusals, and the transport-level answers the gateway itself returns.
 */
const COMMAND_REFUSAL_COPY: Record<string, string> = {
  // Auction lifecycle
  illegal_transition: "That isn't possible from the auction's current state.",
  guard_failed: "The auction isn't ready for that yet.",
  squad_below_minimum: "Some teams are still below the minimum squad size.",
  auction_not_live: "The auction isn't running.",
  another_lot_open: "Finish the lot on the block first.",
  not_found: "That item no longer exists.",
  // Undo
  nothing_to_undo: "There's nothing to undo.",
  undo_window_closed: "Too late to undo — the next lot has already opened.",
  // Paddles
  already_issued: "That team already has its paddle.",
  unknown_team: "That team isn't part of this auction.",
  terminal_auction: "The auction has finished.",
  no_active_paddle: "You don't hold a paddle for that team.",
  no_grant: "You haven't been granted that team's paddle yet.",
  // Gateway
  not_authorized: "You don't have permission to do that.",
  unknown_command: "That action isn't available here.",
  unknown_auction: "This auction couldn't be found.",
  invalid_payload: "Something was missing from that request — try again.",
};

/**
 * One entry point for every ack the live surfaces render, so a bid rejection
 * and a lifecycle refusal read the same way.
 */
export function commandRefusalMessage(reason: string | null | undefined): string {
  if (reason === null || reason === undefined || reason === "") {
    return "That didn't go through. Try again.";
  }
  const bids: Record<string, string | undefined> = BID_REJECTION_COPY;
  return COMMAND_REFUSAL_COPY[reason] ?? bids[reason] ?? "That didn't go through. Try again.";
}
