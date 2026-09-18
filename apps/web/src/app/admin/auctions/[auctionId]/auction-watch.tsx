"use client";

import { Badge, Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";
import { useCallback } from "react";

import { compactINR, exactINR } from "../../../../lib/inr";
import { roleLabeller } from "../../../../lib/role-label";
import { adminAuctionWatch, type AuctionWatch } from "../../../../server/admin/live-watch";
import { AuctionOverviewPanel } from "../../../seasons/[slug]/auction/auction-overview-panel";
import { LiveFreshness } from "../../live-freshness";
import { ageLabel, istClock, istTime, usePolled } from "../../use-polled";

const REFRESH_MS = 5_000;

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral" | "danger"> = {
  live: "success",
  paused: "warning",
  scheduled: "info",
  completed: "neutral",
  reconciled: "neutral",
  abandoned: "danger",
};

const LOT_STATUS_LABEL: Record<string, string> = {
  sold: "Sold",
  unsold: "Unsold",
  withdrawn: "Withdrawn",
  queued: "Queued",
  prepared: "Prepared",
  on_block: "On the block",
  closing_soon: "Closing",
  frozen: "Held",
};

function isRunning(watch: AuctionWatch): boolean {
  return watch.header.status === "live" || watch.header.status === "paused";
}

/**
 * One auction, watched — and, once it has closed, its report.
 *
 * While the room is live the page refreshes itself every five seconds: what is
 * on the block, the bid tape, every team's purse, and the engine's own view of
 * the room. When the auction ends the same page stops refreshing and reads as
 * the result: every lot, what it went for and to whom, and each team's spend.
 * It is the organizer's own read of the auction (auctionOverview), so the
 * numbers here cannot disagree with the ones in their console.
 */
export function AuctionWatchView({ initial }: { initial: AuctionWatch }) {
  const auctionId = initial.header.auctionId;
  const fetcher = useCallback(() => adminAuctionWatch(auctionId), [auctionId]);
  // Polls while the room is open, and stops by itself the moment it closes.
  const { data, failed, revoked } = usePolled(initial, fetcher, REFRESH_MS, isRunning);
  const { header, overview, pulse, engine } = data;
  const stillRunning = isRunning(data);
  const labelOf = roleLabeller(overview.roles);

  const endMs = pulse.closedAtMs ?? (stillRunning ? data.generatedAtMs : pulse.lastEventAtMs);
  const durationMs = pulse.openedAtMs === null || endMs === null ? null : endMs - pulse.openedAtMs;

  const teams = overview.paddles.map((paddle) => {
    const bought = overview.lots.filter(
      (lot) => lot.status === "sold" && lot.paddleNumber === paddle.paddleNumber,
    );
    const prices = bought.map((lot) => lot.soldPrice ?? 0);
    return {
      ...paddle,
      players: bought.length,
      highest: prices.length === 0 ? null : Math.max(...prices),
    };
  });
  const soldPrices = overview.lots
    .filter((lot) => lot.status === "sold")
    .map((lot) => lot.soldPrice ?? 0);
  const averageSale =
    soldPrices.length === 0
      ? null
      : Math.round(soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length);

  return (
    <>
      <Card data-testid="auction-watch-head">
        <div className="admin-live-head">
          <span className="admin-live-name">
            <span className="admin-watch-title">{header.seasonName}</span>
            <span className="admin-meta">
              <Link href={`/admin/orgs/${header.orgSlug}`}>{header.orgName}</Link> · {header.sport}{" "}
              · {header.auctionName}
            </span>
          </span>
          <Badge tone={STATUS_TONE[header.status] ?? "neutral"} data-testid="auction-watch-status">
            {header.status}
          </Badge>
        </div>
        <LiveFreshness
          generatedAtMs={data.generatedAtMs}
          polling={stillRunning && !revoked}
          failed={failed}
          revoked={revoked}
        />
        <p className="admin-meta">
          You are watching, not conducting. Pausing, closing or recovering this auction happens in
          the organizer&rsquo;s cockpit.
        </p>
      </Card>

      <div className="stat-row" data-testid="auction-watch-vitals">
        <Vital
          label={pulse.closedAtMs !== null ? "Ran" : "Opened"}
          value={
            pulse.openedAtMs === null
              ? "Not yet"
              : pulse.closedAtMs !== null
                ? `${istClock(pulse.openedAtMs)}–${istTime(pulse.closedAtMs)}`
                : istTime(pulse.openedAtMs)
          }
        />
        <Vital label="Duration" value={durationMs === null ? "—" : ageLabel(durationMs)} />
        <Vital
          label={stillRunning ? "Bids · last 5 min" : "Bids"}
          value={
            stillRunning
              ? `${String(pulse.bidsLastFiveMinutes)} / ${String(pulse.bidsTotal)}`
              : String(pulse.bidsTotal)
          }
        />
        <Vital label="Teams that bid" value={String(pulse.activeBidders)} />
        <Vital label="Average sale" value={averageSale === null ? "—" : compactINR(averageSale)} />
      </div>

      <AuctionOverviewPanel overview={overview} idleHint="No lot is under the hammer right now." />

      {engine !== null ? <EngineCard engine={engine} /> : null}

      <Card data-testid="auction-watch-tape">
        <h2 className="admin-section-title">Bid tape</h2>
        {pulse.tape.length === 0 ? (
          <p className="admin-meta">No bids yet.</p>
        ) : (
          <table className="reg-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Lot</th>
                <th scope="col">Team</th>
                <th scope="col" className="admin-num">
                  Bid
                </th>
              </tr>
            </thead>
            <tbody>
              {pulse.tape.map((bid, index) => (
                <tr key={`${String(bid.placedAtMs)}-${String(index)}`} className="reg-row">
                  <td data-label="Time">{istTime(bid.placedAtMs)}</td>
                  <td data-label="Lot">{bid.lotNumber}</td>
                  <td data-label="Team">
                    {bid.teamName}{" "}
                    <span className="admin-meta">
                      {bid.paddleNumber}
                      {bid.status === "outbid" ? " · outbid" : ""}
                    </span>
                  </td>
                  <td data-label="Bid" className="admin-num">
                    {exactINR(bid.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card data-testid="auction-watch-teams">
        <h2 className="admin-section-title">Teams</h2>
        {teams.length === 0 ? (
          <p className="admin-meta">No paddles issued yet.</p>
        ) : (
          <table className="reg-table">
            <thead>
              <tr>
                <th scope="col">Team</th>
                <th scope="col" className="admin-num">
                  Players
                </th>
                <th scope="col" className="admin-num">
                  Spent
                </th>
                <th scope="col" className="admin-num">
                  Left
                </th>
                <th scope="col" className="admin-num">
                  Top buy
                </th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.paddleNumber} className="reg-row">
                  <td data-label="Team">
                    {team.teamName} <span className="admin-meta">{team.paddleNumber}</span>
                  </td>
                  <td data-label="Players" className="admin-num">
                    {team.players}
                  </td>
                  <td data-label="Spent" className="admin-num">
                    {team.spent === undefined ? "—" : compactINR(team.spent)}
                  </td>
                  <td data-label="Left" className="admin-num">
                    {team.remaining === undefined ? "—" : compactINR(team.remaining)}
                  </td>
                  <td data-label="Top buy" className="admin-num">
                    {team.highest === null ? "—" : compactINR(team.highest)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card data-testid="auction-watch-lots">
        <h2 className="admin-section-title">
          Lots <span className="admin-count">· {String(overview.totalLots)}</span>
        </h2>
        {overview.lots.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No lots yet"
            description="The organizer has not put any players into this auction."
          />
        ) : (
          <table className="reg-table">
            <thead>
              <tr>
                <th scope="col">Lot</th>
                <th scope="col">Player</th>
                <th scope="col">Status</th>
                <th scope="col" className="admin-num">
                  Base
                </th>
                <th scope="col" className="admin-num">
                  Final
                </th>
                <th scope="col">Paddle</th>
              </tr>
            </thead>
            <tbody>
              {overview.lots.map((lot) => (
                <tr key={lot.lotId} className="reg-row">
                  <td data-label="Lot">{lot.lotNumber}</td>
                  <td data-label="Player">
                    {lot.playerName ?? "Unnamed"}
                    {lot.role !== null ? (
                      <span className="admin-meta"> · {labelOf(lot.role)}</span>
                    ) : null}
                  </td>
                  <td data-label="Status">{LOT_STATUS_LABEL[lot.status] ?? lot.status}</td>
                  <td data-label="Base" className="admin-num">
                    {compactINR(lot.basePrice)}
                  </td>
                  <td data-label="Final" className="admin-num">
                    {lot.soldPrice === null ? "—" : compactINR(lot.soldPrice)}
                  </td>
                  <td data-label="Paddle">{lot.paddleNumber ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card data-testid="auction-watch-events">
        <h2 className="admin-section-title">Latest events</h2>
        <p className="admin-meta">
          The tail of the auction&rsquo;s append-only log — {String(pulse.eventCount)} events in
          all.
        </p>
        {overview.events.length === 0 ? (
          <p className="admin-meta">Nothing has happened yet.</p>
        ) : (
          <ul className="admin-timeline">
            {overview.events.map((event) => (
              <li key={event.seq}>
                <span>
                  <span className="admin-action">{event.type}</span>
                  <span className="admin-meta"> #{event.seq}</span>
                </span>
                <span className="admin-when">{istTime(event.atMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-value admin-vital">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function EngineCard({ engine }: { engine: NonNullable<AuctionWatch["engine"]> }) {
  if (engine.state === "unreachable" || engine.state === "not_checked") {
    return (
      <Card data-testid="auction-watch-engine">
        <h2 className="admin-section-title">Engine</h2>
        <p className="admin-live-trouble" role="note">
          The engine did not answer within two seconds. If this persists, check /admin/health and
          the engine&rsquo;s readiness probe.
        </p>
      </Card>
    );
  }
  if (engine.state === "idle") {
    return (
      <Card data-testid="auction-watch-engine">
        <h2 className="admin-section-title">Engine</h2>
        <p className="admin-meta">
          The engine is up but holds nothing in memory for this auction — nobody has connected since
          it last started. It loads the room the moment someone does.
        </p>
      </Card>
    );
  }
  const trouble =
    engine.halted !== null
      ? `The engine halted this room: ${engine.halted}`
      : engine.watchdogStalled
        ? "The engine's timer watchdog has stalled — lot clocks may not be advancing."
        : null;
  return (
    <Card data-testid="auction-watch-engine">
      <h2 className="admin-section-title">Engine</h2>
      {trouble !== null ? (
        <p className="admin-live-trouble" role="note">
          {trouble}
        </p>
      ) : null}
      <dl className="admin-live-facts">
        <div>
          <dt>Connected</dt>
          <dd>{engine.connectedClients}</dd>
        </div>
        <div>
          <dt>Commands waiting</dt>
          <dd>{engine.queueDepth}</dd>
        </div>
        <div>
          <dt>Commands / min</dt>
          <dd>{Math.round(engine.commandsPerMinute)}</dd>
        </div>
        <div>
          <dt>Accepted · rejected</dt>
          <dd>
            {engine.accepted} · {engine.rejected}
          </dd>
        </div>
        <div>
          <dt>Broadcast latency</dt>
          <dd>{Math.round(engine.lastBroadcastLatencyMs)} ms</dd>
        </div>
        <div>
          <dt>Recoveries</dt>
          <dd>{engine.recoveries}</dd>
        </div>
      </dl>
    </Card>
  );
}
