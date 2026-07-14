import {
  claimPaddle,
  closeLot,
  markLotClosingSoon,
  placeBid,
  queueAllLots,
  recoverAuction,
  releasePaddle,
  transitionAuction,
  transitionLot,
  type AuctionRecord,
} from "@desiauction/auction";
import { buildLiveSnapshot } from "@desiauction/auction";
import {
  isAuctionCommandType,
  type AuctionCommandEnvelope,
  type AuctionSnapshot,
  type CommandAck,
} from "@desiauction/core";
import { auctions, paddles, type Db } from "@desiauction/db";
import { and, eq } from "drizzle-orm";
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

interface QueuedCommand extends Omit<AuctionCommandEnvelope, "type"> {
  type: AuctionCommandEnvelope["type"] | InternalCommandType;
}

export interface AuctionState {
  record: AuctionRecord;
  snapshot: AuctionSnapshot | null; // null only while halted at load
  serialized: string;
  version: number;
  /** Fail-closed flag: non-null halts every command except RecoverAuction. */
  halted: string | null;
  acks: Map<string, CommandAck>;
}

export interface EngineDeps {
  db: Db;
  logger: FastifyBaseLogger;
  /** Broadcast hook — the WS hub subscribes; tests observe. */
  onSnapshot: (auctionId: string, serialized: string, version: number) => void;
  nowMs?: () => number;
}

const ACK_CACHE_LIMIT = 512;

export class AuctionEngine {
  private readonly states = new Map<string, AuctionState>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly deps: EngineDeps;
  private readonly now: () => number;
  public lastTickMs = 0;
  public tickDriftMs = 0;

  constructor(deps: EngineDeps) {
    this.deps = deps;
    this.now = deps.nowMs ?? (() => Date.now());
  }

  /** Submit a command: strictly serialized per auction (the command queue). */
  async submit(envelope: AuctionCommandEnvelope): Promise<CommandAck> {
    if (!isAuctionCommandType(envelope.type)) {
      return this.reject(envelope, "unknown_command", 0);
    }
    return this.enqueue(envelope);
  }

  private enqueue(envelope: QueuedCommand): Promise<CommandAck> {
    const tail = this.queues.get(envelope.auctionId) ?? Promise.resolve();
    const next = tail
      .then(() => this.process(envelope))
      .catch((error: unknown) => {
        this.deps.logger.error({ err: error, commandId: envelope.commandId }, "command failed");
        return this.reject(
          envelope,
          "engine_halted",
          this.states.get(envelope.auctionId)?.version ?? 0,
        );
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

  /** Load (or reload) an auction: replay-on-load IS the recovery path. */
  async ensureAuction(auctionId: string): Promise<AuctionState | null> {
    const existing = this.states.get(auctionId);
    if (existing !== undefined) {
      return existing;
    }
    const record = await this.loadRecord(auctionId);
    if (record === null) {
      return null;
    }
    const built = await buildLiveSnapshot(this.deps.db, record);
    if (!built.ok) {
      const state: AuctionState = {
        record,
        snapshot: null,
        serialized: "",
        version: 0,
        halted: `replay_failed:${built.reason}@${String(built.atSeq)}`,
        acks: new Map(),
      };
      this.states.set(auctionId, state);
      this.deps.logger.error(
        { auctionId, reason: built.reason, atSeq: built.atSeq },
        "REPLAY FAILED — auction halted",
      );
      return state;
    }
    const state: AuctionState = {
      record,
      snapshot: built.snapshot,
      serialized: built.serialized,
      version: built.snapshot.version,
      halted:
        built.divergences.length > 0 ? `projection_mismatch:${built.divergences.join("; ")}` : null,
      acks: new Map(),
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

  /** Drop in-memory state (test/ops surface — equivalent to a process restart). */
  reset(auctionId?: string): void {
    if (auctionId !== undefined) {
      this.states.delete(auctionId);
      this.queues.delete(auctionId);
    } else {
      this.states.clear();
      this.queues.clear();
    }
  }

  snapshotOf(auctionId: string): AuctionState | undefined {
    return this.states.get(auctionId);
  }

  private async process(envelope: QueuedCommand): Promise<CommandAck> {
    const state = await this.ensureAuction(envelope.auctionId);
    if (state === null) {
      return this.reject(envelope, "unknown_auction", 0);
    }
    // Idempotency: the same commandId returns the ORIGINAL ack, never re-executes.
    const cached = state.acks.get(envelope.commandId);
    if (cached !== undefined) {
      return cached;
    }
    if (state.halted !== null && envelope.type !== "RecoverAuction") {
      return this.remember(state, this.reject(envelope, "engine_halted", state.version));
    }

    const ack = await this.execute(state, envelope);
    // Rebuild + verify + broadcast after every executed command (fail closed).
    await this.rebuild(state, envelope.auctionId);
    const finalAck: CommandAck = { ...ack, version: state.version };
    return this.remember(state, finalAck);
  }

  private remember(state: AuctionState, ack: CommandAck): CommandAck {
    state.acks.set(ack.commandId, ack);
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
      case "PauseAuction":
      case "ResumeAuction":
      case "CompleteAuction":
      case "AbortAuction": {
        if (!envelope.conduct) {
          return rejected("not_authorized");
        }
        const command = {
          PauseAuction: "pause",
          ResumeAuction: "resume",
          CompleteAuction: "complete",
          AbortAuction: "abort",
        }[envelope.type] as "pause" | "resume" | "complete" | "abort";
        const reasonText = this.str(envelope.payload, "reason") ?? undefined;
        const result = await transitionAuction(db, auction, actor, command, reasonText);
        return result.ok ? accept() : rejected(result.reason);
      }
      case "RecoverAuction": {
        if (!envelope.conduct) {
          return rejected("not_authorized");
        }
        const report = await recoverAuction(db, auction, actor);
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
    const record = await this.loadRecord(auctionId);
    if (record !== null) {
      state.record = record;
    }
    const built = await buildLiveSnapshot(this.deps.db, state.record);
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
    this.deps.onSnapshot(auctionId, built.serialized, built.snapshot.version);
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
   * Deep verification (periodic watchdog): rebuild the snapshot twice from the
   * log and compare BYTES — indeterminism is an integrity failure, halted like
   * any other. Cheap enough to run on a slow cadence.
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
