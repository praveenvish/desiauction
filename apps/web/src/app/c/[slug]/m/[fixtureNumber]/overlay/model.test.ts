import { expect, it } from "vitest";
import type { OverlayProjection, OverlaySting } from "@desiauction/core/scoring";
import { initialPresentation, observeOverlay, overlayStale } from "./model";
const snapshot = (
  seq: number,
  delivery: number,
  sting: OverlaySting | null,
  attempt = 1,
  inningsNo = 1,
): OverlayProjection => ({
  seq,
  attempt,
  inningsNo,
  betweenOvers: true,
  lastDelivery: {
    seq: delivery,
    boundary: sting === "six" ? 6 : sting === "four" ? 4 : null,
    dismissal: sting === "wicket",
    sting,
  },
});
it("baselines old celebrations, times one new sting for four seconds and ignores duplicate polls", () => {
  let model = observeOverlay(initialPresentation(), snapshot(10, 10, "six"), 0);
  expect(model.sting).toBeNull();
  model = observeOverlay(model, snapshot(12, 11, "four"), 100);
  expect(model.sting).toBe("four");
  expect(model.expiresAt).toBe(4100);
  expect(observeOverlay(model, snapshot(12, 11, "four"), 4099).sting).toBe("four");
  expect(observeOverlay(model, snapshot(12, 11, "four"), 4100).sting).toBeNull();
  expect(observeOverlay(model, snapshot(13, 11, "four"), 300).expiresAt).toBe(4100);
});
it("suppresses amendments and void rollback, resets attempts/innings and reconnects", () => {
  const baseline = observeOverlay(initialPresentation(), snapshot(10, 10, "six"), 0);
  const active = observeOverlay(baseline, snapshot(11, 11, "wicket"), 10);
  expect(observeOverlay(active, snapshot(12, 11, null), 20).sting).toBeNull();
  expect(observeOverlay(active, snapshot(12, 10, "six"), 20).sting).toBeNull();
  expect(observeOverlay(active, snapshot(13, 13, "six", 2), 20).sting).toBeNull();
  expect(observeOverlay(active, snapshot(13, 13, "six", 1, 2), 20).sting).toBeNull();
  expect(observeOverlay(active, null, 20)).toEqual(initialPresentation());
  expect(observeOverlay(initialPresentation(), snapshot(13, 13, "six"), 20).sting).toBeNull();
  expect(observeOverlay(active, snapshot(9, 9, "six"), 20).baseline?.seq).toBe(11);
});
it("replaces only with a genuinely newer qualifying delivery and never plays a backlog", () => {
  let model = observeOverlay(initialPresentation(), snapshot(10, 10, null), 0);
  model = observeOverlay(model, snapshot(11, 11, "six"), 10);
  expect(observeOverlay(model, snapshot(12, 12, null), 20).sting).toBe("six");
  expect(observeOverlay(model, snapshot(15, 14, "wicket"), 30).sting).toBe("wicket");
  expect(observeOverlay(model, snapshot(15, 10, "four"), 30).sting).toBeNull();
});

it("clears transient statistics for stale scores even when duplicate polls remain healthy", () => {
  expect(overlayStale("live", 59999, 0, 59999)).toBe(false);
  expect(overlayStale("live", 60000, 0, 60000)).toBe(true);
  expect(overlayStale("live", 60000, 60000, 0)).toBe(true);
  expect(overlayStale("finished", 60000, 0, 60000)).toBe(false);
});
