"use client";

import {
  EmptyState,
  IconAlert,
  IconArrowRight,
  IconBolt,
  IconBroadcast,
  IconCheckCircle,
  IconChevronDown,
  IconClock,
  IconGavel,
  IconShieldCheck,
  IconUsers,
  Notice,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
} from "@desiauction/ui";
import Link from "next/link";
import { useCallback } from "react";

import { moneyFormat } from "../../../lib/money";
import type { EngineRoom, LiveBoardView } from "../../../server/admin/live-watch";
import { adminLiveBoard } from "../../../server/admin/live-watch";
import type { LiveAuctionRow } from "../../../server/admin/live-views";
import { KpiValue } from "../admin-ui";
import { LiveFreshness } from "../live-freshness";
import { STUCK_LABEL, engineTrouble, roomBadge } from "../room-state";
import { biddingNow, engineHealth, goneQuiet, nothingBiddingLine } from "./live-model";
import { ageLabel, istWhen, usePolled } from "../use-polled";

const REFRESH_MS = 10_000;
/** "Never closed" is a backlog, not a feed: the longest-silent tail folds away. */
const STALE_SHOWN = 10;
/** Rooms gone quiet: the most recent few, the rest behind "Show all". */
const QUIET_SHOWN = 10;
/** The last day's closes: the newest few, the rest behind "Show all". */
const ENDED_SHOWN = 5;

/**
 * Every room, on one screen, refreshing itself.
 *
 * Ordered by the room's pulse — bids in the last five minutes — so the busiest
 * auction is always at the top and a room that has gone quiet drifts down. The
 * engine's own view of each room sits beside the database's: connections, and
 * any sign the engine has stopped (halted, stalled watchdog, commands queuing).
 */
export function LiveBoard({ initial }: { initial: LiveBoardView }) {
  const fetcher = useCallback(() => adminLiveBoard(), []);
  const { data, failed, revoked } = usePolled(initial, fetcher, REFRESH_MS, true);
  const pulse = data.running.reduce((sum, row) => sum + row.bids.lastFiveMinutes, 0);
  const connected = Object.values(data.engine).reduce(
    (sum, room) =>
      sum + (room.state === "loaded" || room.state === "idle" ? room.connectedClients : 0),
    0,
  );
  const bidding = biddingNow(data.running);
  const quiet = goneQuiet(data.running);
  const health = engineHealth(data.running, data.engine, (room) => engineTrouble(room) !== null);
  // With the engine down everywhere, that is ONE fact: the notice says it and
  // the rows stop repeating it twenty times.
  const engineDown = health.kind === "down";

  return (
    <>
      <LiveFreshness
        generatedAtMs={data.generatedAtMs}
        polling={!revoked}
        failed={failed}
        revoked={revoked}
      />

      {/* The console's one KPI tile (StatCard), as on the overview. A zero is
          the calm answer and reads muted; only trouble takes a colour. */}
      <StatGrid testId="live-summary">
        <StatCard
          icon={<IconGavel />}
          concept={bidding.length > 0 ? "auction" : "neutral"}
          value={<KpiValue n={bidding.length} />}
          label="Bidding now"
        />
        <StatCard
          icon={<IconBolt />}
          concept="neutral"
          value={<KpiValue n={pulse} />}
          label="Bids · last 5 min"
        />
        <StatCard
          icon={<IconUsers />}
          concept="neutral"
          value={<KpiValue n={connected} />}
          label="People connected"
        />
        <EngineTile health={health} />
      </StatGrid>

      {engineDown ? (
        <Notice
          tone="danger"
          icon={<IconAlert size={20} />}
          title="The engine isn't answering"
          testId="live-engine-down"
        >
          None of the {health.asked} open {health.asked === 1 ? "room" : "rooms"} it was asked about
          replied, so nobody can bid anywhere until it is back. The rooms themselves are intact in
          the database. <Link href="/admin/health">Check system health</Link>
        </Notice>
      ) : null}

      <SectionCard
        icon={<IconBroadcast />}
        tone={bidding.length > 0 ? "green" : "neutral"}
        title="Bidding now"
        description={
          bidding.length === 0
            ? "Rooms with a bid, sale or pause in the last 15 minutes"
            : `${String(bidding.length)} room${bidding.length === 1 ? "" : "s"}, busiest first`
        }
        flush
        data-testid="live-running"
      >
        {bidding.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
              headingLevel={3}
              title="Nothing is bidding right now"
              description={nothingBiddingLine(quiet.length, REFRESH_MS / 1000)}
            />
          </div>
        ) : (
          <ul className="admin-rooms">
            <li className="admin-room admin-room-head" aria-hidden>
              <span>Auction</span>
              <span className="admin-room-facts">
                <span>Lots</span>
                <span>Spent</span>
                <span>Bids · 5 min</span>
                <span>Last activity</span>
                <span>Room</span>
              </span>
              <span />
            </li>
            {bidding.map((row) => (
              <RoomRow
                key={row.auctionId}
                row={row}
                engine={data.engine[row.auctionId]}
                engineDown={engineDown}
                nowMs={data.generatedAtMs}
              />
            ))}
          </ul>
        )}
      </SectionCard>

      {quiet.length > 0 ? (
        // Open and not closed, but nothing for over fifteen minutes: usually a
        // rehearsal, or a night someone forgot to close. Not the night's feed.
        <details className="admin-fold" data-testid="live-quiet">
          <summary>
            <span className="admin-fold-icon" aria-hidden>
              <IconClock size={16} />
            </span>
            <span className="admin-fold-title">
              <strong>Open, gone quiet · {String(quiet.length)}</strong>
              <span className="admin-meta">
                Opened and not closed, with nothing for over 15 minutes — usually a rehearsal, or a
                night someone forgot to close.
              </span>
            </span>
            <IconChevronDown size={16} className="admin-fold-caret" />
          </summary>
          <ul className="admin-rows">
            {quiet.slice(0, QUIET_SHOWN).map((row) => (
              <QuietRow key={row.auctionId} row={row} nowMs={data.generatedAtMs} />
            ))}
          </ul>
          {quiet.length > QUIET_SHOWN ? (
            <details className="admin-more">
              <summary>Show all {String(quiet.length)}</summary>
              <ul className="admin-rows">
                {quiet.slice(QUIET_SHOWN).map((row) => (
                  <QuietRow key={row.auctionId} row={row} nowMs={data.generatedAtMs} />
                ))}
              </ul>
            </details>
          ) : null}
        </details>
      ) : null}

      {data.stale.length > 0 ? (
        // A backlog, not a feed: one warning line, opened on demand.
        <details className="admin-fold" data-testid="live-stale">
          <summary>
            <span className="admin-fold-icon" data-tone="danger" aria-hidden>
              <IconClock size={16} />
            </span>
            <span className="admin-fold-title">
              <strong>
                {STUCK_LABEL} · {String(data.stale.length)}
              </strong>
              <span className="admin-meta">
                Live or paused, with no event for over twelve hours — never closed. Only the
                organizer can close one, from their cockpit.
              </span>
            </span>
            <IconChevronDown size={16} className="admin-fold-caret" />
          </summary>
          <ul className="admin-rows">
            {data.stale.slice(0, STALE_SHOWN).map((row) => (
              <StaleRow key={row.auctionId} row={row} nowMs={data.generatedAtMs} />
            ))}
          </ul>
          {data.stale.length > STALE_SHOWN ? (
            <details className="admin-more">
              <summary>Show all {String(data.stale.length)}</summary>
              <ul className="admin-rows">
                {data.stale.slice(STALE_SHOWN).map((row) => (
                  <StaleRow key={row.auctionId} row={row} nowMs={data.generatedAtMs} />
                ))}
              </ul>
            </details>
          ) : null}
        </details>
      ) : null}

      <SectionCard
        icon={<IconCheckCircle />}
        tone="neutral"
        title="Ended in the last 24 hours"
        description={data.ended.length === 0 ? undefined : `${String(data.ended.length)} closed`}
        flush
        data-testid="live-ended"
      >
        {data.ended.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
              icon={<IconGavel />}
              title="No auction has closed in the last day"
            />
          </div>
        ) : (
          <>
            <ul className="admin-rows admin-rows-dense">
              {data.ended.slice(0, ENDED_SHOWN).map((row) => (
                <EndedRow key={row.auctionId} row={row} nowMs={data.generatedAtMs} />
              ))}
            </ul>
            {data.ended.length > ENDED_SHOWN ? (
              // The last day's closes are a record, not a feed: the newest few
              // are shown, the rest one click away.
              <details className="admin-more">
                <summary>Show all {String(data.ended.length)}</summary>
                <ul className="admin-rows admin-rows-dense">
                  {data.ended.slice(ENDED_SHOWN).map((row) => (
                    <EndedRow key={row.auctionId} row={row} nowMs={data.generatedAtMs} />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </SectionCard>
    </>
  );
}

function EndedRow({ row, nowMs }: { row: LiveBoardView["ended"][number]; nowMs: number }) {
  return (
    <li>
      <span className="admin-live-name">
        <Link href={`/admin/auctions/${row.auctionId}`}>{row.seasonName}</Link>
        <span className="admin-meta">
          {row.orgName} · {row.status === "abandoned" ? "abandoned" : "closed"}{" "}
          {istWhen(row.endedAtMs, nowMs)}
        </span>
      </span>
      <span className="admin-meta admin-num-line">
        {row.sold} sold · {row.unsold} unsold ·{" "}
        {moneyFormat(row.auctionUnit).compact(row.moneyMoved)}
      </span>
    </li>
  );
}

/** The fourth tile: the engine as one fact — down, answering, or not asked. */
function EngineTile({ health }: { health: ReturnType<typeof engineHealth> }) {
  if (health.kind === "down") {
    return (
      <StatCard
        icon={<IconAlert />}
        concept="alert"
        value="Down"
        label="Engine"
        testId="live-engine"
      />
    );
  }
  if (health.kind === "answering" && health.troubled > 0) {
    return (
      <StatCard
        icon={<IconAlert />}
        concept="alert"
        value={<KpiValue n={health.troubled} />}
        label={health.troubled === 1 ? "Room with engine trouble" : "Rooms with engine trouble"}
        testId="live-engine"
      />
    );
  }
  return (
    <StatCard
      icon={<IconShieldCheck />}
      concept="neutral"
      value={health.kind === "answering" ? "Answering" : <span className="admin-zero">—</span>}
      label={health.kind === "answering" ? "Engine" : "Engine · no room open"}
      testId="live-engine"
    />
  );
}

function QuietRow({ row, nowMs }: { row: LiveAuctionRow; nowMs: number }) {
  const sold = `${String(row.lots.sold)} of ${String(row.lots.total)} sold${
    row.moneyMoved === 0 ? "" : ` · ${moneyFormat(row.auctionUnit).compact(row.moneyMoved)}`
  }`;
  return (
    <li className="live-quiet-row" data-testid={`live-quiet-${row.auctionId}`}>
      <span className="admin-live-name">
        <Link href={`/admin/auctions/${row.auctionId}`}>{row.seasonName}</Link>
        <span className="admin-meta">
          {row.orgName} · {row.status === "paused" ? "paused, " : ""}
          {row.lastEventAtMs === null
            ? "never opened"
            : `last activity ${ageLabel(nowMs - row.lastEventAtMs)} ago`}
          {/* A phone has no right-hand column: the lots join this line. */}
          <span className="admin-room-phone"> · {sold}</span>
        </span>
      </span>
      <span className="admin-meta admin-num-line live-quiet-facts">{sold}</span>
    </li>
  );
}

function StaleRow({ row, nowMs }: { row: LiveAuctionRow; nowMs: number }) {
  return (
    <li>
      <span className="admin-live-name">
        <Link href={`/admin/auctions/${row.auctionId}`}>{row.seasonName}</Link>
        <span className="admin-meta">
          {row.orgName} ·{" "}
          {row.lastEventAtMs === null
            ? "never opened"
            : `silent ${ageLabel(nowMs - row.lastEventAtMs)}`}
        </span>
      </span>
      <span className="admin-meta">
        {row.lots.sold} of {row.lots.total} sold
      </span>
    </li>
  );
}

function engineLine(room: EngineRoom | undefined, engineDown: boolean): string {
  // Each refresh asks the engine about the busiest rooms only; a room it did
  // not ask, or one it cannot answer while the notice above says it is down,
  // has nothing more to say here.
  if (room === undefined || room.state === "not_checked") return "—";
  if (room.state === "unreachable") {
    return engineDown ? "—" : "Engine not answering";
  }
  if (room.state === "idle") {
    return room.connectedClients === 0
      ? "Nobody connected"
      : `${String(room.connectedClients)} connected`;
  }
  return `${String(room.connectedClients)} connected · ${String(Math.round(room.lastBroadcastLatencyMs))} ms broadcast`;
}

function RoomRow({
  row,
  engine,
  engineDown,
  nowMs,
}: {
  row: LiveAuctionRow;
  engine: EngineRoom | undefined;
  engineDown: boolean;
  nowMs: number;
}) {
  // A room's own trouble stays on its row; "the engine is down" is said once.
  const trouble = engineDown ? null : engineTrouble(engine);
  const badge = roomBadge(row.state, trouble);
  const pct = (n: number) => (row.lots.total > 0 ? (n / row.lots.total) * 100 : 0);
  return (
    <li
      className="admin-room"
      data-state={badge.dotState}
      data-trouble={trouble !== null || undefined}
      data-testid={`live-room-${row.auctionId}`}
    >
      <span className="admin-room-name">
        <span className="admin-room-dot" aria-hidden />
        <span className="admin-live-name">
          <Link href={`/admin/auctions/${row.auctionId}`}>{row.seasonName}</Link>
          {/* One line: the opening time is the hover, so "IST" can no longer
              fall onto a third line and double the row. */}
          <span
            className="admin-meta admin-live-sub"
            title={row.openedAtMs === null ? undefined : `Opened ${istWhen(row.openedAtMs, nowMs)}`}
          >
            {row.orgName} · {row.sport}
            {row.openedAtMs === null ? null : (
              <span className="admin-sr-only"> · opened {istWhen(row.openedAtMs, nowMs)}</span>
            )}
          </span>
        </span>
        {/* "Quiet" on every row said nothing. The pill appears only when the
            room is doing something worth a glance; the dot always carries it. */}
        {/* With the engine down nothing can bid, so a green "Bidding" beside
            the notice would contradict it: the dot alone carries the state. */}
        {badge.dotState === "quiet" || engineDown ? (
          <span className="admin-sr-only">{badge.label}</span>
        ) : (
          // With trouble, a phone says it once — on the Room line below.
          <span className="admin-room-pill" data-trouble={trouble !== null || undefined}>
            <Pill tone={badge.tone} dot>
              {badge.label}
            </Pill>
          </span>
        )}
      </span>

      <dl className="admin-room-facts">
        <div>
          <dt>Lots</dt>
          <dd className="admin-room-lots">
            <span className="auc-progress" aria-hidden>
              <span
                className="auc-progress-seg is-sold"
                style={{ width: `${String(pct(row.lots.sold))}%` }}
              />
              <span
                className="auc-progress-seg is-unsold"
                style={{ width: `${String(pct(row.lots.unsold))}%` }}
              />
            </span>
            <span
              title={`${String(row.lots.sold)} sold · ${String(row.lots.unsold)} unsold · ${String(row.lots.remaining)} left`}
            >
              {row.lots.sold}/{row.lots.total}
              <span className="admin-room-phone" aria-hidden>
                {" "}
                sold
              </span>
              <span className="admin-sr-only">
                {" "}
                sold · {row.lots.unsold} unsold · {row.lots.remaining} left
              </span>
            </span>
          </dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd>
            {row.moneyMoved === 0 ? (
              <span data-zero>—</span>
            ) : (
              moneyFormat(row.auctionUnit).compact(row.moneyMoved)
            )}
          </dd>
        </div>
        <div>
          <dt>Bids</dt>
          <dd>
            <span data-zero={row.bids.lastFiveMinutes === 0 || undefined}>
              {row.bids.lastFiveMinutes}
            </span>
            {/* On a phone the column heads are gone, so the cell names itself:
                "0 · 0 total" read as two bare numbers. */}
            <span className="admin-room-phone" aria-hidden>
              {" "}
              in 5 min
            </span>
            <span className="admin-meta"> · {row.bids.total} total</span>
          </dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>{row.lastEventAtMs === null ? "—" : `${ageLabel(nowMs - row.lastEventAtMs)} ago`}</dd>
        </div>
        <div>
          <dt>Room</dt>
          {/* Trouble is said in the Room column, in words, where the eye
              already looks — not as a second full-width strip per row. */}
          {trouble !== null ? (
            // The note role sits on a span inside the <dd>: a <dd> may not
            // carry one (axe aria-allowed-role, and it breaks the <dl>).
            <dd className="admin-room-trouble">
              <span role="note" data-testid="live-room-trouble">
                <IconAlert size={16} />
                {trouble}
              </span>
            </dd>
          ) : (
            <dd
              className="admin-meta"
              title={
                engine === undefined || engine.state === "not_checked"
                  ? "Not asked this refresh — the engine is asked about the busiest rooms only"
                  : undefined
              }
            >
              {engineLine(engine, engineDown)}
            </dd>
          )}
        </div>
      </dl>

      <Link href={`/admin/auctions/${row.auctionId}`} className="admin-room-watch">
        Watch<span className="admin-sr-only"> this auction</span>
        <IconArrowRight size={16} />
      </Link>
    </li>
  );
}
