"use client";

import { IconHand } from "@desiauction/ui";
import type { PlanState } from "@desiauction/core";
import { useEffect, useReducer } from "react";

import { activeJump, jumpReducer, type BlockReason, type OwnerStance } from "./owner-state";

import type { AuctionRules } from "../../../../server/auction/live-summary";
import { useMoney } from "../../../../components/money-unit";

// YOUR PADDLE — the bidder's one control, laid out for a thumb (live-room
// stage 1). On a phone it is pinned to the foot of the screen: what the owner
// can spend, three bigger amounts, and ONE big button that says exactly what it
// will do — "Bid 2,000 pts". On a laptop the same bar is a card beside the
// player card, the big button above the bigger amounts.
//
// THE NEXT BID IS ONE TAP. A BIGGER BID IS TWO. Tapping a chip only CHOOSES
// that amount (aria-pressed); the big button then names it and commits it, and
// "Back to the next bid" takes the choice away. A fat-fingered jump spends real
// money and a mistaken next bid costs one rung, so only the dear one asks
// twice. The choice lapses by itself the moment it stops applying — see
// `activeJump`. Both paths send through the same `onBid`, and so through the
// room's one bid sender and its intent ids: nothing about the protocol moved.
//
// A free-text amount is deliberately NOT here: the engine rejects off-ladder
// amounts, so offering the field only invites a rejection mid-lot.

/** The big button's words when the paddle is locked. */
const LOCKED_LABEL: Record<BlockReason, string> = {
  paused: "Bidding paused",
  closed: "Not taking bids",
  leading: "You're in the lead",
  "squad-full": "Your squad is full",
  "too-dear": "Past your budget",
};

export function PaddleControl({
  lotId,
  stance,
  rules,
  squadSigned,
  readOnly,
  busy,
  onBid,
  plan = null,
}: {
  lotId: string;
  /** Where the owner stands on this lot (`ownerStanceOf`) — shared with the state line. */
  stance: OwnerStance;
  rules: AuctionRules;
  squadSigned: number;
  /** The feed is stale: nothing may be sent, and a chosen amount lapses. */
  readOnly: boolean;
  /** A bid from this room is in flight. */
  busy: boolean;
  onBid: (amount: number) => void;
  /** WR-1: the owner's plan folded against this frame; null when they have none. */
  plan?: PlanState | null;
}) {
  const money = useMoney();
  const { raise, jumps, ceiling, reason } = stance;
  const [choice, dispatch] = useReducer(jumpReducer, null);
  const chosen = activeJump(choice, { lotId, stance, disabled: readOnly });
  // A choice that stopped applying is gone, not dormant: it must not come back
  // to life if the frame that invalidated it is itself undone.
  useEffect(() => {
    if (choice !== null && chosen === null) {
      dispatch({ type: "clear" });
    }
  }, [choice, chosen]);

  const locked = reason !== null;
  const bidsDisabled = readOnly || busy || locked;
  const amount = chosen ?? raise;
  const label = readOnly
    ? "Reconnecting…"
    : reason !== null
      ? LOCKED_LABEL[reason]
      : amount === undefined
        ? "—"
        : `Bid ${money.ledger(amount)}`;
  const planMax = plan?.currentLot?.target?.maxBid ?? null;
  const toBuy = Math.max(0, rules.squadMin - squadSigned);

  return (
    <section
      className="owner-bidbar"
      data-testid="paddle-control"
      data-chosen={chosen === null ? undefined : "true"}
      aria-label="Your paddle"
    >
      <p className="owner-budget" data-testid="bid-budget">
        {ceiling !== null ? (
          <span>
            You can spend up to <b>{money.ledger(ceiling)}</b>
            {/* The purse, squad and spend are the Your-team card's (stage 3);
                a laptop says here only why the ceiling is lower than the
                purse. */}
            {toBuy > 0 ? (
              <span className="owner-budget-need">
                {" "}
                · {toBuy} {toBuy === 1 ? "player" : "players"} still to buy
              </span>
            ) : null}
          </span>
        ) : (
          <span>Your paddle</span>
        )}
        {planMax !== null ? (
          <span data-testid="bid-plan-max">
            Your plan: <b>{money.ledger(planMax)}</b>
          </span>
        ) : null}
      </p>

      {/* The increment ladder, made choosable — same handle it had as prose. */}
      <div className="owner-chips" data-testid="bid-ladder" role="group" aria-label="Bigger bids">
        {jumps.map((rung) => {
          const unaffordable = ceiling !== null && rung > ceiling;
          return (
            <button
              key={rung}
              type="button"
              className="owner-chip"
              aria-pressed={chosen === rung}
              // Each rung answers for itself: the next bid may be affordable
              // and the third rung not.
              disabled={bidsDisabled || unaffordable}
              data-unaffordable={unaffordable ? "true" : undefined}
              title={
                unaffordable
                  ? `Beyond your purse — the most you can bid is ${money.ledger(ceiling)}.`
                  : undefined
              }
              onClick={() => {
                dispatch({ type: "select", lotId, amount: rung });
              }}
              data-testid={`bid-jump-${String(rung)}`}
            >
              {money.ledger(rung)}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="owner-bid"
        disabled={bidsDisabled || amount === undefined}
        aria-describedby={locked ? "paddle-blocked" : undefined}
        onClick={() => {
          if (amount !== undefined) {
            onBid(amount);
          }
        }}
        data-testid="bid-next"
        data-amount={amount === undefined ? undefined : String(amount)}
      >
        {bidsDisabled ? null : <IconHand size={22} weight="fill" />}
        <span>{busy && !locked && !readOnly ? "Sending your bid…" : label}</span>
      </button>

      {chosen !== null && raise !== undefined ? (
        <button
          type="button"
          className="owner-bid-back"
          onClick={() => {
            dispatch({ type: "clear" });
          }}
          data-testid="bid-back"
        >
          Back to the next bid ({money.ledger(raise)})
        </button>
      ) : null}
    </section>
  );
}
