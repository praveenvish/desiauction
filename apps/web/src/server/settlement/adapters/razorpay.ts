import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  GatewayOrder,
  GatewayOrderInput,
  PaymentGatewayPort,
  ProviderPaymentRecord,
  ProviderRefundRecord,
  WebhookEnvelope,
  WebhookVerification,
} from "@desiauction/settlement";

/**
 * The Razorpay adapter (IP-5_ARCHITECTURE §10, M-IP5-2). It implements the
 * settlement domain's `PaymentGatewayPort` with NO SDK: webhook authenticity is
 * HMAC-SHA256 over the raw body (Razorpay's documented scheme), and the REST
 * calls go through an INJECTED transport so the adapter is complete and testable
 * without live credentials or network. No provider type crosses into
 * `packages/settlement`; a second gateway is another adapter, never a rewrite.
 *
 * The trusted-envelope anchor is carried in the order's `notes`
 * (`{ paymentId, orgId }`), set at `createOrder`. The webhook ingress reads
 * org identity from the VERIFIED envelope before any org-scoped database read
 * (§21), then cross-checks the rest against the pinned initiation.
 */

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

export type HttpTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export interface RazorpayConfig {
  readonly keyId: string;
  readonly keySecret: string;
  readonly webhookSecret: string;
  readonly apiBase?: string;
  /** Timestamp window for webhook freshness (default 5 minutes). */
  readonly windowMs?: number;
  readonly transport?: HttpTransport;
  readonly now?: () => number;
}

const DEFAULT_API_BASE = "https://api.razorpay.com/v1";
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

export function createRazorpayAdapter(config: RazorpayConfig): PaymentGatewayPort {
  const apiBase = config.apiBase ?? DEFAULT_API_BASE;
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  const transport = config.transport ?? defaultTransport;
  const now = config.now ?? (() => Date.now());
  const authHeader = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;

  return {
    method: "gateway:razorpay",

    async createOrder(input: GatewayOrderInput): Promise<GatewayOrder> {
      const response = await transport(`${apiBase}/orders`, {
        method: "POST",
        headers: { authorization: authHeader, "content-type": "application/json" },
        body: JSON.stringify({
          amount: input.amount,
          currency: "INR",
          receipt: input.receipt,
          // THE trusted-envelope anchor: it rides every payment/refund webhook.
          notes: { paymentId: input.paymentId, orgId: input.orgId },
        }),
      });
      const order = parseJson(response.body);
      const orderRef = order === null ? null : str(order, "id");
      if (response.status >= 300 || orderRef === null) {
        throw new Error(`razorpay createOrder failed (status ${String(response.status)})`);
      }
      return { orderRef };
    },

    /**
     * The security core. Order matters and is fail-closed at every step
     * (§7 trusted-envelope): signature → window → envelope extraction. No
     * database is touched here — the caller establishes tenant context from the
     * returned envelope's org before any org-scoped read.
     */
    verifyWebhook(rawBody: string, signature: string, receivedAtMs: number): WebhookVerification {
      const expected = createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");
      if (!timingSafeEqualHex(expected, signature)) {
        return { ok: false, reason: "bad_signature" };
      }
      const payload = parseJson(rawBody);
      if (payload === null) {
        return { ok: false, reason: "malformed_body" };
      }
      const createdAt = num(payload, "created_at");
      if (createdAt === null) {
        return { ok: false, reason: "no_timestamp" };
      }
      if (Math.abs(receivedAtMs - createdAt * 1000) > windowMs) {
        return { ok: false, reason: "stale" };
      }
      const eventType = str(payload, "event");
      if (eventType === null) {
        return { ok: false, reason: "no_event" };
      }
      const kind = KIND_OF[eventType];
      if (kind === undefined) {
        // An event we do not act on (e.g. order.paid) — acknowledged, ignored.
        return { ok: false, reason: "unhandled_event" };
      }
      const entity = entityFor(payload, kind);
      if (entity === null) {
        return { ok: false, reason: "no_entity" };
      }
      const notes = obj(entity["notes"]);
      const paymentId = notes === null ? null : str(notes, "paymentId");
      const orgId = notes === null ? null : str(notes, "orgId");
      const providerRef = str(entity, "id");
      const amount = num(entity, "amount");
      const currency = str(entity, "currency") ?? "INR";
      const orderRef = str(entity, "order_id") ?? str(entity, "payment_id") ?? "";
      if (paymentId === null || orgId === null || providerRef === null || amount === null) {
        return { ok: false, reason: "malformed_envelope" };
      }
      const envelope: WebhookEnvelope = {
        // Deterministic idempotency key: same provider event ⇒ same key, so a
        // replayed webhook returns the original ack and appends nothing.
        providerEventId: `${eventType}:${providerRef}`,
        orderRef,
        paymentId,
        orgId,
        kind,
        amount,
        currency,
        providerRef,
      };
      return { ok: true, envelope };
    },

    async fetchPayment(providerRef: string): Promise<ProviderPaymentRecord> {
      const response = await transport(`${apiBase}/payments/${providerRef}`, {
        method: "GET",
        headers: { authorization: authHeader },
      });
      const record = parseJson(response.body);
      const id = record === null ? null : str(record, "id");
      const status = record === null ? null : str(record, "status");
      const amount = record === null ? null : num(record, "amount");
      if (response.status >= 300 || id === null || status === null || amount === null) {
        throw new Error(`razorpay fetchPayment failed (status ${String(response.status)})`);
      }
      return { providerRef: id, status, amount };
    },

    async initiateRefund(providerRef: string, amount: number): Promise<ProviderRefundRecord> {
      const response = await transport(`${apiBase}/payments/${providerRef}/refund`, {
        method: "POST",
        headers: { authorization: authHeader, "content-type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const record = parseJson(response.body);
      const id = record === null ? null : str(record, "id");
      const refundAmount = record === null ? null : num(record, "amount");
      if (response.status >= 300 || id === null || refundAmount === null) {
        throw new Error(`razorpay initiateRefund failed (status ${String(response.status)})`);
      }
      return { providerRef: id, amount: refundAmount };
    },
  };
  void now;
}

const KIND_OF: Record<string, WebhookEnvelope["kind"]> = {
  "payment.authorized": "authorized",
  "payment.captured": "captured",
  "payment.failed": "failed",
  "refund.processed": "refunded",
  "refund.created": "refunded",
  "payment.dispute.created": "disputed",
};

/** Razorpay nests the entity under `payload.<entity>.entity`. */
function entityFor(
  payload: Readonly<Record<string, unknown>>,
  kind: WebhookEnvelope["kind"],
): Readonly<Record<string, unknown>> | null {
  const container = obj(payload["payload"]);
  if (container === null) {
    return null;
  }
  const key = kind === "refunded" ? "refund" : "payment";
  const wrapper = obj(container[key]);
  return wrapper === null ? null : obj(wrapper["entity"]);
}

async function defaultTransport(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<HttpResponse> {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.text() };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

function parseJson(body: string): Readonly<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return obj(parsed);
  } catch {
    return null;
  }
}

function obj(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function str(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function num(payload: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
