"use client";

import { maxAffordableBid, type AuctionSnapshot, type PlanState } from "@desiauction/core";
import {
  GoldDrift,
  IconArrowUp,
  IconCheck,
  IconHand,
  IconLock,
  IconPause,
  IconTrophy,
  SoldStamp,
} from "@desiauction/ui";
import { useMemo } from "react";

import { roleLabeller } from "../../../../lib/role-label";
import { lotSeed } from "../../../../lib/player-seed";
import type { AuctionRules, LotMedia, ResolvedLot } from "../../../../server/auction/live-summary";
import { useMoney } from "../../../../components/money-unit";
import { LotCard, LotPrice } from "./lot-card";
import { ownerStanceOf, stateLineOf, type StateLine } from "./owner-state";
import { PaddleControl } from "./paddle-control";
import { PlanLine } from "./plan-line";
import type { TeamIdentity } from "./purse-board";
import type { AuctionClock } from "./use-auction-socket";

// THE OWNER'S STAGE (live-room stage 1): the player card, the price, one
// coloured sentence saying where the owner stands, and the paddle. On a phone
// the paddle is pinned to the foot of the screen (live.css); on a laptop it
// sits in the stage beside the card.

type Lot = NonNullable<AuctionSnapshot["currentLot"]>;

const STATE_ICON: Record<StateLine["icon"], typeof IconHand> = {
  open: IconHand,
  winning: IconCheck,
  outbid: IconArrowUp,
  chasing: IconArrowUp,
  paused: IconPause,
  locked: IconLock,
};

/** The one sentence an owner reads first. */
function OwnerStateLine({ line, reason }: { line: StateLine; reason: string | null }) {
  const Icon = STATE_ICON[line.icon];
  return (
    <div
      className="owner-state"
      data-tone={line.tone}
      data-state={line.icon}
      data-testid="owner-state"
    >
      <span className="owner-state-icon" aria-hidden>
        <Icon size={20} weight="fill" />
      </span>
      <div className="owner-state-words">
        {/* `paddle-leading` is the long-standing handle for "why this paddle
            cannot bid" (its data-reason is read by the suites): it exists
            exactly while the paddle is locked, leading included. Paused keeps
            its status role, as it always had. */}
        {reason !== null ? (
          <p
            className="owner-state-title"
            id="paddle-blocked"
            data-testid="paddle-leading"
            data-reason={reason}
            role={reason === "paused" ? "status" : undefined}
          >
            {line.title}
          </p>
        ) : (
          <p className="owner-state-title">{line.title}</p>
        )}
        <p className="owner-state-detail">{line.detail}</p>
      </div>
    </div>
  );
}

export function OwnerStage({
  part,
  roles,
  lot,
  media,
  snapshot,
  rules,
  teams,
  myPaddleNumber,
  squadSigned,
  remainingMs,
  lotDurationMs,
  clock,
  frozen,
  readOnly,
  busy,
  onBid,
  plan,
  planNames,
}: {
  /**
   * Which half of the stage (stage 3): the player card, or the bidding beside
   * it — the price, the sentence and the paddle. The room lays the two out in
   * its own columns; a phone reads them one after the other.
   */
  part: "card" | "bidding";
  roles: readonly { key: string; label: string }[];
  lot: Lot;
  media: LotMedia | undefined;
  snapshot: AuctionSnapshot | null;
  rules: AuctionRules;
  teams: readonly TeamIdentity[];
  /** Null for a viewer holding no paddle: the card and the price, no paddle. */
  myPaddleNumber: string | null;
  squadSigned: number;
  remainingMs: number | null;
  lotDurationMs: number;
  clock: AuctionClock;
  frozen: boolean;
  readOnly: boolean;
  busy: boolean;
  onBid: (amount: number) => void;
  plan: PlanState | null;
  planNames: (registrationId: string) => string;
}) {
  const money = useMoney();
  const labelOf = useMemo(() => roleLabeller(roles), [roles]);
  const bid = lot.currentBid;
  const name = lot.playerName ?? "Unnamed";
  const number = media?.number ?? null;
  const stance =
    myPaddleNumber === null
      ? null
      : ownerStanceOf({ lot, snapshot, rules, myPaddleNumber, squadSigned });

  if (part === "card") {
    return (
      // `current-lot` is the long-standing handle for "the lot on the block"
      // — the suites read the player and the lot number off it. Keyed on the
      // lot so a new player remounts the card and its clock starts fresh.
      <section
        key={lot.lotId}
        className="owner-lot"
        data-testid="current-lot"
        aria-label="On the block"
      >
        <LotCard
          name={name}
          seed={media?.registrationId ?? lot.lotId}
          photoUrl={media?.photoUrl ?? null}
          roleLabel={lot.role === "" ? null : labelOf(lot.role)}
          onBlock
          kicker={
            <>
              {lot.lotNumber}
              {number === null ? null : <span data-testid="lot-player-number"> · #{number}</span>} ·
              base {money.ledger(lot.basePrice)}
              {/* How many times the anti-snipe has fired on this lot — the
                  count every window shows, beside the clock it extended. */}
              {lot.extensions > 0 ? (
                <span className="lot-card-ext" data-testid="lot-extensions">
                  {" "}
                  · +{lot.extensions} extension{lot.extensions === 1 ? "" : "s"}
                </span>
              ) : null}
            </>
          }
          clock={{
            remainingMs,
            totalMs: lotDurationMs,
            clock,
            frozen,
            extensions: lot.extensions,
          }}
        />
      </section>
    );
  }

  return (
    <div className="owner-stage" data-has-paddle={stance === null ? "false" : "true"}>
      <section className="owner-standing" aria-label="The bidding">
        <LotPrice basePrice={lot.basePrice} bid={bid} teams={teams} />
        {stance !== null ? (
          <OwnerStateLine line={stateLineOf(stance, money.ledger)} reason={stance.reason} />
        ) : null}
        {/* WR-1: the plan's line sits under the sentence, never above it. */}
        {stance !== null && plan !== null ? <PlanLine state={plan} names={planNames} /> : null}
      </section>
      {stance !== null ? (
        <PaddleControl
          lotId={lot.lotId}
          stance={stance}
          rules={rules}
          squadSigned={squadSigned}
          readOnly={readOnly}
          busy={busy}
          onBid={onBid}
          plan={plan}
        />
      ) : null}
    </div>
  );
}

/**
 * YOU WON — the owner's own moment when the gavel falls for their team. It
 * rides the room's ceremony: it stands exactly while the ceremony's phase is
 * `sold` for this team, and keeps the stage's `ceremony` handle and phase, so
 * everything that follows the ceremony still finds it. Presentation only: the
 * figures are the snapshot's and the squad count the room already keeps.
 */
export function OwnerWon({
  roles,
  outcome,
  ceremonyKey,
  media,
  lotMedia,
  resolved,
  rules,
  purseRemaining,
  squadSize,
}: {
  roles: readonly { key: string; label: string }[];
  outcome: NonNullable<AuctionSnapshot["lastOutcome"]>;
  ceremonyKey: string;
  media: LotMedia | undefined;
  lotMedia: Readonly<Record<string, LotMedia>>;
  resolved: readonly ResolvedLot[];
  rules: AuctionRules;
  purseRemaining: number | null;
  squadSize: number;
}) {
  const money = useMoney();
  const labelOf = useMemo(() => roleLabeller(roles), [roles]);
  const name = outcome.playerName ?? outcome.lotNumber;
  const role = resolved.find((row) => row.lotId === outcome.lotId)?.role ?? null;
  const upTo =
    purseRemaining === null
      ? null
      : Number(
          maxAffordableBid({
            purseRemaining,
            squadSize,
            squadMin: rules.squadMin,
            minPossiblePrice: rules.minPossiblePrice,
          }),
        );
  const stillToBuy = Math.max(0, rules.squadMin - squadSize);
  return (
    <section
      key={ceremonyKey}
      className="owner-won"
      data-testid="ceremony"
      data-phase="sold"
      data-mine="true"
      aria-labelledby="owner-won-title"
    >
      <div className="owner-won-celebration" aria-hidden>
        <span className="owner-won-glow" />
        <GoldDrift className="owner-won-drift" />
      </div>
      <LotCard
        className="owner-won-card"
        name={name}
        seed={lotSeed(outcome.lotId, lotMedia)}
        photoUrl={media?.photoUrl ?? null}
        roleLabel={role === null ? null : labelOf(role)}
        kicker={outcome.lotNumber}
        stamp={<SoldStamp tone="sold" size="lg" />}
      />
      <div className="owner-won-words">
        <p className="owner-won-kicker">
          <IconTrophy size={18} weight="fill" />
          It&apos;s yours
        </p>
        <h2 className="owner-won-title" id="owner-won-title" data-testid="owner-won-title">
          You won {name}
        </h2>
        <p className="owner-won-price">
          for <b>{outcome.amount === null ? "—" : money.ledger(outcome.amount)}</b> · squad now{" "}
          {squadSize} of {rules.squadMax}
        </p>
      </div>
      <dl className="owner-won-figures">
        <div>
          <dt>Purse left</dt>
          <dd>{purseRemaining === null ? "—" : money.ledger(purseRemaining)}</dd>
        </div>
        <div>
          <dt>Can go up to</dt>
          <dd>{upTo === null ? "—" : money.ledger(upTo)}</dd>
        </div>
        <div>
          <dt>Still to buy</dt>
          <dd>{stillToBuy}</dd>
        </div>
      </dl>
    </section>
  );
}
