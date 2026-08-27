"use client";

import { formatPaiseINR, paise, type AuctionSnapshot } from "@desiauction/core";
import { Badge, ButtonLink, Card } from "@desiauction/ui";
import { useEffect, useRef, useState } from "react";

import type { AuctionRules, ResolvedLot } from "../../../../server/auction/live-summary";

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

/**
 * Accumulates the live feed from snapshot deltas on top of the server-rendered
 * history: lot outcomes (keyed by atSeq — idempotent under reconnect replays)
 * and major auction transitions (pause/resume/recovery/completion).
 */
export function useLiveFeed(initial: ResolvedLot[], snapshot: AuctionSnapshot | null): LiveFeed {
  const [resolved, setResolved] = useState<ResolvedLot[]>(initial);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const seenSeqRef = useRef<Set<number>>(new Set());
  const prevStatusRef = useRef<string | null>(null);
  const prevRecoveriesRef = useRef(0);

  useEffect(() => {
    if (snapshot === null) {
      return;
    }
    const outcome = snapshot.lastOutcome;
    if (outcome !== null && !seenSeqRef.current.has(outcome.atSeq)) {
      seenSeqRef.current.add(outcome.atSeq);
      const kind = OUTCOME_KIND[outcome.kind.toLowerCase()] ?? "sold";
      if (kind === "sold" || kind === "unsold" || kind === "withdrawn") {
        setResolved((prior) => {
          const rest = prior.filter((entry) => entry.lotId !== outcome.lotId);
          return [
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
        });
      }
      setEvents((prior) => [
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
        },
        ...prior,
      ]);
    }
    const previousStatus = prevStatusRef.current;
    if (previousStatus !== null && previousStatus !== snapshot.auctionStatus) {
      const transitions: Record<string, FeedEvent["kind"] | undefined> = {
        paused: "paused",
        live: previousStatus === "paused" ? "resumed" : undefined,
        completed: "completed",
      };
      const kind = transitions[snapshot.auctionStatus];
      if (kind !== undefined) {
        setEvents((prior) => [
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
          ...prior,
        ]);
      }
    }
    prevStatusRef.current = snapshot.auctionStatus;
    if (snapshot.recoveries > prevRecoveriesRef.current) {
      prevRecoveriesRef.current = snapshot.recoveries;
      setEvents((prior) => [
        {
          key: `recovered-${String(snapshot.recoveries)}-${String(snapshot.version)}`,
          kind: "recovered",
          label: "State recovered — every bid verified",
          detail: null,
        },
        ...prior,
      ]);
    }
  }, [snapshot]);

  return { resolved, events };
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
export function AuctionTimeline({ feed, limit = 12 }: { feed: LiveFeed; limit?: number }) {
  if (feed.events.length === 0) {
    return null;
  }
  return (
    <Card data-testid="auction-timeline">
      <h2>Auction timeline</h2>
      <ol className="timeline">
        {feed.events.slice(0, limit).map((event) => (
          <li key={event.key} data-testid={`timeline-${event.kind}`}>
            <Badge tone={FEED_TONE[event.kind]}>{event.kind}</Badge>
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
}: {
  snapshot: AuctionSnapshot | null;
  myTeamId: string;
  myTeamName: string;
  myPaddleNumber: string;
  rules: AuctionRules;
  feed: LiveFeed;
}) {
  const paddle = snapshot?.paddles.find((entry) => entry.paddleNumber === myPaddleNumber) ?? null;
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
              {squad.length}/{rules.squadMax}
            </span>
            <span className="stat-label">Squad (min {rules.squadMin})</span>
          </div>
        </div>
      ) : null}
      {squad.length > 0 ? (
        <ul className="conflict-list" data-testid="my-squad">
          {squad.map((lot) => (
            <li key={lot.lotId}>
              <Badge tone="success">{lot.lotNumber}</Badge>
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
      <h2>That&apos;s a wrap 🎉</h2>
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
}: {
  snapshot: AuctionSnapshot | null;
  limit?: number;
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
}: {
  rules: Omit<AuctionRules, "pursePerTeam"> & { pursePerTeam?: number };
}) {
  return (
    <Card data-testid="auction-rules">
      <h2>Rules of the night</h2>
      <ul className="conflict-list">
        {rules.pursePerTeam !== undefined ? (
          <li>
            <span className="registration-name">Purse per team</span>
            <span className="registration-phone">{formatPaiseINR(paise(rules.pursePerTeam))}</span>
          </li>
        ) : null}
        <li>
          <span className="registration-name">Squad size</span>
          <span className="registration-phone">
            {rules.squadMin}–{rules.squadMax} players
          </span>
        </li>
        <li>
          <span className="registration-name">Timer</span>
          <span className="registration-phone">
            {rules.initialSeconds}s per lot · +{rules.extensionSeconds}s anti-snipe extension
          </span>
        </li>
        <li>
          <span className="registration-name">Bid increments</span>
          <span className="registration-phone">
            {rules.slabs
              .map(
                (slab) =>
                  `${formatPaiseINR(paise(slab.step))}${slab.upTo !== null ? ` up to ${formatPaiseINR(paise(slab.upTo))}` : " beyond"}`,
              )
              .join(" · ")}
          </span>
        </li>
      </ul>
    </Card>
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
    <Card data-testid="connection-check">
      <h2>Your connection</h2>
      <p className="competitions-hint">
        {state === "checking" ? (
          "Checking the auction room…"
        ) : state === "ok" ? (
          <>
            <Badge tone="success">Ready</Badge> Engine reachable in {rttMs ?? 0}ms — this device can
            join the room.
          </>
        ) : (
          <>
            <Badge tone="danger">Unreachable</Badge> Couldn&apos;t reach the auction room from this
            device — check your network and reload.
          </>
        )}
      </p>
    </Card>
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
