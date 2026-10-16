"use client";

import { IconHand, VisuallyHidden } from "@desiauction/ui";
import type { PlanState } from "@desiauction/core";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";

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

const GESTURE_NOTICE = "Press canceled. Check the amount and press again.";

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
  bidScope,
  stance,
  rules,
  squadSigned,
  readOnly,
  busy,
  sending = busy,
  onBid,
  plan = null,
}: {
  lotId: string;
  /** Authenticated room and held paddle, never inferred from a displayed amount. */
  bidScope: string;
  /** Where the owner stands on this lot (`ownerStanceOf`) — shared with the state line. */
  stance: OwnerStance;
  rules: AuctionRules;
  squadSigned: number;
  /** The feed is stale: nothing may be sent, and a chosen amount lapses. */
  readOnly: boolean;
  /** Bidding is held: a bid is in flight, or the room's command guard says wait. */
  busy: boolean;
  /** A bid from this tab is actually in flight (defaults to `busy`). */
  sending?: boolean;
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
  type Gesture = {
    scope: string;
    lotId: string;
    amount: number | undefined;
    disabled: boolean;
    canceled: boolean;
    activated: boolean;
    released: boolean;
    ambiguous: boolean;
  };
  const bidButton = useRef<HTMLButtonElement | null>(null);
  const pointerGestures = useRef(new Map<number, Gesture>());
  const keyGestures = useRef(new Map<string, Gesture>());
  const keyboardActivation = useRef<Gesture | null>(null);
  const [gestureNotice, setGestureNotice] = useState("");
  const newGesture = (): Gesture => ({
    scope: bidScope,
    lotId,
    amount,
    disabled: bidsDisabled,
    canceled: false,
    activated: false,
    released: false,
    ambiguous: false,
  });
  const cancelGestures = () => {
    for (const pending of pointerGestures.current.values()) pending.canceled = true;
    for (const pending of keyGestures.current.values()) pending.canceled = true;
  };
  // Independent physical inputs retain their identities; cancellation is monotonic.
  useLayoutEffect(() => {
    const pendingGestures = [...keyGestures.current.values(), ...pointerGestures.current.values()];
    for (const pending of pendingGestures) {
      if (
        pending.scope !== bidScope ||
        pending.lotId !== lotId ||
        pending.amount !== amount ||
        pending.disabled !== bidsDisabled
      )
        pending.canceled = true;
    }
  }, [bidScope, lotId, amount, bidsDisabled]);
  useEffect(() => {
    const blur = () => {
      for (const pending of pointerGestures.current.values()) pending.canceled = true;
      for (const pending of keyGestures.current.values()) pending.canceled = true;
    };
    const keys = keyGestures.current;
    const pointers = pointerGestures.current;
    const timers = new Set<number>();
    const finishPointer = (event: PointerEvent) => {
      const id = event.pointerId;
      const pending = pointers.get(id);
      if (!pending) return;
      pending.released = true;
      if (
        event.type === "pointercancel" ||
        !(event.target instanceof Node) ||
        !bidButton.current?.contains(event.target)
      )
        pending.canceled = true;
      // Native button click follows release. Retire only this completed identity.
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (pointers.get(id) === pending) pointers.delete(id);
      }, 0);
      timers.add(timer);
    };
    const finishKey = (event: KeyboardEvent) => {
      const key = event.key;
      const pending = keys.get(key);
      if (!pending) return;
      pending.released = true;
      if (!(event.target instanceof Node) || !bidButton.current?.contains(event.target))
        pending.canceled = true;
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (keys.get(key) === pending) keys.delete(key);
        if (keyboardActivation.current === pending) keyboardActivation.current = null;
      }, 0);
      timers.add(timer);
    };
    window.addEventListener("keyup", finishKey);
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("keyup", finishKey);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
      for (const timer of timers) window.clearTimeout(timer);
      pointers.clear();
      keyboardActivation.current = null;
      keys.clear();
    };
  }, []);
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
        ref={bidButton}
        disabled={bidsDisabled || amount === undefined}
        aria-describedby={locked ? "paddle-blocked" : undefined}
        onMouseDown={(event) => {
          if (event.button !== 0 || bidsDisabled || amount === undefined) return;
          // Keep native click, but avoid a browser's mouse-focus default blurring Bid.
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
        }}
        onPointerDown={(event) => {
          const pending = newGesture();
          pending.canceled = event.button !== 0 || !event.isPrimary;
          if (pointerGestures.current.size > 0) {
            pending.ambiguous = true;
            for (const other of pointerGestures.current.values()) other.ambiguous = true;
          }
          pointerGestures.current.set(event.pointerId, pending);
          if (!pending.canceled) setGestureNotice("");
        }}
        onPointerUp={(event) => {
          const pending = pointerGestures.current.get(event.pointerId);
          if (pending) pending.released = true;
        }}
        onPointerCancel={(event) => {
          const pending = pointerGestures.current.get(event.pointerId);
          if (pending) pending.canceled = true;
        }}
        onLostPointerCapture={(event) => {
          const pending = pointerGestures.current.get(event.pointerId);
          if (pending && !pending.released) pending.canceled = true;
        }}
        onBlur={cancelGestures}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          if (event.repeat) {
            event.preventDefault();
            return;
          }
          const pending = newGesture();
          keyGestures.current.set(event.key, pending);
          setGestureNotice("");
          keyboardActivation.current = pending;
        }}
        onKeyUp={(event) => {
          const pending = keyGestures.current.get(event.key);
          if (!pending) return;
          pending.released = true;
          keyboardActivation.current = pending;
          // Window-level release cleanup follows native click, including outside focus.
        }}
        onClick={(event) => {
          const native = event.nativeEvent;
          const nativePointerId = "pointerId" in native ? native.pointerId : undefined;
          const hasPointerIdentity = typeof nativePointerId === "number" && nativePointerId >= 0;
          const fromPointer = hasPointerIdentity || event.detail > 0;
          const fallback = [...pointerGestures.current.entries()];
          const pointerEntry = hasPointerIdentity
            ? pointerGestures.current.get(nativePointerId)
            : fallback.length === 1 && fallback[0]?.[1].released && !fallback[0][1].ambiguous
              ? fallback[0][1]
              : undefined;
          const pending = fromPointer ? pointerEntry : keyboardActivation.current;
          const unattributedPointer = fromPointer && !pending;
          const unfinishedKey = !fromPointer && !pending && keyGestures.current.size > 0;
          if (unattributedPointer) {
            for (const other of pointerGestures.current.values()) other.canceled = true;
          }
          const changed =
            pending !== null &&
            pending !== undefined &&
            (pending.canceled ||
              pending.activated ||
              pending.scope !== bidScope ||
              pending.lotId !== lotId ||
              pending.amount !== amount ||
              pending.disabled !== bidsDisabled);
          if (pending) {
            if (fromPointer) {
              if (hasPointerIdentity) pointerGestures.current.delete(nativePointerId);
              else if (fallback[0]) pointerGestures.current.delete(fallback[0][0]);
            } else {
              if (keyboardActivation.current) keyboardActivation.current.activated = true;
              keyboardActivation.current = null;
            }
          }
          if (
            changed ||
            unattributedPointer ||
            unfinishedKey ||
            bidsDisabled ||
            amount === undefined
          ) {
            event.preventDefault();
            setGestureNotice(GESTURE_NOTICE);
            return;
          }
          setGestureNotice("");
          onBid(amount);
        }}
        data-testid="bid-next"
        data-amount={amount === undefined ? undefined : String(amount)}
      >
        {bidsDisabled ? null : <IconHand size={22} weight="fill" />}
        <span>
          {busy && !locked && !readOnly ? (sending ? "Sending your bid…" : "One moment…") : label}
        </span>
      </button>

      <VisuallyHidden role="status" data-testid="bid-gesture-status">
        {gestureNotice}
      </VisuallyHidden>
      <p
        className="owner-budget owner-gesture-notice"
        data-visible={gestureNotice ? "true" : undefined}
        aria-hidden="true"
      >
        {GESTURE_NOTICE}
      </p>

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
