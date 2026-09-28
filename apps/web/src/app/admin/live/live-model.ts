import type { LiveAuctionRow } from "../../../server/admin/live-views";
import type { EngineRoom } from "../../../server/admin/live-watch";

/**
 * THE LIVE BOARD, SORTED INTO WHAT A PERSON ON AN AUCTION NIGHT ASKS.
 *
 * The board's `running` list is every room not yet silent for twelve hours —
 * which on a quiet day is a column of rehearsals nobody closed, 8–12 hours
 * old, under the heading "Running now". Pure over the board and the engine's
 * answers, so each split and each sentence is a unit test.
 */

/** Rooms that did something in the last fifteen minutes, or are paused on purpose. */
export function biddingNow(running: readonly LiveAuctionRow[]): LiveAuctionRow[] {
  return running.filter((row) => row.state === "active" || row.state === "paused");
}

/** Open, not closed, and silent for longer than the active window. */
export function goneQuiet(running: readonly LiveAuctionRow[]): LiveAuctionRow[] {
  return running.filter((row) => row.state === "quiet");
}

export type EngineHealth =
  /** No room was asked: nothing is open. */
  | { readonly kind: "unasked" }
  /** Every room asked went unanswered: the engine is down, one fact. */
  | { readonly kind: "down"; readonly asked: number }
  /** It answered; `troubled` rooms reported a problem of their own. */
  | { readonly kind: "answering"; readonly troubled: number };

export function engineHealth(
  running: readonly LiveAuctionRow[],
  engine: Readonly<Record<string, EngineRoom>>,
  isTroubled: (room: EngineRoom | undefined) => boolean,
): EngineHealth {
  const asked = running
    .map((row) => engine[row.auctionId])
    .filter((room): room is EngineRoom => room !== undefined && room.state !== "not_checked");
  if (asked.length === 0) return { kind: "unasked" };
  if (asked.every((room) => room.state === "unreachable")) {
    return { kind: "down", asked: asked.length };
  }
  return { kind: "answering", troubled: asked.filter((room) => isTroubled(room)).length };
}

/** The empty "Bidding now" card's one line, pointing at where the rooms went. */
export function nothingBiddingLine(quiet: number, refreshSeconds: number): string {
  if (quiet === 0) {
    return `When an organizer opens an auction, it appears here within ${String(refreshSeconds)} seconds.`;
  }
  return `${String(quiet)} ${quiet === 1 ? "room is" : "rooms are"} open but ${quiet === 1 ? "has" : "have"} gone quiet — below. A room appears here within ${String(refreshSeconds)} seconds of its next bid.`;
}
