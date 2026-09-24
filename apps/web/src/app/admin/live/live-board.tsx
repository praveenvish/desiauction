"use client";

import {
  EmptyState,
  IconAlert,
  IconArrowRight,
  IconBolt,
  IconBroadcast,
  IconCheckCircle,
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
import { LiveFreshness } from "../live-freshness";
import { ageLabel, istWhen, usePolled } from "../use-polled";

const REFRESH_MS = 10_000;
/** "Never closed" is a backlog, not a feed: the longest-silent tail folds away. */
const STALE_SHOWN = 10;

const STATE_BADGE: Record<RoomState, { tone: KitTone; label: string }> = {
  active: { tone: "green", label: "Bidding" },
  quiet: { tone: "blue", label: "Quiet" },
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

      <StatGrid testId="live-summary">
        <StatCard
          icon={<IconGavel />}
          tone="gold"
          value={String(data.running.length)}
          label="Auctions running"
        />
        <StatCard icon={<IconBolt />} tone="blue" value={String(pulse)} label="Bids · last 5 min" />
        <StatCard
          icon={<IconUsers />}
          tone="green"
          value={String(connected)}
          label="People connected"
        />
        <StatCard
          icon={<IconAlert />}
          tone={troubled.length > 0 ? "red" : "neutral"}
          value={String(troubled.length)}
          label="Rooms with engine trouble"
        />
      </StatGrid>

      <SectionCard
        icon={<IconBroadcast />}
        tone="red"
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
          <ul className="admin-rows is-stacked">
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
        <SectionCard
          icon={<IconClock />}
          tone="amber"
          title={
            <>
              Never closed <span className="admin-count">· {String(data.stale.length)}</span>
            </>
          }
          description="Marked live, but nothing has happened in over twelve hours — an auction night that ended without anyone closing it. Only the organizer can close it, from their cockpit."
          flush
          data-testid="live-stale"
        >
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
        </SectionCard>
      ) : null}

      <SectionCard
        icon={<IconCheckCircle />}
        tone="neutral"
        title="Ended in the last 24 hours"
        flush
        data-testid="live-ended"
      >
        {data.ended.length === 0 ? (
          <p className="admin-card-empty">No auction has closed in the last day.</p>
        ) : (
          <ul className="admin-rows">
            {data.ended.map((row) => (
              <li key={row.auctionId}>
                <span className="admin-live-name">
                  <Link href={`/admin/auctions/${row.auctionId}`}>{row.seasonName}</Link>
                  <span className="admin-meta">
                    {row.orgName} · {row.status === "abandoned" ? "abandoned" : "closed"}{" "}
                    {istWhen(row.endedAtMs, data.generatedAtMs)}
                  </span>
                </span>
                <span className="admin-meta">
                  {row.sold} sold · {row.unsold} unsold ·{" "}
                  {moneyFormat(row.auctionUnit).compact(row.moneyMoved)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
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
    <li data-testid={`live-room-${row.auctionId}`}>
      <div className="admin-live-head">
        <span className="admin-live-name">
          <Link href={`/admin/auctions/${row.auctionId}`}>{row.seasonName}</Link>
          <span className="admin-meta">
            {row.orgName} · {row.sport}
            {row.openedAtMs === null ? "" : ` · opened ${istWhen(row.openedAtMs, nowMs)}`}
          </span>
        </span>
        <Pill tone={badge.tone} dot>
          {badge.label}
        </Pill>
      </div>

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

      <dl className="admin-live-facts">
        <div>
          <dt>Lots</dt>
          <dd>
            {row.lots.sold} sold · {row.lots.unsold} unsold · {row.lots.remaining} left
          </dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd>{moneyFormat(row.auctionUnit).compact(row.moneyMoved)}</dd>
        </div>
        <div>
          <dt>Bids</dt>
          <dd>
            {row.bids.lastFiveMinutes} in 5 min · {row.bids.total} total
          </dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>{row.lastEventAtMs === null ? "—" : `${ageLabel(nowMs - row.lastEventAtMs)} ago`}</dd>
        </div>
        <div>
          <dt>Room</dt>
          <dd>{engineLine(engine)}</dd>
        </div>
      </dl>

      {trouble !== null ? (
        <p className="admin-live-trouble" role="note" data-testid="live-room-trouble">
          {trouble}
        </p>
      ) : null}

      <Link href={`/admin/auctions/${row.auctionId}`} className="admin-card-link">
        Watch this auction
        <IconArrowRight size={16} className="icon-trail" />
      </Link>
    </li>
  );
}
