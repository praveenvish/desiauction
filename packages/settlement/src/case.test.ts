import { describe, expect, it } from "vitest";

import {
  CASE_MACHINE,
  caseCommandAllowed,
  caseFullyDischarged,
  outstandingOf,
  replayCase,
  totalObligations,
  type CaseProjection,
} from "./case";
import {
  decideAdjust,
  decideClose,
  decideComputeObligations,
  decideOpenCase,
  decideReopen,
  decideSettle,
  decideVerifyCase,
  decideVoid,
  decideWaive,
} from "./commands";
import type { NewEvent, SettlementEventEnvelope } from "./events";
import { envelope, envelopes } from "./testing";

const CASE_ID = "01CASE00000000000000000000";
const AUCTION_ID = "01AUCTION0000000000000000A";
const COMP_ID = "01COMP0000000000000000000A";
const TEAM_A = "01TEAMA000000000000000000A";
const TEAM_B = "01TEAMB000000000000000000B";

const PIN = { sourceEventCount: 12, sourceDigest: "digest-source" };

const VERIFIED = {
  ok: true as const,
  source: {
    pin: PIN,
    fold: { paddles: {} } as never,
    foldDigest: "digest-fold",
    teamCount: 2,
    totalCommitted: 900,
  },
};

function opened(): NewEvent[] {
  const decision = decideOpenCase({
    caseId: CASE_ID,
    auctionId: AUCTION_ID,
    competitionId: COMP_ID,
    auctionStatus: "completed",
    basis: "committed",
    fixed: {},
    pin: PIN,
    caseExists: false,
  });
  if (!decision.ok) {
    throw new Error(decision.reason);
  }
  return [...decision.events];
}

/** Drive the case through decide → fold → decide, exactly as the writer does. */
function drive(steps: (projection: CaseProjection) => NewEvent[]): {
  events: SettlementEventEnvelope[];
  projection: CaseProjection;
} {
  let events = envelopes(opened());
  let replay = replayCase(events);
  if (!replay.ok) {
    throw new Error(replay.reason);
  }
  const next = steps(replay.projection);
  events = [...events, ...envelopes(next, { startSeq: events.length + 1 })];
  replay = replayCase(events);
  if (!replay.ok) {
    throw new Error(`${replay.reason} @${String(replay.atSeq)}`);
  }
  return { events, projection: replay.projection };
}

function ok(decision: ReturnType<typeof decideSettle>): NewEvent[] {
  if (!decision.ok) {
    throw new Error(decision.reason);
  }
  return [...decision.events];
}

/** The full Foundation journey: open → verify → obligations → waive → settle → close. */
function fullJourney(): { events: SettlementEventEnvelope[]; projection: CaseProjection } {
  return drive((projection) => {
    const events: NewEvent[] = [];
    events.push(...ok(decideVerifyCase(projection, VERIFIED)));

    const afterVerify = replayCase(envelopes([...opened(), ...events]));
    if (!afterVerify.ok) {
      throw new Error(afterVerify.reason);
    }
    events.push(
      ...ok(
        decideComputeObligations(afterVerify.projection, [
          { teamId: TEAM_A, amount: 500 },
          { teamId: TEAM_B, amount: 400 },
        ]),
      ),
    );

    const afterCompute = replayCase(envelopes([...opened(), ...events]));
    if (!afterCompute.ok) {
      throw new Error(afterCompute.reason);
    }
    events.push(
      ...ok(
        decideWaive(afterCompute.projection, { teamId: TEAM_A, amount: 500, reason: "sponsor" }),
      ),
    );
    events.push(
      ...ok(
        decideWaive(afterCompute.projection, { teamId: TEAM_B, amount: 400, reason: "sponsor" }),
      ),
    );

    const afterWaivers = replayCase(envelopes([...opened(), ...events]));
    if (!afterWaivers.ok) {
      throw new Error(afterWaivers.reason);
    }
    events.push(...ok(decideSettle(afterWaivers.projection)));

    const afterSettle = replayCase(envelopes([...opened(), ...events]));
    if (!afterSettle.ok) {
      throw new Error(afterSettle.reason);
    }
    events.push(
      ...ok(
        decideClose(afterSettle.projection, {
          publishedDigest: "digest-published",
          receiptedTeams: [],
        }),
      ),
    );
    return events;
  });
}

describe("SettlementCase — the machine", () => {
  it("declares every ratified edge and nothing else", () => {
    expect(CASE_MACHINE.map((edge) => `${edge.from}-${edge.command}`)).toEqual([
      "opened-verify",
      "opened-void",
      "verified-compute",
      "verified-void",
      "discrepant-verify",
      "discrepant-void",
      "settling-settle",
      "settled-close",
      "settled-reopen",
      "closed-reopen",
    ]);
    expect(caseCommandAllowed("voided", "reopen")).toBe(false);
    expect(caseCommandAllowed("closed", "close")).toBe(false);
    expect(caseCommandAllowed("settling", "void")).toBe(false);
  });

  it("opens only on a finished night, once", () => {
    const live = decideOpenCase({
      caseId: CASE_ID,
      auctionId: AUCTION_ID,
      competitionId: COMP_ID,
      auctionStatus: "live",
      basis: "committed",
      fixed: {},
      pin: PIN,
      caseExists: false,
    });
    expect(live).toEqual({ ok: false, reason: "auction_not_final" });

    const second = decideOpenCase({
      caseId: CASE_ID,
      auctionId: AUCTION_ID,
      competitionId: COMP_ID,
      auctionStatus: "completed",
      basis: "committed",
      fixed: {},
      pin: PIN,
      caseExists: true,
    });
    expect(second).toEqual({ ok: false, reason: "case_exists" });
  });

  it("pins intake at open and re-pins it on verification", () => {
    const { projection } = drive((state) => ok(decideVerifyCase(state, VERIFIED)));
    expect(projection.status).toBe("verified");
    expect(projection.sourceEventCount).toBe(12);
    expect(projection.sourceDigest).toBe("digest-source");
    expect(projection.foldDigest).toBe("digest-fold");
  });

  it("freezes money while discrepant — and re-pinning is what releases it", () => {
    const discrepant = drive((state) =>
      ok(
        decideVerifyCase(state, {
          ok: false,
          reasonCode: "count_mismatch",
          detail: "pinned=12 source=13",
        }),
      ),
    );
    expect(discrepant.projection.status).toBe("discrepant");
    // No obligation, waiver or adjustment is reachable from a discrepant case.
    expect(decideComputeObligations(discrepant.projection, [])).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    expect(decideWaive(discrepant.projection, { teamId: TEAM_A, amount: 1, reason: "x" })).toEqual({
      ok: false,
      reason: "illegal_transition",
    });

    // The override re-verification ADOPTS the new source (§11): the count moved
    // because the auction recovered, and the money never did.
    const rePinned = decideVerifyCase(discrepant.projection, {
      ok: true,
      source: {
        pin: { sourceEventCount: 13, sourceDigest: "digest-source-2" },
        fold: { paddles: {} } as never,
        foldDigest: "digest-fold",
        teamCount: 2,
        totalCommitted: 900,
      },
    });
    const events = [...discrepant.events, ...envelopes(ok(rePinned), { startSeq: 3 })];
    const replay = replayCase(events);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.projection.status).toBe("verified");
      expect(replay.projection.sourceEventCount).toBe(13);
      expect(replay.projection.sourceDigest).toBe("digest-source-2");
    }
  });
});

describe("SettlementCase — obligations are derived, never stored", () => {
  it("folds outstanding from non-negative counters", () => {
    const { projection } = fullJourney();
    const teamA = projection.obligations[TEAM_A];
    expect(teamA?.amount).toBe(500);
    expect(teamA?.waived).toBe(500);
    expect(teamA === undefined ? -1 : outstandingOf(teamA)).toBe(0);
    expect(totalObligations(projection)).toBe(900);
    expect(caseFullyDischarged(projection)).toBe(true);
    expect(projection.status).toBe("closed");
  });

  it("refuses to forgive, reduce or settle beyond what is owed", () => {
    const { projection } = drive((state) => {
      const events = ok(decideVerifyCase(state, VERIFIED));
      const afterVerify = replayCase(envelopes([...opened(), ...events]));
      if (!afterVerify.ok) {
        throw new Error(afterVerify.reason);
      }
      events.push(
        ...ok(decideComputeObligations(afterVerify.projection, [{ teamId: TEAM_A, amount: 500 }])),
      );
      return events;
    });

    expect(decideWaive(projection, { teamId: TEAM_A, amount: 501, reason: "r" })).toEqual({
      ok: false,
      reason: "amount_exceeds_outstanding",
    });
    expect(
      decideAdjust(projection, { teamId: TEAM_A, kind: "reduce", amount: 900, reason: "r" }),
    ).toEqual({ ok: false, reason: "amount_exceeds_outstanding" });
    expect(
      decideWaive(projection, { teamId: "01NOSUCHTEAM00000000000000", amount: 1, reason: "r" }),
    ).toEqual({
      ok: false,
      reason: "unknown_team",
    });
    // A case with an outstanding rupee cannot settle.
    expect(decideSettle(projection)).toEqual({ ok: false, reason: "obligations_outstanding" });
  });

  it("an increase re-opens the debt an equal waiver had closed", () => {
    const { projection, events } = drive((state) => {
      const decided = ok(decideVerifyCase(state, VERIFIED));
      const afterVerify = replayCase(envelopes([...opened(), ...decided]));
      if (!afterVerify.ok) {
        throw new Error(afterVerify.reason);
      }
      decided.push(
        ...ok(decideComputeObligations(afterVerify.projection, [{ teamId: TEAM_A, amount: 500 }])),
      );
      return decided;
    });
    const adjusted = ok(
      decideAdjust(projection, {
        teamId: TEAM_A,
        kind: "increase",
        amount: 250,
        reason: "late fee",
      }),
    );
    const replay = replayCase([...events, ...envelopes(adjusted, { startSeq: events.length + 1 })]);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      const obligation = replay.projection.obligations[TEAM_A];
      expect(obligation === undefined ? -1 : outstandingOf(obligation)).toBe(750);
      expect(totalObligations(replay.projection)).toBe(750);
    }
  });
});

describe("SettlementCase — closure, reopening, voiding", () => {
  it("reopens a closed case as a compensating event — history stays", () => {
    const closed = fullJourney();
    const reopen = ok(decideReopen(closed.projection, { reason: "owner disputed a waiver" }));
    const events = [...closed.events, ...envelopes(reopen, { startSeq: closed.events.length + 1 })];
    const replay = replayCase(events);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.projection.status).toBe("settling");
      expect(replay.projection.reopenings).toBe(1);
      // Every prior event survives untouched: reopening appends, never rewrites.
      expect(replay.projection.eventCount).toBe(closed.projection.eventCount + 1);
      expect(events.slice(0, closed.events.length)).toEqual(closed.events);
    }
  });

  it("never closes twice, and never settles a reopened case that owes money", () => {
    const closed = fullJourney();
    expect(decideClose(closed.projection, { publishedDigest: "d", receiptedTeams: [] })).toEqual({
      ok: false,
      reason: "illegal_transition",
    });

    const reopen = ok(decideReopen(closed.projection, { reason: "correction" }));
    const events = [...closed.events, ...envelopes(reopen, { startSeq: closed.events.length + 1 })];
    const replay = replayCase(events);
    if (!replay.ok) {
      throw new Error(replay.reason);
    }
    const increase = ok(
      decideAdjust(replay.projection, {
        teamId: TEAM_A,
        kind: "increase",
        amount: 100,
        reason: "correction",
      }),
    );
    const withDebt = replayCase([
      ...events,
      ...envelopes(increase, { startSeq: events.length + 1 }),
    ]);
    if (!withDebt.ok) {
      throw new Error(withDebt.reason);
    }
    expect(decideSettle(withDebt.projection)).toEqual({
      ok: false,
      reason: "obligations_outstanding",
    });
  });

  it("a case that moved money can never be voided", () => {
    const { projection } = drive((state) => ok(decideVerifyCase(state, VERIFIED)));
    expect(decideVoid(projection, { reason: "duplicate", postingCount: 1 })).toEqual({
      ok: false,
      reason: "case_has_postings",
    });
    const voided = decideVoid(projection, { reason: "duplicate", postingCount: 0 });
    expect(voided.ok).toBe(true);
  });

  it("holds the close guard for collected money (receipts) — vacuous until collections exist", () => {
    const closed = fullJourney();
    // Nothing was COLLECTED (only waived), so no receipt is owed and close stands.
    expect(closed.projection.status).toBe("closed");

    // Simulate a discharged obligation: the guard demands its receipt.
    const withDischarge: CaseProjection = {
      ...closed.projection,
      status: "settled",
      obligations: {
        [TEAM_A]: {
          teamId: TEAM_A,
          amount: 500,
          increased: 0,
          reduced: 0,
          discharged: 500,
          waived: 0,
          reinstated: 0,
        },
      },
    };
    expect(decideClose(withDischarge, { publishedDigest: "d", receiptedTeams: [] })).toEqual({
      ok: false,
      reason: "receipts_missing",
    });
    expect(decideClose(withDischarge, { publishedDigest: "d", receiptedTeams: [TEAM_A] }).ok).toBe(
      true,
    );
  });
});

describe("SettlementCase — replay is deterministic and fail-closed", () => {
  it("folds twice to the identical projection (idempotent replay)", () => {
    const { events } = fullJourney();
    const first = replayCase(events);
    const second = replayCase(events);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("stops on a sequence gap", () => {
    const { events } = fullJourney();
    const gapped = [...events.slice(0, 2), ...events.slice(3)];
    expect(replayCase(gapped)).toEqual({ ok: false, atSeq: 4, reason: "sequence_gap" });
  });

  it("stops on an unknown event type", () => {
    const { events } = fullJourney();
    const forged = [
      ...events,
      envelope("case", CASE_ID, events.length + 1, "CaseAbsolved", { teamId: TEAM_A }),
    ];
    expect(replayCase(forged)).toEqual({
      ok: false,
      atSeq: events.length + 1,
      reason: "unknown_event_type",
    });
  });

  it("stops on an illegal replayed transition (a forged settle over live debt)", () => {
    const { events } = drive((state) => {
      const decided = ok(decideVerifyCase(state, VERIFIED));
      const afterVerify = replayCase(envelopes([...opened(), ...decided]));
      if (!afterVerify.ok) {
        throw new Error(afterVerify.reason);
      }
      decided.push(
        ...ok(decideComputeObligations(afterVerify.projection, [{ teamId: TEAM_A, amount: 500 }])),
      );
      return decided;
    });
    // The command handler refuses; so does REPLAY, independently — which is what
    // stops a hand-written event row from settling a case that owes 500 paise.
    const forged = [...events, envelope("case", CASE_ID, events.length + 1, "CaseSettled", {})];
    expect(replayCase(forged)).toEqual({
      ok: false,
      atSeq: events.length + 1,
      reason: "illegal_replayed_transition",
    });
  });

  it("stops on a forged over-discharge", () => {
    const { events } = drive((state) => {
      const decided = ok(decideVerifyCase(state, VERIFIED));
      const afterVerify = replayCase(envelopes([...opened(), ...decided]));
      if (!afterVerify.ok) {
        throw new Error(afterVerify.reason);
      }
      decided.push(
        ...ok(decideComputeObligations(afterVerify.projection, [{ teamId: TEAM_A, amount: 500 }])),
      );
      return decided;
    });
    const forged = [
      ...events,
      envelope("case", CASE_ID, events.length + 1, "ObligationDischarged", {
        teamId: TEAM_A,
        amount: 501,
        paymentId: "01PAY0000000000000000000A",
        postingRef: "01POST000000000000000000A",
      }),
    ];
    expect(replayCase(forged)).toEqual({
      ok: false,
      atSeq: events.length + 1,
      reason: "obligation_overdischarged",
    });
  });

  it("stops on an obligation for a team the case never recognised", () => {
    const { events } = drive((state) => {
      const decided = ok(decideVerifyCase(state, VERIFIED));
      const afterVerify = replayCase(envelopes([...opened(), ...decided]));
      if (!afterVerify.ok) {
        throw new Error(afterVerify.reason);
      }
      decided.push(
        ...ok(decideComputeObligations(afterVerify.projection, [{ teamId: TEAM_A, amount: 500 }])),
      );
      return decided;
    });
    const forged = [
      ...events,
      envelope("case", CASE_ID, events.length + 1, "ObligationWaived", {
        teamId: TEAM_B,
        amount: 1,
        reason: "forged",
      }),
    ];
    expect(replayCase(forged)).toEqual({
      ok: false,
      atSeq: events.length + 1,
      reason: "unknown_team",
    });
  });

  it("stops on malformed money (float, negative, NaN) — the kernel's rules, at the log", () => {
    for (const amount of [500.5, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      const events = envelopes([
        ...opened(),
        {
          streamType: "case",
          streamId: CASE_ID,
          type: "CaseVerified",
          payload: {
            foldDigest: "d",
            sourceEventCount: 12,
            sourceDigest: "digest-source",
            teamCount: 1,
            totalCommitted: 1,
          },
        },
        {
          streamType: "case",
          streamId: CASE_ID,
          type: "ObligationsComputed",
          payload: { items: [{ teamId: TEAM_A, amount }] },
        },
      ]);
      expect(replayCase(events)).toEqual({
        ok: false,
        atSeq: 3,
        reason: "malformed_obligation",
      });
    }
  });

  it("refuses a stream that does not begin with CaseOpened", () => {
    const orphan = [envelope("case", CASE_ID, 1, "CaseSettled", {})];
    expect(replayCase(orphan)).toEqual({ ok: false, atSeq: 1, reason: "unknown_case" });
    expect(replayCase([])).toEqual({ ok: false, atSeq: 0, reason: "unknown_case" });
  });
});
