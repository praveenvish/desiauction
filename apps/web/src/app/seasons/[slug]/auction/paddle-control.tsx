"use client";

import {
  formatPaiseINR,
  maxAffordableBid,
  nextMinimumBid as snapshotNextMinimumBid,
  paise,
} from "@desiauction/core";
import { Card } from "@desiauction/ui";
import type { AuctionSnapshot } from "@desiauction/core";

import { TeamChip, type TeamIdentity } from "./purse-board";

import type { AuctionRules } from "../../../../server/auction/live-summary";

// YOUR PADDLE — the bidder's one control. The raise is a single large button
// carrying its own amount, because the owner is watching the room and the
// timer, not reading a form: the previous version asked them to parse a
// "Ladder: ₹20L → ₹25L → ₹30L" sentence and then find a separate button.
//
// The jump-ahead chips are the same ladder made pressable. A free-text paise
// field is deliberately NOT here — the engine rejects off-ladder amounts, so
// offering the field only invites a rejection mid-lot.

/** How many rungs of the increment ladder to offer as jump-ahead chips. */
const JUMP_RUNGS = 3;

export function PaddleControl({
  lot,
  rules,
  snapshot,
  myPaddleNumber,
  myTeam,
  squadSigned,
  disabled,
  onBid,
}: {
  lot: NonNullable<AuctionSnapshot["currentLot"]>;
  rules: AuctionRules;
  snapshot: AuctionSnapshot | null;
  myPaddleNumber: string;
  myTeam: TeamIdentity | undefined;
  squadSigned: number;
  disabled: boolean;
  onBid: (amount: number) => void;
}) {
  const paiseSlabs = rules.slabs.map((slab) => ({
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
  const paddle = snapshot?.paddles.find((entry) => entry.paddleNumber === myPaddleNumber) ?? null;
  // DA: the engine decides "am I leading?" by TEAM, not by paddle — a holder
  // with two paddles for one franchise cannot outbid himself. Comparing paddle
  // numbers here made the room and the engine answer the same question two
  // different ways. Team identity is the engine's, so it is ours.
  const iAmLeading =
    lot.currentBid !== null &&
    (paddle === null
      ? lot.currentBid.paddleNumber === myPaddleNumber
      : snapshot?.paddles.some(
          (entry) =>
            entry.teamId === paddle.teamId && entry.paddleNumber === lot.currentBid?.paddleNumber,
        ) === true);
  // DA-12: the raise buttons stayed live when the server was certain to refuse
  // — already leading, or a full squad — so the room invited the rejection
  // instead of preventing it, then showed it as an enum (DA-11).
  //
  // DA: and the biggest of those refusals was missing. A PAUSED auction left
  // `RAISE TO ₹15,000` gold and enabled, and the engine answered the tap with
  // "That lot has already closed." It had not closed — it was paused. The one
  // state the button never consulted was the auction's own.
  const paused = snapshot !== null && snapshot.auctionStatus !== "live";
  const squadFull = squadSigned >= rules.squadMax;
  // MONEY IS A REFUSAL THE ROOM CAN PREDICT, TOO.
  //
  // The list above covers paused, already-leading and squad-full — every state
  // where the engine is certain to say no. It never covered the purse, which
  // is the refusal that actually happens late in a night: a captain holding
  // ₹45,000 was shown "RAISE TO ₹50,000" in gold, enabled, with three
  // jump-ahead rungs above it, and every press came back "That would take you
  // past your remaining purse." The ceiling is the engine's own arithmetic
  // (gauntlet 8 + 9) read backwards, so the two cannot drift.
  //
  // `purseRemaining === null` means the money was sealed for this viewer, which
  // never happens for their OWN paddle — but if it ever did, the honest answer
  // is to gate nothing rather than to guess a ceiling.
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
  const blocked = paused
    ? snapshot.auctionStatus === "paused"
      ? "The clock is stopped. Bidding resumes when the auctioneer restarts it."
      : "This auction is not taking bids."
    : iAmLeading
      ? "You're already the highest bidder."
      : squadFull
        ? "Your squad is full."
        : tooDear
          ? ceiling === 0
            ? "Your purse can't cover another signing at this price."
            : `Beyond your purse. The most you can bid is ${formatPaiseINR(paise(ceiling))}.`
          : null;
  const bidsDisabled = disabled || blocked !== null;

  return (
    <Card data-testid="paddle-control">
      <div className="competition-head">
        <h2>Your paddle</h2>
        <span className="paddle-who">
          <TeamChip team={myTeam} fallback={myPaddleNumber} />
          {myTeam?.name ?? myPaddleNumber}
        </span>
      </div>

      {blocked !== null ? (
        <p
          className={paused ? "paddle-leading paddle-frozen" : "paddle-leading"}
          id="paddle-blocked"
          data-testid="paddle-leading"
          data-reason={
            paused ? "paused" : iAmLeading ? "leading" : squadFull ? "squad-full" : "too-dear"
          }
          role={paused ? "status" : undefined}
        >
          {paused || !iAmLeading ? blocked : "You're leading this lot."}
        </p>
      ) : null}

      <div className="paddle-actions">
        <button
          type="button"
          className="paddle-raise"
          disabled={bidsDisabled || raise === undefined}
          title={blocked ?? undefined}
          aria-describedby={blocked !== null ? "paddle-blocked" : undefined}
          onClick={() => {
            if (raise !== undefined) {
              onBid(raise);
            }
          }}
          data-testid="bid-next"
        >
          <span className="paddle-raise-label">Raise to</span>
          <span className="paddle-raise-amount">
            {raise === undefined ? "—" : formatPaiseINR(paise(raise))}
          </span>
        </button>
        <div className="paddle-jump">
          <p className="paddle-jump-label">Jump ahead</p>
          {/* The increment ladder, made pressable — same handle it had as prose. */}
          <div className="paddle-jump-row" data-testid="bid-ladder">
            {jumps.map((amount) => (
              <button
                key={amount}
                type="button"
                className="paddle-jump-chip"
                // Each rung answers for itself: the raise may be affordable and
                // the third jump not, and offering it anyway is the same
                // invitation-to-a-refusal in miniature.
                disabled={bidsDisabled || (ceiling !== null && amount > ceiling)}
                title={
                  ceiling !== null && amount > ceiling && blocked === null
                    ? `Beyond your purse — the most you can bid is ${formatPaiseINR(paise(ceiling))}.`
                    : (blocked ?? undefined)
                }
                onClick={() => {
                  onBid(amount);
                }}
                data-testid={`bid-jump-${String(amount)}`}
              >
                {formatPaiseINR(paise(amount))}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Distinct testids from MyTeamCard's: the same three figures appear in
          both (deliberately — a bidder shouldn't look away mid-lot), and a
          shared handle would match twice and fail Playwright's strict mode. */}
      {paddle !== null ? (
        <dl className="paddle-stats">
          <div>
            <dt>Purse left</dt>
            <dd className="paddle-stat-remaining" data-testid="paddle-purse">
              {paddle.purseRemaining === null ? "—" : formatPaiseINR(paise(paddle.purseRemaining))}
            </dd>
          </div>
          <div>
            <dt>Committed</dt>
            <dd data-testid="paddle-committed">
              {paddle.committed === null ? "—" : formatPaiseINR(paise(paddle.committed))}
            </dd>
          </div>
          <div>
            <dt>Signed</dt>
            <dd data-testid="paddle-signed">
              {squadSigned}/{rules.squadMax}
            </dd>
          </div>
        </dl>
      ) : null}
    </Card>
  );
}
