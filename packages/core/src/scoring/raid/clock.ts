import { integer, isRecord } from "../validate-primitives";
import type { RaidPanel } from "./public-state";
export interface RaidClockContext {
  serverAtMs: number;
  delayMs: number;
}
/** Display-only released timeline; never an engine transition or canonical snapshot mutation. */
export function raidClockDisplay(
  panel: RaidPanel,
  context: RaidClockContext,
  monotonicElapsedMs = 0,
): { halfElapsedMs: number; raidElapsedMs: number } {
  const advancing = panel.running && !panel.halfClosed && panel.clockAnchorAtMs !== null;
  const delta = advancing
    ? Math.max(
        0,
        context.serverAtMs -
          context.delayMs +
          Math.max(0, monotonicElapsedMs) -
          (panel.clockAnchorAtMs ?? 0),
      )
    : 0;
  return {
    halfElapsedMs: Math.min(panel.halfDurationMs, panel.halfElapsedMs + delta),
    raidElapsedMs: Math.min(30000, panel.raidElapsedMs + delta),
  };
}

export function projectRaidClockContext(raw: unknown): RaidClockContext | null {
  return isRecord(raw) &&
    integer(raw.serverAtMs, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) &&
    integer(raw.delayMs, 0, Number.MAX_SAFE_INTEGER)
    ? { serverAtMs: raw.serverAtMs, delayMs: raw.delayMs }
    : null;
}
