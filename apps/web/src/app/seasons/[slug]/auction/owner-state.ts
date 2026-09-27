import {
  maxAffordableBid,
  nextMinimumBid as snapshotNextMinimumBid,
  paise,
  type AuctionSnapshot,
} from "@desiauction/core";

import type { AuctionRules } from "../../../../server/auction/live-summary";

/**
 * WHERE THE OWNER STANDS ON THIS LOT — one pure answer, read by every part of
 * the owner's room: the one coloured sentence under the price, the big bid
 * button's label and whether it can be pressed, and the three amount chips.
 *
 * It used to be worked out inline in PaddleControl, which answered "can I bid"
 * but not "what is happening to me": the room said "Outbid — …" in a toast that
 * landed on top of the very controls the owner needed next. Every rule here is
 * the one PaddleControl already enforced — the engine's own refusals read
 * backwards (paused, already leading by TEAM, squad full, past the purse
 * ceiling) — so the sentence and the button can never disagree.
 */

type Lot = NonNullable<AuctionSnapshot["currentLot"]>;

/** How many rungs of the increment ladder are offered as bigger amounts. */
export const JUMP_RUNGS = 3;

/** Why the paddle cannot bid. `leading` is good news, but it is still a no. */
export type BlockReason = "paused" | "closed" | "leading" | "squad-full" | "too-dear";

export type StanceKind =
  /** No bids yet: the owner can open. */
  | "open"
  /** The owner's team leads. */
  | "winning"
  /** The owner's team was in this lot and another team now leads. */
  | "outbid"
  /** Another team leads and the owner has not bid on this lot. */
  | "chasing"
  /** The owner cannot bid (paused, squad full, past the purse). */
  | "blocked";

export interface OwnerStance {
  kind: StanceKind;
  /** Set whenever the paddle is locked — including `leading`. */
  reason: BlockReason | null;
  /** The next bid on the ladder: the big button's amount. */
  raise: number | undefined;
  /** The bigger amounts, rung by rung above `raise`. */
  jumps: readonly number[];
  /**
   * The most this team may bid and still fill the squad minimum — the engine's
   * own arithmetic (gauntlet 8 + 9). Null when the purse is sealed (never for
   * an owner's own paddle, but then the honest answer is to gate nothing).
   */
  ceiling: number | null;
  /** The bid on the block, when there is one. */
  leader: { teamName: string; amount: number } | null;
  /** Players still needed to reach the squad minimum. */
  stillToBuy: number;
}

/** The ladder: the next bid and the rungs above it. */
export function ladderOf(
  lot: Pick<Lot, "basePrice" | "currentBid">,
  slabs: AuctionRules["slabs"],
): { raise: number | undefined; jumps: number[] } {
  const paiseSlabs = slabs.map((slab) => ({
    upTo: slab.upTo === null ? null : paise(slab.upTo),
    step: paise(slab.step),
  }));
  const rungs: number[] = [];
  let leading: number | null = lot.currentBid?.amount ?? null;
  for (let i = 0; i < JUMP_RUNGS + 1; i += 1) {
    const next = Number(
      snapshotNextMinimumBid(
        paise(lot.basePrice),
        paiseSlabs,
        leading === null ? null : paise(leading),
      ),
    );
    rungs.push(next);
    leading = next;
  }
  const [raise, ...jumps] = rungs;
  return { raise, jumps };
}

export function ownerStanceOf({
  lot,
  snapshot,
  rules,
  myPaddleNumber,
  squadSigned,
}: {
  lot: Lot;
  snapshot: AuctionSnapshot | null;
  rules: AuctionRules;
  myPaddleNumber: string;
  squadSigned: number;
}): OwnerStance {
  const { raise, jumps } = ladderOf(lot, rules.slabs);
  const paddle = snapshot?.paddles.find((entry) => entry.paddleNumber === myPaddleNumber) ?? null;
  // The engine decides "am I leading?" by TEAM, not by paddle — a holder with
  // two paddles for one franchise cannot outbid himself.
  const myTeamPaddles = new Set(
    paddle === null
      ? [myPaddleNumber]
      : (snapshot?.paddles ?? [])
          .filter((entry) => entry.teamId === paddle.teamId)
          .map((entry) => entry.paddleNumber),
  );
  const bid = lot.currentBid;
  const iAmLeading = bid !== null && myTeamPaddles.has(bid.paddleNumber);
  const paused = snapshot !== null && snapshot.auctionStatus !== "live";
  const squadFull = squadSigned >= rules.squadMax;
  const ceiling =
    paddle?.purseRemaining == null
      ? null
      : Number(
          maxAffordableBid({
            purseRemaining: paddle.purseRemaining,
            squadSize: squadSigned,
            squadMin: rules.squadMin,
            minPossiblePrice: rules.minPossiblePrice,
          }),
        );
  const tooDear = ceiling !== null && raise !== undefined && raise > ceiling;
  const reason: BlockReason | null = paused
    ? snapshot.auctionStatus === "paused"
      ? "paused"
      : "closed"
    : iAmLeading
      ? "leading"
      : squadFull
        ? "squad-full"
        : tooDear
          ? "too-dear"
          : null;
  const iBidHere = lot.bidHistory.some((entry) => myTeamPaddles.has(entry.paddleNumber));
  const kind: StanceKind =
    reason === "leading"
      ? "winning"
      : reason !== null
        ? "blocked"
        : bid === null
          ? "open"
          : iBidHere
            ? "outbid"
            : "chasing";
  return {
    kind,
    reason,
    raise,
    jumps,
    ceiling,
    leader: bid === null ? null : { teamName: bid.teamName, amount: bid.amount },
    stillToBuy: Math.max(0, rules.squadMin - squadSigned),
  };
}

/**
 * A bigger amount the owner has CHOSEN but not yet sent (two-step bids).
 *
 * The next bid stays one tap. A bigger amount is a two-step act — pick the
 * chip, then press the big button, which now names that amount — because a
 * fat-fingered jump spends real money and a mistaken next-bid only costs one
 * rung. The choice belongs to one lot.
 */
export interface JumpChoice {
  lotId: string;
  amount: number;
}

export type JumpAction = { type: "select"; lotId: string; amount: number } | { type: "clear" };

export function jumpReducer(state: JumpChoice | null, action: JumpAction): JumpChoice | null {
  switch (action.type) {
    case "select":
      // A second tap on the chosen chip takes the choice back.
      return state !== null && state.lotId === action.lotId && state.amount === action.amount
        ? null
        : { lotId: action.lotId, amount: action.amount };
    case "clear":
      return null;
  }
}

/**
 * The choice as it stands against THIS frame, or null when it no longer
 * applies: another lot, the bidding has moved to or past it (it is no longer
 * one of the bigger amounts on offer), the purse cannot reach it, or the
 * paddle is locked. An owner must never commit an amount picked for a
 * situation that has since changed.
 */
export function activeJump(
  choice: JumpChoice | null,
  frame: { lotId: string; stance: OwnerStance; disabled: boolean },
): number | null {
  if (choice === null || choice.lotId !== frame.lotId || frame.disabled) {
    return null;
  }
  const { stance } = frame;
  if (stance.reason !== null || !stance.jumps.includes(choice.amount)) {
    return null;
  }
  if (stance.ceiling !== null && choice.amount > stance.ceiling) {
    return null;
  }
  return choice.amount;
}

export type StateTone = "accent" | "success" | "warning" | "neutral";

export interface StateLine {
  tone: StateTone;
  /** Which glyph leads the sentence. */
  icon: "open" | "winning" | "outbid" | "chasing" | "paused" | "locked";
  title: string;
  detail: string;
}

/**
 * THE ONE SENTENCE an owner reads first, in their own numbers. `ledger` formats
 * money in the season's unit (₹ or points), so the sentence and the button
 * print the same figure the same way.
 */
export function stateLineOf(stance: OwnerStance, ledger: (amount: number) => string): StateLine {
  const next = stance.raise === undefined ? null : ledger(stance.raise);
  switch (stance.kind) {
    case "open":
      return {
        tone: "accent",
        icon: "open",
        title: "No bids yet — be the first",
        detail: next === null ? "Waiting for the opening bid." : `Opening bid is ${next}.`,
      };
    case "winning":
      return {
        tone: "success",
        icon: "winning",
        title:
          stance.leader === null
            ? "You're winning"
            : `You're winning at ${ledger(stance.leader.amount)}`,
        detail: "Hold tight. The player is yours if no one bids higher.",
      };
    case "outbid":
    case "chasing": {
      const who = stance.leader?.teamName ?? "Another team";
      const at = stance.leader === null ? "" : ledger(stance.leader.amount);
      return stance.kind === "outbid"
        ? {
            tone: "warning",
            icon: "outbid",
            title: `${who} bid ${at}`,
            detail: next === null ? "You've been outbid." : `Bid ${next} to take the lead back.`,
          }
        : {
            tone: "accent",
            icon: "chasing",
            title: `${who} leads at ${at}`,
            detail: next === null ? "Waiting for the next bid." : `Bid ${next} to take the lead.`,
          };
    }
    case "blocked":
      switch (stance.reason) {
        case "paused":
          return {
            tone: "neutral",
            icon: "paused",
            title: "Bidding is paused",
            detail: "The clock is stopped. Bidding resumes when the auctioneer restarts it.",
          };
        case "squad-full":
          return {
            tone: "neutral",
            icon: "locked",
            title: "Your squad is full",
            detail: "You can't buy any more players tonight.",
          };
        case "too-dear": {
          const ceiling = stance.ceiling ?? 0;
          const toBuy =
            stance.stillToBuy === 0
              ? ""
              : ` — ${String(stance.stillToBuy)} ${stance.stillToBuy === 1 ? "player" : "players"} still to buy`;
          return {
            tone: "neutral",
            icon: "locked",
            title: "This is past your budget",
            detail:
              ceiling === 0
                ? "Your purse can't cover another signing at this price."
                : `You can go up to ${ledger(ceiling)}${toBuy}.`,
          };
        }
        default:
          return {
            tone: "neutral",
            icon: "locked",
            title: "Not taking bids",
            detail: "This auction is not taking bids.",
          };
      }
  }
}
