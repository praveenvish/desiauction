"use client";

import { formatPaiseINR, paise, type AuctionSnapshot, type PlanState } from "@desiauction/core";
import {
  Badge,
  ButtonLink,
  Card,
  IconBroadcast,
  IconFile,
  IconTrophy,
  Pill,
  PlayerImage,
  SectionCard,
} from "@desiauction/ui";
import { useEffect, useState, type ReactNode } from "react";

import { lotSeed } from "../../../../lib/player-seed";
import type { AuctionRules, LotMedia, ResolvedLot } from "../../../../server/auction/live-summary";
import { fitBadge } from "./plan/plan-model";
import "./dashboard.css";

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
}: {
  lotId: string;
  name: string;
  lotMedia: MediaByLot;
  size?: "xs" | "sm";
}) {
  return (
    <PlayerImage
      name={name}
      seed={lotSeed(lotId, lotMedia)}
      src={lotMedia[lotId]?.photoUrl}
      size={size}
      shape="round"
      decorative
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
export function foldSnapshot(feed: FeedState, snapshot: AuctionSnapshot): FeedState {
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
        detail: outcome.amount !== null ? formatPaiseINR(paise(outcome.amount)) : null,
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
  const [feed, setFeed] = useState<FeedState>(() => ({
    resolved: initial,
    events: [],
    folded: null,
    seenSeqs: new Set(),
    lastStatus: null,
    recoveries: 0,
  }));
  if (snapshot !== null && snapshot !== feed.folded) {
    setFeed(foldSnapshot(feed, snapshot));
  }
  return { resolved: feed.resolved, events: feed.events };
}

const FEED_TONE: Record<FeedEvent["kind"], "success" | "neutral" | "warning" | "info" | "danger"> =
  {
    sold: "success",
    unsold: "neutral",
    withdrawn: "danger",
    held: "info",
    reopened: "warning",
    paused: "warning",
    resumed: "success",
    recovered: "info",
    completed: "success",
  };

/** The auction timeline: outcomes and conduct events, newest first. */
export function AuctionTimeline({
  feed,
  limit = 12,
  lotMedia = {},
}: {
  feed: LiveFeed;
  limit?: number;
  lotMedia?: MediaByLot;
}) {
  if (feed.events.length === 0) {
    return null;
  }
  return (
    <Card data-testid="auction-timeline">
      <h2>Auction timeline</h2>
      <ol className="timeline timeline--faces">
        {feed.events.slice(0, limit).map((event) => (
          <li key={event.key} data-testid={`timeline-${event.kind}`}>
            <Badge tone={FEED_TONE[event.kind]}>{event.kind}</Badge>
            {event.subject === undefined ? null : (
              <LotFace
                lotId={event.subject.lotId}
                name={event.subject.playerName ?? ""}
                lotMedia={lotMedia}
              />
            )}
            <span>{event.label}</span>
            {event.detail !== null ? <span className="timeline-at">{event.detail}</span> : null}
          </li>
        ))}
      </ol>
    </Card>
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
  const paddle = snapshot?.paddles.find((entry) => entry.paddleNumber === myPaddleNumber) ?? null;
  const fit = plan === null ? null : fitBadge(plan.budget.fit);
  const squad = feed.resolved.filter(
    (lot) => lot.status === "sold" && (lot.teamId === myTeamId || lot.teamName === myTeamName),
  );
  const leading =
    snapshot?.currentLot?.currentBid !== null &&
    snapshot?.currentLot?.currentBid.paddleNumber === myPaddleNumber;
  return (
    <Card data-testid="my-team-card">
      <div className="competition-head">
        <h2>{myTeamName}</h2>
        {leading ? (
          <Badge tone="success" data-testid="my-team-leading">
            Leading this lot
          </Badge>
        ) : null}
      </div>
      {paddle !== null ? (
        <div className="stat-row live-team-stats">
          {/* This is the viewer's OWN paddle, so the engine always sends its
              money; the fallback exists because the type is honest about
              redaction, not because a bidder is ever denied their own purse. */}
          <div className="stat-tile" data-testid="my-purse">
            <span className="stat-value">
              {paddle.purseRemaining === null ? "—" : formatPaiseINR(paise(paddle.purseRemaining))}
            </span>
            <span className="stat-label">Purse remaining</span>
          </div>
          <div className="stat-tile" data-testid="my-spent">
            <span className="stat-value">
              {paddle.committed === null ? "—" : formatPaiseINR(paise(paddle.committed))}
            </span>
            <span className="stat-label">Committed</span>
          </div>
          <div className="stat-tile" data-testid="my-slots">
            <span className="stat-value">
              {squadSize}/{rules.squadMax}
            </span>
            <span className="stat-label">Squad (min {rules.squadMin})</span>
          </div>
          {plan !== null && fit !== null ? (
            <div className="stat-tile" data-testid="my-plan-headroom" data-fit={plan.budget.fit}>
              <span className="stat-value">
                {plan.budget.headroom < 0
                  ? `−${formatPaiseINR(paise(-plan.budget.headroom))}`
                  : formatPaiseINR(paise(plan.budget.headroom))}
              </span>
              <span className="stat-label">Plan headroom</span>
              <Badge tone={fit.tone} className="plan-tile-badge">
                {plan.budget.fit === "fits"
                  ? "Fits"
                  : plan.budget.fit === "at_risk"
                    ? "At risk"
                    : "Over purse"}
              </Badge>
            </div>
          ) : null}
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
                {lot.soldPrice !== null ? formatPaiseINR(paise(lot.soldPrice)) : ""}
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
}: {
  snapshot: AuctionSnapshot;
  feed: LiveFeed;
  slug: string | null;
  canConduct: boolean;
  viewerTeamName: string | null;
  canReplay?: boolean;
}) {
  const sold = feed.resolved.filter((lot) => lot.status === "sold");
  const unsold = feed.resolved.filter((lot) => lot.status === "unsold");
  const topSale = sold.reduce<ResolvedLot | null>(
    (best, lot) => (best === null || (lot.soldPrice ?? 0) > (best.soldPrice ?? 0) ? lot : best),
    null,
  );
  // Redacted money sorts and sums as zero rather than throwing: the ceremony
  // shows what this viewer was sent, and a sealed rival simply has no figure.
  const totalSpent = snapshot.paddles.reduce((sum, paddle) => sum + (paddle.committed ?? 0), 0);
  const teams = [...snapshot.paddles].sort((a, b) => (b.committed ?? 0) - (a.committed ?? 0));
  return (
    <Card data-testid="auction-summary">
      <h2>
        <IconTrophy size={20} className="icon-lead" /> That&apos;s a wrap
      </h2>
      <p className="competitions-hint">
        {viewerTeamName !== null
          ? `Congratulations, ${viewerTeamName} — your squad is set.`
          : "The auction is complete — every rupee accounted for."}
      </p>
      <div className="stat-row live-team-stats">
        <div className="stat-tile" data-testid="summary-sold">
          <span className="stat-value">{sold.length}</span>
          <span className="stat-label">Players sold</span>
        </div>
        <div className="stat-tile" data-testid="summary-unsold">
          <span className="stat-value">{unsold.length}</span>
          <span className="stat-label">Passed</span>
        </div>
        <div className="stat-tile" data-testid="summary-spent">
          <span className="stat-value">{formatPaiseINR(paise(totalSpent))}</span>
          <span className="stat-label">Total spent</span>
        </div>
        {topSale !== null ? (
          <div className="stat-tile" data-testid="summary-top">
            <span className="stat-value">
              {topSale.soldPrice !== null ? formatPaiseINR(paise(topSale.soldPrice)) : "—"}
            </span>
            <span className="stat-label">Top sale — {topSale.playerName ?? topSale.lotNumber}</span>
          </div>
        ) : null}
      </div>
      <h3 className="live-summary-heading">Squads by spend</h3>
      <ul className="conflict-list" data-testid="summary-teams">
        {teams.map((paddle) => (
          <li key={paddle.paddleId}>
            <Badge tone="info">{paddle.paddleNumber}</Badge>
            <span className="registration-name">{paddle.teamName}</span>
            <span className="registration-phone">
              {paddle.committed === null || paddle.purseRemaining === null
                ? "purse sealed"
                : `spent ${formatPaiseINR(paise(paddle.committed))} · left ${formatPaiseINR(
                    paise(paddle.purseRemaining),
                  )}`}
            </span>
          </li>
        ))}
      </ul>
      {slug !== null ? (
        <div className="date-row live-summary-actions">
          {canReplay ? (
            <ButtonLink href={`/seasons/${slug}/auction/replay`} variant="secondary">
              Watch the replay
            </ButtonLink>
          ) : (
            <ButtonLink href={`/c/${slug}`} variant="secondary" data-testid="summary-tournament">
              See the full tournament
            </ButtonLink>
          )}
          {canConduct ? (
            <ButtonLink href={`/seasons/${slug}/auction/ledger`} variant="ghost">
              Open the ledger
            </ButtonLink>
          ) : null}
          {!canReplay ? (
            <ButtonLink href="/" variant="primary" data-testid="summary-run-your-own">
              Run your own auction
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
    </Card>
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
            <span className="up-next-base">base {formatPaiseINR(paise(entry.basePrice))}</span>
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
  return (
    <SectionCard
      icon={<IconFile />}
      tone="amber"
      title="Rules of the night"
      action={action}
      data-testid="auction-rules"
    >
      <dl className="rules-list">
        {rules.pursePerTeam !== undefined ? (
          <div>
            <dt>Purse per team</dt>
            <dd>{formatPaiseINR(paise(rules.pursePerTeam))}</dd>
          </div>
        ) : null}
        <div>
          <dt>Squad size</dt>
          <dd>
            {rules.squadMin}–{rules.squadMax} players
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
                {formatPaiseINR(paise(slab.step))}
                {slab.upTo !== null ? ` up to ${formatPaiseINR(paise(slab.upTo))}` : " beyond"}
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
