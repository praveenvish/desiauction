"use client";

import {
  EmptyState,
  IconBolt,
  IconClock,
  IconGavel,
  IconLayers,
  IconList,
  IconRupee,
  IconUsers,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";
import { useCallback } from "react";

import { moneyFormat } from "../../../../lib/money";
import { roleLabeller } from "../../../../lib/role-label";
import { adminAuctionWatch, type AuctionWatch } from "../../../../server/admin/live-watch";
import { eventLabel } from "../../../seasons/[slug]/auction/auction-bits";
import { AuctionOverviewPanel } from "../../../seasons/[slug]/auction/auction-overview-panel";
import { ReadOnlyNotice } from "../../admin-ui";
import { LiveFreshness } from "../../live-freshness";
import { ageLabel, istClock, istTime, istWhen, usePolled } from "../../use-polled";

const REFRESH_MS = 5_000;

const STATUS_TONE: Record<string, KitTone> = {
  live: "green",
  paused: "amber",
  scheduled: "blue",
  completed: "neutral",
  reconciled: "neutral",
  abandoned: "red",
};

/** A lot's state, toned: what is settled, what is still moving. */
const LOT_STATUS_TONE: Record<string, KitTone> = {
  sold: "green",
  unsold: "neutral",
  withdrawn: "neutral",
  queued: "neutral",
  prepared: "neutral",
  on_block: "gold",
  closing_soon: "amber",
  frozen: "red",
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
  // This room's own unit (0091): the admin tree has no season layout above it.
  const money = moneyFormat(header.auctionUnit);
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

  // A Base column that reads "1,000 pts" 37 times says one thing, once.
  const firstBase = overview.lots[0]?.basePrice ?? null;
  const sameBase =
    overview.lots.length > 1 && overview.lots.every((lot) => lot.basePrice === firstBase);

  return (
    <>
      <SectionCard
        icon={<IconGavel />}
        tone={stillRunning ? "green" : "gold"}
        title={header.seasonName}
        description={
          <>
            <Link href={`/admin/orgs/${header.orgSlug}`} className="admin-inline-link">
              {header.orgName}
            </Link>{" "}
            · {header.sport} · {header.auctionName}
          </>
        }
        action={
          <span className="admin-pills">
            <Pill tone={STATUS_TONE[header.status] ?? "neutral"} dot testId="auction-watch-status">
              {header.status}
            </Pill>
            {/* "You are watching, not conducting" — said by the pill, with the
                full sentence one tap away, instead of a paragraph per visit. */}
            <ReadOnlyNotice />
          </span>
        }
        data-testid="auction-watch-head"
      >
        <div className="admin-watch-body">
          <LiveFreshness
            generatedAtMs={data.generatedAtMs}
            polling={stillRunning && !revoked}
            failed={failed}
            revoked={revoked}
          />
          <p className="admin-meta">
            Watching, not conducting: pausing, closing or recovering happens in the
            organizer&rsquo;s cockpit.
          </p>
        </div>
      </SectionCard>

      <div className="admin-vitals">
        <StatGrid testId="auction-watch-vitals">
          <StatCard
            icon={<IconClock />}
            tone="blue"
            label={pulse.closedAtMs !== null ? "Ran" : "Opened"}
            value={
              pulse.openedAtMs === null
                ? "Not yet"
                : pulse.closedAtMs !== null
                  ? `${istClock(pulse.openedAtMs)}–${istClock(pulse.closedAtMs)}`
                  : istWhen(pulse.openedAtMs, data.generatedAtMs)
            }
          />
          <StatCard
            icon={<IconClock />}
            tone="neutral"
            label="Duration"
            value={durationMs === null ? "—" : ageLabel(durationMs)}
          />
          <StatCard
            icon={<IconBolt />}
            tone="gold"
            label={stillRunning ? "Bids · last 5 min" : "Bids"}
            value={
              stillRunning
                ? `${String(pulse.bidsLastFiveMinutes)} / ${String(pulse.bidsTotal)}`
                : String(pulse.bidsTotal)
            }
          />
          <StatCard
            icon={<IconUsers />}
            tone="purple"
            label="Teams that bid"
            value={String(pulse.activeBidders)}
          />
          <StatCard
            icon={<IconRupee />}
            tone="green"
            label="Average sale"
            value={averageSale === null ? "—" : money.compact(averageSale)}
          />
        </StatGrid>
      </div>

      <AuctionOverviewPanel
        overview={overview}
        unit={header.auctionUnit}
        idleHint="No lot is under the hammer right now."
        finished={
          header.status === "completed" ||
          header.status === "reconciled" ||
          header.status === "abandoned"
        }
      />

      {engine !== null ? <EngineCard engine={engine} /> : null}

      <SectionCard
        icon={<IconBolt />}
        tone="gold"
        title="Bid tape"
        description="The latest bids, newest first."
        flush
        data-testid="auction-watch-tape"
      >
        {pulse.tape.length === 0 ? (
          <p className="admin-card-empty">No bids yet.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table admin-tape">
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
                  <tr
                    key={`${String(bid.placedAtMs)}-${String(index)}`}
                    data-outbid={bid.status === "outbid" || undefined}
                  >
                    <td data-label="Time" className="admin-count">
                      {istTime(bid.placedAtMs)}
                    </td>
                    <td data-label="Lot" className="admin-count">
                      {bid.lotNumber}
                    </td>
                    <td data-label="Team">
                      <span className="admin-cell-main is-inline">
                        <span className="admin-name">{bid.teamName}</span>
                        <span className="admin-meta">
                          {bid.paddleNumber}
                          {bid.status === "outbid" ? " · outbid" : ""}
                        </span>
                      </span>
                    </td>
                    <td data-label="Bid" className="admin-num admin-count">
                      {money.exact(bid.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        icon={<IconUsers />}
        tone="purple"
        title="Teams"
        description="Players bought, purse spent and left, and each team's top buy."
        flush
        data-testid="auction-watch-teams"
      >
        {teams.length === 0 ? (
          <p className="admin-card-empty">No paddles issued yet.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
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
                  <tr key={team.paddleNumber}>
                    <td data-label="Team">
                      <span className="admin-cell-main">
                        <span className="admin-name">{team.teamName}</span>
                        <span className="admin-meta">{team.paddleNumber}</span>
                      </span>
                    </td>
                    <td data-label="Players" className="admin-num admin-count">
                      {team.players}
                    </td>
                    <td data-label="Spent" className="admin-num admin-count">
                      {team.spent === undefined ? "—" : money.compact(team.spent)}
                    </td>
                    <td data-label="Left" className="admin-num admin-count">
                      {team.remaining === undefined ? "—" : money.compactFloor(team.remaining)}
                    </td>
                    <td data-label="Top buy" className="admin-num admin-count">
                      {team.highest === null ? "—" : money.compact(team.highest)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        icon={<IconList />}
        tone="blue"
        title="Lots"
        description={
          sameBase && firstBase !== null
            ? `${String(overview.totalLots)} lot${overview.totalLots === 1 ? "" : "s"} · every base price ${money.compact(firstBase)}`
            : `${String(overview.totalLots)} lot${overview.totalLots === 1 ? "" : "s"} · base and final price, and the paddle that bought`
        }
        flush
        data-testid="auction-watch-lots"
      >
        {overview.lots.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              headingLevel={3}
              title="No lots yet"
              description="The organizer has not put any players into this auction."
            />
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Lot</th>
                  <th scope="col">Status</th>
                  {sameBase ? null : (
                    <th scope="col" className="admin-num">
                      Base
                    </th>
                  )}
                  <th scope="col" className="admin-num">
                    Final
                  </th>
                  <th scope="col">Paddle</th>
                </tr>
              </thead>
              <tbody>
                {overview.lots.map((lot) => (
                  <tr key={lot.lotId}>
                    <td data-label="Player">
                      <span className="admin-cell-main">
                        <span className="admin-name">{lot.playerName ?? "Unnamed"}</span>
                        {lot.role !== null ? (
                          <span className="admin-meta">{labelOf(lot.role)}</span>
                        ) : null}
                      </span>
                    </td>
                    <td data-label="Lot" className="admin-count">
                      {lot.lotNumber}
                    </td>
                    <td data-label="Status">
                      <Pill tone={LOT_STATUS_TONE[lot.status] ?? "neutral"}>
                        {LOT_STATUS_LABEL[lot.status] ?? lot.status}
                      </Pill>
                    </td>
                    {sameBase ? null : (
                      <td data-label="Base" className="admin-num admin-count">
                        {money.compact(lot.basePrice)}
                      </td>
                    )}
                    <td data-label="Final" className="admin-num admin-count">
                      {lot.soldPrice === null ? "—" : money.compact(lot.soldPrice)}
                    </td>
                    <td data-label="Paddle">{lot.paddleNumber ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        icon={<IconLayers />}
        tone="neutral"
        title="Latest events"
        description={`The tail of the auction’s append-only log — ${String(pulse.eventCount)} events in all.`}
        flush
        data-testid="auction-watch-events"
      >
        {overview.events.length === 0 ? (
          <p className="admin-card-empty">Nothing has happened yet.</p>
        ) : (
          <ul className="admin-rows">
            {overview.events.map((event) => (
              <li key={event.seq}>
                <span>
                  {/* The engine's own names ("AuctionClosed") read as code on
                      a page people run the night from. The hub already speaks
                      them as words; the raw type stays on hover. */}
                  <span className="admin-action" title={event.type}>
                    {eventLabel(event.type)}
                  </span>
                  <span className="admin-meta"> #{event.seq}</span>
                </span>
                <span className="admin-when">{istTime(event.atMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}

function EngineCard({ engine }: { engine: NonNullable<AuctionWatch["engine"]> }) {
  if (engine.state === "unreachable" || engine.state === "not_checked") {
    return (
      <SectionCard icon={<IconBolt />} tone="red" title="Engine" data-testid="auction-watch-engine">
        <p className="admin-live-trouble" role="note">
          The engine did not answer within two seconds. If this persists, check /admin/health and
          the engine&rsquo;s readiness probe.
        </p>
      </SectionCard>
    );
  }
  if (engine.state === "idle") {
    return (
      <SectionCard
        icon={<IconBolt />}
        tone="neutral"
        title="Engine"
        data-testid="auction-watch-engine"
      >
        <p className="admin-meta">
          The engine is up but holds nothing in memory for this auction — nobody has connected since
          it last started. It loads the room the moment someone does.
        </p>
      </SectionCard>
    );
  }
  const trouble =
    engine.halted !== null
      ? `The engine halted this room: ${engine.halted}`
      : engine.watchdogStalled
        ? "The engine's timer watchdog has stalled — lot clocks may not be advancing."
        : null;
  return (
    <SectionCard
      icon={<IconBolt />}
      tone={trouble !== null ? "red" : "green"}
      title="Engine"
      description="The engine's own view of the room."
      data-testid="auction-watch-engine"
    >
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
    </SectionCard>
  );
}
