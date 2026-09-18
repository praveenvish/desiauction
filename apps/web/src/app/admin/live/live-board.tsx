"use client";

import { Badge, Card, EmptyState, IconArrowRight } from "@desiauction/ui";
import Link from "next/link";
import { useCallback } from "react";

import { compactINR } from "../../../lib/inr";
import type { EngineRoom, LiveBoardView } from "../../../server/admin/live-watch";
import { adminLiveBoard } from "../../../server/admin/live-watch";
import type { LiveAuctionRow, RoomState } from "../../../server/admin/live-views";
import { LiveFreshness } from "../live-freshness";
import { ageLabel, istTime, usePolled } from "../use-polled";

const REFRESH_MS = 10_000;

const STATE_BADGE: Record<
  RoomState,
  { tone: "success" | "info" | "warning" | "neutral"; label: string }
> = {
  active: { tone: "success", label: "Bidding" },
  quiet: { tone: "info", label: "Quiet" },
  paused: { tone: "warning", label: "Paused" },
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

      <div className="stat-row" data-testid="live-summary">
        <SummaryTile label="Auctions running" value={String(data.running.length)} />
        <SummaryTile label="Bids · last 5 min" value={String(pulse)} />
        <SummaryTile label="People connected" value={String(connected)} />
        <SummaryTile
          label="Rooms with engine trouble"
          value={String(troubled.length)}
          tone={troubled.length > 0 ? "danger" : undefined}
        />
      </div>

      <Card data-testid="live-running">
        <h2 className="admin-section-title">Running now</h2>
        {data.running.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No auction is running"
            description={`When an organizer opens one, it appears here within ${String(REFRESH_MS / 1000)} seconds.`}
          />
        ) : (
          <ul className="admin-live-list">
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
      </Card>

      {data.stale.length > 0 ? (
        <Card data-testid="live-stale">
          <h2 className="admin-section-title">
            Never closed <span className="admin-count">· {String(data.stale.length)}</span>
          </h2>
          <p className="admin-meta">
            Marked live, but nothing has happened in over twelve hours — an auction night that ended
            without anyone closing it. Only the organizer can close it, from their cockpit.
          </p>
          <ul className="admin-live-list is-compact">
            {data.stale.map((row) => (
              <li key={row.auctionId} className="admin-live-row">
                <span className="admin-live-name">
                  <Link href={`/admin/auctions/${row.auctionId}`}>{row.seasonName}</Link>
                  <span className="admin-meta">
                    {row.orgName} ·{" "}
                    {row.lastEventAtMs === null
                      ? "never opened"
                      : `silent ${ageLabel(data.generatedAtMs - row.lastEventAtMs)}`}
                  </span>
                </span>
                <span className="admin-meta">
                  {row.lots.sold} of {row.lots.total} sold
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card data-testid="live-ended">
        <h2 className="admin-section-title">Ended in the last 24 hours</h2>
        {data.ended.length === 0 ? (
          <p className="admin-meta">No auction has closed in the last day.</p>
        ) : (
          <ul className="admin-live-list is-compact">
            {data.ended.map((row) => (
              <li key={row.auctionId} className="admin-live-row">
                <span className="admin-live-name">
                  <Link href={`/admin/auctions/${row.auctionId}`}>{row.seasonName}</Link>
                  <span className="admin-meta">
                    {row.orgName} · {row.status === "abandoned" ? "abandoned" : "closed"}{" "}
                    {istTime(row.endedAtMs)}
                  </span>
                </span>
                <span className="admin-meta">
                  {row.sold} sold · {row.unsold} unsold · {compactINR(row.moneyMoved)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | undefined;
}) {
  return (
    <div className={tone === "danger" ? "stat-tile admin-tile-danger" : "stat-tile"}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
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
    return "Engine not checked";
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
    <li className="admin-live-room" data-testid={`live-room-${row.auctionId}`}>
      <div className="admin-live-head">
        <span className="admin-live-name">
          <Link href={`/admin/auctions/${row.auctionId}`}>{row.seasonName}</Link>
          <span className="admin-meta">
            {row.orgName} · {row.sport}
            {row.openedAtMs === null ? "" : ` · opened ${istTime(row.openedAtMs)}`}
          </span>
        </span>
        <Badge tone={badge.tone}>{badge.label}</Badge>
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
          <dd>{compactINR(row.moneyMoved)}</dd>
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

      <Link href={`/admin/auctions/${row.auctionId}`} className="admin-meta">
        Watch this auction
        <IconArrowRight size={16} className="icon-trail" />
      </Link>
    </li>
  );
}
