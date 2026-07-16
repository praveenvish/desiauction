import { describe, expect, it } from "vitest";

import {
  attestationDateFor,
  checklistGreen,
  dailyOpsJobKey,
  endedFiscalYearFor,
  evaluateFoundationChecklist,
  exceptionKindForCheck,
  leaseExpired,
  nextDailyDueMs,
  nextYearEndDueMs,
  retryDecision,
  yearEndJobKey,
} from "./runner";

describe("runner decisions", () => {
  it("retryDecision: deterministic exponential backoff, then a DEAD LETTER", () => {
    const now = 1_000_000;
    expect(retryDecision(1, 5, now)).toEqual({ kind: "retry", notBeforeMs: now + 5_000 });
    expect(retryDecision(2, 5, now)).toEqual({ kind: "retry", notBeforeMs: now + 10_000 });
    expect(retryDecision(4, 5, now)).toEqual({ kind: "retry", notBeforeMs: now + 40_000 });
    expect(retryDecision(5, 5, now)).toEqual({ kind: "dead" });
    expect(retryDecision(7, 5, now)).toEqual({ kind: "dead" });
    // The cap: attempt 30 of 31 still waits at most one hour.
    const capped = retryDecision(30, 31, now);
    expect(capped).toEqual({ kind: "retry", notBeforeMs: now + 3_600_000 });
    // Determinism: same inputs, same verdict.
    expect(retryDecision(3, 5, now)).toEqual(retryDecision(3, 5, now));
  });

  it("leaseExpired: crash recovery is a timeout, not a guess", () => {
    const leased = { state: "leased" as const, attempts: 1, maxAttempts: 5, leasedUntilMs: 100 };
    expect(leaseExpired(leased, 99)).toBe(false);
    expect(leaseExpired(leased, 100)).toBe(true);
    expect(leaseExpired({ ...leased, state: "queued" }, 200)).toBe(false);
    expect(leaseExpired({ ...leased, leasedUntilMs: null }, 200)).toBe(false);
  });

  it("schedule due times are IST-pinned and strictly ahead", () => {
    // 2026-07-15 00:00 IST == 2026-07-14T18:30Z; next daily-ops = 01:30 IST same day.
    const midnightIst = Date.parse("2026-07-14T18:30:00.000Z");
    expect(nextDailyDueMs(midnightIst)).toBe(Date.parse("2026-07-14T20:00:00.000Z"));
    // At exactly 01:30 IST the NEXT day fires (strictly ahead — no double fire).
    const atSlot = Date.parse("2026-07-14T20:00:00.000Z");
    expect(nextDailyDueMs(atSlot)).toBe(Date.parse("2026-07-15T20:00:00.000Z"));
    // Year-end: next April 1st 02:00 IST.
    expect(nextYearEndDueMs(Date.parse("2026-07-14T18:30:00.000Z"))).toBe(
      Date.parse("2027-03-31T20:30:00.000Z"),
    );
    expect(nextYearEndDueMs(Date.parse("2027-03-31T20:30:00.000Z"))).toBe(
      Date.parse("2028-03-31T20:30:00.000Z"),
    );
  });

  it("derived keys and occasions: same occasion, same key — idempotent by schema", () => {
    expect(dailyOpsJobKey("ORG", "2026-07-14")).toBe("ops.attest-day:ORG:2026-07-14");
    expect(yearEndJobKey("ORG", "2025-26")).toBe("ops.year-end:ORG:2025-26");
    // A run at 01:30 IST on the 15th attests the 14th.
    expect(attestationDateFor(Date.parse("2026-07-14T20:00:00.000Z"))).toBe("2026-07-14");
    // In July 2026 (FY 2026-27), the most recently ENDED year is 2025-26.
    expect(endedFiscalYearFor(Date.parse("2026-07-14T20:00:00.000Z"))).toBe("2025-26");
    // In February 2026 (still FY 2025-26), it is 2024-25.
    expect(endedFiscalYearFor(Date.parse("2026-02-14T20:00:00.000Z"))).toBe("2024-25");
  });

  it("the foundation checklist maps failures to the closed exception kinds", () => {
    const green = evaluateFoundationChecklist({
      followerLagEvents: 0,
      finopsDivergences: [],
      deadJobs: [],
    });
    expect(checklistGreen(green)).toBe(true);
    expect(green.map((check) => check.name)).toEqual([
      "follower-current",
      "finops-aggregates-healthy",
      "runner-queue-healthy",
    ]);

    const red = evaluateFoundationChecklist({
      followerLagEvents: 3,
      finopsDivergences: ["series:X documents: stored=[] expected=[…]"],
      deadJobs: [{ kind: "follower.run", key: "follower.run:ORG:2026-07-14" }],
    });
    expect(checklistGreen(red)).toBe(false);
    expect(red.every((check) => check.outcome === "fail")).toBe(true);
    expect(exceptionKindForCheck("follower-current")).toBe("follower-stall");
    expect(exceptionKindForCheck("finops-aggregates-healthy")).toBe("verification-failure");
    expect(exceptionKindForCheck("runner-queue-healthy")).toBe("dispatch-dlq");
    expect(exceptionKindForCheck("anything-else")).toBe("manual");
  });
});
