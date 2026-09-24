"use client";

import {
  buildAuctionSnapshot,
  replayAuction,
  serializeSnapshot,
  type AuctionSnapshot,
  type CurrentLotBids,
} from "@desiauction/core";
import { Badge, Card, PlayerImage } from "@desiauction/ui";
import { useMemo, useState } from "react";

import type { ReplayViewerData } from "../../../../../server/auction/conduct-actions";
import { formatTime } from "../../../../../lib/format-date";
import { lotSeed } from "../../../../../lib/player-seed";
import { useHydrated } from "../../../../../lib/use-hydrated";
import { useMoney } from "../../../../../components/money-unit";

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
  const hydrated = useHydrated();

  const frame = useMemo(() => {
    const slice = data.events.slice(0, step);
    // Measuring the fold IS the point of this viewer, and the figure is only
    // rendered once hydrated (see HYDRATION below), so the server and client
    // never have to agree on it.
    // eslint-disable-next-line react-hooks/purity
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
      // eslint-disable-next-line react-hooks/purity -- see `started` above.
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
          {/* HYDRATION. `foldMs` comes from performance.now() inside the useMemo
              above, which runs on the server AND on the client — two different
              numbers for the same render, which is a hydration mismatch and made
              React throw away and rebuild this subtree on every load. The
              component already tracks `hydrated` for exactly this; the timing
              readout simply was not behind it. It is a diagnostic, so waiting a
              tick for it costs nothing. */}
          {frame.ok && hydrated ? (
            <span className="competitions-hint" data-testid="replay-fold-time">
              rebuilt in {frame.foldMs.toFixed(1)} ms
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
                ? "matches the live engine snapshot, byte for byte"
                : "DIVERGED from the live engine snapshot"}
            </Badge>
          </p>
        ) : null}
      </Card>

      {frame.ok ? (
        <ReplayFrame snapshot={frame.snapshot} lotMedia={data.lotMedia} />
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

function ReplayFrame({
  snapshot,
  lotMedia,
}: {
  snapshot: AuctionSnapshot;
  lotMedia: ReplayViewerData["lotMedia"];
}) {
  const money = useMoney();
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
            <div className="replay-subject">
              <PlayerImage
                name={snapshot.currentLot.playerName ?? "Unnamed"}
                seed={lotSeed(snapshot.currentLot.lotId, lotMedia)}
                src={lotMedia[snapshot.currentLot.lotId]?.photoUrl}
                size="md"
                shape="round"
                decorative
              />
              <p className="registration-name" data-testid="replay-lot">
                {snapshot.currentLot.lotNumber} · {snapshot.currentLot.playerName ?? "Unnamed"} ·{" "}
                {snapshot.currentLot.status.replace(/_/g, " ")}
              </p>
            </div>
            <p data-testid="replay-leading">
              {snapshot.currentLot.currentBid !== null
                ? `Leading: ${money.ledger(snapshot.currentLot.currentBid.amount)} — ${snapshot.currentLot.currentBid.teamName}`
                : "No bids yet"}
            </p>
            <ol className="timeline">
              {[...snapshot.currentLot.bidHistory].reverse().map((entry) => (
                <li key={entry.bidId}>
                  <Badge tone="neutral">{entry.paddleNumber}</Badge>
                  <span>{entry.teamName}</span>
                  <span className="timeline-at">{money.ledger(entry.amount)}</span>
                </li>
              ))}
            </ol>
          </>
        ) : snapshot.lastOutcome !== null ? (
          <div className="replay-subject">
            <PlayerImage
              name={snapshot.lastOutcome.playerName ?? snapshot.lastOutcome.lotNumber}
              seed={lotSeed(snapshot.lastOutcome.lotId, lotMedia)}
              src={lotMedia[snapshot.lastOutcome.lotId]?.photoUrl}
              size="md"
              shape="round"
              decorative
            />
            <p data-testid="replay-outcome">
              {snapshot.lastOutcome.kind.toUpperCase()} — {snapshot.lastOutcome.lotNumber}{" "}
              {snapshot.lastOutcome.playerName ?? ""}
              {snapshot.lastOutcome.amount !== null
                ? ` at ${money.ledger(snapshot.lastOutcome.amount)}`
                : ""}
            </p>
          </div>
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
                  : `${money.ledger(paddle.purseRemaining)} left`}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
