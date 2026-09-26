"use client";

import type { AuctionSnapshot, PlanState } from "@desiauction/core";
import {
  Badge,
  ButtonLink,
  Card,
  IconBroadcast,
  IconCheck,
  IconCrown,
  IconFile,
  IconLedger,
  IconPlay,
  IconTrophy,
  IconUsers,
  IconWallet,
  Pill,
  PlayerImage,
  SectionCard,
  StatCard,
  StatGrid,
  TeamChip,
  type KitTone,
} from "@desiauction/ui";
import { useEffect, useState, type ReactNode } from "react";

import { useMoney } from "../../../../components/money-unit";
import type { MoneyFormat } from "../../../../lib/money";
import { lotSeed } from "../../../../lib/player-seed";
import type { AuctionRules, LotMedia, ResolvedLot } from "../../../../server/auction/live-summary";
import { fitBadge } from "./plan/plan-model";
import "./dashboard.css";
import "./live/live.css";

// PX-6 live-experience kit: presentation over the broadcast AuctionSnapshot
// and the resolved-lot history. NOTHING here decides — money math comes from
// the snapshot (committed/purseRemaining) and the canonical increment helper;
// timelines are observed transitions of server truth.

export interface FeedEvent {
  key: string;
  kind:
    | "sold"
    | "unsold"
    | "withdrawn"
    | "held"
    | "reopened"
    | "paused"
    | "resumed"
    | "recovered"
    | "completed";
  label: string;
  detail: string | null;
  /**
   * The lot an outcome is about, so the timeline can put the player's face on
   * the line. Absent on auction-wide events (paused, recovered, completed).
   */
  subject?: { lotId: string; playerName: string | null };
}

/** Faces keyed by lot id, as every live view carries them (`lotMediaOf`). */
type MediaByLot = Readonly<Record<string, LotMedia>>;

/**
 * A player's face on a live list row: photo or branded mark, seeded by the
 * registration (lib/player-seed). Decorative — every caller prints the name
 * right beside it.
 */
function LotFace({
  lotId,
  name,
  lotMedia,
  size = "xs",
  teamColor,
}: {
  lotId: string;
  name: string;
  lotMedia: MediaByLot;
  size?: "xs" | "sm" | "md";
  /** The buying franchise's colour, when the row has one — it rings the face. */
  teamColor?: string | null;
}) {
  return (
    <PlayerImage
      name={name}
      seed={lotSeed(lotId, lotMedia)}
      src={lotMedia[lotId]?.photoUrl}
      size={size}
      shape="round"
      decorative
      {...(teamColor === null || teamColor === undefined ? {} : { teamColor, ring: true })}
    />
  );
}

export interface LiveFeed {
  resolved: ResolvedLot[];
  events: FeedEvent[];
}

const OUTCOME_KIND: Record<string, FeedEvent["kind"]> = {
  sold: "sold",
  unsold: "unsold",
  withdrawn: "withdrawn",
  held: "held",
  reopened: "reopened",
};

/** Everything the feed has folded in so far. */
export interface FeedState extends LiveFeed {
  /** The snapshot last folded — the render-time guard against folding twice. */
  folded: AuctionSnapshot | null;
  /** Outcome seqs already applied: a reconnect replays the same outcome. */
  seenSeqs: ReadonlySet<number>;
  lastStatus: string | null;
  recoveries: number;
}

/**
 * One snapshot folded into the feed. Pure: the previous feed in, the next out.
 *
 * Outcomes are keyed by atSeq, so a reconnect replaying the same outcome is a
 * no-op; status changes and recoveries are compared against what the feed
 * last saw rather than against the previous render.
 */
export function foldSnapshot(
  feed: FeedState,
  snapshot: AuctionSnapshot,
  money: MoneyFormat,
): FeedState {
  let { resolved, events, seenSeqs } = feed;
  const outcome = snapshot.lastOutcome;
  if (outcome !== null && !feed.seenSeqs.has(outcome.atSeq)) {
    seenSeqs = new Set(feed.seenSeqs).add(outcome.atSeq);
    const kind = OUTCOME_KIND[outcome.kind.toLowerCase()] ?? "sold";
    if (kind === "sold" || kind === "unsold" || kind === "withdrawn") {
      const rest = resolved.filter((entry) => entry.lotId !== outcome.lotId);
      resolved = [
        ...rest,
        {
          lotId: outcome.lotId,
          // The snapshot outcome is spectator-safe and carries no
          // registration id; the next server read fills it in.
          registrationId: null,
          // Nor does it carry the squad marks, for the same reason — so a
          // captain sold seconds ago wears the badge from the next server
          // read rather than from this optimistic row. False is the honest
          // value here: absent, not "not a captain".
          isCaptain: false,
          isViceCaptain: false,
          lotNumber: outcome.lotNumber,
          seq: Number.MAX_SAFE_INTEGER - outcome.atSeq,
          playerName: outcome.playerName,
          role: "",
          status: kind,
          soldPrice: outcome.amount,
          teamId: null,
          teamName: outcome.teamName,
        },
      ];
    }
    events = [
      {
        key: `outcome-${String(outcome.atSeq)}`,
        kind,
        label:
          kind === "sold"
            ? `${outcome.playerName ?? outcome.lotNumber} — SOLD to ${outcome.teamName ?? "?"}`
            : kind === "unsold"
              ? `${outcome.playerName ?? outcome.lotNumber} — passes for now`
              : kind === "held"
                ? `${outcome.playerName ?? outcome.lotNumber} — frozen by the auctioneer`
                : kind === "reopened"
                  ? `${outcome.playerName ?? outcome.lotNumber} — reopened (undo)`
                  : `${outcome.playerName ?? outcome.lotNumber} — withdrawn`,
        detail: outcome.amount !== null ? money.ledger(outcome.amount) : null,
        subject: { lotId: outcome.lotId, playerName: outcome.playerName },
      },
      ...events,
    ];
  }
  const previousStatus = feed.lastStatus;
  if (previousStatus !== null && previousStatus !== snapshot.auctionStatus) {
    const transitions: Record<string, FeedEvent["kind"] | undefined> = {
      paused: "paused",
      live: previousStatus === "paused" ? "resumed" : undefined,
      completed: "completed",
    };
    const kind = transitions[snapshot.auctionStatus];
    if (kind !== undefined) {
      events = [
        {
          key: `status-${String(snapshot.version)}`,
          kind,
          label:
            kind === "paused"
              ? "Auction paused"
              : kind === "resumed"
                ? "Auction resumed"
                : "Auction completed",
          detail: null,
        },
        ...events,
      ];
    }
  }
  let recoveries = feed.recoveries;
  if (snapshot.recoveries > recoveries) {
    recoveries = snapshot.recoveries;
    events = [
      {
        key: `recovered-${String(snapshot.recoveries)}-${String(snapshot.version)}`,
        kind: "recovered",
        label: "State recovered — every bid verified",
        detail: null,
      },
      ...events,
    ];
  }
  return {
    resolved,
    events,
    seenSeqs,
    lastStatus: snapshot.auctionStatus,
    recoveries,
    folded: snapshot,
  };
}

/**
 * Accumulates the live feed from snapshot deltas on top of the server-rendered
 * history: lot outcomes (keyed by atSeq — idempotent under reconnect replays)
 * and major auction transitions (pause/resume/recovery/completion).
 *
 * The fold runs DURING render when a new snapshot arrives, so the timeline and
 * the board it sits beside change in the same commit. It was an effect before,
 * which painted every new snapshot once with a stale timeline and then again.
 */
export function useLiveFeed(initial: ResolvedLot[], snapshot: AuctionSnapshot | null): LiveFeed {
  const money = useMoney();
  const [feed, setFeed] = useState<FeedState>(() => ({
    resolved: initial,
    events: [],
    folded: null,
    seenSeqs: new Set(),
    lastStatus: null,
    recoveries: 0,
  }));
  if (snapshot !== null && snapshot !== feed.folded) {
    setFeed(foldSnapshot(feed, snapshot, money));
  }
  return { resolved: feed.resolved, events: feed.events };
}

/**
 * The pill's word where the engine's kind is not the public one. The
 * timeline rendered the raw kind, so a public stage printed "UNSOLD" beside a
 * player's face — the word content/help.ts rules out on a public screen.
 */
const FEED_PILL: Partial<Record<FeedEvent["kind"], string>> = {
  unsold: "Passed",
};

const FEED_TONE: Record<FeedEvent["kind"], KitTone> = {
  sold: "blue",
  unsold: "neutral",
  withdrawn: "red",
  held: "purple",
  reopened: "amber",
  paused: "amber",
  resumed: "green",
  recovered: "neutral",
  completed: "green",
};

/** The auction timeline: outcomes and conduct events, newest first. */
export function AuctionTimeline({
  feed,
  limit = 12,
  lotMedia = {},
  teamColors,
}: {
  feed: LiveFeed;
  limit?: number;
  lotMedia?: MediaByLot;
  /**
   * Team NAME → colour. The timeline is the night's history of PEOPLE: the face
   * is read at a glance and the ring says which franchise took them.
   */
  teamColors?: ReadonlyMap<string, string | null>;
}) {
  const teamOfLot = new Map(feed.resolved.map((lot) => [lot.lotId, lot.teamName]));
  if (feed.events.length === 0) {
    return null;
  }
  return (
    <Card data-testid="auction-timeline" className="live-card">
      <h2>Auction timeline</h2>
      <ol className="live-rail-list">
        {feed.events.slice(0, limit).map((event) => (
          <li key={event.key} data-testid={`timeline-${event.kind}`} data-kind={event.kind}>
            <span className="live-rail-dot" aria-hidden />
            <span className="live-rail-pill">
              <Pill tone={FEED_TONE[event.kind]}>{FEED_PILL[event.kind] ?? event.kind}</Pill>
            </span>
            {event.subject === undefined ? null : (
              <LotFace
                lotId={event.subject.lotId}
                name={event.subject.playerName ?? ""}
                lotMedia={lotMedia}
                size="md"
                teamColor={teamColors?.get(teamOfLot.get(event.subject.lotId) ?? "") ?? null}
              />
            )}
            <span className="live-rail-label">{event.label}</span>
            {event.detail !== null ? <span className="timeline-at">{event.detail}</span> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * The bidding on the lot, newest first, as the founder mockup reads it: the
 * paddle on its team's colour, the team, what they did, and the amount. The
 * snapshot carries no bid times, so there is no time column to fake.
 */
export function BidFeedList({
  bids,
  playerName,
  teamColors,
  testId,
}: {
  bids: readonly { bidId: string; paddleNumber: string; teamName: string; amount: number }[];
  playerName: string | null;
  /** Team NAME → colour: the bid entries carry the name, not the id. */
  teamColors: ReadonlyMap<string, string | null>;
  testId?: string;
}) {
  const money = useMoney();
  const newestFirst = [...bids].reverse();
  return (
    <ol className="bid-feed-list" data-testid={testId}>
      {newestFirst.map((entry, index) => (
        <li key={entry.bidId} data-leading={index === 0 ? "true" : undefined}>
          <TeamChip color={teamColors.get(entry.teamName) ?? null}>{entry.paddleNumber}</TeamChip>
          <span className="bid-feed-team">{entry.teamName}</span>
          <span className="bid-feed-action">
            {index === newestFirst.length - 1 ? "opened the bidding" : "raised"}
            {playerName !== null ? (
              <>
                {" "}
                for <strong>{playerName}</strong>
              </>
            ) : null}
          </span>
          <span className="bid-feed-amount">{money.ledger(entry.amount)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Progress + anti-snipe chips, derived from the snapshot alone. */
/**
 * RENDERS WHILE CONNECTING, rather than appearing when the socket answers.
 *
 * Returning `null` for a missing snapshot cost nothing to write and 0.564 CLS
 * to use: this sits in the middle of the live room's right-hand column, so its
 * arrival ~400ms after first paint pushed the purse board, the pool summary and
 * the squad board down together — up to 842px of movement on the screen a
 * bidder is about to tap.
 *
 * The bar is the same bar at 0%, and the counts are em dashes until they are
 * known. Nothing is claimed that is not true, and the column does not move.
 */
export function AuctionProgress({ snapshot }: { snapshot: AuctionSnapshot | null }) {
  const pct =
    snapshot === null || snapshot.lotsTotal === 0
      ? 0
      : Math.round((snapshot.lotsResolved / snapshot.lotsTotal) * 100);
  const extensions = snapshot?.currentLot?.extensions ?? 0;
  return (
    <div
      className="live-progress"
      data-testid="auction-progress"
      data-connecting={snapshot === null}
    >
      <div className="live-progress-bar" role="presentation">
        <span style={{ width: `${String(pct)}%` }} />
      </div>
      <span className="competitions-hint">
        {snapshot === null
          ? "— / — lots · — in queue"
          : `${String(snapshot.lotsResolved)}/${String(snapshot.lotsTotal)} lots · ${String(snapshot.queue.length)} in queue`}
      </span>
      {snapshot?.currentLot?.status === "closing_soon" ? (
        <Badge tone="warning" data-testid="closing-soon">
          Closing soon
        </Badge>
      ) : null}
      {extensions > 0 ? (
        <Badge tone="info" data-testid="anti-snipe">
          Anti-snipe ×{extensions}
        </Badge>
      ) : null}
    </div>
  );
}

/* BidLadder lived here: the next three legal steps rendered as the prose
   "Ladder: ₹20L → ₹25L → ₹30L". PaddleControl now renders the same rungs as
   pressable chips and carries the `bid-ladder` handle, so this had no callers
   left — and two elements sharing that testid would fail Playwright's strict
   mode the moment both were on screen. */

/** The owner workspace: purse, spend, squad and slots — all server truth. */
export function MyTeamCard({
  snapshot,
  myTeamId,
  myTeamName,
  myPaddleNumber,
  rules,
  feed,
  squadSize,
  plan = null,
  lotMedia = {},
}: {
  snapshot: AuctionSnapshot | null;
  myTeamId: string;
  myTeamName: string;
  myPaddleNumber: string;
  rules: AuctionRules;
  feed: LiveFeed;
  /**
   * The WHOLE squad — pre-signed players plus auction buys, deduped by
   * `squadSizesOf`. The list below this tile is the night's wins, which is a
   * different number: a team with two icons and ten buys has won ten lots and
   * signed twelve players. Counting the wins here printed "10/12 Squad" beside
   * a "12/12" on the same screen, telling an owner they were two short of a
   * squad the engine had already closed.
   */
  squadSize: number;
  /**
   * WR-1: the owner's plan folded against this frame, or null when they have
   * none — in which case the card is exactly what it was before plans existed.
   */
  plan?: PlanState | null;
  /** Faces for the squad list, keyed by lot id. */
  lotMedia?: MediaByLot;
}) {
  const money = useMoney();
  const paddle = snapshot?.paddles.find((entry) => entry.paddleNumber === myPaddleNumber) ?? null;
  const fit = plan === null ? null : fitBadge(plan.budget.fit);
  const squad = feed.resolved.filter(
    (lot) => lot.status === "sold" && (lot.teamId === myTeamId || lot.teamName === myTeamName),
  );
  const leading =
    snapshot?.currentLot?.currentBid !== null &&
    snapshot?.currentLot?.currentBid.paddleNumber === myPaddleNumber;
  const complete = squadSize >= rules.squadMax;
  return (
    <Card data-testid="my-team-card" className="live-card my-team">
      <div className="competition-head">
        <h2>{myTeamName}</h2>
        {leading ? (
          <Badge tone="success" data-testid="my-team-leading">
            Leading this lot
          </Badge>
        ) : (
          <a className="live-card-link" href="#live-squads">
            View squad
          </a>
        )}
      </div>
      {paddle !== null ? (
        <div className="my-team-stats">
          {/* This is the viewer's OWN paddle, so the engine always sends its
              money; the fallback exists because the type is honest about
              redaction, not because a bidder is ever denied their own purse. */}
          <div className="my-team-stat" data-testid="my-purse">
            <span className="my-team-value">
              {paddle.purseRemaining === null ? "—" : money.ledger(paddle.purseRemaining)}
            </span>
            <span className="my-team-label">Purse remaining</span>
          </div>
          <div className="my-team-stat" data-testid="my-spent">
            <span className="my-team-value">
              {paddle.committed === null ? "—" : money.ledger(paddle.committed)}
            </span>
            <span className="my-team-label">Committed</span>
          </div>
          <div className="my-team-stat" data-testid="my-slots">
            <span className="my-team-value">
              {squadSize}/{rules.squadMax}
            </span>
            <span className="my-team-label">Squad (min {rules.squadMin})</span>
          </div>
          {plan !== null && fit !== null ? (
            <div className="my-team-stat" data-testid="my-plan-headroom" data-fit={plan.budget.fit}>
              <span className="my-team-value">
                {plan.budget.headroom < 0
                  ? `−${money.ledger(-plan.budget.headroom)}`
                  : money.ledger(plan.budget.headroom)}
              </span>
              <span className="my-team-label">Plan headroom</span>
              <Badge tone={fit.tone} className="plan-tile-badge">
                {plan.budget.fit === "fits"
                  ? "Fits"
                  : plan.budget.fit === "at_risk"
                    ? "At risk"
                    : "Over purse"}
              </Badge>
            </div>
          ) : (
            <div className="my-team-stat my-team-stat--pill">
              <Pill
                tone={complete ? "green" : squadSize >= rules.squadMin ? "blue" : "amber"}
                icon={complete ? <IconCheck /> : undefined}
              >
                {complete
                  ? "Squad complete"
                  : squadSize >= rules.squadMin
                    ? `${String(rules.squadMax - squadSize)} spots open`
                    : `${String(rules.squadMin - squadSize)} short of minimum`}
              </Pill>
            </div>
          )}
        </div>
      ) : null}
      {squad.length > 0 ? (
        <ul className="conflict-list my-squad-list" data-testid="my-squad">
          {squad.map((lot) => (
            <li key={lot.lotId}>
              <Badge tone="success">{lot.lotNumber}</Badge>
              <LotFace
                lotId={lot.lotId}
                name={lot.playerName ?? "Unnamed"}
                lotMedia={lotMedia}
                size="sm"
              />
              <span className="registration-name">{lot.playerName ?? "Unnamed"}</span>
              <span className="registration-phone">
                {lot.soldPrice !== null ? money.ledger(lot.soldPrice) : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="competitions-hint">No players signed yet — your wins land here.</p>
      )}
    </Card>
  );
}

/** The ceremony's final act: summary, winners, statistics, exits. */
export function AuctionSummaryCard({
  snapshot,
  feed,
  slug,
  canConduct,
  viewerTeamName,
  /**
   * The replay is a MEMBER surface: `/…/auction/replay` answers a signed-out
   * request with 307 → /login. Offering it to an anonymous spectator was a door
   * that opens onto a sign-in wall at the exact moment the night ends. Guests
   * get the two doors that work for them instead (this tournament, and their
   * own).
   */
  canReplay = true,
  teamColors = {},
}: {
  snapshot: AuctionSnapshot;
  feed: LiveFeed;
  slug: string | null;
  canConduct: boolean;
  viewerTeamName: string | null;
  canReplay?: boolean;
  /** Team id → the team's own colour, for the spend bars. */
  teamColors?: Readonly<Record<string, string | null>>;
}) {
  const money = useMoney();
  const sold = feed.resolved.filter((lot) => lot.status === "sold");
  const unsold = feed.resolved.filter((lot) => lot.status === "unsold");
  const topSale = sold.reduce<ResolvedLot | null>(
    (best, lot) => (best === null || (lot.soldPrice ?? 0) > (best.soldPrice ?? 0) ? lot : best),
    null,
  );
  // Redacted money sorts and sums as zero rather than throwing: the ceremony
  // shows what this viewer was sent, and a sealed rival simply has no figure.
  // A sealed purse is not a zero: when any team's money was withheld, the
  // total comes from the hammer prices, which the whole room saw called.
  const totalSpent = snapshot.paddles.some((paddle) => paddle.committed === null)
    ? sold.reduce((sum, lot) => sum + (lot.soldPrice ?? 0), 0)
    : snapshot.paddles.reduce((sum, paddle) => sum + (paddle.committed ?? 0), 0);
  /*
   * ONE ROW PER TEAM, RANKED BY WHAT IT SPENT.
   *
   * This listed paddles and printed "purse sealed" for each when the engine
   * withheld the money from this viewer — three "purse sealed" rows under a
   * "Total spent 1,74,500 pts" that is the sum of them. What a team spent is
   * its hammer prices, which the room saw called, so a sealed row falls back
   * to that sum; only the purse LEFT stays unsaid, because that the engine
   * did withhold. A team that handed a paddle back and took another is still
   * one team (see `teamPurseRows`).
   */
  const teams = [
    ...snapshot.paddles
      .reduce((byTeam, paddle) => {
        const row = byTeam.get(paddle.teamId);
        if (row === undefined) {
          byTeam.set(paddle.teamId, {
            teamId: paddle.teamId,
            teamName: paddle.teamName,
            paddleNumber: paddle.paddleNumber,
            committed: paddle.committed,
            purseRemaining: paddle.purseRemaining,
          });
        } else {
          row.committed =
            row.committed === null || paddle.committed === null
              ? null
              : row.committed + paddle.committed;
          if (!paddle.released) {
            row.paddleNumber = paddle.paddleNumber;
          }
        }
        return byTeam;
      }, new Map<string, { teamId: string; teamName: string; paddleNumber: string; committed: number | null; purseRemaining: number | null }>())
      .values(),
  ]
    .map((team) => ({
      ...team,
      spent:
        team.committed ??
        sold
          .filter((lot) => lot.teamName === team.teamName)
          .reduce((sum, lot) => sum + (lot.soldPrice ?? 0), 0),
    }))
    .sort((a, b) => b.spent - a.spent || a.teamName.localeCompare(b.teamName));
  return (
    <section className="wrap" data-testid="auction-summary" aria-labelledby="wrap-title">
      <div className="wrap-hero">
        <span className="wrap-trophy" aria-hidden>
          <IconTrophy size={40} />
        </span>
        <div className="wrap-hero-text">
          <h2 id="wrap-title">That&apos;s a wrap!</h2>
          <p>
            {viewerTeamName !== null
              ? `Congratulations, ${viewerTeamName} — your squad is set.`
              : `The auction is complete — every ${money.unit === "points" ? "point" : "rupee"} accounted for.`}
          </p>
        </div>
        <p className="wrap-tag" aria-hidden>
          Teams built. Stories ahead.
        </p>
      </div>
      <StatGrid>
        <StatCard
          icon={<IconUsers />}
          concept="players"
          value={sold.length}
          label="Players sold"
          testId="summary-sold"
        />
        <StatCard
          icon={<IconFile />}
          concept="neutral"
          value={unsold.length}
          label="Passed"
          testId="summary-unsold"
        />
        <StatCard
          icon={<IconWallet />}
          concept="money"
          value={money.ledger(totalSpent)}
          label="Total spent"
          testId="summary-spent"
        />
        {topSale !== null ? (
          <StatCard
            icon={<IconCrown />}
            tone="gold"
            value={topSale.soldPrice !== null ? money.ledger(topSale.soldPrice) : "—"}
            label={`Top sale — ${topSale.playerName ?? topSale.lotNumber}`}
            testId="summary-top"
          />
        ) : null}
      </StatGrid>
      <div className="wrap-body">
        <div className="wrap-spend">
          <h3 className="live-summary-heading">Squads by spend</h3>
          <ul className="wrap-spend-list" data-testid="summary-teams">
            {teams.map((paddle) => {
              const total =
                paddle.committed === null || paddle.purseRemaining === null
                  ? null
                  : paddle.committed + paddle.purseRemaining;
              const pct =
                total === null || total === 0 ? 0 : ((paddle.committed ?? 0) / total) * 100;
              const color = teamColors[paddle.teamId] ?? null;
              return (
                <li key={paddle.teamId}>
                  <TeamChip color={color}>{paddle.paddleNumber}</TeamChip>
                  <span className="wrap-spend-team">{paddle.teamName}</span>
                  {total === null ? (
                    <span />
                  ) : (
                    <span
                      className="wrap-spend-bar"
                      style={color !== null ? { ["--team" as string]: color } : {}}
                      aria-hidden
                    >
                      <span style={{ width: `${String(Math.min(100, pct))}%` }} />
                    </span>
                  )}
                  <span className="wrap-spend-figures">
                    {paddle.committed === null || paddle.purseRemaining === null ? (
                      <>
                        <strong>{money.ledger(paddle.spent)}</strong>
                        <span> spent</span>
                      </>
                    ) : (
                      <>
                        <strong>{money.ledger(paddle.committed)}</strong>
                        <span> · left {money.ledger(paddle.purseRemaining)}</span>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        {slug !== null ? (
          <div className="wrap-actions live-summary-actions">
            {canReplay ? (
              <ButtonLink href={`/seasons/${slug}/auction/replay`} variant="secondary" size="touch">
                <IconPlay size={18} />
                Watch the replay
              </ButtonLink>
            ) : (
              <ButtonLink
                href={`/c/${slug}`}
                variant="secondary"
                size="touch"
                data-testid="summary-tournament"
              >
                See the full tournament
              </ButtonLink>
            )}
            {canConduct ? (
              <ButtonLink href={`/seasons/${slug}/auction/ledger`} variant="primary" size="touch">
                <IconLedger size={18} />
                Open the ledger
              </ButtonLink>
            ) : null}
            {!canReplay ? (
              <ButtonLink
                href="/"
                variant="primary"
                size="touch"
                data-testid="summary-run-your-own"
              >
                Run your own auction
              </ButtonLink>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * UP NEXT — the queue, which has been on the wire in every snapshot since
 * M-IP4-3 and rendered nowhere.
 *
 * "Who is coming?" is the second question anyone in the room asks, and the only
 * answer the product gave was a bare count buried in the progress line ("3 in
 * queue"). Names are what a spectator is waiting for; a parent watching for one
 * player wants to know whether to keep the phone up.
 */
export function UpNext({
  snapshot,
  limit = 5,
  lotMedia = {},
}: {
  snapshot: AuctionSnapshot | null;
  limit?: number;
  /** Faces for the queue, keyed by lot id. */
  lotMedia?: MediaByLot;
}) {
  const money = useMoney();
  const queue = snapshot?.queue ?? [];
  if (queue.length === 0) {
    return null;
  }
  return (
    <Card data-testid="up-next">
      <div className="competition-head">
        <h2>Up next</h2>
        <span className="competitions-hint">{queue.length} still to come</span>
      </div>
      <ol className="up-next-list">
        {queue.slice(0, limit).map((entry, index) => (
          <li key={entry.lotId}>
            <span className="up-next-pos" aria-hidden>
              {index + 1}
            </span>
            <LotFace
              lotId={entry.lotId}
              name={entry.playerName ?? entry.lotNumber}
              lotMedia={lotMedia}
              size="sm"
            />
            <span className="up-next-name">{entry.playerName ?? entry.lotNumber}</span>
            <span className="up-next-role">{entry.role.replace(/_/g, " ")}</span>
            <span className="up-next-base">base {money.ledger(entry.basePrice)}</span>
          </li>
        ))}
      </ol>
      {queue.length > limit ? (
        <p className="competitions-hint">
          and {queue.length - limit} more after {queue[limit - 1]?.playerName ?? "these"}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Lobby: the locked rules of the night, verbatim from the auction config.
 * `pursePerTeam` is optional because it is money sight (DA-30): a viewer
 * without it is served a payload that has no purse in it at all, so the row is
 * absent rather than blanked.
 */
export function RulesCard({
  rules,
  action,
}: {
  rules: Omit<AuctionRules, "pursePerTeam"> & { pursePerTeam?: number };
  /** A header link ("Room & settings →") where the card sits on a dashboard. */
  action?: ReactNode;
}) {
  const money = useMoney();
  return (
    <SectionCard
      icon={<IconFile />}
      concept="neutral"
      title="Rules of the night"
      action={action}
      data-testid="auction-rules"
    >
      <dl className="rules-list">
        {rules.pursePerTeam !== undefined ? (
          <div>
            <dt>Purse per team</dt>
            <dd>{money.ledger(rules.pursePerTeam)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Squad size</dt>
          {/* A fixed squad is one number: "12–12 players" reads as a typo. */}
          <dd>
            {rules.squadMin === rules.squadMax
              ? `${String(rules.squadMax)} players`
              : `${String(rules.squadMin)}–${String(rules.squadMax)} players`}
          </dd>
        </div>
        <div>
          <dt>Timer</dt>
          <dd>
            {rules.initialSeconds}s per lot · +{rules.extensionSeconds}s anti-snipe extension
          </dd>
        </div>
        <div>
          <dt>Bid increments</dt>
          <dd>
            {rules.slabs.map((slab) => (
              <span key={`${String(slab.step)}-${String(slab.upTo)}`} className="rules-slab">
                {money.ledger(slab.step)}
                {slab.upTo !== null ? ` up to ${money.ledger(slab.upTo)}` : " beyond"}
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </SectionCard>
  );
}

/** Lobby: is the engine reachable from THIS device, and how fast? */
export function ConnectionCheck({ wsUrl }: { wsUrl: string }) {
  const [state, setState] = useState<"checking" | "ok" | "unreachable">("checking");
  const [rttMs, setRttMs] = useState<number | null>(null);
  useEffect(() => {
    const startedAt = Date.now();
    let settled = false;
    const socket = new WebSocket(wsUrl);
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        setState("unreachable");
        socket.close();
      }
    }, 6_000);
    socket.onmessage = () => {
      if (!settled) {
        settled = true;
        setRttMs(Date.now() - startedAt);
        setState("ok");
        window.clearTimeout(timer);
        socket.close();
      }
    };
    socket.onerror = () => {
      if (!settled) {
        settled = true;
        setState("unreachable");
        window.clearTimeout(timer);
      }
    };
    return () => {
      window.clearTimeout(timer);
      socket.close();
    };
  }, [wsUrl]);
  return (
    <SectionCard
      icon={<IconBroadcast />}
      tone={state === "unreachable" ? "red" : "green"}
      title="Your connection"
      data-testid="connection-check"
    >
      <div className="conn-check" data-state={state}>
        {state === "checking" ? (
          <p className="conn-check-text">Checking the auction room…</p>
        ) : state === "ok" ? (
          <>
            <Pill tone="green" dot>
              Ready
            </Pill>
            <p className="conn-check-text">
              <strong>Engine reachable in {rttMs ?? 0}ms</strong>
              <span>This device can join the room.</span>
            </p>
          </>
        ) : (
          <>
            <Pill tone="red" dot>
              Unreachable
            </Pill>
            <p className="conn-check-text">
              <strong>Couldn&apos;t reach the auction room</strong>
              <span>Check this device&apos;s network and reload.</span>
            </p>
          </>
        )}
      </div>
    </SectionCard>
  );
}

/**
 * Inline connection quality: state, clock sync, read-only hint.
 *
 * `connection` is the socket's readyState, and a readyState of `open` survives
 * the network dying — the browser does not learn otherwise until TCP gives up.
 * So this line read "Live · clock ±20ms" for a device that had been offline for
 * fifteen seconds, with the ribbon two inches away already saying OFFLINE and
 * the raise button already disabled. It is the sentence somebody opens the
 * diagnostics strip to read when bidding has stopped working, and it was the
 * one thing on the page still claiming everything was fine.
 *
 * `stale` and `offline` come from the same hook the ribbon uses, so the two
 * cannot disagree again.
 */
export function ConnectionQuality({
  connection,
  drift,
  stale = false,
  offline = false,
}: {
  connection: "connecting" | "open" | "reconnecting";
  drift: number;
  /** The feed has stopped confirming state, whatever the socket claims. */
  stale?: boolean;
  /** The device itself reports no network. */
  offline?: boolean;
}) {
  const label = offline
    ? "Offline — this device has no network"
    : stale
      ? "No answer from the auction — read-only"
      : connection === "open"
        ? `Live · clock ±${String(Math.min(999, Math.abs(Math.round(drift))))}ms`
        : connection === "connecting"
          ? "Connecting…"
          : "Reconnecting — read-only";
  return (
    <span
      className="live-quality"
      data-testid="connection-quality"
      data-state={offline ? "offline" : stale ? "stale" : connection}
    >
      <span className="live-quality-dot" aria-hidden />
      {label}
    </span>
  );
}
