import type { RaidClockContext } from "../raid/clock";
import type { TimedPanel } from "./public-state";
/** Released display time only; no transition, event, result or ETag mutation. */
export function timedClockDisplay(
  panel: TimedPanel,
  context: RaidClockContext,
  monotonicElapsedMs = 0,
): { periodElapsedMs: number; gameClockMs: number } {
  const delta =
    panel.running && !panel.periodClosed && panel.clockAnchorAtMs !== null
      ? Math.max(
          0,
          context.serverAtMs -
            context.delayMs +
            Math.max(0, monotonicElapsedMs) -
            panel.clockAnchorAtMs,
        )
      : 0;
  const periodElapsedMs = Math.min(panel.periodDurationMs, panel.periodElapsedMs + delta);
  return {
    periodElapsedMs,
    gameClockMs: panel.gameClockMs + periodElapsedMs - panel.periodElapsedMs,
  };
}
