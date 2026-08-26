import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createManualAdapter } from "./manual";
import { createRazorpayAdapter, type HttpTransport } from "./razorpay";

const SECRET = "whsec_test_123";
const NOW = 1_700_000_000_000;
const PAYMENT = "01PAY00000000000000000000A";
const ORG = "01ORG00000000000000000000A";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

function captureBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "payment.captured",
    created_at: Math.floor(NOW / 1000),
    payload: {
      payment: {
        entity: {
          id: "pay_ABC",
          order_id: "order_XYZ",
          amount: 5_000,
          currency: "INR",
          notes: { paymentId: PAYMENT, orgId: ORG },
          ...overrides,
        },
      },
    },
  });
}

const adapter = createRazorpayAdapter({
  keyId: "rzp_test",
  keySecret: "secret",
  webhookSecret: SECRET,
});

describe("Razorpay adapter — webhook verification (the trusted-envelope core)", () => {
  it("verifies a well-signed, in-window capture and extracts the envelope", () => {
    const body = captureBody();
    const result = adapter.verifyWebhook(body, sign(body), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope).toEqual({
        providerEventId: "captured:pay_ABC",
        orderRef: "order_XYZ",
        paymentId: PAYMENT,
        orgId: ORG,
        kind: "captured",
        amount: 5_000,
        currency: "INR",
        providerRef: "pay_ABC",
      });
    }
  });

  it("REJECTS a bad signature (a forged webhook)", () => {
    const body = captureBody();
    expect(adapter.verifyWebhook(body, "deadbeef", NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    // A body tampered after signing no longer matches its signature.
    const tampered = captureBody({ amount: 9_999 });
    expect(adapter.verifyWebhook(tampered, sign(body), NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("REJECTS a stale event outside the freshness window (clock skew)", () => {
    const body = captureBody();
    const result = adapter.verifyWebhook(body, sign(body), NOW + 10 * 60 * 1000);
    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("gives a duplicate webhook the SAME providerEventId (idempotency key)", () => {
    const body = captureBody();
    const a = adapter.verifyWebhook(body, sign(body), NOW);
    const b = adapter.verifyWebhook(body, sign(body), NOW + 1_000);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.envelope.providerEventId).toBe(b.envelope.providerEventId);
    }
  });

  it("collapses refund.created and refund.processed for ONE refund to ONE key (no double refund)", () => {
    // Razorpay emits both events for a single refund entity. Keying the
    // idempotency id on the event type booked the same partial refund twice;
    // keying on the KIND makes the second event dedupe against the first.
    const refundBody = (event: string): string =>
      JSON.stringify({
        event,
        created_at: Math.floor(NOW / 1000),
        payload: {
          refund: {
            entity: {
              id: "rfnd_ABC",
              amount: 2_500,
              currency: "INR",
              notes: { paymentId: PAYMENT, orgId: ORG },
            },
          },
        },
      });
    const created = adapter.verifyWebhook(
      refundBody("refund.created"),
      sign(refundBody("refund.created")),
      NOW,
    );
    const processed = adapter.verifyWebhook(
      refundBody("refund.processed"),
      sign(refundBody("refund.processed")),
      NOW + 1_000,
    );
    expect(created.ok && processed.ok).toBe(true);
    if (created.ok && processed.ok) {
      expect(created.envelope.providerEventId).toBe("refunded:rfnd_ABC");
      // Same refund entity ⇒ same idempotency key ⇒ booked exactly once.
      expect(created.envelope.providerEventId).toBe(processed.envelope.providerEventId);
    }
    // Two DISTINCT partial refunds on one payment still stay independent.
    const second = adapter.verifyWebhook(
      refundBody("refund.processed").replace("rfnd_ABC", "rfnd_DEF"),
      sign(refundBody("refund.processed").replace("rfnd_ABC", "rfnd_DEF")),
      NOW,
    );
    expect(second.ok).toBe(true);
    if (second.ok && created.ok) {
      expect(second.envelope.providerEventId).not.toBe(created.envelope.providerEventId);
    }
  });

  it("maps each provider event kind onto the ratified envelope kind", () => {
    const cases: { event: string; kind: string; entityKey: string }[] = [
      { event: "payment.authorized", kind: "authorized", entityKey: "payment" },
      { event: "payment.failed", kind: "failed", entityKey: "payment" },
      { event: "refund.processed", kind: "refunded", entityKey: "refund" },
      { event: "payment.dispute.created", kind: "disputed", entityKey: "payment" },
    ];
    for (const c of cases) {
      const body = JSON.stringify({
        event: c.event,
        created_at: Math.floor(NOW / 1000),
        payload: {
          [c.entityKey]: {
            entity: {
              id: "ent_1",
              order_id: "order_1",
              amount: 5_000,
              currency: "INR",
              notes: { paymentId: PAYMENT, orgId: ORG },
            },
          },
        },
      });
      const result = adapter.verifyWebhook(body, sign(body), NOW);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.kind).toBe(c.kind);
      }
    }
    // An event we do not act on is acknowledged and ignored, not mis-handled.
    const order = JSON.stringify({
      event: "order.paid",
      created_at: Math.floor(NOW / 1000),
      payload: {},
    });
    expect(adapter.verifyWebhook(order, sign(order), NOW)).toEqual({
      ok: false,
      reason: "unhandled_event",
    });
  });

  it("REJECTS an envelope with no trusted anchor (missing notes)", () => {
    const body = JSON.stringify({
      event: "payment.captured",
      created_at: Math.floor(NOW / 1000),
      payload: {
        payment: { entity: { id: "pay_1", order_id: "o", amount: 5_000, currency: "INR" } },
      },
    });
    expect(adapter.verifyWebhook(body, sign(body), NOW)).toEqual({
      ok: false,
      reason: "malformed_envelope",
    });
  });
});

describe("Razorpay adapter — REST via injected transport (no SDK, no live network)", () => {
  it("creates an order carrying the trusted-envelope notes", async () => {
    let seen: { url: string; body: string } | null = null;
    const transport: HttpTransport = (url, init) => {
      seen = { url, body: init.body ?? "" };
      return Promise.resolve({ status: 200, body: JSON.stringify({ id: "order_NEW" }) });
    };
    const rzp = createRazorpayAdapter({
      keyId: "k",
      keySecret: "s",
      webhookSecret: SECRET,
      transport,
    });
    const order = await rzp.createOrder({
      paymentId: PAYMENT,
      orgId: ORG,
      amount: 5_000,
      receipt: PAYMENT,
      settlementAccountRef: "acc_ORGANIZER01",
    });
    expect(order.orderRef).toBe("order_NEW");
    expect(seen).not.toBeNull();
    const sent = JSON.parse((seen as unknown as { body: string }).body) as {
      amount: number;
      notes: { paymentId: string; orgId: string };
      transfers: { account: string; amount: number; currency: string }[];
    };
    expect(sent.amount).toBe(5_000);
    expect(sent.notes).toEqual({ paymentId: PAYMENT, orgId: ORG });
    // SPLIT SETTLEMENT: the money is routed to the ORGANIZER's account, not
    // collected into the platform's. The whole amount goes — the platform takes
    // no cut, so a shortfall here would be money quietly retained.
    expect(sent.transfers).toEqual([
      { account: "acc_ORGANIZER01", amount: 5_000, currency: "INR" },
    ]);
  });

  it("fetches a payment (the sweep's port) and initiates a refund", async () => {
    const transport: HttpTransport = (url) =>
      Promise.resolve(
        url.endsWith("/refund")
          ? { status: 200, body: JSON.stringify({ id: "rfnd_1", amount: 2_000 }) }
          : {
              status: 200,
              body: JSON.stringify({ id: "pay_1", status: "captured", amount: 5_000 }),
            },
      );
    const rzp = createRazorpayAdapter({
      keyId: "k",
      keySecret: "s",
      webhookSecret: SECRET,
      transport,
    });
    expect(await rzp.fetchPayment("pay_1")).toEqual({
      providerRef: "pay_1",
      status: "captured",
      amount: 5_000,
    });
    expect(await rzp.initiateRefund("pay_1", 2_000)).toEqual({
      providerRef: "rfnd_1",
      amount: 2_000,
    });
  });
});

describe("Manual adapter — a first-class channel with no gateway operations", () => {
  it("has no order, no webhook, no remote record — structurally", () => {
    const manual = createManualAdapter("manual:cash");
    expect(manual.method).toBe("manual:cash");
    expect(manual.verifyWebhook("{}", "sig", NOW)).toEqual({
      ok: false,
      reason: "manual method has no webhook",
    });
    expect(() =>
      manual.createOrder({
        paymentId: PAYMENT,
        orgId: ORG,
        amount: 1,
        receipt: "r",
        settlementAccountRef: "acc_UNUSED",
      }),
    ).toThrow(/no gateway operation/);
  });
});
