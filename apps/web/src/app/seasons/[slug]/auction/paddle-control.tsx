"use client";

import { formatPaiseINR, nextMinimumBid as snapshotNextMinimumBid, paise } from "@desiauction/core";
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
  const iAmLeading = lot.currentBid?.paddleNumber === myPaddleNumber;
  // DA-12: the raise buttons stayed live when the server was certain to refuse
  // — already leading, or a full squad — so the room invited the rejection
  // instead of preventing it, then showed it as an enum (DA-11).
  const squadFull = squadSigned >= rules.squadMax;
  const blocked = iAmLeading
    ? "You're already the highest bidder."
    : squadFull
      ? "Your squad is full."
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
        <p className="paddle-leading" id="paddle-blocked" data-testid="paddle-leading">
          {iAmLeading ? "You're leading this lot." : blocked}
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
                disabled={bidsDisabled}
                title={blocked ?? undefined}
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
              {formatPaiseINR(paise(paddle.purseRemaining))}
            </dd>
          </div>
          <div>
            <dt>Committed</dt>
            <dd data-testid="paddle-committed">{formatPaiseINR(paise(paddle.committed))}</dd>
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
