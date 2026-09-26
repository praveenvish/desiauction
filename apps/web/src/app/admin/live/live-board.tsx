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
  IconUsers,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";
import { useCallback } from "react";

import { moneyFormat } from "../../../lib/money";
import type { EngineRoom, LiveBoardView } from "../../../server/admin/live-watch";
import { adminLiveBoard } from "../../../server/admin/live-watch";
import type { LiveAuctionRow, RoomState } from "../../../server/admin/live-views";
import { KpiValue } from "../admin-ui";
import { LiveFreshness } from "../live-freshness";
import { ageLabel, istWhen, usePolled } from "../use-polled";

const REFRESH_MS = 10_000;
/** "Never closed" is a backlog, not a feed: the longest-silent tail folds away. */
const STALE_SHOWN = 10;
/** The last day's closes: the newest few, the rest behind "Show all". */
const ENDED_SHOWN = 5;

const STATE_BADGE: Record<RoomState, { tone: KitTone; label: string }> = {
  active: { tone: "green", label: "Bidding" },
  quiet: { tone: "neutral", label: "Quiet" },
  paused: { tone: "amber", label: "Paused" },
  stale: { tone: "neutral", label: "Silent" },
};

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
  const troubled = data.running.filter((row) => engineTrouble(data.engine[row.auctionId]) !== null);

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
          concept="auction"
          value={<KpiValue n={data.running.length} />}
          label="Auctions running"
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
        <StatCard
          icon={<IconAlert />}
          concept={troubled.length > 0 ? "alert" : "neutral"}
          value={<KpiValue n={troubled.length} />}
          label="Rooms with engine trouble"
        />
      </StatGrid>

      <SectionCard
        icon={<IconBroadcast />}
        tone={data.running.length > 0 ? "green" : "neutral"}
        title="Running now"
        description={
          data.running.length === 0
            ? "Busiest first"
            : `${String(data.running.length)} room${data.running.length === 1 ? "" : "s"}, busiest first`
        }
        flush
        data-testid="live-running"
      >
        {data.running.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              headingLevel={3}
              title="No auction is running"
              description={`When an organizer opens one, it appears here within ${String(REFRESH_MS / 1000)} seconds.`}
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
            {data.running.map((row) => (
              <RoomRow
                key={row.auctionId}
                row={row}
                engine={data.engine[row.auctionId]}
                nowMs={data.generatedAtMs}
              />
            ))}
          </ul>
        )}
      </SectionCard>

      {data.stale.length > 0 ? (
        // A backlog, not a feed: one warning line, opened on demand.
        <details className="admin-fold" data-testid="live-stale">
          <summary>
            <span className="admin-fold-icon" data-tone="warning" aria-hidden>
              <IconClock size={16} />
            </span>
            <span className="admin-fold-title">
              <strong>Never closed · {String(data.stale.length)}</strong>
              <span className="admin-meta">
                Marked live, silent for over twelve hours. Only the organizer can close one, from
                their cockpit.
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
          <p className="admin-card-empty">No auction has closed in the last day.</p>
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

/** A sentence when the engine's view of a room is a problem; null when it is fine. */
function engineTrouble(room: EngineRoom | undefined): string | null {
  if (room === undefined) {
    return null;
  }
  switch (room.state) {
    case "unreachable":
      return "Engine not answering";
    case "loaded":
      if (room.halted !== null) {
        return `Engine halted this room: ${room.halted}`;
      }
      if (room.watchdogStalled) {
        return "Engine timer watchdog stalled";
      }
      if (room.queueDepth > 5) {
        return `${String(room.queueDepth)} commands waiting in the engine`;
      }
      return null;
    default:
      return null;
  }
}

function engineLine(room: EngineRoom | undefined): string {
  if (room === undefined || room.state === "not_checked") {
    // Each refresh asks the engine about the busiest rooms only.
    return "Not checked (busiest 20 only)";
  }
  if (room.state === "unreachable") {
    return "Engine not answering";
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
  nowMs,
}: {
  row: LiveAuctionRow;
  engine: EngineRoom | undefined;
  nowMs: number;
}) {
  const badge = STATE_BADGE[row.state];
  const trouble = engineTrouble(engine);
  const pct = (n: number) => (row.lots.total > 0 ? (n / row.lots.total) * 100 : 0);
  return (
    <li
      className="admin-room"
      data-state={row.state}
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
        {row.state === "quiet" ? (
          <span className="admin-sr-only">{badge.label}</span>
        ) : (
          <Pill tone={badge.tone} dot>
            {badge.label}
          </Pill>
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
            <dd className="admin-room-trouble" role="note" data-testid="live-room-trouble">
              <IconAlert size={16} />
              {trouble}
            </dd>
          ) : (
            <dd className="admin-meta">{engineLine(engine)}</dd>
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
