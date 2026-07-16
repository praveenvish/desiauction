/**
 * Deterministic fixtures shared by the finops unit suites. Test-only and pure:
 * the same inputs build the same log, byte for byte, on every machine.
 */

import type { FinopsEventEnvelope, FinopsNewEvent, FinopsStreamType } from "./events";

/** Turn decided events into a persisted stream, exactly as the writer would. */
export function envelopes(
  events: readonly FinopsNewEvent[],
  options: { startSeq?: number; atMs?: number; actor?: string } = {},
): FinopsEventEnvelope[] {
  const startSeq = options.startSeq ?? 1;
  const atMs = options.atMs ?? 1_700_000_000_000;
  const actor = options.actor ?? "01ACTOR0000000000000000000";
  return events.map((event, index) => ({
    streamType: event.streamType,
    streamId: event.streamId,
    seq: startSeq + index,
    type: event.type,
    atMs: atMs + index,
    actor,
    correlationId: `01CORR${String(index).padStart(20, "0")}`,
    commandId: `01CMD${String(index).padStart(21, "0")}`,
    payload: event.payload,
  }));
}

export function envelope(
  streamType: FinopsStreamType,
  streamId: string,
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  actor = "01ACTOR0000000000000000000",
): FinopsEventEnvelope {
  return {
    streamType,
    streamId,
    seq,
    type,
    atMs: 1_700_000_000_000 + seq,
    actor,
    correlationId: `01CORR${String(seq).padStart(20, "0")}`,
    commandId: `01CMD${String(seq).padStart(21, "0")}`,
    payload,
  };
}
