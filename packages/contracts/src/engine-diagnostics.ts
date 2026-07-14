import { z } from "zod";

/**
 * The engine's read-only diagnostics feed (M-IP4-3): GET /diagnostics/:id,
 * shared-secret gated — the recovery dashboard's wire contract. Numbers only;
 * no snapshot payloads, no secrets, nothing a spectator could ever receive.
 */
export const engineDiagnosticsSchema = z.object({
  auctionId: z.string(),
  auctionStatus: z.string().nullable(),
  version: z.number(),
  eventCount: z.number(),
  halted: z.string().nullable(),
  queueDepth: z.number(),
  processed: z.number(),
  accepted: z.number(),
  rejected: z.number(),
  avgProcessMs: z.number(),
  lastProcessMs: z.number(),
  maxProcessMs: z.number(),
  commandsPerMinute: z.number(),
  lastReplayMs: z.number(),
  lastRecoveryMs: z.number(),
  lastBroadcastLatencyMs: z.number(),
  snapshotHash: z.string(),
  projectionHash: z.string(),
  recoveries: z.number(),
  watchdog: z.object({
    lastTickMs: z.number(),
    tickDriftMs: z.number(),
    stalled: z.boolean(),
  }),
  connectedClients: z.number(),
  wsHeartbeatAgeMs: z.number(),
  serverNowMs: z.number(),
});

export type EngineDiagnostics = z.infer<typeof engineDiagnosticsSchema>;
