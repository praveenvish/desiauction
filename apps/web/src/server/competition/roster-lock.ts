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
 * WHILE THE AUCTION IS SCHEDULED every mark stays open, although lots were
 * drawn when it was created: the pool is settled again when it OPENS
 * (`settlePool`, packages/auction) — a waiting lot of a player pre-signed by
 * then is withdrawn and they keep their team, and a player unmarked since gets
 * a lot. So an organizer who names captains at the owners' meeting, after the
 * auction was set up, loses nothing by doing it in that order.
 *
 * `isCaptain` is not frozen with the others, although it pre-signs a player
 * like they do (lib/pre-signed.ts). Freezing it would bring back the old
 * defect: before the auction a drafted player has no team to captain, and
 * after it the mark was refused — so the window in which the answer is
 * knowable was the one window the product refused to write it down. Once the
 * auction has opened it is judged per player instead: see
 * `captainChangeRefusal`.
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

/** What the captain rule needs to know about one registration. */
export interface CaptainFacts {
  name: string;
  isIcon: boolean;
  isRetained: boolean;
  isCaptain: boolean;
  /** Bought in this auction: their place on the team came through a sale. */
  bought: boolean;
}

export type CaptainRefusal =
  | { kind: "not_in_squad"; name: string }
  | { kind: "joined_as_captain"; name: string }
  | { kind: "armband_holder"; name: string };

/**
 * THE CAPTAIN MARK, ONCE THE AUCTION HAS OPENED.
 *
 * The pool settled when the auction opened. From then on the armband may still
 * change — the team's leader is often picked from the players it just bought —
 * but only where it cannot move a player into or out of the pool, or a squad
 * count the engine is pricing bids against. The mark matters to that
 * arithmetic only for a player whom nothing else pre-signs and who was not
 * bought:
 *
 * - naming one captain would pre-sign a player still WAITING for the block (or
 *   one the auction has not placed): they would go under the hammer as another
 *   team's captain, and the sale would collide with the buyer's own captain on
 *   `registrations_team_captain_uq` — a lot the gavel cannot close;
 * - clearing a captain who joined that way would drop them from their team's
 *   squad count while they are still on its sheet;
 * - and handing the armband to someone else DEMOTES the incumbent (DA-04),
 *   which clears their mark just the same.
 *
 * A bought player, an Icon or a retained player can take or give up the
 * armband freely: nothing but the badge changes.
 */
export function captainChangeRefusal(
  player: CaptainFacts,
  isCaptain: boolean,
  incumbent: CaptainFacts | null,
): CaptainRefusal | null {
  if (player.isCaptain === isCaptain) {
    return null;
  }
  const signedByArmband = (p: CaptainFacts) => !p.isIcon && !p.isRetained && !p.bought;
  if (signedByArmband(player)) {
    return { kind: isCaptain ? "not_in_squad" : "joined_as_captain", name: player.name };
  }
  if (isCaptain && incumbent !== null && signedByArmband(incumbent)) {
    return { kind: "armband_holder", name: incumbent.name };
  }
  return null;
}

/** The organizer's sentence for a refused captain change. */
export function captainRefusalMessage(refusal: CaptainRefusal): string {
  switch (refusal.kind) {
    case "not_in_squad":
      return `${refusal.name} isn't on a squad yet. Now that the auction has started, a captain is picked from the players a team has bought or pre-signed.`;
    case "joined_as_captain":
      return `${refusal.name} joined their team as captain, without the auction. Now that the auction has started, that place on the squad is fixed.`;
    case "armband_holder":
      return `${refusal.name} joined this team as captain, without the auction, so the armband can't change hands now that the auction has started.`;
  }
}
