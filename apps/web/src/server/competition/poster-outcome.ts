import type { PosterMark, PosterOutcome } from "@desiauction/core";

import type { PreSignedKind } from "../../lib/pre-signed";

/**
 * What the poster may truthfully say.
 *
 * A verdict when the auction has reached one. Before it has, the one true
 * sentence is "in the pool" — and "UNSOLD" is still never a default to fall
 * back on: it is a claim about a night that has not finished.
 *
 * `pool` needs the player to actually be in play: a lot waiting its turn (or
 * on the block right now), or no lot yet in a season whose auction has not
 * finished. A withdrawn or frozen lot, or a finished auction that never
 * reached them, earns no card at all.
 */
const WAITING_LOTS: ReadonlySet<string> = new Set([
  "prepared",
  "queued",
  "on_block",
  "closing_soon",
]);
const FINISHED_AUCTIONS: ReadonlySet<string> = new Set(["completed", "reconciled"]);

export function outcomeOf(
  preSigned: PreSignedKind | null,
  lotStatus: string | undefined,
  auctionStatus: string | null = null,
): PosterOutcome | null {
  if (preSigned !== null) {
    return preSigned;
  }
  if (lotStatus === "sold") {
    return "sold";
  }
  if (lotStatus === "unsold") {
    return "unsold";
  }
  if (lotStatus !== undefined) {
    return WAITING_LOTS.has(lotStatus) ? "pool" : null;
  }
  return auctionStatus !== null && FINISHED_AUCTIONS.has(auctionStatus) ? null : "pool";
}

/** Every mark a pre-signed player wears — a player can be an icon AND captain. */
export function marksOf(row: {
  isIcon: boolean;
  isCaptain: boolean;
  isRetained: boolean;
}): PosterMark[] {
  const marks: PosterMark[] = [];
  if (row.isCaptain) {
    marks.push("captain");
  }
  if (row.isIcon) {
    marks.push("icon");
  }
  if (row.isRetained) {
    marks.push("retained");
  }
  // `preSignedSql` selected this row, so at least one mark is always present;
  // the fallback keeps a hand-edited row from rendering an unmarked "icon".
  return marks.length > 0 ? marks : ["icon"];
}
