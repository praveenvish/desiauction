"use client";

import { formatPaiseINR, paise, type AuctionSnapshot, type CeremonyState } from "@desiauction/core";
import { useEffect, useRef, useState } from "react";

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

function moneyOf(amount: number | null): string {
  return amount === null ? "" : formatPaiseINR(paise(amount));
}

/**
 * The ceremony in a sentence. Returns null for moments not worth speaking —
 * `bid` fires on every raise and would turn the region into the ticker the
 * countdown was banned for being. (The leading bid is already announced by the
 * status ribbon, which is a live region and carries it.)
 */
function ceremonyLine(ceremony: CeremonyState, snapshot: AuctionSnapshot): string | null {
  const outcome = snapshot.lastOutcome;
  const lot = snapshot.currentLot;
  const who = outcome?.playerName ?? outcome?.lotNumber ?? "the lot";
  switch (ceremony.phase) {
    case "sold":
      return `Sold. ${who} to ${outcome?.teamName ?? "an unnamed team"} for ${moneyOf(outcome?.amount ?? null)}.`;
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
        : `On the block: ${lot.playerName ?? lot.lotNumber}, ${lot.role.replace(/_/g, " ")}, base ${formatPaiseINR(paise(lot.basePrice))}.`;
    case "extension":
      return "Time extended — a bid landed in the final seconds.";
    default:
      return null;
  }
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
  const [moment, setMoment] = useState<{ key: string; text: string } | null>(null);
  const spokenKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (snapshot === null || ceremony.key === spokenKeyRef.current) {
      return;
    }
    const text = ceremonyLine(ceremony, snapshot);
    spokenKeyRef.current = ceremony.key;
    if (text !== null) {
      setMoment({ key: ceremony.key, text });
    }
  }, [ceremony, snapshot]);

  // The clock, at thresholds. The lot id resets the ladder so every lot gets
  // its own thirty-second and ten-second call.
  const [clock, setClock] = useState<{ key: string; text: string } | null>(null);
  const lotId = snapshot?.currentLot?.lotId ?? null;
  const crossedRef = useRef<{ lotId: string | null; at: number }>({ lotId: null, at: Infinity });
  useEffect(() => {
    if (crossedRef.current.lotId !== lotId) {
      crossedRef.current = { lotId, at: Infinity };
    }
    if (lotId === null || remainingMs === null) {
      /*
       * A resolved lot has no clock. Returning without clearing left the last
       * call — "10 seconds left." — standing in the live region under a card
       * that had already said SOLD, so the running commentary contradicted the
       * result beside it and a screen reader kept stale urgency on the page.
       */
      setClock(null);
      return;
    }
    const seconds = Math.ceil(remainingMs / 1000);
    if (seconds <= 0) {
      if (crossedRef.current.at > 0) {
        crossedRef.current = { lotId, at: 0 };
        setClock({ key: `${lotId}-0`, text: "Time. The lot is with the auctioneer." });
      }
      return;
    }
    for (const threshold of THRESHOLDS) {
      if (seconds <= threshold && crossedRef.current.at > threshold) {
        crossedRef.current = { lotId, at: threshold };
        setClock({
          key: `${lotId}-${String(threshold)}`,
          text: `${String(threshold)} seconds left.`,
        });
        return;
      }
    }
  }, [lotId, remainingMs]);

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
