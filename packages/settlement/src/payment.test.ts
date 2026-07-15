import { describe, expect, it } from "vitest";

import type { SettlementEventEnvelope } from "./events";
import {
  PAYMENT_MACHINE,
  isManualMethod,
  paymentCommandAllowed,
  refundableOf,
  replayPayment,
  type PaymentProjection,
} from "./payment";
import { envelope } from "./testing";

const PAY = "01PAY00000000000000000000A";
const CASE_ID = "01CASE00000000000000000000";
const TEAM = "01TEAMA000000000000000000A";

function initiated(method: string, amount: number): SettlementEventEnvelope {
  return envelope("payment", PAY, 1, "PaymentInitiated", {
    paymentId: PAY,
    caseId: CASE_ID,
    teamId: TEAM,
    method,
    amount,
    orderRef: method.startsWith("gateway") ? "order_abc" : null,
  });
}

function fold(events: readonly SettlementEventEnvelope[]): PaymentProjection {
  const replay = replayPayment(events);
  if (!replay.ok) {
    throw new Error(`${replay.reason} @${String(replay.atSeq)}`);
  }
  return replay.projection;
}

describe("Payment — the machine (provider-independent)", () => {
  it("declares the ratified edges; failure is terminal and retry is a NEW payment", () => {
    expect(PAYMENT_MACHINE.map((edge) => `${edge.from}-${edge.command}`)).toEqual([
      "created-authorize",
      "created-capture",
      "created-attest",
      "created-fail",
      "authorized-capture",
      "authorized-fail",
      "captured-refund",
      "captured-dispute",
    ]);
    expect(paymentCommandAllowed("failed", "capture")).toBe(false);
    expect(paymentCommandAllowed("refunded", "refund")).toBe(false);
    expect(paymentCommandAllowed("disputed", "refund")).toBe(false);
    expect(isManualMethod("manual:cash")).toBe(true);
    expect(isManualMethod("gateway:razorpay")).toBe(false);
  });

  it("takes provider truth out of order: capture without a seen authorize", () => {
    const projection = fold([
      initiated("gateway:razorpay", 5_000),
      envelope("payment", PAY, 2, "PaymentCaptured", {
        amount: 5_000,
        providerRef: "pay_x1",
        providerEventId: "evt_1",
      }),
    ]);
    expect(projection.status).toBe("captured");
    expect(projection.captured).toBe(5_000);
    expect(projection.providerRef).toBe("pay_x1");
    expect(projection.attested).toBe(false);
    expect(projection.providerEventIds).toEqual(["evt_1"]);
  });

  it("records a manual attestation as an attestation — never as provider truth", () => {
    const projection = fold([
      initiated("manual:cash", 5_000),
      envelope("payment", PAY, 2, "PaymentCaptured", {
        amount: 5_000,
        attestedBy: "01OFFICER00000000000000AA",
        evidenceRef: "photo-123",
      }),
    ]);
    expect(projection.status).toBe("captured");
    expect(projection.attested).toBe(true);
    expect(projection.attestedBy).toBe("01OFFICER00000000000000AA");
    expect(projection.providerRef).toBeNull();
  });

  it("refuses a manual capture with no attester, and a gateway capture with no provider ref", () => {
    expect(
      replayPayment([
        initiated("manual:cash", 5_000),
        envelope("payment", PAY, 2, "PaymentCaptured", { amount: 5_000 }),
      ]),
    ).toEqual({ ok: false, atSeq: 2, reason: "malformed_payment" });

    expect(
      replayPayment([
        initiated("gateway:razorpay", 5_000),
        envelope("payment", PAY, 2, "PaymentCaptured", { amount: 5_000, providerEventId: "e" }),
      ]),
    ).toEqual({ ok: false, atSeq: 2, reason: "malformed_payment" });
  });

  it("pins the amount at initiation — a capture for any other amount is not this payment", () => {
    expect(
      replayPayment([
        initiated("gateway:razorpay", 5_000),
        envelope("payment", PAY, 2, "PaymentCaptured", {
          amount: 9_000,
          providerRef: "pay_x1",
          providerEventId: "evt_1",
        }),
      ]),
    ).toEqual({ ok: false, atSeq: 2, reason: "malformed_payment" });
  });
});

describe("Payment — partial refunds are first-class", () => {
  const captured = [
    initiated("gateway:razorpay", 1_000),
    envelope("payment", PAY, 2, "PaymentCaptured", {
      amount: 1_000,
      providerRef: "pay_x1",
      providerEventId: "evt_1",
    }),
  ];

  it("accumulates refunds and stays captured until the capture is fully returned", () => {
    const partial = fold([
      ...captured,
      envelope("payment", PAY, 3, "PaymentRefunded", {
        amount: 400,
        reason: "overpayment",
        providerEventId: "evt_2",
      }),
    ]);
    expect(partial.status).toBe("captured");
    expect(partial.refundedTotal).toBe(400);
    expect(refundableOf(partial)).toBe(600);

    const full = fold([
      ...captured,
      envelope("payment", PAY, 3, "PaymentRefunded", {
        amount: 400,
        reason: "overpayment",
        providerEventId: "evt_2",
      }),
      envelope("payment", PAY, 4, "PaymentRefunded", {
        amount: 600,
        reason: "cancelled",
        providerEventId: "evt_3",
      }),
    ]);
    expect(full.status).toBe("refunded");
    expect(refundableOf(full)).toBe(0);
  });

  it("halts when cumulative refunds exceed the capture", () => {
    expect(
      replayPayment([
        ...captured,
        envelope("payment", PAY, 3, "PaymentRefunded", {
          amount: 600,
          reason: "a",
          providerEventId: "evt_2",
        }),
        envelope("payment", PAY, 4, "PaymentRefunded", {
          amount: 401,
          reason: "b",
          providerEventId: "evt_3",
        }),
      ]),
    ).toEqual({ ok: false, atSeq: 4, reason: "refund_exceeds_captured" });
  });

  it("never refunds a payment that was never captured", () => {
    expect(
      replayPayment([
        initiated("gateway:razorpay", 1_000),
        envelope("payment", PAY, 2, "PaymentRefunded", {
          amount: 100,
          reason: "x",
          providerEventId: "evt_2",
        }),
      ]),
    ).toEqual({ ok: false, atSeq: 2, reason: "illegal_replayed_transition" });
  });
});

describe("Payment — replay is fail-closed", () => {
  it("refuses a stream that does not begin with PaymentInitiated", () => {
    expect(replayPayment([envelope("payment", PAY, 1, "PaymentCaptured", { amount: 1 })])).toEqual({
      ok: false,
      atSeq: 1,
      reason: "unknown_payment",
    });
    expect(replayPayment([])).toEqual({ ok: false, atSeq: 0, reason: "unknown_payment" });
  });

  it("refuses an unknown method, a zero amount, and an unknown type", () => {
    expect(replayPayment([initiated("gateway:stripe", 100)])).toEqual({
      ok: false,
      atSeq: 1,
      reason: "malformed_payment",
    });
    expect(replayPayment([initiated("manual:cash", 0)])).toEqual({
      ok: false,
      atSeq: 1,
      reason: "malformed_payment",
    });
    expect(
      replayPayment([
        initiated("manual:cash", 100),
        envelope("payment", PAY, 2, "PaymentSettledSomehow", {}),
      ]),
    ).toEqual({ ok: false, atSeq: 2, reason: "unknown_event_type" });
  });

  it("folds twice to the identical projection", () => {
    const events = [
      initiated("gateway:razorpay", 1_000),
      envelope("payment", PAY, 2, "PaymentAuthorized", {
        providerRef: "pay_x1",
        providerEventId: "evt_1",
      }),
      envelope("payment", PAY, 3, "PaymentCaptured", {
        amount: 1_000,
        providerRef: "pay_x1",
        providerEventId: "evt_2",
      }),
    ];
    expect(replayPayment(events)).toEqual(replayPayment(events));
  });
});
