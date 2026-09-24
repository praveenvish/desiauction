"use client";

import type { AuctionSnapshot, CeremonyState } from "@desiauction/core";
import { useState } from "react";

import { useMoney } from "../../../../components/money-unit";
import type { MoneyFormat } from "../../../../lib/money";

// THE ANNOUNCER — the auction night as spoken word.
//
// Before this there were exactly two live regions across the cockpit and the
// bidder's view: the status ribbon and the toast. The CEREMONY was in neither.
// Measured on the sold splash: `{live: null, role: null, parentLive:
// "NOT-in-live-region"}`. So a blind auctioneer was never told a player sold,
// and a blind bidder was never told the lot they were bidding on had gone.
//
// The countdown is correctly `aria-hidden` — a region that re-announces itself
// every second announces nothing else ever again — but nothing replaced it, so
// the entire time pressure of the product was invisible to assistive tech.
// This announces at THRESHOLDS only.
//
// Two regions, because they answer different questions and must not overwrite
// each other mid-sentence: what just happened, and how long is left.

/** Seconds at which the clock is worth interrupting for. Descending. */
const THRESHOLDS = [30, 10] as const;

function moneyOf(amount: number | null, money: MoneyFormat): string {
  return amount === null ? "" : money.ledger(amount);
}

/**
 * The ceremony in a sentence. Returns null for moments not worth speaking —
 * `bid` fires on every raise and would turn the region into the ticker the
 * countdown was banned for being. (The leading bid is already announced by the
 * status ribbon, which is a live region and carries it.)
 */
export function ceremonyLine(
  ceremony: CeremonyState,
  snapshot: AuctionSnapshot,
  money: MoneyFormat,
): string | null {
  const outcome = snapshot.lastOutcome;
  const lot = snapshot.currentLot;
  const who = outcome?.playerName ?? outcome?.lotNumber ?? "the lot";
  switch (ceremony.phase) {
    case "sold":
      return `Sold. ${who} to ${outcome?.teamName ?? "an unnamed team"} for ${moneyOf(outcome?.amount ?? null, money)}.`;
    case "unsold":
      return `Unsold. ${who} drew no bid.`;
    case "withdrawn":
      return `Withdrawn. ${who} is out of the auction.`;
    case "reopened":
      return `Undone. ${who} is back, and the clock is held until the auctioneer restarts it.`;
    case "hold":
      return `Lot frozen. ${who} is paused for the auctioneer to resolve.`;
    case "paused":
      return "Auction paused. The clock is stopped. Bidding resumes when the auctioneer restarts it.";
    case "completed":
      return `Auction complete. ${String(snapshot.lotsResolved)} of ${String(snapshot.lotsTotal)} lots resolved.`;
    case "recovered":
      return "Engine recovered. State verified.";
    case "opening":
      return lot === null
        ? null
        : `On the block: ${lot.playerName ?? lot.lotNumber}, ${lot.role.replace(/_/g, " ")}, base ${money.ledger(lot.basePrice)}.`;
    case "extension":
      return "Time extended — a bid landed in the final seconds.";
    default:
      return null;
  }
}

interface Announcement {
  key: string;
  text: string;
}

interface SpokenMoment {
  /** The ceremony key last considered — spoken or deliberately silent. */
  key: string | null;
  moment: Announcement | null;
}

/** Where one lot's clock is on the 30s → 10s → time ladder, and what it last said. */
export interface ClockLadder {
  lotId: string | null;
  /** The lowest threshold already announced for this lot (Infinity: none yet). */
  at: number;
  call: Announcement | null;
}

export const CLOCK_LADDER_START: ClockLadder = { lotId: null, at: Infinity, call: null };

/**
 * The clock region's next state, or `prev` itself when nothing changes — the
 * identity is what lets the component adjust state during render without
 * looping.
 *
 * When one tick crosses two thresholds at once (a late join, a paused tab
 * catching up) it announces the more urgent one: "30 seconds left" said with
 * five seconds on the clock is wrong, not merely late.
 */
export function advanceClockLadder(
  prev: ClockLadder,
  lotId: string | null,
  remainingMs: number | null,
): ClockLadder {
  const at = prev.lotId === lotId ? prev.at : Infinity;
  const unchanged = (): ClockLadder =>
    prev.lotId === lotId && prev.at === at ? prev : { ...prev, lotId, at };
  if (lotId === null || remainingMs === null) {
    /*
     * A resolved lot has no clock. Leaving the last call — "10 seconds left." —
     * standing in the live region under a card that had already said SOLD made
     * the running commentary contradict the result beside it, and a screen
     * reader kept stale urgency on the page.
     */
    return prev.call === null && prev.lotId === lotId && prev.at === at
      ? prev
      : { lotId, at, call: null };
  }
  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds <= 0) {
    return at > 0
      ? { lotId, at: 0, call: { key: `${lotId}-0`, text: "Time. The lot is with the auctioneer." } }
      : unchanged();
  }
  let crossed: number | null = null;
  for (const threshold of THRESHOLDS) {
    if (seconds <= threshold && at > threshold) {
      crossed = crossed === null ? threshold : Math.min(crossed, threshold);
    }
  }
  if (crossed === null) {
    return unchanged();
  }
  return {
    lotId,
    at: crossed,
    call: { key: `${lotId}-${String(crossed)}`, text: `${String(crossed)} seconds left.` },
  };
}

export function AuctionAnnouncer({
  snapshot,
  ceremony,
  remainingMs,
}: {
  snapshot: AuctionSnapshot | null;
  ceremony: CeremonyState;
  remainingMs: number | null;
}) {
  // Each announcement is a NEW node (keyed), so an identical sentence twice
  // over — the same player undone and re-sold at the same price — is still two
  // announcements rather than one silent DOM no-op.
  //
  // Both regions are "previous prop" state, adjusted DURING render: a change
  // is spoken in the same commit that shows it. They used to be effects that
  // set state after the commit, which painted every moment twice — once
  // silent, once announced — and needed refs to remember what was spoken.
  const money = useMoney();
  const [spoken, setSpoken] = useState<SpokenMoment>({ key: null, moment: null });
  if (snapshot !== null && ceremony.key !== spoken.key) {
    const text = ceremonyLine(ceremony, snapshot, money);
    setSpoken({
      key: ceremony.key,
      moment: text === null ? spoken.moment : { key: ceremony.key, text },
    });
  }
  const moment = spoken.moment;

  // The clock, at thresholds. The lot id resets the ladder so every lot gets
  // its own thirty-second and ten-second call.
  const lotId = snapshot?.currentLot?.lotId ?? null;
  const [ladder, setLadder] = useState<ClockLadder>(CLOCK_LADDER_START);
  const nextLadder = advanceClockLadder(ladder, lotId, remainingMs);
  if (nextLadder !== ladder) {
    setLadder(nextLadder);
  }
  const clock = nextLadder.call;

  return (
    <>
      <div
        className="auction-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="ceremony-announcer"
      >
        {moment !== null ? <p key={moment.key}>{moment.text}</p> : null}
      </div>
      <div
        className="auction-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="clock-announcer"
      >
        {clock !== null ? <p key={clock.key}>{clock.text}</p> : null}
      </div>
    </>
  );
}
