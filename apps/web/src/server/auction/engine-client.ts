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
 * M-IP4-3: every conduct mutation now travels the command path — the reset
 * nudge is gone. These read-only fetches feed the recovery dashboard and the
 * replay viewer; both are web-tier only (shared secret), never spectators.
 */
export async function fetchEngineDiagnostics(auctionId: string): Promise<unknown> {
  try {
    const response = await fetch(`${env.ENGINE_URL}/diagnostics/${auctionId}`, {
      headers: { "x-engine-secret": env.ENGINE_SECRET },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as unknown;
  } catch {
    return null; // engine unreachable — the dashboard says so, loudly
  }
}

/** The engine's CURRENT serialized snapshot (replay-viewer comparison input). */
export async function fetchEngineSnapshot(auctionId: string): Promise<string | null> {
  try {
    const response = await fetch(`${env.ENGINE_URL}/snapshot/${auctionId}`, {
      headers: { "x-engine-secret": env.ENGINE_SECRET },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}
