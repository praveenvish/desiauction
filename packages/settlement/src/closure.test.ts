import { describe, expect, it } from "vitest";

import {
  caseFinancial,
  closureSummary,
  closureTimeline,
  collectionSummary,
  decideCloseCase,
  journalSummary,
  reconciledOverlay,
  verifyClosure,
  type ClosureInput,
} from "./closure";
import { replayCase, type CaseProjection } from "./case";
import { replayJournal, type JournalProjection } from "./journal";
import type { SettlementEventEnvelope } from "./events";
import { envelope, testDigest } from "./testing";

const CASE_ID = "01CASE00000000000000000000";
const AUCTION_ID = "01AUCTION0000000000000000A";
const COMP_ID = "01COMP0000000000000000000A";
const TEAM = "01TEAMA000000000000000000A";
const ORG = "01ORG00000000000000000000A";

/** A fully collected, settled case: opened → verified → obligations → discharged → settled. */
function settledCase(): CaseProjection {
  const events: SettlementEventEnvelope[] = [
    envelope("case", CASE_ID, 1, "CaseOpened", {
      caseId: CASE_ID,
      auctionId: AUCTION_ID,
      competitionId: COMP_ID,
      basis: "committed",
      sourceEventCount: 10,
      sourceDigest: "src",
    }),
    envelope("case", CASE_ID, 2, "CaseVerified", {
      foldDigest: "fold",
      sourceEventCount: 10,
      sourceDigest: "src",
      teamCount: 1,
      totalCommitted: 1000,
    }),
    envelope("case", CASE_ID, 3, "ObligationsComputed", {
      items: [{ teamId: TEAM, amount: 1000 }],
    }),
    envelope("case", CASE_ID, 4, "ObligationDischarged", {
      teamId: TEAM,
      amount: 1000,
      paymentId: "01PAY0000000000000000000A",
      postingRef: "01POST000000000000000002A",
    }),
    envelope("case", CASE_ID, 5, "CaseSettled", {}),
  ];
  const replay = replayCase(events);
  if (!replay.ok) {
    throw new Error(replay.reason);
  }
  return replay.projection;
}

/** The matching journal: obligation recognised, then collected in full. */
function balancedJournal(): JournalProjection {
  const events: SettlementEventEnvelope[] = [
    envelope("journal", ORG, 1, "JournalPosted", {
      postingId: "01POST000000000000000001A",
      template: "obligation",
      legs: [
        { account: `dues:${CASE_ID}:${TEAM}`, direction: "debit", amount: 1000 },
        { account: `case:${CASE_ID}`, direction: "credit", amount: 1000 },
      ],
      source: { stream: `case:${CASE_ID}`, seq: 3 },
      memo: null,
    }),
    envelope("journal", ORG, 2, "JournalPosted", {
      postingId: "01POST000000000000000002A",
      template: "collection",
      legs: [
        { account: "funds:manual:cash", direction: "debit", amount: 1000 },
        { account: `dues:${CASE_ID}:${TEAM}`, direction: "credit", amount: 1000 },
      ],
      source: { stream: `payment:01PAY0000000000000000000A`, seq: 2 },
      memo: null,
    }),
  ];
  const replay = replayJournal(events);
  if (!replay.ok) {
    throw new Error(replay.reason);
  }
  return replay.projection;
}

function input(overrides: Partial<ClosureInput> = {}): ClosureInput {
  const projection = overrides.caseProjection ?? settledCase();
  const journal = overrides.journal ?? balancedJournal();
  return {
    caseProjection: projection,
    journal,
    journalSeq: journal.lastSeq,
    caseEventCount: projection.eventCount,
    recomputedObligations: overrides.recomputedObligations ?? { [TEAM]: 1000 },
  };
}

describe("Closure — the financial verification engine", () => {
  it("passes every check on a clean, fully collected, settled case", () => {
    const verification = verifyClosure(input(), testDigest);
    expect(verification.ok).toBe(true);
    expect(verification.checks.map((c) => c.name)).toEqual([
      "case_settled",
      "no_outstanding",
      "trial_balance_zero",
      "dues_cleared",
      "no_refund_liability",
      "obligations_match_source",
      "collections_reconcile",
    ]);
    expect(verification.checks.every((c) => c.pass)).toBe(true);
  });

  it("BLOCKS closure when a team still owes money", () => {
    // Obligations computed but not discharged → still settling; force a settled-
    // shaped projection with outstanding by not discharging. Use a case stuck at
    // settling: verifyClosure reports both case_settled AND no_outstanding false.
    const events: SettlementEventEnvelope[] = [
      envelope("case", CASE_ID, 1, "CaseOpened", {
        caseId: CASE_ID,
        auctionId: AUCTION_ID,
        competitionId: COMP_ID,
        basis: "committed",
        sourceEventCount: 10,
        sourceDigest: "src",
      }),
      envelope("case", CASE_ID, 2, "CaseVerified", {
        foldDigest: "fold",
        sourceEventCount: 10,
        sourceDigest: "src",
        teamCount: 1,
        totalCommitted: 1000,
      }),
      envelope("case", CASE_ID, 3, "ObligationsComputed", {
        items: [{ teamId: TEAM, amount: 1000 }],
      }),
    ];
    const replay = replayCase(events);
    if (!replay.ok) throw new Error(replay.reason);
    const verification = verifyClosure(input({ caseProjection: replay.projection }), testDigest);
    expect(verification.ok).toBe(false);
    expect(verification.checks.find((c) => c.name === "no_outstanding")?.pass).toBe(false);
    expect(decideCloseCase(replay.projection, verification)).toMatchObject({ ok: false });
  });

  it("BLOCKS closure on a refund liability", () => {
    // A journal carrying an unrefunded over-collection.
    const events: SettlementEventEnvelope[] = [
      envelope("journal", ORG, 1, "JournalPosted", {
        postingId: "01POST000000000000000001A",
        template: "obligation",
        legs: [
          { account: `dues:${CASE_ID}:${TEAM}`, direction: "debit", amount: 1000 },
          { account: `case:${CASE_ID}`, direction: "credit", amount: 1000 },
        ],
        source: { stream: `case:${CASE_ID}`, seq: 3 },
        memo: null,
      }),
      envelope("journal", ORG, 2, "JournalPosted", {
        postingId: "01POST000000000000000002A",
        template: "overpaid-collection",
        legs: [
          { account: "funds:manual:cash", direction: "debit", amount: 1200 },
          { account: `dues:${CASE_ID}:${TEAM}`, direction: "credit", amount: 1000 },
          { account: "refund-liability", direction: "credit", amount: 200 },
        ],
        source: { stream: `payment:01PAY0000000000000000000A`, seq: 2 },
        memo: null,
      }),
    ];
    const replay = replayJournal(events);
    if (!replay.ok) throw new Error(replay.reason);
    const verification = verifyClosure(input({ journal: replay.projection }), testDigest);
    expect(verification.ok).toBe(false);
    expect(verification.checks.find((c) => c.name === "no_refund_liability")?.pass).toBe(false);
    expect(decideCloseCase(settledCase(), verification)).toEqual({
      ok: false,
      reason: "verification_failed:no_refund_liability",
    });
  });

  it("BLOCKS closure on an imbalanced journal (trial balance)", () => {
    // A degenerate journal whose accounts do not balance — the check catches it.
    const journal: JournalProjection = {
      accounts: { "funds:manual:cash": { debits: 1000, credits: 0 } },
      postings: {},
      sources: {},
      receipts: {},
      receiptCount: 0,
      creditNoteCount: 0,
      recoveries: 0,
      lastSeq: 1,
      eventCount: 1,
    };
    const verification = verifyClosure(input({ journal }), testDigest);
    expect(verification.checks.find((c) => c.name === "trial_balance_zero")?.pass).toBe(false);
    expect(verification.ok).toBe(false);
  });

  it("BLOCKS closure when obligations no longer match the auction source", () => {
    const verification = verifyClosure(
      input({ recomputedObligations: { [TEAM]: 999 } }),
      testDigest,
    );
    expect(verification.checks.find((c) => c.name === "obligations_match_source")?.pass).toBe(
      false,
    );
    expect(verification.ok).toBe(false);
  });
});

describe("Closure — evidence is reproducible by replay", () => {
  it("produces byte-identical evidence for identical inputs", () => {
    const a = verifyClosure(input(), testDigest);
    const b = verifyClosure(input(), testDigest);
    expect(JSON.stringify(a.evidence)).toBe(JSON.stringify(b.evidence));
  });

  it("seals every required digest, each reproducible", () => {
    const { evidence } = verifyClosure(input(), testDigest);
    for (const key of [
      "verificationDigest",
      "projectionDigest",
      "journalDigest",
      "walletDigest",
      "paymentDigest",
      "trialBalanceDigest",
    ] as const) {
      expect(typeof evidence[key]).toBe("string");
      expect(evidence[key].length).toBeGreaterThan(0);
    }
    expect(evidence.caseEventCount).toBe(5);
    expect(evidence.journalSeq).toBe(2);
  });

  it("closes with the evidence embedded in the CaseClosed event", () => {
    const verification = verifyClosure(input(), testDigest);
    const decision = decideCloseCase(settledCase(), verification);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.events[0]?.type).toBe("CaseClosed");
      expect(decision.events[0]?.payload["evidence"]).toEqual(verification.evidence);
      expect(decision.events[0]?.payload["publishedDigest"]).toBe(
        verification.evidence.verificationDigest,
      );
    }
  });

  it("a re-close (different journal seq) produces DIFFERENT evidence", () => {
    const first = verifyClosure(input(), testDigest);
    // A later closure sees a longer journal (more postings from a reopen cycle).
    const grown = balancedJournal();
    grown.lastSeq = 9;
    const second = verifyClosure(input({ journal: grown, journalSeq: 9 }), testDigest);
    expect(second.evidence.journalDigest).not.toBe(first.evidence.journalDigest);
    expect(second.evidence.journalSeq).toBe(9);
  });
});

describe("Closure — ceremony projections (read-only folds)", () => {
  const projection = settledCase();
  const journal = balancedJournal();

  it("summarises closure, finances and collections from the fold", () => {
    expect(closureSummary(projection)).toMatchObject({
      caseId: CASE_ID,
      auctionId: AUCTION_ID,
      status: "settled",
      basis: "committed",
      closedAtSeq: null,
    });
    expect(caseFinancial(projection)).toMatchObject({
      totalObligations: 1000,
      discharged: 1000,
      outstanding: 0,
    });
    expect(collectionSummary(projection)).toEqual([
      {
        teamId: TEAM,
        obligation: 1000,
        discharged: 1000,
        waived: 0,
        reinstated: 0,
        outstanding: 0,
      },
    ]);
  });

  it("summarises the case's journal footprint", () => {
    const lines = journalSummary(journal, CASE_ID);
    const dues = lines.find((l) => l.account === `dues:${CASE_ID}:${TEAM}`);
    expect(dues).toMatchObject({ debit: 1000, credit: 1000 }); // recognised then collected
  });

  it("folds the case stream into a timeline, unknown types rendered as themselves", () => {
    const events = [
      envelope("case", CASE_ID, 1, "CaseOpened", { basis: "committed" }),
      envelope("case", CASE_ID, 2, "CaseSettled", {}),
      envelope("case", CASE_ID, 3, "MysteryEvent", {}),
    ];
    const timeline = closureTimeline(events);
    expect(timeline[0]?.summary).toContain("Case opened");
    expect(timeline[1]?.summary).toContain("ready for closure");
    expect(timeline[2]?.summary).toBe("MysteryEvent");
  });

  it("derives the reconciled overlay from the case state, never the auction", () => {
    expect(reconciledOverlay(projection)).toMatchObject({
      auctionId: AUCTION_ID,
      reconciled: false, // settled, not yet closed
      caseId: CASE_ID,
    });
  });
});
