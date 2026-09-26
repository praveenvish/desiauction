import type { KitTone } from "@desiauction/ui";

import type { LiveBoard, RoomState } from "../../server/admin/live-views";

/**
 * ONE RULE, ONE COLOUR, ON EVERY ADMIN SURFACE THAT DRAWS A ROOM.
 *
 * /admin said "116 auctions live for over 12 hours" (status `live`, CREATED
 * over twelve hours ago) while /admin/live said "Silent over 12h · 117" (live
 * OR paused, no EVENT for twelve hours) — two rules, one word apart. And the
 * overview drew the same six rooms with green "bidding" dots that the board
 * drew red. Both surfaces now read the live board's rule and this palette.
 */
export const ROOM_TONE: Record<RoomState, KitTone> = {
  active: "green",
  quiet: "neutral",
  paused: "amber",
  stale: "red",
};

export const ROOM_LABEL: Record<RoomState, string> = {
  active: "Bidding",
  quiet: "Quiet",
  paused: "Paused",
  stale: "Silent",
};

/** The short name of the stuck rule — the board's fold, the overview's chip. */
export const STUCK_LABEL = "Silent over 12h";

export interface StuckSummary {
  readonly count: number;
  readonly clubs: number;
  /** The longest silence among rooms that ever spoke; null when none did. */
  readonly longestSilentMs: number | null;
}

/** The live board's silent rooms, summarised once for every surface. */
export function stuckSummary(board: Pick<LiveBoard, "stale" | "generatedAtMs">): StuckSummary {
  const silences = board.stale
    .map((row) => row.lastEventAtMs)
    .filter((at): at is number => at !== null)
    .map((at) => board.generatedAtMs - at);
  return {
    count: board.stale.length,
    clubs: new Set(board.stale.map((row) => row.orgSlug)).size,
    longestSilentMs: silences.length > 0 ? Math.max(...silences) : null,
  };
}
