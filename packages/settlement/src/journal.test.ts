import { canonicalJson } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import type { SettlementEventEnvelope } from "./events";
import {
  buildCollectionPosting,
  buildObligationPosting,
  buildRefundPosting,
  buildWaiverPosting,
  caseControlAccount,
  duesAccount,
  fundsAccount,
  parseAccount,
  postingsForCase,
  refundLiability,
  refundReinstatement,
  replayJournal,
  statementOf,
  trialBalance,
  validatePostingShape,
  walletOf,
  wallets,
  waivedAccount,
  type BuiltPosting,
  type JournalProjection,
  type PostingLeg,
} from "./journal";
import { envelope } from "./testing";

const ORG = "01ORG00000000000000000000A";
const CASE_ID = "01CASE00000000000000000000";
const TEAM_A = "01TEAMA000000000000000000A";
const TEAM_B = "01TEAMB000000000000000000B";
const METHOD = "manual:cash";

let seq = 0;

function posted(
  posting: BuiltPosting,
  source: { stream: string; seq: number },
  postingId: string,
): SettlementEventEnvelope {
  seq += 1;
  return envelope("journal", ORG, seq, "JournalPosted", {
    postingId,
    template: posting.template,
    legs: posting.legs.map((leg) => ({ ...leg })),
    source,
    memo: null,
  });
}

function fold(events: readonly SettlementEventEnvelope[]): JournalProjection {
  const replay = replayJournal(events);
  if (!replay.ok) {
    throw new Error(`${replay.reason} @${String(replay.atSeq)}`);
  }
  return replay.projection;
}

/** The obligation → collection → overpayment → refund life of one org's money. */
function moneyStory(): SettlementEventEnvelope[] {
  seq = 0;
  return [
    posted(
      buildObligationPosting(CASE_ID, [
        { teamId: TEAM_A, amount: 500 },
        { teamId: TEAM_B, amount: 400 },
      ]),
      { stream: `case:${CASE_ID}`, seq: 3 },
      "01POST000000000000000001A",
    ),
    // Team A pays in full.
    posted(
      buildCollectionPosting(CASE_ID, TEAM_A, METHOD, 500, 500),
      { stream: `payment:01PAYA`, seq: 3 },
      "01POST000000000000000002A",
    ),
    // Team B's dues were partly waived — and its payment for the ORIGINAL amount
    // lands anyway. The excess becomes a refund liability, in one balanced posting.
    posted(
      buildWaiverPosting(CASE_ID, TEAM_B, 150),
      { stream: `case:${CASE_ID}`, seq: 5 },
      "01POST000000000000000003A",
    ),
    posted(
      buildCollectionPosting(CASE_ID, TEAM_B, METHOD, 400, 250),
      { stream: `payment:01PAYB`, seq: 3 },
      "01POST000000000000000004A",
    ),
    // The overpayment is returned: liability first, so no settled debt resurrects.
    posted(
      buildRefundPosting(CASE_ID, TEAM_B, METHOD, 150, 150),
      { stream: `payment:01PAYB`, seq: 4 },
      "01POST000000000000000005A",
    ),
  ];
}

describe("OrgJournal — double-entry is the only money model", () => {
  it("every posting balances, and the org's books balance at every seq", () => {
    const events = moneyStory();
    for (let cut = 1; cut <= events.length; cut += 1) {
      const projection = fold(events.slice(0, cut));
      const balance = trialBalance(projection);
      expect(balance.balanced).toBe(true);
      expect(balance.debits).toBe(balance.credits);
    }
  });

  it("derives every wallet from the fold — nothing stores a balance", () => {
    const projection = fold(moneyStory());

    // Team A: owed 500, paid 500 → nothing outstanding.
    expect(walletOf(projection, duesAccount(CASE_ID, TEAM_A))?.balance).toBe(0);
    // Team B: owed 400, waived 150, paid 400, refunded 150 → nothing outstanding.
    expect(walletOf(projection, duesAccount(CASE_ID, TEAM_B))?.balance).toBe(0);
    // The org holds 900 collected − 150 returned = 750 in cash.
    expect(walletOf(projection, fundsAccount(METHOD))?.balance).toBe(750);
    // Dues recognised: 900. Forgiven: 150. Owed back: 0.
    expect(walletOf(projection, caseControlAccount(CASE_ID))?.balance).toBe(900);
    expect(walletOf(projection, waivedAccount(CASE_ID))?.balance).toBe(150);
    expect(refundLiability(projection)).toBe(0);

    // wallet == journal fold: each wallet is exactly the sum of its statement legs.
    for (const wallet of wallets(projection)) {
      const lines = statementOf(projection, wallet.account);
      const debits = lines
        .filter((line) => line.direction === "debit")
        .reduce((sum, line) => sum + line.amount, 0);
      const credits = lines
        .filter((line) => line.direction === "credit")
        .reduce((sum, line) => sum + line.amount, 0);
      expect(debits).toBe(wallet.debits);
      expect(credits).toBe(wallet.credits);
    }
  });

  it("carries the overpayment through refund-liability, never through a settled debt", () => {
    const events = moneyStory();
    // After the overpaid capture (4 events) the excess is owed back, visibly.
    const mid = fold(events.slice(0, 4));
    expect(refundLiability(mid)).toBe(150);
    expect(walletOf(mid, duesAccount(CASE_ID, TEAM_B))?.balance).toBe(0);

    const overpaid = events[3];
    expect(overpaid?.payload["template"]).toBe("overpaid-collection");

    // The refund debits the liability, NOT the dues — so nothing is reinstated.
    const refund = buildRefundPosting(CASE_ID, TEAM_B, METHOD, 150, 150);
    expect(refund.legs).toHaveLength(2);
    expect(refundReinstatement(refund, CASE_ID, TEAM_B)).toBe(0);

    // A refund beyond the liability reaches into dues — and that part, and only
    // that part, is what reinstates the team's obligation.
    const deeper = buildRefundPosting(CASE_ID, TEAM_A, METHOD, 200, 50);
    expect(refundReinstatement(deeper, CASE_ID, TEAM_A)).toBe(150);
    expect(validatePostingShape("refund", deeper.legs)).toBe(true);
  });

  it("chooses the posting template by the numbers, never by the caller", () => {
    expect(buildCollectionPosting(CASE_ID, TEAM_A, METHOD, 300, 500).template).toBe("collection");
    expect(buildCollectionPosting(CASE_ID, TEAM_A, METHOD, 500, 500).template).toBe("collection");
    expect(buildCollectionPosting(CASE_ID, TEAM_A, METHOD, 501, 500).template).toBe(
      "overpaid-collection",
    );
  });
});

describe("OrgJournal — the template set is a law, not a convention", () => {
  it("accepts only the ratified shapes", () => {
    expect(
      validatePostingShape(
        "obligation",
        buildObligationPosting(CASE_ID, [{ teamId: TEAM_A, amount: 5 }]).legs,
      ),
    ).toBe(true);
    expect(
      validatePostingShape(
        "collection",
        buildCollectionPosting(CASE_ID, TEAM_A, METHOD, 5, 5).legs,
      ),
    ).toBe(true);
    expect(validatePostingShape("waiver", buildWaiverPosting(CASE_ID, TEAM_A, 5).legs)).toBe(true);

    // A balanced posting that no template describes is still refused: there is
    // no free-form journal entry in this system.
    const freeform: PostingLeg[] = [
      { account: fundsAccount(METHOD), direction: "debit", amount: 100 },
      { account: waivedAccount(CASE_ID), direction: "credit", amount: 100 },
    ];
    expect(validatePostingShape("collection", freeform)).toBe(false);
    expect(validatePostingShape("waiver", freeform)).toBe(false);

    // An account outside the closed families cannot appear at all.
    const invented: PostingLeg[] = [
      { account: "slush:offshore", direction: "debit", amount: 100 },
      { account: duesAccount(CASE_ID, TEAM_A), direction: "credit", amount: 100 },
    ];
    expect(parseAccount("slush:offshore")).toBeNull();
    expect(validatePostingShape("collection", invented)).toBe(false);
  });

  it("halts on an off-template posting in the log", () => {
    seq = 0;
    const forged = envelope("journal", ORG, 1, "JournalPosted", {
      postingId: "01POSTFORGED000000000000A",
      template: "collection",
      legs: [
        { account: fundsAccount(METHOD), direction: "debit", amount: 100 },
        { account: waivedAccount(CASE_ID), direction: "credit", amount: 100 },
      ],
      source: { stream: "payment:01PAYX", seq: 3 },
    });
    expect(replayJournal([forged])).toEqual({
      ok: false,
      atSeq: 1,
      reason: "template_shape_mismatch",
    });
  });

  it("halts on an unbalanced posting — an unbalanced ledger is unrepresentable", () => {
    seq = 0;
    const forged = envelope("journal", ORG, 1, "JournalPosted", {
      postingId: "01POSTFORGED000000000000B",
      template: "collection",
      legs: [
        { account: fundsAccount(METHOD), direction: "debit", amount: 100 },
        { account: duesAccount(CASE_ID, TEAM_A), direction: "credit", amount: 90 },
      ],
      source: { stream: "payment:01PAYX", seq: 3 },
    });
    expect(replayJournal([forged])).toEqual({ ok: false, atSeq: 1, reason: "unbalanced_posting" });
  });

  it("halts when one cause posts twice", () => {
    seq = 0;
    const source = { stream: `case:${CASE_ID}`, seq: 3 };
    const events = [
      posted(buildObligationPosting(CASE_ID, [{ teamId: TEAM_A, amount: 500 }]), source, "01POST1"),
      posted(buildObligationPosting(CASE_ID, [{ teamId: TEAM_A, amount: 500 }]), source, "01POST2"),
    ];
    expect(replayJournal(events)).toEqual({
      ok: false,
      atSeq: 2,
      reason: "duplicate_posting_source",
    });
  });

  it("halts on money that never existed (conservation)", () => {
    seq = 0;
    // Collect against dues nobody owes → the dues account would go negative.
    const events = [
      posted(
        buildCollectionPosting(CASE_ID, TEAM_A, METHOD, 500, 500),
        { stream: "payment:01PAYA", seq: 3 },
        "01POSTX",
      ),
    ];
    expect(replayJournal(events)).toEqual({ ok: false, atSeq: 1, reason: "negative_account_flow" });

    // Refund cash the org never took in → the funds account would go negative.
    seq = 0;
    const refundOnly = [
      posted(
        buildRefundPosting(CASE_ID, TEAM_A, METHOD, 100, 0),
        { stream: "payment:01PAYA", seq: 4 },
        "01POSTY",
      ),
    ];
    expect(replayJournal(refundOnly)).toEqual({
      ok: false,
      atSeq: 1,
      reason: "negative_account_flow",
    });
  });

  it("halts on an unknown event type", () => {
    const events = [...moneyStory(), envelope("journal", ORG, 6, "MoneyVanished", {})];
    expect(replayJournal(events)).toEqual({ ok: false, atSeq: 6, reason: "unknown_event_type" });
  });

  it("halts on a sequence gap", () => {
    const [first, , third] = moneyStory();
    if (first === undefined || third === undefined) {
      throw new Error("fixture");
    }
    expect(replayJournal([first, third])).toEqual({
      ok: false,
      atSeq: 3,
      reason: "sequence_gap",
    });
  });
});

describe("OrgJournal — documents (registered here; issued in M-IP5-3)", () => {
  it("numbers receipts densely and credits them without ever editing them", () => {
    const events = moneyStory();
    const next = events.length;
    const withDocs = [
      ...events,
      envelope("journal", ORG, next + 1, "ReceiptIssued", {
        receiptId: "01RCPT000000000000000001A",
        receiptNo: 1,
        caseId: CASE_ID,
        teamId: TEAM_A,
        amount: 500,
        coversPostings: ["01POST000000000000000002A"],
      }),
      envelope("journal", ORG, next + 2, "CreditNoteIssued", {
        noteId: "01NOTE000000000000000001A",
        noteNo: 1,
        receiptId: "01RCPT000000000000000001A",
        amount: 200,
        reason: "partial refund",
      }),
    ];
    const projection = fold(withDocs);
    expect(projection.receiptCount).toBe(1);
    expect(projection.receipts["01RCPT000000000000000001A"]?.credited).toBe(200);

    // A gap in the series is a halt, not a shrug.
    const gapped = [
      ...events,
      envelope("journal", ORG, next + 1, "ReceiptIssued", {
        receiptId: "01RCPT000000000000000009A",
        receiptNo: 2,
        caseId: CASE_ID,
        teamId: TEAM_A,
        amount: 500,
        coversPostings: [],
      }),
    ];
    expect(replayJournal(gapped)).toEqual({
      ok: false,
      atSeq: next + 1,
      reason: "malformed_receipt",
    });

    // A receipt covering a posting that does not exist is not a receipt.
    const phantom = [
      ...events,
      envelope("journal", ORG, next + 1, "ReceiptIssued", {
        receiptId: "01RCPT000000000000000002A",
        receiptNo: 1,
        caseId: CASE_ID,
        teamId: TEAM_A,
        amount: 500,
        coversPostings: ["01POSTNOTHING0000000000AA"],
      }),
    ];
    expect(replayJournal(phantom)).toEqual({
      ok: false,
      atSeq: next + 1,
      reason: "unknown_posting",
    });

    // A credit note against an unknown receipt, and one beyond the receipt's value.
    const unknownReceipt = [
      ...events,
      envelope("journal", ORG, next + 1, "CreditNoteIssued", {
        noteId: "01NOTE000000000000000002A",
        noteNo: 1,
        receiptId: "01RCPTNOTHING000000000AAA",
        amount: 10,
        reason: "x",
      }),
    ];
    expect(replayJournal(unknownReceipt)).toEqual({
      ok: false,
      atSeq: next + 1,
      reason: "unknown_receipt",
    });

    const overCredit = [
      ...withDocs,
      envelope("journal", ORG, next + 3, "CreditNoteIssued", {
        noteId: "01NOTE000000000000000003A",
        noteNo: 2,
        receiptId: "01RCPT000000000000000001A",
        amount: 400,
        reason: "too much",
      }),
    ];
    expect(replayJournal(overCredit)).toEqual({
      ok: false,
      atSeq: next + 3,
      reason: "malformed_receipt",
    });
  });
});

describe("OrgJournal — replay determinism", () => {
  it("folds twice to identical BYTES", () => {
    const events = moneyStory();
    const first = replayJournal(events);
    const second = replayJournal(events);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(canonicalJson(first.projection)).toBe(canonicalJson(second.projection));
    }
  });

  it("attributes postings to their case — by their ACCOUNTS, and their provenance", () => {
    const projection = fold(moneyStory());
    // Four of the five postings touch a case account (dues or control). The
    // liability-first refund touches neither: `refund-liability` is an ORG-level
    // account (§9.3), so that posting is attributed to the org — and remains
    // traceable to the case through its payment source, which is what provenance
    // is for. The void guard is unaffected: a case cannot hold a refund without
    // first holding the collection that put a dues leg on the books.
    expect(postingsForCase(projection, CASE_ID)).toHaveLength(4);
    expect(postingsForCase(projection, "01CASEOTHER0000000000000A")).toHaveLength(0);

    const refundPosting = projection.postings["01POST000000000000000005A"];
    expect(refundPosting?.template).toBe("refund");
    expect(refundPosting?.caseId).toBeNull();
    expect(refundPosting?.sourceStream).toBe("payment:01PAYB");
  });

  it("folds a large journal within the certified envelope", () => {
    seq = 0;
    const events: SettlementEventEnvelope[] = [];
    const cases = 500;
    for (let index = 0; index < cases; index += 1) {
      const caseId = `01CASE${String(index).padStart(20, "0")}`;
      // 64 teams per case → 65 legs per obligation posting, plus a collection each.
      const items = Array.from({ length: 64 }, (_, team) => ({
        teamId: `01TEAM${String(team).padStart(20, "0")}`,
        amount: 1_000 + team,
      }));
      events.push(
        posted(
          buildObligationPosting(caseId, items),
          { stream: `case:${caseId}`, seq: 3 },
          `01P${String(index).padStart(23, "0")}`,
        ),
      );
      for (const item of items) {
        events.push(
          posted(
            buildCollectionPosting(caseId, item.teamId, METHOD, item.amount, item.amount),
            { stream: `payment:${caseId}${item.teamId}`, seq: 3 },
            `01C${String(events.length).padStart(23, "0")}`,
          ),
        );
      }
    }
    const legCount = cases * 65 + cases * 64 * 2;
    expect(legCount).toBeGreaterThan(90_000);

    const started = performance.now();
    const projection = fold(events);
    const elapsed = performance.now() - started;
    expect(trialBalance(projection).balanced).toBe(true);
    // The genesis fold is a scheduled/recovery path, not the command path — but
    // it must stay well inside the envelope even so (§24: < 1 s @100k legs).
    expect(elapsed).toBeLessThan(1_000);
  });
});
