"use client";

import {
  EmptyState,
  IconBolt,
  IconChevronDown,
  IconClock,
  IconGavel,
  IconLayers,
  IconUsers,
  Pill,
  PlayerImage,
  SectionCard,
  SegmentedTabs,
  StateDot,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";

import { moneyFormat } from "../../../../lib/money";
import { countNoun, formatCount } from "../../../../lib/plural";
import { roleLabeller } from "../../../../lib/role-label";
import { adminAuctionWatch, type AuctionWatch } from "../../../../server/admin/live-watch";
import { eventLabel } from "../../../seasons/[slug]/auction/auction-bits";
import { ReadOnlyNotice, RecentFold } from "../../admin-ui";
import { LiveFreshness } from "../../live-freshness";
import { ageLabel, istClock, istTime, istWhen, usePolled } from "../../use-polled";

/** A lot list shows ten before "Show all"; a filter narrows it first. */
const LOTS_SHOWN = 10;

const REFRESH_MS = 5_000;

const STATUS_TONE: Record<string, KitTone> = {
  live: "green",
  paused: "amber",
  scheduled: "neutral",
  completed: "green",
  reconciled: "green",
  abandoned: "red",
};

/** The row's dot: the ui kit's shared state palette. */
const LOT_STATUS_DOT: Record<string, string | null> = {
  sold: "sold",
  on_block: "live",
  closing_soon: "pending",
  frozen: "error",
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

type LotFilter = "all" | "sold" | "unsold" | "to-come";

function isRunning(watch: AuctionWatch): boolean {
  return watch.header.status === "live" || watch.header.status === "paused";
}

/**
 * One auction, watched — and, once it has closed, its report.
 *
 * While the room is live the page refreshes itself every five seconds: the
 * result so far, what is on the block, the bid tape and the engine's own view
 * of the room. When the auction ends the same page stops refreshing and reads
 * as the result (redesign, 2026-09-27): how it ended, where each team landed,
 * and every lot — with the tape and the log folded away as the records they
 * now are. It is the organizer's own read of the auction (auctionOverview),
 * so the numbers here cannot disagree with the ones in their console.
 *
 * Before the redesign a closed night stacked nine blocks: five stat tiles, the
 * old progress panel, a tape of the last 15 bids under a "289 bids" tile, a
 * Teams table repeating the purse burndown, and "Show all 12" of 797 events.
 */
export function AuctionWatchView({ initial }: { initial: AuctionWatch }) {
  const auctionId = initial.header.auctionId;
  const fetcher = useCallback(() => adminAuctionWatch(auctionId), [auctionId]);
  // Polls while the room is open, and stops by itself the moment it closes.
  const { data, failed, revoked } = usePolled(initial, fetcher, REFRESH_MS, isRunning);
  const { header, overview, pulse, engine } = data;
  // This room's own unit (0091): the admin tree has no season layout above it.
  const money = moneyFormat(header.auctionUnit);
  const points = header.auctionUnit === "points";
  const stillRunning = isRunning(data);
  const labelOf = roleLabeller(overview.roles);
  const [filter, setFilter] = useState<LotFilter>("all");

  const endMs = pulse.closedAtMs ?? (stillRunning ? data.generatedAtMs : pulse.lastEventAtMs);
  const durationMs = pulse.openedAtMs === null || endMs === null ? null : endMs - pulse.openedAtMs;
  const when =
    pulse.openedAtMs === null
      ? "Not opened yet"
      : pulse.closedAtMs !== null
        ? `Ran ${istClock(pulse.openedAtMs)}–${istClock(pulse.closedAtMs)}`
        : `Opened ${istWhen(pulse.openedAtMs, data.generatedAtMs)}`;

  const { counts, totalLots, moneyMoved, paddles, onBlock } = overview;
  const sold = overview.lots.filter((lot) => lot.status === "sold");
  const teamOf = new Map(paddles.map((paddle) => [paddle.paddleNumber, paddle]));
  const teams = paddles.map((paddle) => {
    const prices = sold
      .filter((lot) => lot.paddleNumber === paddle.paddleNumber)
      .map((lot) => lot.soldPrice ?? 0);
    return {
      ...paddle,
      players: prices.length,
      highest: prices.length === 0 ? null : Math.max(...prices),
    };
  });
  const averageSale =
    sold.length === 0
      ? null
      : // Whole units: money is stored ×100, and "5,816.67 pts" is noise.
        Math.round(sold.reduce((sum, lot) => sum + (lot.soldPrice ?? 0), 0) / sold.length / 100) *
        100;
  const topBuy = sold.reduce<(typeof sold)[number] | null>(
    (best, lot) => (best === null || (lot.soldPrice ?? 0) > (best.soldPrice ?? 0) ? lot : best),
    null,
  );
  const purseTotal = paddles.every((row) => row.purseTotal !== undefined)
    ? paddles.reduce((sum, row) => sum + (row.purseTotal ?? 0), 0)
    : null;
  const usedShare = purseTotal !== null && purseTotal > 0 ? (moneyMoved / purseTotal) * 100 : null;
  // A first sale out of a ₹2 Cr purse is not "0%".
  const usedPct =
    usedShare === null
      ? null
      : usedShare > 0 && usedShare < 0.1
        ? "under 0.1"
        : usedShare.toFixed(1).replace(/\.0$/, "");
  const pct = (n: number) => (totalLots > 0 ? (n / totalLots) * 100 : 0);
  const toCome = counts.queued + counts.prepared + counts.onBlock;
  const segments = [
    { key: "sold", n: counts.sold },
    { key: "block", n: counts.onBlock },
    { key: "queued", n: counts.queued + counts.prepared },
    { key: "unsold", n: counts.unsold },
  ];

  const shownLots = overview.lots.filter((lot) =>
    filter === "all"
      ? true
      : filter === "sold"
        ? lot.status === "sold"
        : filter === "unsold"
          ? lot.status === "unsold" || lot.status === "withdrawn"
          : lot.status !== "sold" && lot.status !== "unsold" && lot.status !== "withdrawn",
  );
  const filters: { key: LotFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: totalLots },
    { key: "sold", label: "Sold", count: counts.sold },
    { key: "unsold", label: "Unsold", count: counts.unsold },
    ...(toCome > 0 ? [{ key: "to-come" as const, label: "To come", count: toCome }] : []),
  ];

  const tapeRows =
    pulse.tape.length === 0 ? (
      <div className="admin-card-empty">
        <EmptyState size="compact" icon={<IconGavel />} title="No bids yet" />
      </div>
    ) : (
      <ul className="admin-watch-tape">
        {pulse.tape.map((bid, index) => (
          <li
            key={`${String(bid.placedAtMs)}-${String(index)}`}
            data-outbid={bid.status === "outbid" || undefined}
          >
            <span className="admin-watch-when">{istTime(bid.placedAtMs)}</span>
            <span className="admin-watch-who">
              <strong>{bid.teamName}</strong>
              <span>
                {bid.paddleNumber} · lot {bid.lotNumber}
                {bid.status === "outbid" ? " · outbid" : ""}
              </span>
            </span>
            <span className="admin-watch-fig">{money.exact(bid.amount)}</span>
          </li>
        ))}
      </ul>
    );

  const eventRows =
    overview.events.length === 0 ? (
      <div className="admin-card-empty">
        <EmptyState size="compact" icon={<IconClock />} title="Nothing has happened yet" />
      </div>
    ) : (
      // Already one press away inside its fold: no second "Show all".
      <ul className="admin-rows">
        {overview.events.map((event) => (
          <li key={event.seq}>
            <span>
              {/* The engine's own names ("AuctionClosed") read as code; the
                  hub speaks them as words and the raw type stays on hover. */}
              <span className="admin-action" title={event.type}>
                {eventLabel(event.type)}
              </span>
              <span className="admin-meta"> #{event.seq}</span>
            </span>
            <span className="admin-when">{istTime(event.atMs)}</span>
          </li>
        ))}
      </ul>
    );

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
            · {header.sport} · {when}
            {durationMs !== null ? ` · ${ageLabel(durationMs)}` : ""}
          </>
        }
        action={
          <span className="admin-pills">
            <Pill tone={STATUS_TONE[header.status] ?? "neutral"} dot testId="auction-watch-status">
              {/* Title case, as every other "Completed" in the product. */}
              {header.status.charAt(0).toUpperCase() + header.status.slice(1)}
            </Pill>
            {/* "You are watching, not conducting" — the pill says it, with
                the full sentence one tap away. */}
            <ReadOnlyNotice />
          </span>
        }
        data-testid="auction-watch-head"
      >
        {stillRunning ? (
          <LiveFreshness
            generatedAtMs={data.generatedAtMs}
            polling={!revoked}
            failed={failed}
            revoked={revoked}
          />
        ) : undefined}
      </SectionCard>

      {/* The result, in the organizer hub's own words: sold of total, the
          spend and its share of every purse, and the figures the five stat
          tiles used to hold. */}
      <section
        className="admin-watch-result"
        aria-labelledby="admin-watch-result-title"
        data-testid="auction-watch-result"
      >
        <h2 id="admin-watch-result-title" className="admin-watch-result-title">
          {counts.sold} of {totalLots} sold
        </h2>
        <p className="admin-watch-result-sub">
          <span>
            {counts.sold} sold · {counts.unsold} unsold
            {toCome > 0 ? ` · ${String(toCome)} to come` : ""}
          </span>
          <span>
            {points ? money.exact(moneyMoved) : money.compact(moneyMoved)} spent
            {usedPct !== null ? ` · ${usedPct}% of every purse` : ""}
          </span>
        </p>
        <span className="admin-watch-bar" aria-hidden>
          {segments.map((segment) =>
            segment.n > 0 ? (
              <span
                key={segment.key}
                data-kind={segment.key}
                style={{ width: `${String(pct(segment.n))}%` }}
              />
            ) : null,
          )}
        </span>
        <dl className="admin-watch-figures" data-testid="auction-watch-vitals">
          <div>
            <dt>
              {stillRunning
                ? `bids · ${formatCount(pulse.bidsLastFiveMinutes)} in the last 5 min`
                : "bids"}
            </dt>
            <dd>{formatCount(pulse.bidsTotal)}</dd>
          </div>
          <div>
            <dt>teams that bid</dt>
            <dd>
              {pulse.activeBidders} of {paddles.length}
            </dd>
          </div>
          <div>
            <dt>average sale</dt>
            <dd>{averageSale === null ? "—" : money.exact(averageSale)}</dd>
          </div>
          <div>
            <dt>top buy{topBuy !== null ? ` · ${topBuy.playerName ?? "Unnamed"}` : ""}</dt>
            <dd>{topBuy === null ? "—" : money.exact(topBuy.soldPrice ?? 0)}</dd>
          </div>
        </dl>
      </section>

      {/* A room still running keeps its moving parts at the top. */}
      {stillRunning ? (
        <SectionCard
          icon={<IconGavel />}
          tone={onBlock !== null ? "green" : "neutral"}
          title={onBlock !== null ? "On the block now" : "Nothing on the block"}
          description={onBlock === null ? "No lot is under the hammer right now." : undefined}
          data-testid="auction-watch-block"
        >
          {onBlock !== null ? (
            <div className="admin-watch-block">
              <PlayerImage
                name={onBlock.playerName ?? "Unnamed"}
                seed={onBlock.registrationId}
                src={onBlock.photoUrl}
                size="md"
                shape="round"
                decorative
              />
              <span className="admin-watch-who">
                <strong>{onBlock.playerName ?? "Unnamed"}</strong>
                <span>
                  {onBlock.lotNumber} · {labelOf(onBlock.role)} · base{" "}
                  {money.exact(onBlock.basePrice)}
                </span>
              </span>
              <span className="admin-watch-who is-end">
                <strong>
                  {onBlock.currentBid !== null ? money.exact(onBlock.currentBid) : "No bids yet"}
                </strong>
                {onBlock.leadingTeamName !== null ? <span>{onBlock.leadingTeamName}</span> : null}
              </span>
            </div>
          ) : null}
        </SectionCard>
      ) : null}
      {engine !== null ? <EngineCard engine={engine} /> : null}
      {stillRunning ? (
        <SectionCard
          icon={<IconBolt />}
          tone="gold"
          title="Bid tape"
          description="The latest bids, newest first."
          flush
          data-testid="auction-watch-tape"
        >
          {tapeRows}
        </SectionCard>
      ) : null}

      {/* One card per team: the purse burndown and the Teams table listed the
          same rows twice. */}
      <SectionCard
        icon={<IconUsers />}
        tone="purple"
        title="Teams"
        flush
        data-testid="auction-watch-teams"
      >
        {teams.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState size="compact" icon={<IconUsers />} title="No paddles issued yet" />
          </div>
        ) : (
          <ul className="admin-watch-teams">
            {teams.map((team) => {
              const used =
                team.purseTotal !== undefined && team.spent !== undefined && team.purseTotal > 0
                  ? Math.round((team.spent / team.purseTotal) * 100)
                  : null;
              return (
                <li key={team.paddleNumber}>
                  <span
                    className="admin-watch-paddle"
                    style={team.color !== null ? { ["--team" as string]: team.color } : {}}
                  >
                    {team.paddleNumber}
                  </span>
                  <span className="admin-watch-team">
                    <span className="admin-watch-who is-inline">
                      <strong>{team.teamName}</strong>
                      <span>{team.players} bought</span>
                    </span>
                    {used !== null ? (
                      <span
                        className="admin-watch-spend"
                        style={team.color !== null ? { ["--team" as string]: team.color } : {}}
                        aria-hidden
                      >
                        <span style={{ width: `${String(used)}%` }} />
                      </span>
                    ) : null}
                  </span>
                  <span className="admin-watch-who is-end">
                    <strong>{team.spent === undefined ? "—" : money.exact(team.spent)}</strong>
                    <span>
                      {team.remaining === undefined
                        ? "sealed"
                        : `${money.compactFloor(team.remaining)} left`}
                    </span>
                  </span>
                  <span className="admin-watch-who is-end admin-watch-top">
                    <span>Top buy</span>
                    <strong>{team.highest === null ? "—" : money.exact(team.highest)}</strong>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        icon={<IconGavel />}
        tone="blue"
        title="Lots"
        flush
        action={
          totalLots > 0 ? (
            <SegmentedTabs
              label="Show lots"
              items={filters.map((option) => ({
                key: option.key,
                label: option.label,
                count: option.count,
                active: option.key === filter,
                onSelect: () => {
                  setFilter(option.key);
                },
              }))}
            />
          ) : undefined
        }
        data-testid="auction-watch-lots"
      >
        {overview.lots.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              size="compact"
              headingLevel={3}
              title="No lots yet"
              description="The organizer has not put any players into this auction."
            />
          </div>
        ) : shownLots.length === 0 ? (
          <p className="admin-card-empty admin-meta">No lots here.</p>
        ) : (
          <RecentFold key={filter} items={shownLots} className="admin-watch-lots" keep={LOTS_SHOWN}>
            {(lot) => {
              const team = lot.paddleNumber !== null ? teamOf.get(lot.paddleNumber) : undefined;
              return (
                <li key={lot.lotId}>
                  <span className="admin-watch-lot-no">{lot.lotNumber}</span>
                  <span className="admin-watch-who">
                    <strong>{lot.playerName ?? "Unnamed"}</strong>
                    <span>
                      <span className="admin-watch-phone">{lot.lotNumber} · </span>
                      {lot.role !== null ? labelOf(lot.role) : "—"}
                      {team !== undefined ? (
                        <span className="admin-watch-phone"> · {team.teamName}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="admin-watch-lot-team">
                    {team !== undefined ? (
                      <>
                        <span
                          className="admin-watch-dot"
                          style={team.color !== null ? { background: team.color } : {}}
                          aria-hidden
                        />
                        {team.teamName}
                      </>
                    ) : null}
                  </span>
                  <span className="admin-watch-who is-end">
                    {lot.soldPrice !== null ? (
                      <strong>{money.exact(lot.soldPrice)}</strong>
                    ) : (
                      <span className="admin-lot-state">
                        <StateDot state={LOT_STATUS_DOT[lot.status] ?? null} />
                        {LOT_STATUS_LABEL[lot.status] ?? lot.status}
                      </span>
                    )}
                  </span>
                </li>
              );
            }}
          </RecentFold>
        )}
      </SectionCard>

      {/* A closed night's tape and log are records, not feeds: two rows that
          open. The live room shows its tape above. */}
      <div className="admin-watch-folds">
        {stillRunning ? null : (
          <Fold
            icon={<IconBolt size={18} />}
            title="Bid tape"
            hint={
              pulse.tape.length > 0
                ? `The last ${countNoun(pulse.tape.length, "bid")} of ${formatCount(pulse.bidsTotal)}`
                : "No bids"
            }
            testId="auction-watch-tape"
          >
            {tapeRows}
          </Fold>
        )}
        <Fold
          icon={<IconLayers size={18} />}
          title="Event log"
          hint={`${countNoun(pulse.eventCount, "event")} · the latest ${formatCount(overview.events.length)} here`}
          testId="auction-watch-events"
        >
          {eventRows}
        </Fold>
      </div>
    </>
  );
}

function Fold({
  icon,
  title,
  hint,
  testId,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <details className="admin-watch-fold" data-testid={testId}>
      <summary>
        <span aria-hidden>{icon}</span>
        <strong>{title}</strong>
        <span className="admin-watch-fold-hint">{hint}</span>
        <IconChevronDown size={16} aria-hidden className="admin-watch-caret" />
      </summary>
      {children}
    </details>
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
