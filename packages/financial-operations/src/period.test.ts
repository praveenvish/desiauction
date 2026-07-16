import { describe, expect, it } from "vitest";

import {
  decideAttestDay,
  decideClosePeriod,
  decideNoteException,
  decideReopenPeriod,
} from "./commands";
import { FINOPS_SYSTEM_ACTOR, type FinopsEventEnvelope } from "./events";
import { closeReadiness, replayPeriod, type PeriodProjection } from "./period";
import { envelope } from "./testing";

const PERIOD = "01PER00000000000000000000A";
const ORG = "01ORG00000000000000000000A";
const HUMAN = "01HUMAN0000000000000000000";

// The test clock (1_700_000_000_000 + seq in testing.envelope) lands on IST
// 2023-11-15, i.e. FY 2023-24 — the period below matches it so openedDate
// falls INSIDE the year and close-coverage starts there.
const FY = "2023-24";

const greenChecks = [{ name: "follower-current", outcome: "pass" }];
const redChecks = [{ name: "follower-current", outcome: "fail", detail: "3 events behind" }];

function openedAt(seq = 1): FinopsEventEnvelope {
  return envelope("period", PERIOD, seq, "PeriodOpened", {
    periodId: PERIOD,
    orgId: ORG,
    fy: FY,
    openingWatermark: { "journal:org": 0 },
  });
}

function attested(
  seq: number,
  date: string,
  options: { actor?: string; checks?: unknown; watermark?: Record<string, number> } = {},
): FinopsEventEnvelope {
  return envelope(
    "period",
    PERIOD,
    seq,
    "DayAttested",
    {
      date,
      checks: options.checks ?? greenChecks,
      watermark: options.watermark ?? { "journal:org": seq },
    },
    options.actor ?? FINOPS_SYSTEM_ACTOR,
  );
}

function exception(seq: number, date: string): FinopsEventEnvelope {
  return envelope("period", PERIOD, seq, "ExceptionNoted", {
    date,
    kind: "follower-stall",
    detail: "cursor 3 behind",
  });
}

function foldOk(events: readonly FinopsEventEnvelope[]): PeriodProjection {
  const result = replayPeriod(events);
  if (!result.ok) {
    throw new Error(`${result.reason}@${String(result.atSeq)}`);
  }
  return result.projection;
}

describe("FiscalPeriod aggregate", () => {
  it("opens, attests days, and is deterministic (double fold, identical bytes)", () => {
    const events = [openedAt(), attested(2, "2023-11-14"), attested(3, "2023-11-15")];
    const first = foldOk(events);
    const second = foldOk(events);
    expect(Object.keys(first.days)).toEqual(["2023-11-14", "2023-11-15"]);
    expect(first.days["2023-11-14"]?.attestorKind).toBe("system");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("THE SENTINEL CANNOT ATTEST A RED DAY — replay-enforced, not just command-checked", () => {
    const forged = attested(2, "2023-11-14", { checks: redChecks });
    expect(replayPeriod([openedAt(), forged])).toEqual({
      ok: false,
      atSeq: 2,
      reason: "illegal_replayed_transition",
    });
    // A HUMAN may attest the same red day (that is the acknowledgment).
    const human = attested(2, "2023-11-14", { checks: redChecks, actor: HUMAN });
    expect(foldOk([openedAt(), human]).days["2023-11-14"]?.failures).toBe(1);
  });

  it("acknowledgment is deterministic: a HUMAN attestation covers prior exceptions of its day", () => {
    const events = [openedAt(), exception(2, "2023-11-14")];
    const burdened = foldOk(events);
    expect(burdened.exceptions[0]?.acknowledgedAtSeq).toBeNull();

    // The sentinel cannot attest the burdened day…
    expect(replayPeriod([...events, attested(3, "2023-11-14")])).toEqual({
      ok: false,
      atSeq: 3,
      reason: "illegal_replayed_transition",
    });
    // …a human can, and the exception is acknowledged at that seq.
    const answered = foldOk([...events, attested(3, "2023-11-14", { actor: HUMAN })]);
    expect(answered.exceptions[0]?.acknowledgedAtSeq).toBe(3);
    // A LATER exception on the same day is NOT retroactively acknowledged.
    const reopenedBurden = foldOk([
      ...events,
      attested(3, "2023-11-14", { actor: HUMAN }),
      exception(4, "2023-11-14"),
    ]);
    expect(reopenedBurden.exceptions[1]?.acknowledgedAtSeq).toBeNull();
  });

  it("CLOSE cannot fold over an unacknowledged exception; reopen is compensating", () => {
    const sealedOverBurden = envelope("period", PERIOD, 3, "PeriodClosed", {
      closingWatermark: { "journal:org": 9 },
      evidence: { daysAttested: 0 },
    });
    expect(replayPeriod([openedAt(), exception(2, "2023-11-14"), sealedOverBurden])).toEqual({
      ok: false,
      atSeq: 3,
      reason: "illegal_replayed_transition",
    });

    const closed = [
      openedAt(),
      attested(2, "2023-11-14", { actor: HUMAN }),
      envelope("period", PERIOD, 3, "PeriodClosed", {
        closingWatermark: { "journal:org": 9 },
        evidence: { daysAttested: 1 },
      }),
    ];
    const sealed = foldOk(closed);
    expect(sealed.status).toBe("closed");
    expect(sealed.closedAtSeq).toBe(3);

    const reopened = foldOk([
      ...closed,
      envelope("period", PERIOD, 4, "PeriodReopened", { reason: "late refund", compensates: 3 }),
    ]);
    expect(reopened.status).toBe("open");
    expect(reopened.closedAtSeq).toBeNull();
    expect(reopened.evidence).toBeNull();
    expect(reopened.reopenings).toBe(1);
  });

  it("WATERMARK_REGRESSION: an attestation standing on less history cannot fold", () => {
    const events = [
      openedAt(),
      attested(2, "2023-11-14", { watermark: { "journal:org": 10 } }),
      attested(3, "2023-11-15", { watermark: { "journal:org": 9 } }),
    ];
    expect(replayPeriod(events)).toEqual({ ok: false, atSeq: 3, reason: "watermark_regression" });
  });

  it("re-attestation is append-only; the latest attestation of a date governs", () => {
    const events = [
      openedAt(),
      attested(2, "2023-11-14"),
      attested(3, "2023-11-14", { actor: HUMAN }),
    ];
    const fold = foldOk(events);
    expect(fold.days["2023-11-14"]?.attestorKind).toBe("human");
    expect(fold.days["2023-11-14"]?.attestedAtSeq).toBe(3);
  });

  it("rejects dates outside the fiscal year and malformed checks", () => {
    expect(replayPeriod([openedAt(), attested(2, "2024-04-01")])).toEqual({
      ok: false,
      atSeq: 2,
      reason: "malformed_period",
    });
    expect(
      replayPeriod([openedAt(), attested(2, "2023-11-14", { checks: [{ name: "x" }] })]),
    ).toEqual({ ok: false, atSeq: 2, reason: "malformed_period" });
    expect(replayPeriod([openedAt(), attested(2, "2023-13-40")])).toEqual({
      ok: false,
      atSeq: 2,
      reason: "malformed_period",
    });
  });

  it("closeReadiness: coverage runs from the OPENING day (mid-year adoption) to FY end", () => {
    // Opened 2023-11-15 (the test clock); attest 15th..only — everything from
    // opening through FY end must be attested, nothing before it.
    const fold = foldOk([openedAt(), attested(2, "2023-11-15", { actor: HUMAN })]);
    const readiness = closeReadiness(fold);
    expect(readiness.ready).toBe(false);
    expect(readiness.missingDays[0]).toBe("2023-11-16");
    expect(readiness.missingDays).not.toContain("2023-11-14");
    expect(readiness.missingDays[readiness.missingDays.length - 1]).toBe("2024-03-31");
  });

  it("command guards: close demands an ENDED year; reopen demands a reason", () => {
    const fold = foldOk([openedAt(), attested(2, "2023-11-15", { actor: HUMAN })]);
    expect(
      decideClosePeriod(fold, {
        closingWatermark: { "journal:org": 99 },
        evidence: {},
        todayIst: "2024-03-31",
      }),
    ).toEqual({ ok: false, reason: "fiscal_year_not_ended" });
    expect(
      decideClosePeriod(fold, {
        closingWatermark: { "journal:org": 99 },
        evidence: {},
        todayIst: "2024-04-01",
      }),
    ).toEqual({ ok: false, reason: "days_unattested" });
    expect(decideReopenPeriod(fold, "why")).toEqual({ ok: false, reason: "period_not_closed" });
    expect(
      decideAttestDay(fold, {
        date: "2023-11-16",
        checks: [{ name: "c", outcome: "fail", detail: null }],
        watermark: { "journal:org": 99 },
        system: true,
      }),
    ).toEqual({ ok: false, reason: "system_cannot_attest_exceptions" });
    expect(decideNoteException(fold, { date: "2023-11-16", kind: "manual", detail: " " })).toEqual({
      ok: false,
      reason: "detail_required",
    });
  });

  it("fails closed on gaps, unknown types and wrong genesis", () => {
    expect(replayPeriod([attested(1, "2023-11-14")])).toEqual({
      ok: false,
      atSeq: 1,
      reason: "unknown_period",
    });
    expect(replayPeriod([openedAt(), envelope("period", PERIOD, 2, "PeriodForged", {})])).toEqual({
      ok: false,
      atSeq: 2,
      reason: "unknown_event_type",
    });
    expect(replayPeriod([openedAt(), attested(3, "2023-11-14")])).toEqual({
      ok: false,
      atSeq: 3,
      reason: "sequence_gap",
    });
  });
});
