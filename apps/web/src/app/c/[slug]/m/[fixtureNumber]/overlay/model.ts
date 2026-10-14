import type { OverlayProjection, OverlaySting } from "@desiauction/core/scoring";
export interface OverlayPresentation {
  baseline: OverlayProjection | null;
  sting: OverlaySting | null;
  expiresAt: number;
}
export const initialPresentation = (): OverlayPresentation => ({
  baseline: null,
  sting: null,
  expiresAt: 0,
});
export function observeOverlay(
  previous: OverlayPresentation,
  next: OverlayProjection | null,
  now: number,
): OverlayPresentation {
  if (!next) return initialPresentation();
  const baseline = previous.baseline;
  if (!baseline || baseline.attempt !== next.attempt || baseline.inningsNo !== next.inningsNo)
    return { baseline: next, sting: null, expiresAt: 0 };
  if (next.seq < baseline.seq) return { baseline, sting: null, expiresAt: 0 };
  if (
    (next.lastDelivery?.seq ?? 0) < (baseline.lastDelivery?.seq ?? 0) ||
    (next.lastDelivery?.seq === baseline.lastDelivery?.seq &&
      next.lastDelivery?.sting !== baseline.lastDelivery?.sting)
  )
    return { baseline: next, sting: null, expiresAt: 0 };
  const fresh = next.lastDelivery && next.lastDelivery.seq > baseline.seq;
  const celebration = fresh && next.lastDelivery?.sting;
  return {
    baseline: next,
    sting: celebration
      ? (next.lastDelivery?.sting ?? null)
      : now < previous.expiresAt
        ? previous.sting
        : null,
    expiresAt: celebration ? now + 4000 : previous.expiresAt,
  };
}

export function overlayStale(
  phase: string | undefined,
  now: number,
  changedAt: number,
  lastSuccess: number,
): boolean {
  return now - lastSuccess >= 60000 || (phase === "live" && now - changedAt >= 60000);
}
