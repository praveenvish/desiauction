import { describe, expect, it } from "vitest";

import {
  attestationDigestBytes,
  certificationBytes,
  composeFiscalEvidence,
  deriveHealth,
  evaluateOperationalChecklist,
  overallHealth,
  periodTimeline,
  type OperationalObservations,
} from "./operations";
import { exceptionKindForCheck } from "./runner";
import { envelope } from "./testing";

const HEALTHY: OperationalObservations = {
  follower: { totalBehind: 0, cursorsAheadOfHead: 0 },
  runner: { deadJobs: 0, schedulesSeeded: true, scheduleOverdueMs: 0 },
  dispatch: { requestedBacklog: 0, oldestRequestedAgeMs: 0, failed: 0 },
  exports: { requestedBacklog: 0, failed: 0, unverifiedArtifacts: 0 },
  documents: { total: 5, unreproducible: 0, divergences: 0 },
  settlementSync: { journalBalanced: true, unfoldableStreams: 0, stalePayments: 0 },
  fiscal: { openExceptions: 0, awaitingClose: false, unverifiedEvidence: 0 },
};

describe("the operations supervisor — health is DERIVED, never asserted", () => {
  it("a fully observed, unbroken system is healthy", () => {
    const components = deriveHealth(HEALTHY);
    expect(components).toHaveLength(7);
    expect(components.every((component) => component.status === "healthy")).toBe(true);
    expect(overallHealth(components)).toBe("healthy");
  });

  it("UNKNOWN OPERATIONAL STATE FAILS CLOSED: an unobservable component is never healthy", () => {
    const components = deriveHealth({ ...HEALTHY, documents: null });
    const documents = components.find((component) => component.component === "documents");
    expect(documents?.status).toBe("unknown");
    expect(overallHealth(components)).toBe("unknown");
  });

  it("watermark corruption (a cursor ahead of its source head) FAILS the follower", () => {
    const components = deriveHealth({
      ...HEALTHY,
      follower: { totalBehind: 0, cursorsAheadOfHead: 1 },
    });
    expect(components.find((component) => component.component === "follower")?.status).toBe(
      "failed",
    );
    expect(overallHealth(components)).toBe("failed");
  });

  it("each broken observation degrades or fails EXACTLY its component", () => {
    const cases: [Partial<OperationalObservations>, string, string][] = [
      [{ follower: { totalBehind: 3, cursorsAheadOfHead: 0 } }, "follower", "degraded"],
      [
        { runner: { deadJobs: 1, schedulesSeeded: true, scheduleOverdueMs: 0 } },
        "runner",
        "failed",
      ],
      [
        { dispatch: { requestedBacklog: 2, oldestRequestedAgeMs: 16 * 60_000, failed: 0 } },
        "dispatch",
        "degraded",
      ],
      [
        { exports: { requestedBacklog: 0, failed: 0, unverifiedArtifacts: 1 } },
        "exports",
        "failed",
      ],
      [{ documents: { total: 5, unreproducible: 1, divergences: 0 } }, "documents", "failed"],
      [
        { settlementSync: { journalBalanced: false, unfoldableStreams: 0, stalePayments: 0 } },
        "settlement-sync",
        "failed",
      ],
      [
        { settlementSync: { journalBalanced: true, unfoldableStreams: 0, stalePayments: 2 } },
        "settlement-sync",
        "degraded",
      ],
      [
        { fiscal: { openExceptions: 1, awaitingClose: false, unverifiedEvidence: 0 } },
        "fiscal",
        "degraded",
      ],
      [
        { fiscal: { openExceptions: 0, awaitingClose: false, unverifiedEvidence: 1 } },
        "fiscal",
        "failed",
      ],
    ];
    for (const [override, component, status] of cases) {
      const components = deriveHealth({ ...HEALTHY, ...override });
      expect(components.find((row) => row.component === component)?.status).toBe(status);
      // Nothing else moved.
      expect(
        components.filter((row) => row.component !== component && row.status !== "healthy"),
      ).toEqual([]);
    }
  });
});

describe("the full operational checklist (M-IP6-4 completion)", () => {
  const GREEN = {
    followerLagEvents: 0,
    finopsDivergences: [],
    deadJobs: [],
    documentsUnreproducible: 0,
    exportsUnverified: 0,
    dispatchOldestRequestedAgeMs: 0,
    settlementSynchronized: true,
    fiscalEvidenceUnverified: 0,
  };

  it("extends the foundation's three checks with the five governance checks", () => {
    const checks = evaluateOperationalChecklist(GREEN);
    expect(checks.map((check) => check.name)).toEqual([
      "follower-current",
      "finops-aggregates-healthy",
      "runner-queue-healthy",
      "documents-reproducible",
      "exports-verified",
      "dispatch-current",
      "settlement-synchronized",
      "fiscal-evidence-reproducible",
    ]);
    expect(checks.every((check) => check.outcome === "pass")).toBe(true);
  });

  it("every governance check maps to a CLOSED exception kind; unknown names fail to manual", () => {
    expect(exceptionKindForCheck("documents-reproducible")).toBe("verification-failure");
    expect(exceptionKindForCheck("exports-verified")).toBe("export-failure");
    expect(exceptionKindForCheck("dispatch-current")).toBe("dispatch-dlq");
    expect(exceptionKindForCheck("settlement-synchronized")).toBe("sweep-mismatch");
    expect(exceptionKindForCheck("fiscal-evidence-reproducible")).toBe("verification-failure");
    expect(exceptionKindForCheck("never-heard-of-it")).toBe("manual");
  });

  it("red inputs redden exactly their checks", () => {
    const checks = evaluateOperationalChecklist({
      ...GREEN,
      documentsUnreproducible: 2,
      settlementSynchronized: false,
    });
    const failing = checks.filter((check) => check.outcome === "fail").map((check) => check.name);
    expect(failing).toEqual(["documents-reproducible", "settlement-synchronized"]);
  });
});

describe("evidence & certification bytes — canonical, deterministic, time-free", () => {
  it("composeFiscalEvidence canonicalizes ordering: input order never changes bytes", () => {
    const base = {
      watermark: { "journal:o": 4, "case:c": 7 },
      daysAttested: 2,
      exceptionCount: 0,
      attestationDigest: "d",
      documents: {
        series: [
          { seriesId: "B", eventCount: 3, documents: 2, registerDigest: "rb" },
          { seriesId: "A", eventCount: 2, documents: 1, registerDigest: "ra" },
        ],
        total: 3,
      },
      exports: {
        runs: [
          { exportId: "Y", eventCount: 2, status: "completed" },
          { exportId: "X", eventCount: 2, status: "failed" },
        ],
        registerDigest: "re",
        completed: 1,
      },
      dispatch: { requested: 0, sent: 1, confirmed: 1, failed: 0 },
      periodEventCount: 9,
    };
    const forward = composeFiscalEvidence(base);
    const reversed = composeFiscalEvidence({
      ...base,
      documents: { ...base.documents, series: [...base.documents.series].reverse() },
      exports: { ...base.exports, runs: [...base.exports.runs].reverse() },
    });
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
    expect(forward.documents.series[0]?.seriesId).toBe("A");
  });

  it("attestationDigestBytes orders by date — attestation order never changes the digest", () => {
    const forward = attestationDigestBytes([
      { date: "2025-04-02", attestedAtSeq: 3 },
      { date: "2025-04-01", attestedAtSeq: 2 },
    ]);
    const reversed = attestationDigestBytes([
      { date: "2025-04-01", attestedAtSeq: 2 },
      { date: "2025-04-02", attestedAtSeq: 3 },
    ]);
    expect(forward).toBe(reversed);
  });

  it("certificationBytes is time-free and check-order-independent", () => {
    const report = {
      orgId: "01ORG00000000000000000000A",
      watermark: { "case:c": 7 },
      streamCounts: { "series:s": 3 },
      checks: [
        { name: "b-check", pass: true, detail: null },
        { name: "a-check", pass: true, detail: "5 verified" },
      ],
      pass: true,
    };
    const swapped = { ...report, checks: [...report.checks].reverse() };
    expect(certificationBytes(report)).toBe(certificationBytes(swapped));
    expect(certificationBytes(report)).not.toContain("atMs");
  });
});

describe("the fiscal timeline — the period stream, rendered", () => {
  it("summarizes every event type from the fold, unknowns as themselves", () => {
    const entries = periodTimeline([
      envelope("period", "P", 1, "PeriodOpened", { periodId: "P", orgId: "O", fy: "2025-26" }),
      envelope("period", "P", 2, "DayAttested", { date: "2026-03-31", checks: [] }),
      envelope("period", "P", 3, "ExceptionNoted", { date: "2026-03-30", kind: "manual" }),
      envelope("period", "P", 4, "PeriodClosed", { evidence: {} }),
      envelope("period", "P", 5, "PeriodReopened", { reason: "late refund" }),
      envelope("period", "P", 6, "SomethingElse", {}),
    ]);
    expect(entries.map((entry) => entry.summary)).toEqual([
      "fiscal year opened",
      "day 2026-03-31 attested",
      "exception (manual) on 2026-03-30",
      "fiscal year sealed",
      "reopened — late refund",
      "SomethingElse",
    ]);
  });
});
