"use client";

import {
  buildAuctionSnapshot,
  replayAuction,
  serializeSnapshot,
  type AuctionSnapshot,
  type CurrentLotBids,
} from "@desiauction/core";
import {
  Badge,
  Card,
  IconAlert,
  IconChevronLeft,
  IconChevronRight,
  IconPause,
  IconPlay,
  IconShieldCheck,
  IconSkipBack,
  IconSkipForward,
  PlayerImage,
} from "@desiauction/ui";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { ReplayViewerData } from "../../../../../server/auction/conduct-actions";
import { formatTime } from "../../../../../lib/format-date";
import { lotSeed } from "../../../../../lib/player-seed";
import { useHydrated } from "../../../../../lib/use-hydrated";
import { useMoney } from "../../../../../components/money-unit";
import { eventLabel } from "../auction-bits";

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
  const money = useMoney();

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
  const total = data.events.length;

  /**
   * THE MARKERS. Every hammer on the night, as a tick on the scrubber: gold
   * for a sale, grey for a pass. Positions are percentages of the log, so the
   * ticks sit where the slider's thumb lands for that event.
   */
  const markers = useMemo(
    () =>
      data.events.flatMap((entry, index) =>
        entry.type === "LotSold" || entry.type === "LotUnsold"
          ? [{ at: index + 1, sold: entry.type === "LotSold" }]
          : [],
      ),
    [data.events],
  );
  /**
   * THE HAMMER HISTORY: every sale and pass up to this moment, newest first,
   * named from the reference data. A row is a door — it moves the scrubber to
   * that hammer. Undone sales stay listed: the replay shows the record.
   */
  const hammers = useMemo(() => {
    const rows: {
      at: number;
      lotId: string;
      sold: boolean;
      lotNumber: string;
      playerName: string | null;
      teamName: string | null;
      amount: number | null;
    }[] = [];
    for (const [index, entry] of data.events.entries()) {
      if (index >= step) {
        break;
      }
      if (entry.type !== "LotSold" && entry.type !== "LotUnsold") {
        continue;
      }
      const lotId = typeof entry.payload["lotId"] === "string" ? entry.payload["lotId"] : "";
      const paddleId =
        typeof entry.payload["paddleId"] === "string" ? entry.payload["paddleId"] : null;
      const amount = typeof entry.payload["amount"] === "number" ? entry.payload["amount"] : null;
      const ref = data.refs.lots[lotId];
      rows.push({
        at: index + 1,
        lotId,
        sold: entry.type === "LotSold",
        lotNumber: ref?.lotNumber ?? "—",
        playerName: ref?.playerName ?? null,
        teamName: paddleId !== null ? (data.refs.paddles[paddleId]?.teamName ?? null) : null,
        amount,
      });
    }
    return rows.reverse();
  }, [data, step]);

  /** The resolutions only — "next sale" jumps between these, not 797 raw events. */
  const hammerSteps = markers.map((marker) => marker.at);

  /** PLAYBACK: a timer that walks the log forward. Pure presentation. */
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
  useEffect(() => {
    if (!playing) {
      return;
    }
    const timer = window.setInterval(() => {
      setStep((current) => {
        if (current >= total) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 400 / speed);
    return () => {
      window.clearInterval(timer);
    };
  }, [playing, speed, total]);

  const go = (next: number) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(total, next)));
  };
  const prevHammer = [...hammerSteps].reverse().find((at) => at < step) ?? 0;
  const nextHammer = hammerSteps.find((at) => at > step) ?? total;

  return (
    <div
      className="competitions-stack"
      data-testid="replay-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <Card className="replay-transport">
        <div className="replay-transport-row">
          <div className="replay-buttons" role="group" aria-label="Playback">
            <button
              type="button"
              className="replay-btn"
              onClick={() => {
                go(0);
              }}
              disabled={step === 0}
              aria-label="Back to the start"
            >
              <IconSkipBack size={16} weight="fill" />
            </button>
            <button
              type="button"
              className="replay-btn"
              onClick={() => {
                go(prevHammer);
              }}
              disabled={step === 0}
              aria-label="Previous result"
            >
              <IconChevronLeft size={16} weight="bold" />
            </button>
            <button
              type="button"
              className="replay-btn replay-btn--play"
              onClick={() => {
                if (!playing && step >= total) {
                  setStep(0);
                }
                setPlaying((value) => !value);
              }}
              aria-label={playing ? "Pause" : "Play"}
              aria-pressed={playing}
            >
              {playing ? (
                <IconPause size={20} weight="fill" />
              ) : (
                <IconPlay size={20} weight="fill" />
              )}
            </button>
            <button
              type="button"
              className="replay-btn"
              onClick={() => {
                go(nextHammer);
              }}
              disabled={step >= total}
              aria-label="Next result"
            >
              <IconChevronRight size={16} weight="bold" />
            </button>
            <button
              type="button"
              className="replay-btn"
              onClick={() => {
                go(total);
              }}
              disabled={step >= total}
              aria-label="Jump to the end"
            >
              <IconSkipForward size={16} weight="fill" />
            </button>
          </div>
          <div className="replay-now">
            <span className="replay-seq" data-testid="replay-position">
              {step}/{total}
            </span>
            {/* HYDRATION. `foldMs` comes from performance.now() inside the
                useMemo above, which runs on the server AND on the client — two
                different numbers for the same render, so the timing waits for
                `hydrated` and lives on hover. The event type is spoken in words
                ("Auction closed"), with the engine's own name on hover too. */}
            <p
              className="replay-event"
              data-testid="replay-event"
              title={frame.ok && hydrated ? `Rebuilt in ${frame.foldMs.toFixed(1)} ms` : undefined}
            >
              {event !== undefined ? (
                <>
                  <span title={event.type}>{eventLabel(event.type)}</span>
                  <span className="replay-event-meta">
                    #{String(event.seq)} · {formatTime(event.atMs)}
                  </span>
                </>
              ) : (
                "Before the first event — the initial scheduled state."
              )}
            </p>
          </div>
          <div className="replay-speed" role="group" aria-label="Playback speed">
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                className="replay-speed-btn"
                aria-pressed={speed === value}
                onClick={() => {
                  setSpeed(value);
                }}
              >
                {value}×
              </button>
            ))}
          </div>
        </div>
        <div className="replay-track">
          <input
            type="range"
            className="replay-slider"
            min={0}
            max={total}
            value={step}
            aria-label="Replay position"
            onChange={(changeEvent) => {
              setPlaying(false);
              setStep(Number(changeEvent.target.value));
            }}
            data-testid="replay-slider"
          />
          <span className="replay-ticks" aria-hidden>
            {markers.map((marker) => (
              <span
                key={marker.at}
                className="replay-tick"
                data-sold={marker.sold ? "true" : undefined}
                style={{ left: `${String((marker.at / Math.max(total, 1)) * 100)}%` }}
              />
            ))}
          </span>
        </div>
        <div className="replay-foot">
          <span className="replay-legend" aria-hidden>
            <span className="replay-tick replay-tick--key" data-sold="true" /> Sold
            <span className="replay-tick replay-tick--key" /> Unsold
          </span>
          {converged !== null ? (
            /* The proof, said once and briefly — it used to be an all-caps
               badge that ran past a phone's edge and scrolled the page. */
            <p
              className="replay-verified"
              data-testid="replay-convergence"
              data-converged={converged ? "true" : "false"}
            >
              {converged ? <IconShieldCheck size={16} /> : <IconAlert size={16} />}
              {converged
                ? "Verified — matches the live engine snapshot"
                : "DIVERGED from the live engine snapshot"}
            </p>
          ) : null}
        </div>
      </Card>

      {frame.ok ? (
        <ReplayFrame
          snapshot={frame.snapshot}
          lotMedia={data.lotMedia}
          purse={data.refs.pursePerTeam}
          history={
            <Card className="replay-history">
              <div className="competition-head">
                <h2>Hammer history</h2>
                {/* Counted per LOT, by its latest hammer: a lot passed in round
                    one and sold in round two is one sale, not a sale and a pass
                    ("30 sold · 18 passed" beside "7 unsold", round 2). */}
                <span className="competitions-hint">
                  {(() => {
                    const latest = new Map<string, boolean>();
                    for (const row of hammers) {
                      if (!latest.has(row.lotId)) latest.set(row.lotId, row.sold);
                    }
                    const sold = [...latest.values()].filter(Boolean).length;
                    return `${String(sold)} sold · ${String(latest.size - sold)} unsold`;
                  })()}
                </span>
              </div>
              {hammers.length === 0 ? (
                <p className="competitions-hint">No hammer has fallen yet at this moment.</p>
              ) : (
                <ol className="replay-history-list">
                  {hammers.map((row) => (
                    <li key={row.at}>
                      <button
                        type="button"
                        className="replay-history-row"
                        aria-current={row.at === step ? "step" : undefined}
                        onClick={() => {
                          go(row.at);
                        }}
                      >
                        <PlayerImage
                          name={row.playerName ?? row.lotNumber}
                          seed={lotSeed(row.lotId, data.lotMedia)}
                          src={data.lotMedia[row.lotId]?.photoUrl}
                          size="sm"
                          shape="round"
                          decorative
                        />
                        <span className="replay-history-who">
                          <span className="replay-history-name">{row.playerName ?? "Unnamed"}</span>
                          <span className="replay-history-meta">
                            {row.lotNumber}
                            {row.teamName !== null ? ` · ${row.teamName}` : ""}
                          </span>
                        </span>
                        <span
                          className="replay-history-result"
                          data-sold={row.sold ? "true" : undefined}
                        >
                          {row.sold && row.amount !== null ? money.ledger(row.amount) : "Unsold"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          }
        />
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

const SPEEDS = [1, 4, 16] as const;

const STATUS_TONE = {
  scheduled: "neutral",
  live: "success",
  paused: "warning",
  completed: "success",
  reconciled: "success",
  abandoned: "danger",
} as const;

function ReplayFrame({
  snapshot,
  lotMedia,
  purse,
  history,
}: {
  snapshot: AuctionSnapshot;
  lotMedia: ReplayViewerData["lotMedia"];
  /** Every team's starting purse — the scale for the spend bars. */
  purse: number;
  /** The hammer history, stacked under the moment. */
  history: ReactNode;
}) {
  const money = useMoney();
  const progress =
    snapshot.lotsTotal > 0 ? Math.round((snapshot.lotsResolved / snapshot.lotsTotal) * 100) : 0;
  return (
    <div className="replay-grid">
      <div className="replay-col">
        <Card data-testid="replay-frame" className="replay-stage">
          <div className="competition-head">
            <h2>State at this moment</h2>
            <Badge tone={STATUS_TONE[snapshot.auctionStatus]} data-testid="replay-status">
              {snapshot.auctionStatus}
            </Badge>
          </div>
          <div className="replay-progress">
            <span className="replay-progress-bar" aria-hidden>
              <span style={{ width: `${String(progress)}%` }} />
            </span>
            <span className="replay-progress-text">
              <b>
                {snapshot.lotsResolved}/{snapshot.lotsTotal}
              </b>{" "}
              lots resolved
            </span>
          </div>
          {snapshot.currentLot !== null ? (
            <div className="replay-now-card">
              <div className="replay-subject">
                <PlayerImage
                  name={snapshot.currentLot.playerName ?? "Unnamed"}
                  seed={lotSeed(snapshot.currentLot.lotId, lotMedia)}
                  src={lotMedia[snapshot.currentLot.lotId]?.photoUrl}
                  size="lg"
                  shape="round"
                  decorative
                />
                <div className="replay-subject-text">
                  <span className="replay-kicker">On the block</span>
                  <p className="replay-subject-name" data-testid="replay-lot">
                    {snapshot.currentLot.lotNumber} · {snapshot.currentLot.playerName ?? "Unnamed"}{" "}
                    · {snapshot.currentLot.status.replace(/_/g, " ")}
                  </p>
                  <p className="replay-subject-figure" data-testid="replay-leading">
                    {snapshot.currentLot.currentBid !== null
                      ? `Leading: ${money.ledger(snapshot.currentLot.currentBid.amount)} — ${snapshot.currentLot.currentBid.teamName}`
                      : "No bids yet"}
                  </p>
                </div>
              </div>
              {snapshot.currentLot.bidHistory.length > 0 ? (
                <ol className="replay-bids">
                  {[...snapshot.currentLot.bidHistory].reverse().map((entry) => (
                    <li key={entry.bidId}>
                      <span className="replay-paddle">{entry.paddleNumber}</span>
                      <span className="replay-bid-team">{entry.teamName}</span>
                      <span className="replay-bid-amount">{money.ledger(entry.amount)}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : snapshot.lastOutcome !== null ? (
            <div className="replay-now-card" data-kind={snapshot.lastOutcome.kind}>
              <div className="replay-subject">
                <PlayerImage
                  name={snapshot.lastOutcome.playerName ?? snapshot.lastOutcome.lotNumber}
                  seed={lotSeed(snapshot.lastOutcome.lotId, lotMedia)}
                  src={lotMedia[snapshot.lastOutcome.lotId]?.photoUrl}
                  size="lg"
                  shape="round"
                  decorative
                />
                <div className="replay-subject-text">
                  <span className="replay-kicker">Last result</span>
                  <p className="replay-subject-name" data-testid="replay-outcome">
                    {snapshot.lastOutcome.kind.toUpperCase()} — {snapshot.lastOutcome.lotNumber}{" "}
                    {snapshot.lastOutcome.playerName ?? ""}
                    {snapshot.lastOutcome.amount !== null
                      ? ` at ${money.ledger(snapshot.lastOutcome.amount)}`
                      : ""}
                  </p>
                  {snapshot.lastOutcome.teamName !== null ? (
                    <p className="replay-subject-figure">to {snapshot.lastOutcome.teamName}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <p className="competitions-hint">No lot on the block.</p>
          )}
        </Card>
        {history}
      </div>
      <Card className="replay-purses">
        <h2>Purses</h2>
        <ul className="replay-purse-list">
          {snapshot.paddles.map((paddle) => {
            const left = paddle.purseRemaining;
            const used =
              left === null || purse <= 0
                ? null
                : Math.min(100, Math.max(0, ((purse - left) / purse) * 100));
            return (
              <li key={paddle.paddleId} data-released={paddle.released ? "true" : undefined}>
                <span className="replay-purse-head">
                  <span className="replay-paddle">{paddle.paddleNumber}</span>
                  <span className="replay-purse-team">{paddle.teamName}</span>
                  <span className="replay-purse-left">
                    {left === null ? "purse sealed" : `${money.ledger(left)} left`}
                  </span>
                </span>
                {used !== null ? (
                  <span className="replay-purse-bar" aria-hidden>
                    <span style={{ width: `${used.toFixed(1)}%` }} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
