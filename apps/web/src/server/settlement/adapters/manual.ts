import type { PaymentGatewayPort } from "@desiauction/settlement";

/**
 * The Manual attestation adapter (IP-5_ARCHITECTURE §10, M-IP5-2) — a
 * first-class collection channel for the desi market's cash / direct-UPI
 * majority, NOT a bypass. It implements the same `PaymentGatewayPort` shape, so
 * the writer treats it identically to a gateway; the difference is that its
 * captures are human attestations recorded as such, never provider truth.
 *
 * A manual method has no external gateway: it creates no order, verifies no
 * webhook, fetches no remote record, and initiates no provider refund. Those
 * operations are structurally unavailable — calling them is a programming error,
 * not a runtime path — which is exactly what keeps manual captures on the
 * attestation path and gateway captures on the provider-truth path.
 */
export function createManualAdapter(method: string): PaymentGatewayPort {
  const unavailable = (op: string): never => {
    throw new Error(`manual method ${method} has no gateway operation: ${op}`);
  };
  return {
    method,
    createOrder: () => unavailable("createOrder"),
    verifyWebhook: () => ({ ok: false, reason: "manual method has no webhook" }),
    fetchPayment: () => unavailable("fetchPayment"),
    initiateRefund: () => unavailable("initiateRefund"),
  };
}

export const MANUAL_METHODS = ["manual:cash", "manual:upi-direct", "manual:bank"] as const;
