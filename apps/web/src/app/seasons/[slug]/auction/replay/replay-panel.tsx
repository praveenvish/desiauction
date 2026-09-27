"use client";

import {
  buildAuctionSnapshot,
  replayAuction,
  serializeSnapshot,
  type AuctionSnapshot,
  type CurrentLotBids,
} from "@desiauction/core";
import {
  IconAlert,
  IconChevronLeft,
  IconChevronRight,
  IconPause,
  IconPlay,
  IconShieldCheck,
  IconSkipBack,
  IconSkipForward,
  PlayerImage,
  SoldStamp,
} from "@desiauction/ui";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { ReplayViewerData } from "../../../../../server/auction/conduct-actions";
import { formatTime } from "../../../../../lib/format-date";
import { lotSeed } from "../../../../../lib/player-seed";
import { useHydrated } from "../../../../../lib/use-hydrated";
import { useMoney } from "../../../../../components/money-unit";
import { LotCard, LotPrice } from "../lot-card";
import { PurseTeamCrest, type TeamIdentity } from "../purse-board";
import {
  bidsIn,
  chapterAt,
  chaptersOf,
  lotRowsAt,
  summaryOf,
  type Chapter,
  type WarPoint,
} from "./replay-model";

// THE REPLAY (2026-09-27) — the auction night, watched again.
//
// Every frame is still core's pure fold of events[0..n] — the EXACT reducer the
// engine, recovery and the watchdog run — and the final frame's canonical bytes
// are still compared against the engine's live snapshot, so equality is shown,
// not claimed. What changed is how the moment is DRAWN: the lot on the block as
// the live room's player card, its bidding as a line of team-coloured dots, the
// lots as a playlist, the teams in their own colours, and a player bar that
// steps lot by lot rather than event by event. It opens on the finished night.

const SPEEDS = [1, 4, 16] as const;

/** The current lot's bid history, from the events alone — the engine's own query, replayed. */
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
  const total = data.events.length;
  const [step, setStep] = useState(total);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
  const hydrated = useHydrated();
  const money = useMoney();

  const chapters = useMemo(() => chaptersOf(data.events), [data.events]);
  const lotOrder = useMemo(
    () =>
      Object.entries(data.refs.lots)
        .sort(([, a], [, b]) => a.seq - b.seq)
        .map(([lotId]) => lotId),
    [data.refs.lots],
  );
  const lotIndex = useMemo(() => {
    // "Lot 5 of 37" counts in the order lots came up on the night.
    const order = lotRowsAt(chapters, lotOrder, total).map((row) => row.lotId);
    return new Map(order.map((lotId, index) => [lotId, index + 1]));
  }, [chapters, lotOrder, total]);

  const frame = useMemo(() => {
    const slice = data.events.slice(0, step);
    // Measuring the fold IS the point of this viewer; the figure is shown only
    // once hydrated (on hover), so server and client never have to agree on it.
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

  const converged =
    frame.ok && step === total && data.engineSerialized !== null
      ? frame.serialized === data.engineSerialized
      : null;

  /** PLAYBACK: a timer that walks the log forward. Pure presentation. */
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
  const opens = chapters.map((chapter) => chapter.openAt);
  const prevLot = [...opens].reverse().find((at) => at < step) ?? 0;
  const nextLot = opens.find((at) => at > step) ?? total;

  const chapter = chapterAt(chapters, step);
  const event = step > 0 ? data.events[step - 1] : undefined;
  const openedAt = data.events.find((entry) => entry.type === "AuctionOpened")?.atMs ?? null;
  const minutesIn =
    event !== undefined && openedAt !== null
      ? Math.max(0, Math.floor((event.atMs - openedAt) / 60_000))
      : null;
  const finished =
    frame.ok &&
    step === total &&
    (frame.snapshot.auctionStatus === "completed" || frame.snapshot.auctionStatus === "reconciled");
  const summary = useMemo(
    () => summaryOf(data.events, chapters, lotOrder.length),
    [data.events, chapters, lotOrder.length],
  );
  const boughtNow = useMemo(
    () => summaryOf(data.events, chapters, lotOrder.length, step).bought,
    [data.events, chapters, lotOrder.length, step],
  );
  const rows = useMemo(() => lotRowsAt(chapters, lotOrder, step), [chapters, lotOrder, step]);

  const teamOfPaddle = (paddleId: string): TeamIdentity | undefined => {
    const teamId = data.refs.paddles[paddleId]?.teamId;
    return data.teams.find((team) => team.id === teamId);
  };
  const lotName = (lotId: string) => data.refs.lots[lotId]?.playerName ?? "Unnamed";
  const roleOf = (key: string | undefined) =>
    key === undefined ? null : (data.roles.find((role) => role.key === key)?.label ?? null);

  const decided = rows.filter((row) => row.state === "sold" || row.state === "unsold").length;

  const nowLabel = (() => {
    if (chapter === null) {
      return "Before the first lot";
    }
    const index = lotIndex.get(chapter.lotId) ?? 0;
    const name = lotName(chapter.lotId);
    const ended = chapter.endAt !== null && chapter.endAt <= step;
    if (finished) {
      return `The end — all ${String(lotOrder.length)} lots decided`;
    }
    if (!ended) {
      return `Lot ${String(index)} · ${name} — bidding`;
    }
    return chapter.result?.sold === true
      ? `Lot ${String(index)} · ${name} — sold to ${teamOfPaddle(chapter.result.paddleId)?.name ?? "a team"}`
      : `Lot ${String(index)} · ${name} — unsold`;
  })();

  return (
    <div className="rp" data-testid="replay-panel" data-hydrated={hydrated ? "true" : "false"}>
      <div className="rp-body">
        <LotList
          rows={rows}
          current={chapter?.lotId ?? null}
          decided={decided}
          total={lotOrder.length}
          name={lotName}
          lotNumber={(lotId) => data.refs.lots[lotId]?.lotNumber ?? "—"}
          team={teamOfPaddle}
          onJump={go}
          money={money.ledger}
        />

        <section className="rp-stage" aria-label="This moment">
          {!frame.ok ? (
            <p className="rp-failed" data-testid="replay-failed">
              Replay failed closed at seq {frame.atSeq}: {frame.reason} — the log needs forensics,
              never an override.
            </p>
          ) : finished ? (
            <NightSummary
              summary={summary}
              name={lotName}
              role={(lotId) => roleOf(data.refs.lots[lotId]?.role)}
              media={data.lotMedia}
              team={teamOfPaddle}
              money={money.ledger}
              onWatch={() => {
                setStep(0);
                setPlaying(true);
              }}
              onJump={go}
            />
          ) : chapter === null ? (
            <div className="rp-empty">
              <p>Before the first lot. Press play to watch the night from the start.</p>
            </div>
          ) : (
            <LotMoment
              chapter={chapter}
              step={step}
              snapshot={frame.snapshot}
              data={data}
              index={lotIndex.get(chapter.lotId) ?? 0}
              total={lotOrder.length}
              role={roleOf(data.refs.lots[chapter.lotId]?.role)}
              team={teamOfPaddle}
            />
          )}
        </section>

        {frame.ok ? (
          <TeamsNow
            snapshot={frame.snapshot}
            teams={data.teams}
            purse={data.refs.pursePerTeam}
            bought={boughtNow}
            money={money.ledger}
            slug={data.competition.slug}
          />
        ) : null}
      </div>

      {/* THE PLAYER BAR — lot by lot, with the whole night as chapters. */}
      <div className="rp-transport" role="group" aria-label="Replay controls">
        <div className="rp-chapters" aria-hidden>
          {chapters.map((entry) => (
            <span
              key={`${entry.lotId}-${String(entry.round)}`}
              className="rp-chapter"
              data-state={
                entry.openAt > step
                  ? "ahead"
                  : entry.endAt === null || entry.endAt > step
                    ? "now"
                    : entry.result?.sold === true
                      ? "sold"
                      : "unsold"
              }
              style={
                entry.result?.sold === true && entry.endAt !== null && entry.endAt <= step
                  ? {
                      ["--team" as string]:
                        teamOfPaddle(entry.result.paddleId)?.primaryColor ?? undefined,
                    }
                  : undefined
              }
            />
          ))}
        </div>
        <input
          type="range"
          className="rp-slider"
          min={0}
          max={total}
          value={step}
          aria-label="Replay position"
          aria-valuetext={nowLabel}
          onChange={(changeEvent) => {
            setPlaying(false);
            setStep(Number(changeEvent.target.value));
          }}
          data-testid="replay-slider"
        />
        <div className="rp-controls">
          <div className="rp-buttons">
            <button
              type="button"
              className="rp-btn rp-btn--edge"
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
              className="rp-btn"
              onClick={() => {
                go(prevLot);
              }}
              disabled={step === 0}
              aria-label="Previous lot"
            >
              <IconChevronLeft size={18} weight="bold" />
            </button>
            <button
              type="button"
              className="rp-btn rp-btn--play"
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
                <IconPause size={22} weight="fill" />
              ) : (
                <IconPlay size={22} weight="fill" />
              )}
            </button>
            <button
              type="button"
              className="rp-btn"
              onClick={() => {
                go(nextLot);
              }}
              disabled={step >= total}
              aria-label="Next lot"
            >
              <IconChevronRight size={18} weight="bold" />
            </button>
            <button
              type="button"
              className="rp-btn rp-btn--edge"
              onClick={() => {
                go(total);
              }}
              disabled={step >= total}
              aria-label="Jump to the end"
            >
              <IconSkipForward size={16} weight="fill" />
            </button>
          </div>
          <div className="rp-now">
            <p className="rp-now-title" data-testid="replay-event" aria-live="polite">
              {nowLabel}
            </p>
            <p
              className="rp-now-meta"
              title={frame.ok && hydrated ? `Rebuilt in ${frame.foldMs.toFixed(1)} ms` : undefined}
            >
              {event !== undefined ? formatTime(event.atMs) : "Before the night began"}
              {minutesIn !== null ? ` · ${String(minutesIn)} min in` : ""}
              <span className="rp-now-pos" data-testid="replay-position">
                {" "}
                · event {step} of {total}
              </span>
              {frame.ok ? (
                <span className="rp-status" data-testid="replay-status">
                  {frame.snapshot.auctionStatus}
                </span>
              ) : null}
            </p>
          </div>
          <div className="rp-speed" role="group" aria-label="Playback speed">
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                className="rp-speed-btn"
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
        {converged !== null ? (
          /* The proof, said once and briefly. */
          <p
            className="rp-verified"
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
    </div>
  );
}

/* ---- The lots, as a playlist -------------------------------------------- */

function LotList({
  rows,
  current,
  decided,
  total,
  name,
  lotNumber,
  team,
  onJump,
  money,
}: {
  rows: ReturnType<typeof lotRowsAt>;
  current: string | null;
  decided: number;
  total: number;
  name: (lotId: string) => string;
  lotNumber: (lotId: string) => string;
  team: (paddleId: string) => TeamIdentity | undefined;
  onJump: (step: number) => void;
  money: (amount: number) => string;
}) {
  return (
    <nav className="rp-lots" aria-label="Lots">
      <p className="rp-side-head">
        <strong>Lots</strong>
        <span>
          {decided} of {total} decided
        </span>
      </p>
      <ol className="rp-lot-list">
        {rows.map((row) => {
          const sold = row.result?.sold === true ? row.result : null;
          const buyer = sold !== null ? team(sold.paddleId) : undefined;
          return (
            <li key={row.lotId}>
              <button
                type="button"
                className="rp-lot"
                data-state={row.state}
                aria-current={row.lotId === current ? "true" : undefined}
                disabled={row.jumpTo === null}
                onClick={() => {
                  if (row.jumpTo !== null) onJump(row.jumpTo);
                }}
              >
                <span className="rp-lot-no">{lotNumber(row.lotId)}</span>
                <span className="rp-lot-name">{name(row.lotId)}</span>
                {row.state === "bidding" ? (
                  <span className="rp-lot-state">Bidding</span>
                ) : row.state === "unsold" ? (
                  <span className="rp-lot-state">Unsold</span>
                ) : row.state === "waiting" ? (
                  <span className="rp-lot-state">—</span>
                ) : sold !== null ? (
                  <span className="rp-lot-sold">
                    <PurseTeamCrest team={buyer} fallback="?" />
                    <span>{money(sold.amount)}</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---- One lot, at this moment -------------------------------------------- */

function LotMoment({
  chapter,
  step,
  snapshot,
  data,
  index,
  total,
  role,
  team,
}: {
  chapter: Chapter;
  step: number;
  snapshot: AuctionSnapshot;
  data: ReplayViewerData;
  index: number;
  total: number;
  role: string | null;
  team: (paddleId: string) => TeamIdentity | undefined;
}) {
  const money = useMoney();
  const ref = data.refs.lots[chapter.lotId];
  const name = ref?.playerName ?? "Unnamed";
  const ended = chapter.endAt !== null && chapter.endAt <= step;
  const bids = bidsIn(data.events, chapter, step);
  const lastBid = bids[bids.length - 1];
  const leaderTeam = lastBid !== undefined ? team(lastBid.paddleId) : undefined;
  const onBlock =
    snapshot.currentLot !== null && snapshot.currentLot.lotId === chapter.lotId
      ? snapshot.currentLot
      : null;
  const kicker = [
    `Lot ${String(index)} of ${String(total)}`,
    ref?.lotNumber,
    chapter.round > 1 ? `round ${String(chapter.round)}` : null,
    ref !== undefined ? `base ${money.ledger(ref.basePrice)}` : null,
  ]
    .filter((part) => part !== null && part !== undefined)
    .join(" · ");

  return (
    <div className="rp-moment" data-testid="replay-frame">
      <div className="rp-moment-top">
        <LotCard
          className="rp-card"
          name={name}
          seed={lotSeed(chapter.lotId, data.lotMedia)}
          photoUrl={data.lotMedia[chapter.lotId]?.photoUrl ?? null}
          roleLabel={role}
          kicker={kicker}
          nameTestId="replay-lot"
          {...(ended
            ? {
                stamp: (
                  <SoldStamp
                    tone={chapter.result?.sold === true ? "sold" : "unsold"}
                    size="md"
                    hammer={false}
                  />
                ),
              }
            : {})}
        />
        <div className="rp-price">
          {ended && chapter.result?.sold !== true ? (
            <div className="rp-unsold" data-testid="replay-outcome">
              <p className="rp-unsold-word">Unsold</p>
              <p className="rp-unsold-sub">
                {bids.length === 0 ? "No bids at the base price" : "Passed"}
              </p>
            </div>
          ) : (
            <LotPrice
              basePrice={ref?.basePrice ?? 0}
              bid={
                lastBid === undefined
                  ? null
                  : {
                      amount: lastBid.amount,
                      teamName: leaderTeam?.name ?? "A team",
                      paddleNumber: data.refs.paddles[lastBid.paddleId]?.paddleNumber ?? "",
                    }
              }
              teams={data.teams}
            />
          )}
          <p className="rp-moment-state" data-testid="replay-leading">
            {ended
              ? chapter.result?.sold === true
                ? `Sold to ${team(chapter.result.paddleId)?.name ?? "a team"}`
                : "No team bought this lot"
              : onBlock?.status === "closing_soon"
                ? "Closing soon"
                : "On the block"}
          </p>
        </div>
      </div>
      <BiddingLine bids={bids} team={team} base={ref?.basePrice ?? 0} money={money.ledger} />
    </div>
  );
}

/** The bidding as a line of team-coloured dots, base to hammer. */
function BiddingLine({
  bids,
  team,
  base,
  money,
}: {
  bids: readonly WarPoint[];
  team: (paddleId: string) => TeamIdentity | undefined;
  base: number;
  money: (amount: number) => string;
}) {
  const W = 600;
  const H = 150;
  const bidders = [
    ...new Map(bids.map((bid) => [bid.paddleId, team(bid.paddleId)] as const)).entries(),
  ];
  if (bids.length === 0) {
    return (
      <div className="rp-war">
        <p className="rp-war-head">
          <strong>The bidding</strong>
          <span>No bids yet</span>
        </p>
      </div>
    );
  }
  const top = Math.max(base, ...bids.map((bid) => bid.amount));
  const low = Math.min(base, bids[0]?.amount ?? base);
  const span = Math.max(1, top - low);
  const points = bids.map((bid, index) => ({
    x: 18 + (bids.length === 1 ? 0.5 : index / (bids.length - 1)) * (W - 36),
    y: H - 20 - ((bid.amount - low) / span) * (H - 44),
    color: team(bid.paddleId)?.primaryColor ?? "var(--accent)",
  }));
  const last = points[points.length - 1];
  const lastBid = bids[bids.length - 1];
  return (
    <div className="rp-war">
      <p className="rp-war-head">
        <strong>The bidding</strong>
        <span className="rp-war-key">
          {bidders.map(([paddleId, identity]) => (
            <span key={paddleId}>
              <span
                className="rp-war-dot"
                style={{ background: identity?.primaryColor ?? "var(--accent)" }}
              />
              {identity?.shortName ?? identity?.name ?? "Team"}
            </span>
          ))}
          <span>
            · {bids.length} bid{bids.length === 1 ? "" : "s"}
          </span>
        </span>
      </p>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        className="rp-war-chart"
        role="img"
        aria-label={`${String(bids.length)} bids from ${money(bids[0]?.amount ?? base)} to ${money(lastBid?.amount ?? base)}`}
      >
        <polyline
          className="rp-war-line"
          points={points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}
        />
        {points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={bids.length > 40 ? 3 : 5}
            fill={point.color}
            className="rp-war-point"
          />
        ))}
        {last !== undefined && lastBid !== undefined ? (
          <text
            x={Math.min(last.x, W - 8)}
            y={Math.max(14, last.y - 12)}
            textAnchor="end"
            className="rp-war-label"
          >
            {money(lastBid.amount)}
          </text>
        ) : null}
        <text x={18} y={H - 4} className="rp-war-axis">
          base {money(base)}
        </text>
      </svg>
    </div>
  );
}

/* ---- The finished night -------------------------------------------------- */

function NightSummary({
  summary,
  name,
  role,
  media,
  team,
  money,
  onWatch,
  onJump,
}: {
  summary: ReturnType<typeof summaryOf>;
  name: (lotId: string) => string;
  role: (lotId: string) => string | null;
  media: ReplayViewerData["lotMedia"];
  team: (paddleId: string) => TeamIdentity | undefined;
  money: (amount: number) => string;
  onWatch: () => void;
  onJump: (step: number) => void;
}) {
  return (
    <div className="rp-summary" data-testid="replay-frame">
      <div className="rp-summary-hero">
        <p className="rp-summary-kicker">Auction complete</p>
        <p className="rp-summary-title" data-testid="replay-outcome">
          {summary.sold} sold · {summary.unsold} unsold
        </p>
        <p className="rp-summary-sub">
          {summary.lots} lots
          {summary.minutes !== null ? ` in ${String(summary.minutes)} minutes` : ""}
        </p>
        <button type="button" className="rp-watch" onClick={onWatch}>
          <IconPlay size={18} weight="fill" aria-hidden />
          Watch it from the first lot
        </button>
      </div>
      {summary.top.length > 0 ? (
        <div className="rp-top">
          <p className="rp-top-head">Top buys</p>
          <ol>
            {summary.top.map((buy, index) => {
              const buyer = team(buy.paddleId);
              const roleLabel = role(buy.lotId);
              return (
                <li key={buy.lotId}>
                  <button
                    type="button"
                    className="rp-top-row"
                    onClick={() => {
                      onJump(buy.at);
                    }}
                  >
                    <span className="rp-top-rank">{index + 1}</span>
                    <PlayerImage
                      name={name(buy.lotId)}
                      seed={lotSeed(buy.lotId, media)}
                      src={media[buy.lotId]?.photoUrl}
                      size="sm"
                      shape="round"
                      decorative
                    />
                    <span className="rp-top-who">
                      <span className="rp-top-name">{name(buy.lotId)}</span>
                      <span className="rp-top-meta">
                        {[roleLabel, buyer?.name]
                          .filter((part) => part !== null && part !== undefined)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="rp-top-amount">{money(buy.amount)}</span>
                    <span className="rp-top-watch">Watch</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/* ---- The teams at this moment ------------------------------------------- */

function TeamsNow({
  snapshot,
  teams,
  purse,
  bought,
  money,
  slug,
}: {
  snapshot: AuctionSnapshot;
  teams: readonly TeamIdentity[];
  purse: number;
  bought: Readonly<Record<string, number>>;
  money: (amount: number) => string;
  slug: string;
}) {
  return (
    <aside className="rp-teams" aria-label="Teams at this moment">
      <p className="rp-side-head">
        <strong>Teams at this moment</strong>
      </p>
      <ul className="rp-team-list">
        {snapshot.paddles.map((paddle) => {
          const identity = teams.find((team) => team.id === paddle.teamId);
          const left = paddle.purseRemaining;
          const used =
            left === null || purse <= 0
              ? null
              : Math.min(100, Math.max(0, ((purse - left) / purse) * 100));
          return (
            <li key={paddle.paddleId} className="rp-team">
              <span className="rp-team-head">
                <PurseTeamCrest team={identity} fallback={paddle.paddleNumber} />
                <span className="rp-team-name">{paddle.teamName}</span>
                <span className="rp-team-bought">{bought[paddle.paddleId] ?? 0} bought</span>
              </span>
              {used !== null ? (
                <span className="rp-team-bar" aria-hidden>
                  <span
                    style={{
                      width: `${used.toFixed(1)}%`,
                      background: identity?.primaryColor ?? undefined,
                    }}
                  />
                </span>
              ) : null}
              <span className="rp-team-left">
                {left === null ? "purse sealed" : `${money(left)} left of ${money(purse)}`}
              </span>
            </li>
          );
        })}
      </ul>
      <Link className="rp-ledger" href={`/seasons/${slug}/auction/ledger`}>
        Every bid, as a list — the Ledger
      </Link>
    </aside>
  );
}
