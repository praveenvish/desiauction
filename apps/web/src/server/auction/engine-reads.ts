import { env } from "../../env";
import { logger } from "../logger";

// THE ENGINE, READ. Split out of engine-client.ts, which carries the command
// sender and the websocket ticket signer, so a surface that only needs to LOOK
// at the engine — the recovery dashboard, the replay viewer, platform
// administration's live board — can import exactly that and nothing that acts.
// `.dependency-cruiser.cjs` keeps administration away from engine-client.

/**
 * M-IP4-3: every conduct mutation now travels the command path — the reset
 * nudge is gone. These read-only fetches feed the recovery dashboard and the
 * replay viewer; both are web-tier only (shared secret), never spectators.
 */
export async function fetchEngineDiagnostics(
  auctionId: string,
  timeoutMs = 5_000,
): Promise<unknown> {
  try {
    const response = await fetch(`${env.ENGINE_URL}/diagnostics/${auctionId}`, {
      headers: { "x-engine-secret": env.ENGINE_SECRET },
      cache: "no-store",
      // PRR P2/F46: a hung engine must not hang the server render. These are
      // read-only dashboard fetches, so a timeout degrades to "unreachable",
      // never a stalled page. `sendEngineCommand` already carries this budget.
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as unknown;
  } catch (error: unknown) {
    logger().warn({ err: error, auctionId }, "engine.diagnostics_unreachable");
    return null; // engine unreachable — the dashboard says so, loudly
  }
}

/** The engine's CURRENT serialized snapshot (replay-viewer comparison input). */
export async function fetchEngineSnapshot(auctionId: string): Promise<string | null> {
  try {
    const response = await fetch(`${env.ENGINE_URL}/snapshot/${auctionId}`, {
      headers: { "x-engine-secret": env.ENGINE_SECRET },
      cache: "no-store",
      // PRR P2/F46: bounded so a hung engine cannot stall the replay viewer's render.
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch (error: unknown) {
    logger().warn({ err: error, auctionId }, "engine.snapshot_unreachable");
    return null;
  }
}
