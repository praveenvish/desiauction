/**
 * Which registration marks the auction freezes.
 *
 * Lives outside `actions.ts` because that module is `"use server"`, where every
 * export must be an async Server Action. This is a pure predicate, so it gets
 * its own file — and becomes testable without a session.
 *
 * `isIcon` and `teamId` decide who is in the pool and whose squad is how full —
 * the arithmetic the engine has already priced bids against, so they freeze the
 * moment the auction leaves `scheduled`.
 *
 * `isCaptain` decides nothing. `auctionReady` filters the pool on `isIcon`
 * alone; no purse, lot or squad count reads the captain badge. Freezing it with
 * the others made naming a captain impossible in either direction: before the
 * auction a drafted player has no team to captain, and after it the mark was
 * refused — so the window in which the answer is knowable was the one window
 * the product refused to write it down.
 */
export function marksFreezeWithRoster(marks: {
  isIcon?: boolean;
  isCaptain?: boolean;
  teamId?: string | null;
}): boolean {
  return marks.isIcon !== undefined || marks.teamId !== undefined;
}
