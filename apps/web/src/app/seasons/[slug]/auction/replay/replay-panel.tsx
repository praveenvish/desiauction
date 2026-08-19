"use client";

import {
  buildAuctionSnapshot,
  formatPaiseINR,
  paise,
  replayAuction,
  serializeSnapshot,
  type AuctionSnapshot,
  type CurrentLotBids,
} from "@desiauction/core";
import { Badge, Card } from "@desiauction/ui";
import { useEffect, useMemo, useState } from "react";

import type { ReplayViewerData } from "../../../../../server/auction/conduct-actions";
import { formatTime } from "../../../../../lib/format-date";

// THE REPLAY VIEWER (M-IP4-3). The founder scrubs through the immutable event
// log; every frame is core's pure fold of events[0..n] — the EXACT reducer the
// engine, recovery and the watchdog run. The final frame's canonical bytes are
// compared against the engine's live snapshot: equality is shown, not claimed.

/**
 * The current lot's bid history derived purely from the events — EVERY
 * accepted bid ever placed on the lot in seq order, exactly like the engine's
 * bids-table query (voided-but-visible bids stay; rounds never erase history).
 */
function bidsFromEvents(
  events: ReplayViewerData["events"],
  uptoSeq: number,
  lotId: string,
): CurrentLotBids {
  const bids: { bidId: string; paddleId: string; amount: number }[] = [];
  for (const event of events) {
    if (event.seq > uptoSeq) {
      break;
    }
    if (event.type === "BidAccepted" && event.payload["lotId"] === lotId) {
      const bidId = event.payload["bidId"];
      const paddleId = event.payload["paddleId"];
      const amount = event.payload["amount"];
      if (typeof bidId === "string" && typeof paddleId === "string" && typeof amount === "number") {
        bids.push({ bidId, paddleId, amount });
      }
    }
  }
  return { lotId, bids };
}

export function ReplayPanel({ data }: { data: ReplayViewerData }) {
  const [step, setStep] = useState(data.events.length);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const frame = useMemo(() => {
    const slice = data.events.slice(0, step);
    const started = performance.now();
    const replay = replayAuction(slice);
    if (!replay.ok) {
      return { ok: false as const, reason: replay.reason, atSeq: replay.atSeq, foldMs: 0 };
    }
    const onBlock = Object.entries(replay.projection.lots).find(
      ([, lot]) => lot.status === "on_block" || lot.status === "closing_soon",
    );
    const lotBids = onBlock !== undefined ? bidsFromEvents(data.events, step, onBlock[0]) : null;
    const snapshot = buildAuctionSnapshot(replay.projection, data.refs, lotBids);
    return {
      ok: true as const,
      snapshot,
      serialized: serializeSnapshot(snapshot),
      foldMs: performance.now() - started,
    };
  }, [data, step]);

  const event = step > 0 ? data.events[step - 1] : undefined;
  const converged =
    frame.ok && step === data.events.length && data.engineSerialized !== null
      ? frame.serialized === data.engineSerialized
      : null;

  return (
    <div
      className="competitions-stack"
      data-testid="replay-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <Card>
        <div className="replay-controls">
          <span className="replay-seq" data-testid="replay-position">
            {step}/{data.events.length}
          </span>
          <input
            type="range"
            className="replay-slider"
            min={0}
            max={data.events.length}
            value={step}
            aria-label="Replay position"
            onChange={(changeEvent) => {
              setStep(Number(changeEvent.target.value));
            }}
            data-testid="replay-slider"
          />
          {frame.ok ? (
            <span className="competitions-hint" data-testid="replay-fold-time">
              fold {frame.foldMs.toFixed(1)} ms
            </span>
          ) : null}
        </div>
        <p className="competitions-hint" data-testid="replay-event">
          {event !== undefined
            ? `#${String(event.seq)} · ${event.type} · ${formatTime(event.atMs)}`
            : "Before the first event — the initial scheduled state."}
        </p>
        {converged !== null ? (
          <p data-testid="replay-convergence">
            <Badge tone={converged ? "success" : "danger"}>
              {converged
                ? "identical bytes — the fold matches the live engine snapshot"
                : "DIVERGED from the live engine snapshot"}
            </Badge>
          </p>
        ) : null}
      </Card>

      {frame.ok ? (
        <ReplayFrame snapshot={frame.snapshot} />
      ) : (
        <Card>
          <p data-testid="replay-failed">
            Replay failed closed at seq {frame.atSeq}: {frame.reason} — the log needs forensics,
            never an override.
          </p>
        </Card>
      )}
    </div>
  );
}

const STATUS_TONE = {
  scheduled: "info",
  live: "success",
  paused: "warning",
  completed: "neutral",
  reconciled: "neutral",
  abandoned: "danger",
} as const;

function ReplayFrame({ snapshot }: { snapshot: AuctionSnapshot }) {
  return (
    <div className="cockpit-grid">
      <Card data-testid="replay-frame">
        <div className="competition-head">
          <h2>State at this moment</h2>
          <Badge tone={STATUS_TONE[snapshot.auctionStatus]} data-testid="replay-status">
            {snapshot.auctionStatus}
          </Badge>
        </div>
        <p className="competitions-hint">
          {snapshot.lotsResolved}/{snapshot.lotsTotal} lots resolved · v{snapshot.version}
        </p>
        {snapshot.currentLot !== null ? (
          <>
            <p className="registration-name" data-testid="replay-lot">
              {snapshot.currentLot.lotNumber} · {snapshot.currentLot.playerName ?? "Unnamed"} ·{" "}
              {snapshot.currentLot.status.replace(/_/g, " ")}
            </p>
            <p data-testid="replay-leading">
              {snapshot.currentLot.currentBid !== null
                ? `Leading: ${formatPaiseINR(paise(snapshot.currentLot.currentBid.amount))} — ${snapshot.currentLot.currentBid.teamName}`
                : "No bids yet"}
            </p>
            <ol className="timeline">
              {[...snapshot.currentLot.bidHistory].reverse().map((entry) => (
                <li key={entry.bidId}>
                  <Badge tone="neutral">{entry.paddleNumber}</Badge>
                  <span>{entry.teamName}</span>
                  <span className="timeline-at">{formatPaiseINR(paise(entry.amount))}</span>
                </li>
              ))}
            </ol>
          </>
        ) : snapshot.lastOutcome !== null ? (
          <p data-testid="replay-outcome">
            {snapshot.lastOutcome.kind.toUpperCase()} — {snapshot.lastOutcome.lotNumber}{" "}
            {snapshot.lastOutcome.playerName ?? ""}
            {snapshot.lastOutcome.amount !== null
              ? ` at ${formatPaiseINR(paise(snapshot.lastOutcome.amount))}`
              : ""}
          </p>
        ) : (
          <p className="competitions-hint">No lot on the block.</p>
        )}
      </Card>
      <Card>
        <h2>Purses</h2>
        <ul className="conflict-list">
          {snapshot.paddles.map((paddle) => (
            <li key={paddle.paddleId}>
              <Badge tone={paddle.released ? "neutral" : "info"}>{paddle.paddleNumber}</Badge>
              <span>{paddle.teamName}</span>
              <span className="registration-phone">
                {paddle.purseRemaining === null
                  ? "purse sealed"
                  : `${formatPaiseINR(paise(paddle.purseRemaining))} left`}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
