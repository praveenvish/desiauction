import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  acceptOwnerInvite,
  claimPaddle,
  closeLot,
  grantPaddle,
  inviteOwner,
  revokeOwnerInvite,
  issuePaddle,
  markLotClosingSoon,
  placeBid,
  queueAllLots,
  recoverAuction,
  releasePaddle,
  transitionAuction,
  transitionLot,
  undoLastAction,
  type AuctionRecord,
} from "@desiauction/auction";
import { buildLiveSnapshot } from "@desiauction/auction";
import {
  canonicalJson,
  isAuctionCommandType,
  type AuctionCommandEnvelope,
  type AuctionSnapshot,
  type CommandAck,
} from "@desiauction/core";
import { auctions, paddles, type Db } from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";

// THE AUCTION ENGINE CORE (M-IP4-2). The single mutation authority for live
// auctions: every command enters a PER-AUCTION FIFO queue and is processed
// strictly serially — the single writer is now a fact of the process, not just
// a database constraint. After every mutation the engine re-folds the event
// log (core's pure reducer), verifies the row projections against it, rebuilds
// the immutable AuctionSnapshot and broadcasts it. Any integrity failure —
// replay error, projection mismatch, snapshot indeterminism — HALTS the
// auction fail-closed: commands are rejected until RecoverAuction heals it.

/** Timer-driven mutations are attributed to the engine itself (valid char 26). */
export const ENGINE_ACTOR = "00000000000000000000000000";

/** Internal, engine-enqueued command types — never accepted from transport. */
type InternalCommandType = "_TimerClose" | "_ClosingSoon";

/**
 * PER-ACTOR RATE LIMIT (audit 2026-08-18, P2-2).
 *
 * There was no limit anywhere on the command path. Every command — including a
 * REJECTED one — appends an event, writes an audit row, and makes the engine
 * re-fold the entire event log and broadcast to every socket in the room. So a
 * single participant sending junk made the night quadratically slower for
 * everyone, and the per-auction FIFO queue meant their traffic sat in front of
 * real bids.
 *
 * A token bucket, not a hard window: bidding genuinely IS bursty near the
 * hammer, and a fixed window would refuse the exact moment the product exists
 * for. BURST covers a flurry of legitimate taps; REFILL_PER_SEC is the
 * sustained rate. The engine's own timer commands are never metered.
 */
/*
 * The numbers, and why they are this generous.
 *
 * The limit exists to stop SUSTAINED abuse — the pattern where one participant
 * makes the event log grow quadratically for everyone — not to police normal
 * play. A real conductor issues a few commands a second at the gavel; a bidder
 * in a frenzy taps maybe five. So the ceiling can sit an order of magnitude
 * above human behaviour and still turn an unbounded spam loop into a bounded
 * trickle, which is the whole point.
 *
 * Set too tight, this becomes its own outage: the first draft used 30/10 and
 * refused a legitimate conductor sequence in the engine's own integration
 * suite. A rate limit that fires on correct usage is worse than none, because
 * it fails in the one hour the product exists for.
 *
 * Tunable without a deploy, because the right number is an operational fact we
 * will only learn from a real auction night.
 */
const DEFAULT_RATE_BURST = 200;
const DEFAULT_RATE_REFILL_PER_SEC = 50;

/**
 * BOUNDED RESIDENCY (audit 2026-08-26, P3-1).
 *
 * Every one of the engine's maps grew and never shrank: one rate-limit bucket
 * per distinct actor for the life of the process, one full snapshot per auction
 * ever touched, and a queue/pending entry beside it. Only `reset()` — a test and
 * ops surface — ever emptied them. On a long-lived host that is a slow leak
 * measured in snapshots, and the biggest objects in it belong to auctions that
 * finished weeks ago.
 *
 * Both sweeps are RESTART-EQUIVALENT: whatever they drop, the next touch
 * rebuilds from the event log (auctions) or from a full bucket (actors), which
 * is exactly the state a redeploy would leave behind. That is the safety
 * argument the whole eviction rests on, and it is why the guards below are
 * deliberately paranoid — a wrongly evicted auction mid-night is a P0, while a
 * wrongly RETAINED one is only memory.
 *
 * No new timer: the sweep rides the watchdog tick that already runs, throttled
 * to its own cadence, and `allow()` triggers it too so an engine whose tick is
 * not running (tests, an idle process) still reclaims.
 */
const BUCKET_IDLE_TTL_MS = 10 * 60_000;
const TERMINAL_RESIDENCY_TTL_MS = 15 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

/**
 * The statuses after which nothing can legally change again. Note what is NOT
 * here: `live` and `paused` (the auction is in progress) and `scheduled` (it is
 * about to be) — those states are never evicted at any age.
 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "reconciled", "abandoned"]);

interface Bucket {
  tokens: number;
  lastMs: number;
}

/**
 * The idempotency key: actor AND command id.
 *
 * NUL separates the two so no actor/id pair can be spelled two ways. The
 * engine's own commands are attributed to ENGINE_ACTOR, which the transport
 * cannot claim (the web tier sets `actor` server-side from the session, and
 * the id shape is pinned in server.ts), so the internal timer namespace is
 * unaddressable from outside.
 */
function ackKeyOf(envelope: { actor: string; commandId: string }): string {
  return `${envelope.actor}\u0000${envelope.commandId}`;
}

interface QueuedCommand extends Omit<AuctionCommandEnvelope, "type"> {
  type: AuctionCommandEnvelope["type"] | InternalCommandType;
}

/** Per-auction operational counters (M-IP4-3 diagnostics — read-only surface). */
export interface EngineStats {
  processed: number;
  accepted: number;
  rejected: number;
  totalProcessMs: number;
  lastProcessMs: number;
  maxProcessMs: number;
  /** Millis when this auction loaded into the engine (throughput window). */
  loadedAtMs: number;
  lastCommandAtMs: number;
  /** Last event-log fold + snapshot rebuild duration. */
  lastReplayMs: number;
  /** Last RecoverAuction (replay → diff → heal) duration. */
  lastRecoveryMs: number;
  /** Rebuild start → broadcast handoff. */
  lastBroadcastLatencyMs: number;
  snapshotHash: string;
  projectionHash: string;
  eventCount: number;
}

export interface AuctionState {
  record: AuctionRecord;
  snapshot: AuctionSnapshot | null; // null only while halted at load
  serialized: string;
  version: number;
  /** Fail-closed flag: non-null halts every command except RecoverAuction. */
  halted: string | null;
  acks: Map<string, CommandAck>;
  stats: EngineStats;
  /**
   * Last time anything asked for this auction — a command, a socket joining,
   * a diagnostics read: every one of them goes through `ensureAuction`. Stamped
   * on the ENGINE's clock (the injectable one), not the wall clock the stats
   * use, so residency and diagnostics never compare across two time axes.
   */
  lastTouchMs: number;
}

/** What the engine is currently holding in memory (audit 2026-08-26, P3-1). */
export interface EngineResidency {
  /** Auctions resident right now. */
  auctions: number;
  /** Rate-limit buckets resident right now. */
  buckets: number;
  evictedAuctions: number;
  evictedBuckets: number;
}

/** The read-only diagnostics view (never exposes snapshot payloads or secrets). */
export interface AuctionDiagnostics {
  auctionId: string;
  auctionStatus: string | null;
  version: number;
  eventCount: number;
  halted: string | null;
  queueDepth: number;
  processed: number;
  accepted: number;
  rejected: number;
  avgProcessMs: number;
  lastProcessMs: number;
  maxProcessMs: number;
  commandsPerMinute: number;
  lastReplayMs: number;
  lastRecoveryMs: number;
  lastBroadcastLatencyMs: number;
  snapshotHash: string;
  projectionHash: string;
  recoveries: number;
  watchdog: { lastTickMs: number; tickDriftMs: number; stalled: boolean };
}

export interface EngineDeps {
  db: Db;
  logger: FastifyBaseLogger;
  /** Broadcast hook — the WS hub subscribes; tests observe. */
  onSnapshot: (auctionId: string, serialized: string, version: number) => void;
  /** Per-actor command rate limit; defaults are sized well above human play. */
  rateBurst?: number;
  rateRefillPerSec?: number;
  nowMs?: () => number;
}

const ACK_CACHE_LIMIT = 512;

/**
 * The web tier abandons a command at 2s (engine-client.ts AbortSignal). The
 * post-command rebuild re-folds the whole event log to re-verify integrity —
 * a deliberate O(events) invariant, not a bug — so per-command cost grows with
 * the night. At beta scale (one lot on the block, a few thousand events) it
 * stays well under budget; this warns LONG before it approaches 2s, so the
 * degradation is caught and a checkpoint-fold fast-follow can be scheduled
 * rather than discovered by a stalled bid (PRR P1-5, monitored risk).
 */
const SLOW_COMMAND_WARN_MS = 1_000;

function freshStats(nowMs: number): EngineStats {
  return {
    processed: 0,
    accepted: 0,
    rejected: 0,
    totalProcessMs: 0,
    lastProcessMs: 0,
    maxProcessMs: 0,
    loadedAtMs: nowMs,
    lastCommandAtMs: 0,
    lastReplayMs: 0,
    lastRecoveryMs: 0,
    lastBroadcastLatencyMs: 0,
    snapshotHash: "",
    projectionHash: "",
    eventCount: 0,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class AuctionEngine {
  private readonly states = new Map<string, AuctionState>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly rateBurst: number;
  private readonly rateRefillPerSec: number;
  private readonly queues = new Map<string, Promise<unknown>>();
  /** Commands enqueued but not yet finished — the diagnostics queue depth. */
  private readonly pending = new Map<string, number>();
  private readonly deps: EngineDeps;
  private readonly now: () => number;
  private lastBucketSweepMs = 0;
  private lastStateSweepMs = 0;
  private evictedAuctions = 0;
  private evictedBuckets = 0;
  public lastTickMs = 0;
  public tickDriftMs = 0;

  constructor(deps: EngineDeps) {
    this.deps = deps;
    this.now = deps.nowMs ?? (() => Date.now());
    this.rateBurst = deps.rateBurst ?? DEFAULT_RATE_BURST;
    this.rateRefillPerSec = deps.rateRefillPerSec ?? DEFAULT_RATE_REFILL_PER_SEC;
  }

  /**
   * Spend one token for this actor. Returns false when the actor is over their
   * sustained rate — the command is refused BEFORE it reaches the queue, so it
   * costs no fold, no broadcast and no head-of-line time.
   */
  private allow(actor: string): boolean {
    const now = this.now();
    this.sweepBuckets(now);
    const bucket = this.buckets.get(actor) ?? { tokens: this.rateBurst, lastMs: now };
    const refilled = Math.min(
      this.rateBurst,
      bucket.tokens + ((now - bucket.lastMs) / 1000) * this.rateRefillPerSec,
    );
    bucket.lastMs = now;
    if (refilled < 1) {
      bucket.tokens = refilled;
      this.buckets.set(actor, bucket);
      return false;
    }
    bucket.tokens = refilled - 1;
    this.buckets.set(actor, bucket);
    return true;
  }

  /** What the engine is holding, and what it has reclaimed (read-only). */
  residency(): EngineResidency {
    return {
      auctions: this.states.size,
      buckets: this.buckets.size,
      evictedAuctions: this.evictedAuctions,
      evictedBuckets: this.evictedBuckets,
    };
  }

  /**
   * Reclaim the meter for actors who have gone home. Amortized to once a
   * minute however hot the command path is, and driven by the meter's own path
   * plus the watchdog — never by a timer of its own.
   *
   * A bucket is dropped ONLY when it has refilled to the full burst, because a
   * full bucket and a missing bucket are the same thing: `allow()` mints a
   * missing one at exactly `rateBurst`. An actor who still owes tokens is
   * therefore kept however long they idle — reclaiming them would hand a
   * spammer their burst back, which is the one thing this must never do.
   */
  private sweepBuckets(nowMs: number): void {
    if (nowMs - this.lastBucketSweepMs < SWEEP_INTERVAL_MS) {
      return;
    }
    this.lastBucketSweepMs = nowMs;
    for (const [actor, bucket] of this.buckets) {
      const idleMs = nowMs - bucket.lastMs;
      if (idleMs < BUCKET_IDLE_TTL_MS) {
        continue;
      }
      const refilled = bucket.tokens + (idleMs / 1000) * this.rateRefillPerSec;
      if (refilled < this.rateBurst) {
        continue; // still in debt — keep metering them
      }
      this.buckets.delete(actor);
      this.evictedBuckets += 1;
    }
  }

  /**
   * Reclaim finished auctions. Deleting while iterating a Map is well defined.
   *
   * The WATCHDOG drives this and nothing else does: sweeping from the command
   * path would let a command evict the very auction it is a microsecond from
   * loading — never wrong (the load rebuilds it) but a snapshot thrown away for
   * nothing, and a needlessly confusing thing to read in a log.
   */
  private sweepStates(nowMs: number): void {
    if (nowMs - this.lastStateSweepMs < SWEEP_INTERVAL_MS) {
      return;
    }
    this.lastStateSweepMs = nowMs;
    for (const [auctionId, state] of this.states) {
      if (!this.evictable(auctionId, state, nowMs)) {
        continue;
      }
      // Consistently, or not at all: the snapshot, the queue tail, the depth
      // counter and the ack cache (which lives inside the state) go together.
      // Half an eviction — a dropped state with a live queue tail behind it —
      // would let the next command run beside the old one and break the single
      // writer, so these four lines are one operation.
      this.states.delete(auctionId);
      this.queues.delete(auctionId);
      this.pending.delete(auctionId);
      this.evictedAuctions += 1;
      this.deps.logger.info({ auctionId }, "auction evicted from memory — idle and terminal");
    }
  }

  /**
   * THE INVARIANT: an eviction must be indistinguishable from a restart.
   *
   * That holds only when nothing is in flight and nothing more can happen, so
   * every one of these guards must pass:
   *
   *  1. Not halted, and holding a snapshot. A halted auction is EVIDENCE an
   *     operator is looking at, and its recovery is still pending.
   *  2. Terminal status. A `live` or `paused` auction is mid-night and may take
   *     a command in the next millisecond; `scheduled` is about to be one.
   *     This is the guard that makes a mid-auction eviction unreachable.
   *  3. Nothing pending. A depth of zero means every enqueued command has run
   *     its `finally`, so the queue tail is settled and dropping it cannot
   *     orphan work or admit a second writer. `submit()` increments this depth
   *     synchronously, before any await, so a command is either counted here or
   *     has not been accepted yet — and one that arrives later simply reloads
   *     the auction from the log.
   *  4. Quiet for the TTL. Every command, socket join and diagnostics read
   *     touches `lastTouchMs`, so a finished auction people are still watching
   *     stays resident.
   */
  private evictable(auctionId: string, state: AuctionState, nowMs: number): boolean {
    if (state.halted !== null || state.snapshot === null) {
      return false;
    }
    if (!TERMINAL_STATUSES.has(state.snapshot.auctionStatus)) {
      return false;
    }
    if ((this.pending.get(auctionId) ?? 0) > 0) {
      return false;
    }
    return nowMs - state.lastTouchMs >= TERMINAL_RESIDENCY_TTL_MS;
  }

  async submit(envelope: AuctionCommandEnvelope): Promise<CommandAck> {
    if (!isAuctionCommandType(envelope.type)) {
      return this.reject(envelope, "unknown_command", 0);
    }
    // Metered BEFORE the queue: a refused command must not cost a fold, a
    // broadcast, or a place in front of somebody's bid.
    if (!this.allow(envelope.actor)) {
      this.deps.logger.warn({ actor: envelope.actor }, "actor rate limited");
      return this.reject(envelope, "rate_limited", 0);
    }
    // ARRIVAL TIME IS STAMPED HERE, at the boundary, and never again. Whatever
    // the queue does next, a bid that beat the hammer keeps having beaten it.
    return this.enqueue({ receivedAtMs: this.now(), ...envelope });
  }

  private enqueue(envelope: QueuedCommand): Promise<CommandAck> {
    const tail = this.queues.get(envelope.auctionId) ?? Promise.resolve();
    this.pending.set(envelope.auctionId, (this.pending.get(envelope.auctionId) ?? 0) + 1);
    const next = tail
      .then(() => this.process(envelope))
      .catch(async (error: unknown) => {
        this.deps.logger.error({ err: error, commandId: envelope.commandId }, "command failed");
        /**
         * A THROW IS NOT A HALT, AND SAYING SO WAS WRONG TWICE (audit PA-1 §6).
         *
         * This answered `engine_halted` — the one state that means the ledger
         * and the projections disagreed and NOTHING will be accepted until an
         * organizer runs Recover. Its copy says precisely that. But the engine
         * reaching here has not halted: `state.halted` is untouched and the
         * very next command will be served. A dropped database connection told
         * an auctioneer to run engine recovery mid-auction.
         *
         * Second, the write may well have COMMITTED before the throw — the
         * transaction commits, then something after it fails — so the
         * in-memory snapshot can now be behind the database, and every client
         * in the room is looking at it. Nothing rebuilt it, because `process`
         * never reached its rebuild. So rebuild here, before answering: the
         * room must not keep rendering a state the database has moved past.
         */
        try {
          const state = this.states.get(envelope.auctionId);
          if (state !== undefined) {
            await this.rebuild(state, envelope.auctionId);
          }
        } catch (rebuildError: unknown) {
          // If the rebuild ALSO fails the engine cannot prove its own state,
          // which is the genuine article — leave it to the halt machinery
          // rather than papering over it here.
          this.deps.logger.error({ err: rebuildError }, "rebuild after command failure failed");
        }
        return this.reject(
          envelope,
          "command_failed",
          this.states.get(envelope.auctionId)?.version ?? 0,
        );
      })
      .finally(() => {
        const depth = (this.pending.get(envelope.auctionId) ?? 1) - 1;
        this.pending.set(envelope.auctionId, Math.max(0, depth));
      });
    // The chain never breaks: failures resolve to rejections, the tail advances.
    this.queues.set(
      envelope.auctionId,
      next.catch(() => undefined),
    );
    return next;
  }

  private reject(envelope: QueuedCommand, reason: string, version: number): CommandAck {
    return { commandId: envelope.commandId, accepted: false, reason, version };
  }

  /**
   * REHYDRATE THE AUCTIONS THAT ARE STILL RUNNING (audit PA-1 §6).
   *
   * `tick()` is the timer authority and it only walks auctions RESIDENT in
   * `this.states`. A restarted engine's map is empty, and an auction becomes
   * resident only when something touches it — a socket joining, a command, a
   * diagnostics read. So after a deploy or a crash mid-lot the lot's clock did
   * not resume: it waited. If everyone in the room was watching rather than
   * clicking — which is what a room does while a lot runs down — nothing
   * touched the auction and every countdown simply stopped.
   *
   * Correctness held throughout (a late bid is still refused on its stamped
   * arrival time), but the night stalled until somebody poked it.
   *
   * `live` and `paused` only: a scheduled auction has no running clock and a
   * terminal one has nothing to resume, so this is bounded by what is genuinely
   * in flight — a handful at most, and zero most of the time. One auction
   * failing to load must not stop the others, or a single bad row would keep
   * the whole platform's timers down.
   */
  async rehydrate(): Promise<{ found: number; loaded: number }> {
    const rows = await this.deps.db
      .select({ id: auctions.id })
      .from(auctions)
      .where(inArray(auctions.status, ["live", "paused"]));
    let loaded = 0;
    for (const row of rows) {
      try {
        if ((await this.ensureAuction(row.id)) !== null) {
          loaded += 1;
        }
      } catch (error: unknown) {
        this.deps.logger.error({ err: error, auctionId: row.id }, "rehydrate failed for auction");
      }
    }
    return { found: rows.length, loaded };
  }

  /** Load (or reload) an auction: replay-on-load IS the recovery path. */
  async ensureAuction(auctionId: string): Promise<AuctionState | null> {
    const existing = this.states.get(auctionId);
    if (existing !== undefined) {
      // The single point every command, every socket join and every diagnostics
      // read passes through — so it is the one place residency is stamped.
      existing.lastTouchMs = this.now();
      return existing;
    }
    const record = await this.loadRecord(auctionId);
    if (record === null) {
      return null;
    }
    const stats = freshStats(Date.now());
    const replayStart = performance.now();
    const built = await buildLiveSnapshot(this.deps.db, record);
    stats.lastReplayMs = performance.now() - replayStart;
    if (!built.ok) {
      const state: AuctionState = {
        record,
        snapshot: null,
        serialized: "",
        version: 0,
        halted: `replay_failed:${built.reason}@${String(built.atSeq)}`,
        acks: new Map(),
        stats,
        lastTouchMs: this.now(),
      };
      this.states.set(auctionId, state);
      this.deps.logger.error(
        { auctionId, reason: built.reason, atSeq: built.atSeq },
        "REPLAY FAILED — auction halted",
      );
      return state;
    }
    stats.snapshotHash = sha256(built.serialized);
    stats.projectionHash = sha256(canonicalJson(built.projection));
    stats.eventCount = built.projection.eventCount;
    const state: AuctionState = {
      record,
      snapshot: built.snapshot,
      serialized: built.serialized,
      version: built.snapshot.version,
      halted:
        built.divergences.length > 0 ? `projection_mismatch:${built.divergences.join("; ")}` : null,
      acks: new Map(),
      stats,
      lastTouchMs: this.now(),
    };
    if (state.halted !== null) {
      this.deps.logger.error(
        { auctionId, divergences: built.divergences },
        "PROJECTION MISMATCH — auction halted",
      );
    }
    this.states.set(auctionId, state);
    return state;
  }

  private async loadRecord(auctionId: string): Promise<AuctionRecord | null> {
    const [row] = await this.deps.db
      .select({
        id: auctions.id,
        orgId: auctions.orgId,
        competitionId: auctions.competitionId,
        name: auctions.name,
        status: auctions.status,
        config: auctions.config,
      })
      .from(auctions)
      .where(eq(auctions.id, auctionId))
      .limit(1);
    return row === undefined ? null : { ...row, config: row.config as AuctionRecord["config"] };
  }

  /** Await the drain of an auction's command queue (tests, graceful shutdown). */
  async settle(auctionId: string): Promise<void> {
    await this.queues.get(auctionId);
  }

  /**
   * Drop in-memory state (test/ops surface — equivalent to a process restart).
   *
   * Every map that keys on the auction goes together, `pending` included: a
   * depth counter left behind after its queue was dropped reports a phantom
   * backlog to diagnostics for ever (audit 2026-08-26). A full reset also
   * empties the meter, because a restart would.
   */
  reset(auctionId?: string): void {
    if (auctionId !== undefined) {
      this.states.delete(auctionId);
      this.queues.delete(auctionId);
      this.pending.delete(auctionId);
    } else {
      this.states.clear();
      this.queues.clear();
      this.pending.clear();
      this.buckets.clear();
    }
  }

  snapshotOf(auctionId: string): AuctionState | undefined {
    return this.states.get(auctionId);
  }

  /** The read-only diagnostics projection (M-IP4-3) — no payloads, no secrets. */
  diagnosticsOf(auctionId: string): AuctionDiagnostics | null {
    const state = this.states.get(auctionId);
    if (state === undefined) {
      return null;
    }
    const stats = state.stats;
    const now = Date.now();
    const windowMs = Math.max(1, now - stats.loadedAtMs);
    return {
      auctionId,
      auctionStatus: state.snapshot?.auctionStatus ?? null,
      version: state.version,
      eventCount: stats.eventCount,
      halted: state.halted,
      queueDepth: this.pending.get(auctionId) ?? 0,
      processed: stats.processed,
      accepted: stats.accepted,
      rejected: stats.rejected,
      avgProcessMs: stats.processed > 0 ? stats.totalProcessMs / stats.processed : 0,
      lastProcessMs: stats.lastProcessMs,
      maxProcessMs: stats.maxProcessMs,
      commandsPerMinute: (stats.processed * 60_000) / windowMs,
      lastReplayMs: stats.lastReplayMs,
      lastRecoveryMs: stats.lastRecoveryMs,
      lastBroadcastLatencyMs: stats.lastBroadcastLatencyMs,
      snapshotHash: stats.snapshotHash,
      projectionHash: stats.projectionHash,
      recoveries: state.snapshot?.recoveries ?? 0,
      watchdog: {
        lastTickMs: this.lastTickMs,
        tickDriftMs: this.tickDriftMs,
        stalled: this.lastTickMs !== 0 && Date.now() - this.lastTickMs > 5_000,
      },
    };
  }

  private async process(envelope: QueuedCommand): Promise<CommandAck> {
    const state = await this.ensureAuction(envelope.auctionId);
    if (state === null) {
      return this.reject(envelope, "unknown_auction", 0);
    }
    // Idempotency: the same commandId FROM THE SAME ACTOR returns the ORIGINAL
    // ack, never re-executes.
    //
    // The key used to be the commandId alone, which made the cache a shared
    // namespace between every participant and the engine's own timer commands.
    // Scoping it to the actor means a retry still de-duplicates (same client,
    // same id) while one actor's id can neither serve nor suppress another's —
    // and ENGINE_ACTOR's internal ids are unreachable from transport (P0-2).
    const ackKey = ackKeyOf(envelope);
    const cached = state.acks.get(ackKey);
    if (cached !== undefined) {
      return cached;
    }
    if (state.halted !== null && envelope.type !== "RecoverAuction") {
      return this.remember(state, ackKey, this.reject(envelope, "engine_halted", state.version));
    }

    const started = performance.now();
    const ack = await this.execute(state, envelope);
    // Rebuild + verify + broadcast after every executed command (fail closed).
    await this.rebuild(state, envelope.auctionId);
    const elapsed = performance.now() - started;
    const stats = state.stats;
    stats.processed += 1;
    stats.totalProcessMs += elapsed;
    stats.lastProcessMs = elapsed;
    stats.maxProcessMs = Math.max(stats.maxProcessMs, elapsed);
    stats.lastCommandAtMs = Date.now();
    if (ack.accepted) {
      stats.accepted += 1;
    } else {
      stats.rejected += 1;
    }
    if (elapsed > SLOW_COMMAND_WARN_MS) {
      // PRR P1-5: the re-fold cost is climbing toward the web tier's 2s budget.
      // Surfaced now, while there is still headroom, so a checkpoint-fold can be
      // scheduled before a bidder ever sees a command time out.
      this.deps.logger.warn(
        {
          auctionId: envelope.auctionId,
          processMs: Math.round(elapsed),
          replayMs: Math.round(stats.lastReplayMs),
          eventCount: stats.eventCount,
        },
        "SLOW COMMAND — engine re-fold approaching the web command budget",
      );
    }
    const finalAck: CommandAck = { ...ack, version: state.version };
    return this.remember(state, ackKey, finalAck);
  }

  private remember(state: AuctionState, ackKey: string, ack: CommandAck): CommandAck {
    state.acks.set(ackKey, ack);
    if (state.acks.size > ACK_CACHE_LIMIT) {
      const oldest = state.acks.keys().next().value;
      if (oldest !== undefined) {
        state.acks.delete(oldest);
      }
    }
    return ack;
  }

  private str(payload: Readonly<Record<string, unknown>>, key: string): string | null {
    const value = payload[key];
    return typeof value === "string" && value !== "" ? value : null;
  }

  private async execute(state: AuctionState, envelope: QueuedCommand): Promise<CommandAck> {
    const { db } = this.deps;
    const auction = state.record;
    const actor = envelope.actor;
    const accept = (extra: Partial<CommandAck> = {}): CommandAck => ({
      commandId: envelope.commandId,
      accepted: true,
      version: state.version,
      ...extra,
    });
    const rejected = (reason: string): CommandAck => this.reject(envelope, reason, state.version);

    switch (envelope.type) {
      case "ClaimPaddle": {
        const teamId = this.str(envelope.payload, "teamId");
        if (teamId === null) {
          return rejected("invalid_payload");
        }
        const result = await claimPaddle(db, auction, actor, teamId);
        return result.ok ? accept() : rejected(result.reason);
      }
      case "ReleasePaddle": {
        const teamId = this.str(envelope.payload, "teamId");
        if (teamId === null) {
          return rejected("invalid_payload");
        }
        const result = await releasePaddle(db, auction, actor, teamId, envelope.conduct);
        return result.ok ? accept() : rejected(result.reason);
      }
      case "QueueLots": {
        if (!envelope.conduct) {
          return rejected("not_authorized");
        }
        const result = await queueAllLots(db, auction, actor);
        return accept({ reason: `queued:${String(result.applied)}` });
      }
      case "OpenLot": {
        if (!envelope.conduct) {
          return rejected("not_authorized");
        }
        const lotId = this.str(envelope.payload, "lotId");
        if (lotId === null) {
          return rejected("invalid_payload");
        }
        const result = await transitionLot(db, auction, lotId, actor, "open");
        return result.ok ? accept() : rejected(result.reason);
      }
      case "PlaceBid": {
        const lotId = this.str(envelope.payload, "lotId");
        const paddleId = this.str(envelope.payload, "paddleId");
        const amountRaw = envelope.payload["amountRaw"];
        if (lotId === null || paddleId === null || typeof amountRaw !== "number") {
          return rejected("invalid_payload");
        }
        // The actor must HOLD the paddle (or be a conductor: manual mode, doc 41).
        const [paddle] = await db
          .select({ personId: paddles.personId })
          .from(paddles)
          .where(and(eq(paddles.id, paddleId), eq(paddles.auctionId, auction.id)))
          .limit(1);
        const holder = paddle?.personId === actor;
        const result = await placeBid(db, auction, actor, {
          lotId,
          paddleId,
          amountRaw,
          bidderAuthorized: holder || envelope.conduct,
          ...(envelope.receivedAtMs === undefined ? {} : { receivedAtMs: envelope.receivedAtMs }),
        });
        return result.ok
          ? accept({ bidId: result.bidId, amount: result.amount, extended: result.extended })
          : rejected(result.code);
      }
      case "CloseLot":
      case "_TimerClose": {
        if (envelope.type === "CloseLot" && !envelope.conduct) {
          return rejected("not_authorized");
        }
        const lotId = this.str(envelope.payload, "lotId");
        if (lotId === null) {
          return rejected("invalid_payload");
        }
        const result = await closeLot(
          db,
          auction,
          lotId,
          actor,
          envelope.type === "_TimerClose" ? "timer expiry" : "gavel",
        );
        return result.ok ? accept() : rejected(result.reason);
      }
      case "_ClosingSoon": {
        const lotId = this.str(envelope.payload, "lotId");
        if (lotId === null) {
          return rejected("invalid_payload");
        }
        const result = await markLotClosingSoon(db, auction, lotId, actor);
        return result.ok ? accept() : rejected(result.reason);
      }
      case "OpenAuction":
      case "PauseAuction":
      case "ResumeAuction":
      case "CompleteAuction":
      case "AbortAuction": {
        if (!envelope.conduct) {
          return rejected("not_authorized");
        }
        const command = {
          OpenAuction: "open",
          PauseAuction: "pause",
          ResumeAuction: "resume",
          CompleteAuction: "complete",
          AbortAuction: "abort",
        }[envelope.type] as "open" | "pause" | "resume" | "complete" | "abort";
        const reasonText = this.str(envelope.payload, "reason") ?? undefined;
        // DA-06: completing with squads under the minimum refuses unless the
        // conductor says so on the record — the override rides in the payload
        // and its reason lands in the event, where it stays for ever.
        const override = envelope.payload["overrideSquadMinimum"] === true;
        const result = await transitionAuction(db, auction, actor, command, reasonText, override);
        return result.ok ? accept() : rejected(result.reason);
      }
      // Manual conduct (M-IP4-3): withdraw / freeze / requeue — the same
      // machine-decided aggregate steps, now on the command path.
      case "WithdrawLot":
      case "HoldLot":
      case "RequeueLot": {
        if (!envelope.conduct) {
          return rejected("not_authorized");
        }
        const lotId = this.str(envelope.payload, "lotId");
        if (lotId === null) {
          return rejected("invalid_payload");
        }
        const command = {
          WithdrawLot: "withdraw",
          HoldLot: "hold",
          RequeueLot: "requeue",
        }[envelope.type] as "withdraw" | "hold" | "requeue";
        const reasonText = this.str(envelope.payload, "reason") ?? undefined;
        const result = await transitionLot(db, auction, lotId, actor, command, reasonText);
        return result.ok ? accept() : rejected(result.reason);
      }
      case "IssuePaddle": {
        if (!envelope.conduct) {
          return rejected("not_authorized");
        }
        const teamId = this.str(envelope.payload, "teamId");
        const personId = this.str(envelope.payload, "personId");
        if (teamId === null || personId === null) {
          return rejected("invalid_payload");
        }
        const result = await issuePaddle(db, auction, actor, teamId, personId);
        return result.ok ? accept() : rejected(result.reason);
      }
      // The owner workflow (M-IP4-3): invitation → acceptance → grant.
      case "RevokeOwnerInvite": {
        if (!envelope.conduct) {
          return rejected("not_authorized");
        }
        const inviteId = this.str(envelope.payload, "inviteId");
        if (inviteId === null) {
          return rejected("invalid_payload");
        }
        const result = await revokeOwnerInvite(db, auction, actor, inviteId);
        return result.ok ? accept({}) : rejected(result.reason);
      }
      case "InviteOwner": {
        if (!envelope.conduct) {
          return rejected("not_authorized");
        }
        const teamId = this.str(envelope.payload, "teamId");
        const tokenHash = this.str(envelope.payload, "tokenHash");
        const expiresAtMs = envelope.payload["expiresAtMs"];
        if (teamId === null || tokenHash === null || typeof expiresAtMs !== "number") {
          return rejected("invalid_payload");
        }
        const result = await inviteOwner(db, auction, actor, teamId, tokenHash, expiresAtMs);
        return result.ok
          ? accept({ reason: `invite:${result.inviteId}` })
          : rejected(result.reason);
      }
      case "AcceptOwnerInvite": {
        const inviteId = this.str(envelope.payload, "inviteId");
        if (inviteId === null) {
          return rejected("invalid_payload");
        }
        const result = await acceptOwnerInvite(db, auction, actor, inviteId);
        return result.ok ? accept({ reason: `team:${result.teamId}` }) : rejected(result.reason);
      }
      case "GrantPaddle": {
        if (!envelope.conduct) {
          return rejected("not_authorized");
        }
        const teamId = this.str(envelope.payload, "teamId");
        const personId = this.str(envelope.payload, "personId");
        if (teamId === null || personId === null) {
          return rejected("invalid_payload");
        }
        const result = await grantPaddle(db, auction, actor, teamId, personId);
        return result.ok ? accept() : rejected(result.reason);
      }
      // Compensating undo (doc 41): conduct is not enough — the web gate must
      // have resolved auction.override on this actor.
      case "UndoLastAction": {
        if (!envelope.conduct || envelope.override !== true) {
          return rejected("not_authorized");
        }
        const reasonText = this.str(envelope.payload, "reason") ?? undefined;
        const result = await undoLastAction(db, auction, actor, reasonText);
        return result.ok
          ? accept({ reason: `reopened:${result.lotId}@${String(result.compensatesSeq)}` })
          : rejected(result.reason);
      }
      case "RecoverAuction": {
        if (!envelope.conduct) {
          return rejected("not_authorized");
        }
        const recoveryStart = performance.now();
        const report = await recoverAuction(db, auction, actor);
        state.stats.lastRecoveryMs = performance.now() - recoveryStart;
        if (!report.ok) {
          return rejected(`replay_failed:${report.reason ?? ""}`);
        }
        state.halted = null; // healed — the rebuild below re-verifies
        return accept({
          reason: report.healed ? `healed:${String(report.divergences.length)}` : "verified:0",
        });
      }
      default:
        return rejected("unknown_command");
    }
  }

  /**
   * Post-command rebuild: reload the record, re-fold the event log, verify the
   * projections, refresh + broadcast the snapshot. Every integrity failure
   * halts the auction — a lying snapshot is never served.
   */
  private async rebuild(state: AuctionState, auctionId: string): Promise<void> {
    const rebuildStart = performance.now();
    const record = await this.loadRecord(auctionId);
    if (record !== null) {
      state.record = record;
    }
    const replayStart = performance.now();
    const built = await buildLiveSnapshot(this.deps.db, state.record);
    state.stats.lastReplayMs = performance.now() - replayStart;
    if (!built.ok) {
      state.halted = `replay_failed:${built.reason}@${String(built.atSeq)}`;
      this.deps.logger.error({ auctionId, reason: built.reason }, "REPLAY FAILED — auction halted");
      return;
    }
    if (built.divergences.length > 0) {
      state.halted = `projection_mismatch:${built.divergences.join("; ")}`;
      this.deps.logger.error(
        { auctionId, divergences: built.divergences },
        "PROJECTION MISMATCH — auction halted",
      );
      return;
    }
    state.snapshot = built.snapshot;
    state.serialized = built.serialized;
    state.version = built.snapshot.version;
    state.stats.snapshotHash = sha256(built.serialized);
    state.stats.projectionHash = sha256(canonicalJson(built.projection));
    state.stats.eventCount = built.projection.eventCount;
    this.deps.onSnapshot(auctionId, built.serialized, built.snapshot.version);
    // Command completion → broadcast handoff, the diagnostics broadcast latency.
    state.stats.lastBroadcastLatencyMs = performance.now() - rebuildStart;
  }

  /**
   * The watchdog tick: the engine is the timer authority. Expired lots close
   * (sold/unsold by leading bid — doc 41); lots under the extension window
   * flip to closing_soon. Both go through the SAME command queue — the timer
   * never races a bid.
   */
  tick(): void {
    const now = this.now();
    if (this.lastTickMs !== 0) {
      this.tickDriftMs = Math.max(this.tickDriftMs, now - this.lastTickMs);
    }
    this.lastTickMs = now;
    // Housekeeping rides the watchdog rather than a timer of its own; both
    // sweeps throttle themselves, so a 250ms cadence costs nothing.
    this.sweepBuckets(now);
    this.sweepStates(now);
    for (const [auctionId, state] of this.states) {
      if (state.halted !== null || state.snapshot === null) {
        continue;
      }
      if (state.snapshot.auctionStatus !== "live") {
        continue;
      }
      const lot = state.snapshot.currentLot;
      if (lot === null || lot.endsAtMs === null) {
        continue;
      }
      if (now >= lot.endsAtMs) {
        void this.enqueue({
          commandId: `timer-close-${lot.lotId}-${String(lot.endsAtMs)}`,
          auctionId,
          type: "_TimerClose",
          actor: ENGINE_ACTOR,
          conduct: true,
          payload: { lotId: lot.lotId },
        });
      } else if (
        lot.status === "on_block" &&
        lot.endsAtMs - now <= state.record.config.timer.extensionSeconds * 1000
      ) {
        void this.enqueue({
          commandId: `closing-${lot.lotId}-${String(lot.endsAtMs)}`,
          auctionId,
          type: "_ClosingSoon",
          actor: ENGINE_ACTOR,
          conduct: true,
          payload: { lotId: lot.lotId },
        });
      }
    }
  }

  /**
   * Deep verification: rebuild the snapshot twice from the log and compare
   * BYTES — indeterminism is an integrity failure, halted like any other.
   *
   * NOT ON A TIMER, AND NOT SAFE ON ONE (audit PA-1 §6). It was documented as
   * running every 30 seconds and has never had a caller. The two folds below
   * run in parallel and read the database directly, so from a timer they race
   * the command queue: a commit landing between them makes two HONEST folds
   * differ, and this method's response to a difference is to halt the auction.
   * A healthy live night stopped by its own watchdog is a worse outcome than
   * the indeterminism it looks for.
   *
   * To schedule it, route it through the per-auction FIFO queue so it cannot
   * straddle a commit — the same serialization every mutation already gets.
   * Until then this is an on-demand tool, and the per-command
   * rebuild-and-verify in `process` is what guards the live path.
   */
  async deepVerify(auctionId: string): Promise<boolean> {
    const state = this.states.get(auctionId);
    if (state === undefined || state.halted !== null) {
      return false;
    }
    const [first, second] = await Promise.all([
      buildLiveSnapshot(this.deps.db, state.record),
      buildLiveSnapshot(this.deps.db, state.record),
    ]);
    if (!first.ok || !second.ok) {
      state.halted = "replay_failed:deep_verify";
      this.deps.logger.error({ auctionId }, "DEEP VERIFY: replay failed — auction halted");
      return false;
    }
    if (first.serialized !== second.serialized) {
      state.halted = "snapshot_mismatch";
      this.deps.logger.error({ auctionId }, "DEEP VERIFY: snapshot indeterminism — auction halted");
      return false;
    }
    return true;
  }
}
