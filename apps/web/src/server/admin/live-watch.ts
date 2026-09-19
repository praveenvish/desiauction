"use server";

import { engineDiagnosticsSchema } from "@desiauction/contracts";

import { auctionOverview, type AuctionOverview } from "../auction/auction-overview";
import { fetchEngineDiagnostics } from "../auction/engine-reads";
import { systemDb } from "../db";
import { storage } from "../media";
import { platformAdminGate } from "./authz";
import {
  auctionExists,
  auctionHeader,
  auctionPulse,
  liveAuctionBoard,
  type AuctionHeader,
  type AuctionPulse,
  type LiveBoard,
} from "./live-views";

/**
 * THE LIVE BOARD AND THE AUCTION WATCH — gate, read, return.
 *
 * Read-only in the same way as actions.ts: every export gates on
 * `platform:admin`, reads, and returns. The pages call these on a timer, which
 * is why they are server actions rather than page renders: a page render writes
 * an access-log row (platformAdminPageGate), and a board refreshing every ten
 * seconds would bury the log in its own heartbeat. The page records ONE row
 * when it opens; the refreshes behind it record none.
 *
 * The engine is read over HTTP with a short budget, never commanded — the
 * dependency rules keep engine-client (the command sender) out of reach.
 */

/** How long one engine probe may take before the room reads "unreachable". */
const ENGINE_BUDGET_MS = 2_000;
/** How many rooms one refresh asks the engine about. The rest read "not checked". */
const ENGINE_PROBE_CAP = 20;

export type EngineRoom =
  | { readonly state: "unreachable" }
  /** The engine is up but holds nothing in memory for this auction: nobody has
   *  connected since it (re)started. Normal for a paused or quiet room. */
  | { readonly state: "idle"; readonly connectedClients: number }
  | {
      readonly state: "loaded";
      readonly connectedClients: number;
      /** Why the engine stopped accepting commands for this room, or null. */
      readonly halted: string | null;
      readonly queueDepth: number;
      readonly commandsPerMinute: number;
      readonly accepted: number;
      readonly rejected: number;
      readonly lastBroadcastLatencyMs: number;
      readonly recoveries: number;
      readonly watchdogStalled: boolean;
    }
  | { readonly state: "not_checked" };

async function engineRoom(auctionId: string): Promise<EngineRoom> {
  const raw = await fetchEngineDiagnostics(auctionId, ENGINE_BUDGET_MS);
  if (raw === null) {
    return { state: "unreachable" };
  }
  const parsed = engineDiagnosticsSchema.safeParse(raw);
  if (parsed.success) {
    const d = parsed.data;
    return {
      state: "loaded",
      connectedClients: d.connectedClients,
      halted: d.halted,
      queueDepth: d.queueDepth,
      commandsPerMinute: d.commandsPerMinute,
      accepted: d.accepted,
      rejected: d.rejected,
      lastBroadcastLatencyMs: d.lastBroadcastLatencyMs,
      recoveries: d.recoveries,
      watchdogStalled: d.watchdog.stalled,
    };
  }
  // The engine answers an auction it has not loaded with only its hub fields.
  if (
    typeof raw === "object" &&
    "connectedClients" in raw &&
    typeof raw.connectedClients === "number"
  ) {
    return { state: "idle", connectedClients: raw.connectedClients };
  }
  return { state: "unreachable" };
}

export interface LiveBoardView extends LiveBoard {
  /** Keyed by auction id; running rooms only, the busiest first. */
  readonly engine: Readonly<Record<string, EngineRoom>>;
}

export async function adminLiveBoard(): Promise<LiveBoardView | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  const board = await liveAuctionBoard(systemDb, Date.now());
  const probed = board.running.slice(0, ENGINE_PROBE_CAP);
  const rooms = await Promise.all(probed.map((row) => engineRoom(row.auctionId)));
  const engine: Record<string, EngineRoom> = {};
  board.running.forEach((row, index) => {
    engine[row.auctionId] = rooms[index] ?? { state: "not_checked" };
  });
  return { ...board, engine };
}

/**
 * The Overview's "Live now" band: the same board, without asking the engine —
 * the overview must render fast even when the engine is down, and it links to
 * the board that does ask.
 */
export async function adminLiveNow(): Promise<LiveBoard | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return liveAuctionBoard(systemDb, Date.now());
}

export async function adminAuctionExists(auctionId: string): Promise<boolean> {
  if ((await platformAdminGate()) === null) {
    return false;
  }
  return auctionExists(systemDb, auctionId);
}

export interface AuctionWatch {
  /** The config stays on the server: the overview has already read what it needs. */
  readonly header: Omit<AuctionHeader, "config">;
  readonly overview: AuctionOverview;
  readonly pulse: AuctionPulse;
  /** Null once the auction is over — there is no room left to ask about. */
  readonly engine: EngineRoom | null;
  readonly generatedAtMs: number;
}

export async function adminAuctionWatch(auctionId: string): Promise<AuctionWatch | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  const header = await auctionHeader(systemDb, auctionId);
  if (header === null) {
    return null;
  }
  const nowMs = Date.now();
  const running = header.status === "live" || header.status === "paused";
  const [overview, pulse, engine] = await Promise.all([
    // The organizer's own read of this auction — the same numbers they see,
    // with purses shown: platform:admin already reads every club's money.
    auctionOverview(systemDb, auctionId, header.config, header.sport, {
      money: true,
      readUrl: (key) => storage.readUrl(key),
    }),
    auctionPulse(systemDb, auctionId, nowMs),
    running ? engineRoom(auctionId) : Promise.resolve(null),
  ]);
  return {
    header: {
      auctionId: header.auctionId,
      auctionName: header.auctionName,
      status: header.status,
      orgName: header.orgName,
      orgSlug: header.orgSlug,
      seasonName: header.seasonName,
      seasonSlug: header.seasonSlug,
      sport: header.sport,
    },
    overview,
    pulse,
    engine,
    generatedAtMs: nowMs,
  };
}
