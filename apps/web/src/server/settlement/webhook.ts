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

/**
 * `reason` is what the CALLER is told, and it is deliberately coarse: every
 * pin failure answers `envelope_mismatch`, so a forger learns nothing about
 * which check caught them. `check` is for OUR log only (the route writes it):
 * without it a genuine event refused by a rule of ours looks exactly like a
 * forgery, and nobody can tell that money is waiting on a bug.
 */
export type WebhookResult =
  | { ok: true; ack: Ack }
  | {
      ok: false;
      status: number;
      reason: string;
      check?: WebhookCheck;
      kind?: string;
      paymentId?: string;
    };

export type WebhookCheck = "org_currency_amount" | "method" | "order" | "provider_payment";

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
    //
    // EXCEPT an event we simply do not act on (`order.paid`, a settlement
    // notice, a dispute's outcome). That one is genuine — the signature and
    // the window were checked before its kind was looked at — and the honest
    // answer is "received, nothing to do": a 200. Answering 400 told the
    // provider its delivery had FAILED, and a provider that sees a day of
    // failures switches the webhook off, taking the captures with it.
    if (verification.reason === "unhandled_event") {
      return { ok: false, status: 200, reason: "unhandled_event" };
    }
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
  const mismatch = (check: WebhookCheck): WebhookResult => ({
    ok: false,
    status: 409,
    reason: "envelope_mismatch",
    check,
    kind: envelope.kind,
    paymentId: envelope.paymentId,
  });

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
      return mismatch("org_currency_amount");
    }

    /*
     * 6b · THE EVENT MUST BE ABOUT THE ORDER THIS PAYMENT OPENED (PRR 2026-09-29).
     *
     * Everything above compares what the envelope SAYS about itself — and the
     * part that names the payment (`notes.paymentId`, `notes.orgId`) is copied
     * from the order's notes, which a checkout can also set from the browser.
     * So a payer could pay their OWN order and name somebody else's payment of
     * the same amount in the notes: the signature is genuine (the provider
     * really did capture money), the amount matches, and the wrong team's dues
     * were discharged. The order reference was extracted by the adapter, stored
     * at initiation, and never compared.
     *
     * The provider's own identifiers are not the payer's to choose. WHICH one
     * an event carries depends on the entity the adapter read it from:
     *
     *   · authorized / captured / failed / DISPUTED arrive as the provider's
     *     PAYMENT entity: `orderRef` is the order it paid (must be the order
     *     pinned at initiation) and `providerRef` is the provider's payment id;
     *   · refunded arrives as the REFUND entity, which names no order:
     *     `orderRef` there is the provider payment being refunded, and must be
     *     the one recorded when this payment was captured.
     *
     * A dispute is raised against money that was captured, so it must also
     * name the provider payment we recorded. (The first version of this check
     * compared a dispute's ORDER to our provider PAYMENT id — two different
     * identifiers — and would have refused every genuine chargeback.)
     *
     * And a gateway event may only ever land on a gateway payment.
     */
    if (payment.method !== gateway.method) {
      return mismatch("method");
    }
    if (envelope.kind === "refunded") {
      if (payment.providerRef !== null && envelope.orderRef !== payment.providerRef) {
        return mismatch("provider_payment");
      }
    } else {
      const pinned = await pinnedOrderRef(tenantDeps, envelope.paymentId);
      if (pinned !== null && envelope.orderRef !== pinned) {
        return mismatch("order");
      }
      if (
        envelope.kind === "disputed" &&
        payment.providerRef !== null &&
        envelope.providerRef !== payment.providerRef
      ) {
        return mismatch("provider_payment");
      }
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

/**
 * The order this payment opened at the gateway, as recorded in its own first
 * event. Null only for a payment with no initiation event — which the product
 * cannot create for a gateway method, and which is therefore left to the
 * checks above rather than refused on a technicality.
 */
async function pinnedOrderRef(deps: SettlementDeps, paymentId: string): Promise<string | null> {
  const events = await deps.store.loadStream("payment", paymentId);
  const initiated = events.find((event) => event.type === "PaymentInitiated");
  const orderRef = initiated?.payload["orderRef"];
  return typeof orderRef === "string" && orderRef !== "" ? orderRef : null;
}

/** The payment projection carries orgId only via the row; expose it for the pin
 * check without widening the writer's read surface. */
export type { WebhookFacts };
