import { expect, it } from "vitest";
import { raidClockDisplay } from "./clock";
import type { RaidPanel } from "./public-state";
const panel: RaidPanel = {
  v: 1,
  formatKey: "pkl_40",
  half: 1,
  halfClosed: false,
  halfElapsedMs: 10000,
  halfDurationMs: 1200000,
  clockAnchorAtMs: 100000,
  running: true,
  raidElapsedMs: 1000,
  nextRaidingSide: "home",
  points: { home: 0, away: 0 },
  matCount: { home: 7, away: 7 },
  outCount: { home: 0, away: 0 },
  doOrDie: { home: false, away: false },
};
it("C51 SSR and hydration use released timeline and monotonic progression, not local wall clock", () => {
  expect(raidClockDisplay(panel, { serverAtMs: 140000, delayMs: 30000 })).toEqual({
    halfElapsedMs: 20000,
    raidElapsedMs: 11000,
  });
  expect(raidClockDisplay(panel, { serverAtMs: 140000, delayMs: 30000 }, 1500)).toEqual({
    halfElapsedMs: 21500,
    raidElapsedMs: 12500,
  });
  expect(raidClockDisplay(panel, { serverAtMs: 140000, delayMs: 0 })).toEqual({
    halfElapsedMs: 50000,
    raidElapsedMs: 30000,
  });
});
it("C51 paused/closed/interrupted snapshots never advance display or canonical fields", () => {
  const before = structuredClone(panel);
  for (const snapshot of [
    { ...panel, running: false },
    { ...panel, halfClosed: true },
    { ...panel, clockAnchorAtMs: null },
  ])
    expect(raidClockDisplay(snapshot, { serverAtMs: 140000, delayMs: 0 }, 1000)).toEqual({
      halfElapsedMs: 10000,
      raidElapsedMs: 1000,
    });
  expect(panel).toEqual(before);
});
it("C51 clamping and newly released original-anchor correction are display-only", () => {
  expect(raidClockDisplay(panel, { serverAtMs: 5000000, delayMs: 0 })).toEqual({
    halfElapsedMs: 1200000,
    raidElapsedMs: 30000,
  });
  expect(
    raidClockDisplay(
      { ...panel, halfElapsedMs: 0, clockAnchorAtMs: 110000 },
      { serverAtMs: 140000, delayMs: 30000 },
    ),
  ).toEqual({ halfElapsedMs: 0, raidElapsedMs: 1000 });
  expect(raidClockDisplay(panel, { serverAtMs: 90000, delayMs: 30000 }, -100)).toEqual({
    halfElapsedMs: 10000,
    raidElapsedMs: 1000,
  });
});
