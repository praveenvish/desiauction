import type { CsvRegistrationRow } from "@desiauction/core";

/**
 * Which registration marks the auction freezes.
 *
 * Lives outside `actions.ts` because that module is `"use server"`, where every
 * export must be an async Server Action. This is a pure predicate, so it gets
 * its own file — and becomes testable without a session.
 *
 * `isIcon`, `isRetained` and `teamId` decide who is in the pool and whose squad
 * is how full — the arithmetic the engine has already priced bids against, so
 * they freeze the moment the auction leaves `scheduled`.
 *
 * `isRetained` belongs here for exactly the reason `isIcon` does, and it is not
 * a judgement call: `auctionReady` filters the pool on both, and `placeBid`
 * counts both into the squadMax cap (`or(isIcon, isRetained)`). Retaining a
 * player mid-auction would remove a lot the queue is already built from and
 * shrink a squad's remaining slots after bids were priced against the old
 * count. It had no writer when this file was written, so the omission cost
 * nothing; the moment one exists it would be a live way to change the rules
 * during the night.
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
  isRetained?: boolean;
  isCaptain?: boolean;
  teamId?: string | null;
}): boolean {
  return marks.isIcon !== undefined || marks.isRetained !== undefined || marks.teamId !== undefined;
}

/**
 * The squad columns a FILE carries, in the shape the lock understands.
 *
 * An import and a dashboard toggle must not disagree about whether a mark can
 * still move on auction night, so the import does not get a second opinion — it
 * reduces the file to this and asks the same predicate. A column absent from
 * every row is an absent mark, not a false one, which is why the answer is
 * built by presence rather than by value.
 *
 * `teamId` is set to null purely to SAY THE COLUMN IS THERE: the lock asks
 * whether a team was supplied, never which one, and the file's names are not
 * resolved to ids until the commit.
 */
export function squadMarksIn(rows: readonly CsvRegistrationRow[]): {
  isIcon?: boolean;
  isRetained?: boolean;
  teamId?: string | null;
} {
  const carried: { isIcon?: boolean; isRetained?: boolean; teamId?: string | null } = {};
  for (const row of rows) {
    if (row.isIcon !== null) {
      carried.isIcon = row.isIcon;
    }
    if (row.isRetained !== null) {
      carried.isRetained = row.isRetained;
    }
    if (row.teamName !== null) {
      carried.teamId = null;
    }
  }
  return carried;
}
