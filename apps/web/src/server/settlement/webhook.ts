import type { PaymentGatewayPort, WebhookFacts } from "@desiauction/settlement";

import type { SettlementDeps } from "./deps";
import { ingestWebhookEvent, type Ack } from "./writer";

/**
 * Trusted webhook ingress (IP-5_ARCHITECTURE §21, directive §7) — the ratified
 * trusted-envelope order, and NOTHING before tenant context touches an
 * org-scoped row:
 *
 *   1. verify signature        (adapter HMAC — platform webhook secret, no DB)
 *   2. verify window           (adapter timestamp freshness, no DB)
 *   3. verify provider envelope (adapter extracts orgId + paymentId from the
 *                               order's notes — the trusted anchor, no DB)
 *   4. establish tenant context (orgId comes from the VERIFIED envelope)
 *   5. load payment            (the FIRST org-scoped read, under tenant context)
 *   6. verify envelope pin      (envelope must agree with the pinned initiation)
 *   7. process command         (decideWebhookEvent → commit, idempotent)
 *
 * A verified-HMAC envelope naming a payment it does not match fails closed and
 * is auditable as attempted forgery — envelope data SELECTS the tenant; the
 * pinned aggregate is the authority it must agree with.
 */

export type WebhookResult = { ok: true; ack: Ack } | { ok: false; status: number; reason: string };

export interface WebhookRequest {
  readonly rawBody: string;
  readonly signature: string;
  readonly receivedAtMs: number;
}

/**
 * Opens the tenant boundary the org-scoped half of this handler runs inside.
 *
 * A parameter rather than something the handler reaches for, because the ORDER
 * is the security property: the org may only come from a VERIFIED envelope, so
 * the boundary cannot be opened until step 3 has passed. Passing it in makes
 * that sequence structural — there is no tenant-scoped handle in scope before
 * the signature is checked — and lets tests supply a pass-through.
 */
export type WithSettlementTenant = <T>(
  orgId: string,
  run: (deps: SettlementDeps) => Promise<T>,
) => Promise<T>;

export async function handleRazorpayWebhook(
  deps: SettlementDeps,
  request: WebhookRequest,
  withTenant: WithSettlementTenant,
): Promise<WebhookResult> {
  const gateway: PaymentGatewayPort | null = deps.gateway("gateway:razorpay");
  if (gateway === null) {
    return { ok: false, status: 503, reason: "gateway_unconfigured" };
  }

  // 1–3 · signature, window, envelope — all in the adapter, all before any DB.
  const verification = gateway.verifyWebhook(
    request.rawBody,
    request.signature,
    request.receivedAtMs,
  );
  if (!verification.ok) {
    // A bad signature is a 401; a stale/malformed/unhandled event is a 400. Never
    // a 500 — the endpoint must not leak that it even looked the payment up
    // (it hasn't).
    const status = verification.reason === "bad_signature" ? 401 : 400;
    return { ok: false, status, reason: verification.reason };
  }
  const envelope = verification.envelope;

  /*
   * 4 · TENANT CONTEXT, AND IT USED TO BE A COMMENT INSTEAD OF A BOUNDARY.
   *
   * This block said "the point at which a withTenant boundary WOULD wrap the
   * work (§21)" and then did the org-scoped read on the raw pool. Under the
   * production recipe — `desiauction_app` is NOBYPASSRLS and `payments` carries
   * FORCE ROW LEVEL SECURITY on `app.org_id` — no GUC meant no rows, so
   * `loadPayment` returned null and every genuine capture answered 404. Razorpay
   * would retry a 404 until it gave up, while the organizer's account had been
   * credited and the platform still showed the obligation outstanding.
   *
   * Nothing local could see it: every local process connects as the OWNER, for
   * which RLS is inert (audit PA-1 §10 P0-1).
   *
   * The org comes from the VERIFIED envelope, which is the whole reason the
   * signature check is step 3 and this is step 4. Everything org-scoped now runs
   * inside the boundary — the read, the pin check, and the command.
   */
  return withTenant(envelope.orgId, async (tenantDeps) => {
    const payment = await tenantDeps.store.loadPayment(envelope.paymentId);
    if (payment === null) {
      return { ok: false, status: 404, reason: "unknown_payment" };
    }

    // 6 · pin verification — the envelope must agree with the pinned initiation.
    // The org is the load-bearing one (it selected the tenant); the rest are
    // defence in depth. Any disagreement is attempted forgery.
    if (
      payment.orgId !== envelope.orgId ||
      envelope.currency !== "INR" ||
      (envelope.kind === "captured" && envelope.amount !== payment.amount)
    ) {
      return { ok: false, status: 409, reason: "envelope_mismatch" };
    }

    // 7 · process — provider truth mapped onto the machine, idempotent by
    // providerEventId (a replayed webhook returns the original ack, appends nothing).
    const facts: WebhookFacts = {
      providerEventId: envelope.providerEventId,
      kind: envelope.kind,
      amount: envelope.amount,
      providerRef: envelope.providerRef,
      reason: `razorpay ${envelope.kind}`,
    };
    const ack = await ingestWebhookEvent(tenantDeps, envelope.orgId, envelope.paymentId, facts);
    // A rejected command (e.g. an illegal transition for this payment's state) is
    // still a 200 to the provider — we received and understood it; retrying will
    // not change the verdict. Only infrastructure faults surface as 5xx.
    return { ok: true, ack };
  });
}

/** The payment projection carries orgId only via the row; expose it for the pin
 * check without widening the writer's read surface. */
export type { WebhookFacts };
