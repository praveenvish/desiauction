import { describe, expect, it } from "vitest";

import {
  COLLECTION_POLICIES,
  collectionCommandId,
  collectionsSummary,
  coordinationEffects,
  decideAttestCapture,
  decideExpirePayment,
  decideInitiatePayment,
  decideManualRefund,
  decideWebhookEvent,
  paymentHasEffects,
  type CoordinationContext,
} from "./collections";
import type { SettlementEventEnvelope } from "./events";
import { replayJournal } from "./journal";
import { replayPayment, type PaymentProjection } from "./payment";
import { envelope } from "./testing";

const PAY = "01PAY00000000000000000000A";
const CASE_ID = "01CASE00000000000000000000";
const TEAM = "01TEAMA000000000000000000A";
const ORG = "01ORG00000000000000000000A";
const POSTING = "01POST000000000000000000A";

function paymentFold(events: readonly SettlementEventEnvelope[]): PaymentProjection {
  const replay = replayPayment(events);
  if (!replay.ok) {
    throw new Error(`${replay.reason} @${String(replay.atSeq)}`);
  }
  return replay.projection;
}

const gatewayInitiated = envelope("payment", PAY, 1, "PaymentInitiated", {
  paymentId: PAY,
  caseId: CASE_ID,
  teamId: TEAM,
  method: "gateway:razorpay",
  amount: 5_000,
  orderRef: "order_abc",
});
const manualInitiated = envelope("payment", PAY, 1, "PaymentInitiated", {
  paymentId: PAY,
  caseId: CASE_ID,
  teamId: TEAM,
  method: "manual:cash",
  amount: 5_000,
});

describe("Collections — payment command deciders (map onto the CLOSED catalog)", () => {
  it("initiates only against a settling case, within the team's outstanding", () => {
    const base = {
      paymentId: PAY,
      caseId: CASE_ID,
      teamId: TEAM,
      method: "gateway:razorpay",
      amount: 5_000,
      orderRef: "order_abc",
    };
    expect(
      decideInitiatePayment({ ...base, caseStatus: "verified", teamOutstanding: 9_999 }),
    ).toEqual({ ok: false, reason: "case_not_collecting" });
    expect(
      decideInitiatePayment({ ...base, caseStatus: "settling", teamOutstanding: 4_999 }),
    ).toEqual({ ok: false, reason: "amount_exceeds_outstanding" });
    expect(decideInitiatePayment({ ...base, caseStatus: "settling", teamOutstanding: 0 })).toEqual({
      ok: false,
      reason: "amount_exceeds_outstanding",
    });
    expect(
      decideInitiatePayment({
        ...base,
        method: "gateway:stripe",
        caseStatus: "settling",
        teamOutstanding: 9_999,
      }),
    ).toEqual({ ok: false, reason: "invalid_method" });

    const ok = decideInitiatePayment({ ...base, caseStatus: "settling", teamOutstanding: 9_999 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.events[0]?.type).toBe("PaymentInitiated");
      expect(ok.events[0]?.payload["orderRef"]).toBe("order_abc"); // gateway carries the envelope anchor
    }
  });

  it("manual attestation captures the pinned amount and is flagged as attested", () => {
    const projection = paymentFold([manualInitiated]);
    expect(decideAttestCapture(projection, { attestedBy: "" })).toEqual({
      ok: false,
      reason: "invalid_amount",
    });
    const ok = decideAttestCapture(projection, {
      attestedBy: "01OFF0000000000000000000AA",
      evidenceRef: "photo",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.events[0]).toMatchObject({
        type: "PaymentCaptured",
        payload: { amount: 5_000, attestedBy: "01OFF0000000000000000000AA", evidenceRef: "photo" },
      });
    }
    // A gateway payment cannot be manually attested — wrong channel.
    expect(decideAttestCapture(paymentFold([gatewayInitiated]), { attestedBy: "x" })).toEqual({
      ok: false,
      reason: "wrong_method_channel",
    });
  });

  it("a webhook maps provider truth onto the machine, out-of-order allowed", () => {
    const created = paymentFold([gatewayInitiated]);
    // Capture straight from created (authorize webhook never seen).
    const captured = decideWebhookEvent(created, {
      providerEventId: "evt_1",
      kind: "captured",
      amount: 5_000,
      providerRef: "pay_x",
    });
    expect(captured.ok).toBe(true);
    if (captured.ok) {
      expect(captured.events[0]).toMatchObject({
        type: "PaymentCaptured",
        payload: { amount: 5_000, providerRef: "pay_x", providerEventId: "evt_1" },
      });
    }
    // A capture for any other amount is not this payment.
    expect(
      decideWebhookEvent(created, {
        providerEventId: "e",
        kind: "captured",
        amount: 6_000,
        providerRef: "p",
      }),
    ).toEqual({ ok: false, reason: "amount_mismatch" });
    // A manual payment named by a webhook is a channel mismatch.
    expect(
      decideWebhookEvent(paymentFold([manualInitiated]), {
        providerEventId: "e",
        kind: "captured",
        amount: 5_000,
        providerRef: "p",
      }),
    ).toEqual({ ok: false, reason: "wrong_method_channel" });
  });

  it("expiry is a PaymentFailed(expired); refund reversal is override-only and bounded", () => {
    const created = paymentFold([gatewayInitiated]);
    const expired = decideExpirePayment(created);
    expect(expired.ok).toBe(true);
    if (expired.ok) {
      expect(expired.events[0]).toMatchObject({
        type: "PaymentFailed",
        payload: { code: "expired" },
      });
    }

    const capturedManual = paymentFold([
      manualInitiated,
      envelope("payment", PAY, 2, "PaymentCaptured", { amount: 5_000, attestedBy: "01OFF" }),
    ]);
    expect(decideManualRefund(capturedManual, { amount: 6_000, reason: "x" })).toEqual({
      ok: false,
      reason: "refund_exceeds_captured",
    });
    const ok = decideManualRefund(capturedManual, { amount: 2_000, reason: "returned cash" });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.events[0]).toMatchObject({ type: "PaymentRefunded", payload: { amount: 2_000 } });
    }
  });
});

describe("Collections — the coordinator (source-keyed, deterministic)", () => {
  const capturedEvent = envelope("payment", PAY, 2, "PaymentCaptured", {
    amount: 5_000,
    providerRef: "pay_x",
    providerEventId: "evt_1",
  });

  it("PaymentCaptured → Collection posting + ObligationDischarged (full)", () => {
    const ctx: CoordinationContext = {
      orgId: ORG,
      caseId: CASE_ID,
      teamId: TEAM,
      method: "gateway:razorpay",
      teamOutstanding: 5_000,
      remainingLiability: 0,
      postingId: POSTING,
    };
    const effects = coordinationEffects(capturedEvent, ctx);
    expect(effects).toHaveLength(2);
    expect(effects[0]?.commandId).toBe(`payment:${PAY}:2:collection-posting`);
    expect(effects[0]?.event.payload["template"]).toBe("collection");
    expect(effects[1]?.commandId).toBe(`payment:${PAY}:2:collection-discharge`);
    expect(effects[1]?.event).toMatchObject({
      streamType: "case",
      type: "ObligationDischarged",
      payload: { teamId: TEAM, amount: 5_000, paymentId: PAY, postingRef: POSTING },
    });
  });

  it("overpayment (raced waiver) → Overpaid Collection; discharge is only the dues part", () => {
    const ctx: CoordinationContext = {
      orgId: ORG,
      caseId: CASE_ID,
      teamId: TEAM,
      method: "gateway:razorpay",
      teamOutstanding: 3_000, // a waiver dropped it below the pinned 5,000
      remainingLiability: 0,
      postingId: POSTING,
    };
    const effects = coordinationEffects(capturedEvent, ctx);
    expect(effects[0]?.event.payload["template"]).toBe("overpaid-collection");
    // Discharge is only what was owed; the 2,000 excess rode into refund-liability.
    expect(effects[1]?.event.payload["amount"]).toBe(3_000);
  });

  it("a capture with nothing owed (fully paid already) discharges nothing", () => {
    const ctx: CoordinationContext = {
      orgId: ORG,
      caseId: CASE_ID,
      teamId: TEAM,
      method: "gateway:razorpay",
      teamOutstanding: 0,
      remainingLiability: 0,
      postingId: POSTING,
    };
    const effects = coordinationEffects(capturedEvent, ctx);
    expect(effects).toHaveLength(1); // posting only (all excess → refund-liability)
    expect(effects[0]?.event.payload["template"]).toBe("overpaid-collection");
  });

  it("PaymentRefunded → Refund posting (liability-first); reinstates only the dues part", () => {
    const refundEvent = envelope("payment", PAY, 3, "PaymentRefunded", {
      amount: 2_000,
      reason: "overpayment",
      providerEventId: "evt_2",
    });
    // Liability covers the whole refund → nothing reinstated.
    const liabilityOnly = coordinationEffects(refundEvent, {
      orgId: ORG,
      caseId: CASE_ID,
      teamId: TEAM,
      method: "gateway:razorpay",
      teamOutstanding: 0,
      remainingLiability: 2_000,
      postingId: POSTING,
    });
    expect(liabilityOnly).toHaveLength(1); // posting only, no reinstatement
    expect(liabilityOnly[0]?.event.payload["template"]).toBe("refund");

    // Refund beyond the liability reaches into dues → that part reinstates.
    const intoDues = coordinationEffects(refundEvent, {
      orgId: ORG,
      caseId: CASE_ID,
      teamId: TEAM,
      method: "gateway:razorpay",
      teamOutstanding: 0,
      remainingLiability: 500,
      postingId: POSTING,
    });
    expect(intoDues).toHaveLength(2);
    expect(intoDues[1]?.event).toMatchObject({
      type: "ObligationReinstated",
      payload: { teamId: TEAM, amount: 1_500, compensates: 3 },
    });
  });

  it("names its policies and command ids stably", () => {
    expect(COLLECTION_POLICIES).toEqual([
      "collection-posting",
      "collection-discharge",
      "refund-posting",
      "refund-reinstate",
    ]);
    expect(collectionCommandId("payment:X", 7, "refund-posting")).toBe(
      "payment:X:7:refund-posting",
    );
    expect(paymentHasEffects("PaymentCaptured")).toBe(true);
    expect(paymentHasEffects("PaymentAuthorized")).toBe(false);
  });
});

describe("Collections — wallet projections (derived, never stored)", () => {
  it("summarises outstanding / collected / refund-liability / available / waived from the fold", () => {
    // Obligation 900, collection 500, waiver 150, then an overpaid capture of 400
    // against 250 owed (150 excess → refund-liability), then a 150 refund.
    const events: SettlementEventEnvelope[] = [
      journalPosted(
        1,
        "obligation",
        [
          { account: `dues:${CASE_ID}:${TEAM}`, direction: "debit", amount: 900 },
          { account: `case:${CASE_ID}`, direction: "credit", amount: 900 },
        ],
        "01P1",
      ),
      journalPosted(
        2,
        "collection",
        [
          { account: "funds:gateway:razorpay", direction: "debit", amount: 500 },
          { account: `dues:${CASE_ID}:${TEAM}`, direction: "credit", amount: 500 },
        ],
        "01P2",
      ),
      journalPosted(
        3,
        "waiver",
        [
          { account: `waived:${CASE_ID}`, direction: "debit", amount: 150 },
          { account: `dues:${CASE_ID}:${TEAM}`, direction: "credit", amount: 150 },
        ],
        "01P3",
      ),
      journalPosted(
        4,
        "overpaid-collection",
        [
          { account: "funds:gateway:razorpay", direction: "debit", amount: 400 },
          { account: `dues:${CASE_ID}:${TEAM}`, direction: "credit", amount: 250 },
          { account: "refund-liability", direction: "credit", amount: 150 },
        ],
        "01P4",
      ),
      journalPosted(
        5,
        "refund",
        [
          { account: "refund-liability", direction: "debit", amount: 150 },
          { account: "funds:gateway:razorpay", direction: "credit", amount: 150 },
        ],
        "01P5",
      ),
    ];
    const replay = replayJournal(events);
    expect(replay.ok).toBe(true);
    if (!replay.ok) {
      return;
    }
    const summary = collectionsSummary(replay.projection);
    // dues: 900 − 500 − 150 − 250 = 0 outstanding.
    expect(summary.outstanding).toBe(0);
    // funds: 500 + 400 − 150 = 750 net cash held.
    expect(summary.collected).toBe(750);
    // refund-liability: 150 − 150 = 0 owed back.
    expect(summary.refundLiability).toBe(0);
    expect(summary.available).toBe(750);
    expect(summary.waived).toBe(150);

    // Midway (before the refund) the liability is visible and earmarked.
    const mid = replayJournal(events.slice(0, 4));
    if (mid.ok) {
      const s = collectionsSummary(mid.projection);
      expect(s.refundLiability).toBe(150);
      expect(s.collected).toBe(900);
      expect(s.available).toBe(750); // 900 held − 150 owed back
    }
  });
});

function journalPosted(
  seq: number,
  template: string,
  legs: { account: string; direction: string; amount: number }[],
  postingId: string,
): SettlementEventEnvelope {
  return envelope("journal", ORG, seq, "JournalPosted", {
    postingId,
    template,
    legs,
    source: { stream: `case:${CASE_ID}`, seq },
    memo: null,
  });
}
