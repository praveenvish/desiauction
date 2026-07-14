import { createHmac } from "node:crypto";

import type { AuctionCommandEnvelope, CommandAck } from "@desiauction/core";
import { newId } from "@desiauction/db";

import { env } from "../../env";

// The web tier's engine client (M-IP4-2). Web routes SUBMIT COMMANDS ONLY —
// identity and capability are resolved here (session → tenant → capability),
// then the command travels to the engine, the single mutation authority.
// Nothing in the web tier writes live-auction state anymore.

export type EngineCommandInput = Omit<AuctionCommandEnvelope, "commandId"> & {
  commandId?: string;
};

export async function sendEngineCommand(input: EngineCommandInput): Promise<CommandAck> {
  const envelope: AuctionCommandEnvelope = { commandId: input.commandId ?? newId(), ...input };
  try {
    const response = await fetch(`${env.ENGINE_URL}/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-engine-secret": env.ENGINE_SECRET,
      },
      body: JSON.stringify(envelope),
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        commandId: envelope.commandId,
        accepted: false,
        reason: `engine_http_${String(response.status)}`,
        version: 0,
      };
    }
    return (await response.json()) as CommandAck;
  } catch {
    // The engine is down: a deterministic rejection, never a silent failure.
    return {
      commandId: envelope.commandId,
      accepted: false,
      reason: "engine_unreachable",
      version: 0,
    };
  }
}

/** The spectate ticket the browser presents on the engine WebSocket. */
export function engineWsTicket(auctionId: string): string {
  return createHmac("sha256", env.ENGINE_SECRET).update(auctionId).digest("hex");
}

export function engineWsUrl(auctionId: string): string {
  return `${env.ENGINE_PUBLIC_WS_URL}?auction=${encodeURIComponent(auctionId)}&ticket=${engineWsTicket(auctionId)}`;
}

/**
 * Transitional (M-IP4-2): the auction SETUP surface still mutates through the
 * shared aggregate directly (its M-IP4-1 contract). Rows+events stay atomic,
 * but the engine's in-memory cache could serve a stale snapshot until its next
 * command — so setup mutations nudge the engine to drop cache and re-replay.
 * Best-effort: an unreachable engine is fine (it replays on next touch).
 * The full migration of setup conduct onto engine commands is M-IP4-3 scope.
 */
export async function notifyEngineReset(auctionId: string): Promise<void> {
  try {
    await fetch(`${env.ENGINE_URL}/admin/reset`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-engine-secret": env.ENGINE_SECRET,
      },
      body: JSON.stringify({ auctionId }),
      cache: "no-store",
    });
  } catch {
    // Engine offline — it will replay from the event log on next touch.
  }
}
