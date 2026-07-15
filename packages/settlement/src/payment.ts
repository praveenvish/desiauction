/**
 * The Payment aggregate (IP-5_ARCHITECTURE §10) — the state machine and its
 * reducer, provider-independent. No gateway lives here and none may: the port
 * (ports.ts) is the only shape a provider is ever allowed to take, and the
 * adapters that implement it arrive with Collections (M-IP5-2).
 *
 * Two transition authorities share one machine:
 *   • gateway methods transition on PROVIDER TRUTH only (webhook / sweep);
 *   • manual methods transition on a capability-gated human ATTESTATION, which
 *     is recorded as such and never masquerades as provider truth.
 *
 * Partial refunds are first-class: `PaymentRefunded` events accumulate against
 * the capture, and the payment reaches the terminal `refunded` state only when
 * the cumulative refund equals what was captured. That is what lets an
 * overpayment be returned without unwinding a legitimate collection.
 */

import { addPaise, deductPaise, paise, type Paise } from "@desiauction/core";

import { money, str, type ReplayFailure, type SettlementEventEnvelope } from "./events";

export type PaymentStatus =
  "created" | "authorized" | "captured" | "refunded" | "failed" | "disputed";

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "created",
  "authorized",
  "captured",
  "refunded",
  "failed",
  "disputed",
];

/** Gateway methods carry provider truth; manual methods carry human attestation. */
export type PaymentMethod =
  "gateway:razorpay" | "manual:cash" | "manual:upi-direct" | "manual:bank";

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "gateway:razorpay",
  "manual:cash",
  "manual:upi-direct",
  "manual:bank",
];

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function isManualMethod(method: PaymentMethod): boolean {
  return method.startsWith("manual:");
}

export type PaymentCommand = "authorize" | "capture" | "attest" | "fail" | "refund" | "dispute";

/**
 * Command legality. `capture` is legal straight from `created` because provider
 * truth arrives out of order (an authorize webhook may never be seen); `attest`
 * is the manual twin of capture. `failed` is terminal — a retry is a NEW payment,
 * never a resurrected one.
 */
const PAYMENT_EDGES: Record<PaymentStatus, ReadonlySet<PaymentCommand>> = {
  created: new Set(["authorize", "capture", "attest", "fail"]),
  authorized: new Set(["capture", "fail"]),
  captured: new Set(["refund", "dispute"]),
  refunded: new Set([]),
  failed: new Set([]),
  disputed: new Set([]),
};

export function paymentCommandAllowed(status: PaymentStatus, command: PaymentCommand): boolean {
  return PAYMENT_EDGES[status].has(command);
}

export interface PaymentMachineEdge {
  readonly from: PaymentStatus;
  readonly command: PaymentCommand;
  readonly to: readonly PaymentStatus[];
}

export const PAYMENT_MACHINE: readonly PaymentMachineEdge[] = [
  { from: "created", command: "authorize", to: ["authorized"] },
  { from: "created", command: "capture", to: ["captured"] },
  { from: "created", command: "attest", to: ["captured"] },
  { from: "created", command: "fail", to: ["failed"] },
  { from: "authorized", command: "capture", to: ["captured"] },
  { from: "authorized", command: "fail", to: ["failed"] },
  // A partial refund keeps the payment `captured`; only a full one is terminal.
  { from: "captured", command: "refund", to: ["captured", "refunded"] },
  { from: "captured", command: "dispute", to: ["disputed"] },
];

export interface PaymentProjection {
  status: PaymentStatus;
  paymentId: string;
  caseId: string;
  teamId: string;
  method: PaymentMethod;
  /** Pinned at initiation — the amount every later claim is checked against. */
  amount: number;
  captured: number;
  refundedTotal: number;
  attested: boolean;
  attestedBy: string | null;
  providerRef: string | null;
  /** Every provider event id this payment has already absorbed (idempotency evidence). */
  providerEventIds: string[];
  lastSeq: number;
  eventCount: number;
}

export type PaymentReplayResult = { ok: true; projection: PaymentProjection } | ReplayFailure;

/** Upholds: what a payment still owes back can never exceed what it took in. */
export function refundableOf(projection: PaymentProjection): Paise {
  const remaining = deductPaise(paise(projection.captured), paise(projection.refundedTotal));
  return remaining.ok ? remaining.value : paise(0);
}

export function replayPayment(events: readonly SettlementEventEnvelope[]): PaymentReplayResult {
  let projection: PaymentProjection | null = null;

  for (const event of events) {
    const fail = (reason: ReplayFailure["reason"]): PaymentReplayResult => ({
      ok: false,
      atSeq: event.seq,
      reason,
    });

    if (projection === null) {
      if (event.seq !== 1) {
        return fail("sequence_gap");
      }
      if (event.type !== "PaymentInitiated") {
        return fail("unknown_payment");
      }
      const paymentId = str(event.payload, "paymentId");
      const caseId = str(event.payload, "caseId");
      const teamId = str(event.payload, "teamId");
      const method = str(event.payload, "method");
      const amount = money(event.payload, "amount");
      if (
        paymentId === null ||
        caseId === null ||
        teamId === null ||
        method === null ||
        !isPaymentMethod(method) ||
        amount === null ||
        amount === 0
      ) {
        return fail("malformed_payment");
      }
      projection = {
        status: "created",
        paymentId,
        caseId,
        teamId,
        method,
        amount,
        captured: 0,
        refundedTotal: 0,
        attested: false,
        attestedBy: null,
        providerRef: null,
        providerEventIds: [],
        lastSeq: 1,
        eventCount: 1,
      };
      continue;
    }

    if (event.seq !== projection.lastSeq + 1) {
      return fail("sequence_gap");
    }
    const state = projection;
    const providerEventId = str(event.payload, "providerEventId");
    if (providerEventId !== null) {
      state.providerEventIds.push(providerEventId);
    }

    switch (event.type) {
      case "PaymentInitiated":
        return fail("illegal_replayed_transition");

      case "PaymentAuthorized": {
        if (!paymentCommandAllowed(state.status, "authorize")) {
          return fail("illegal_replayed_transition");
        }
        const providerRef = str(event.payload, "providerRef");
        if (providerRef === null || isManualMethod(state.method)) {
          return fail("malformed_payment");
        }
        state.providerRef = providerRef;
        state.status = "authorized";
        break;
      }

      case "PaymentCaptured": {
        const manual = isManualMethod(state.method);
        const command: PaymentCommand = manual ? "attest" : "capture";
        if (!paymentCommandAllowed(state.status, command)) {
          return fail("illegal_replayed_transition");
        }
        const amount = money(event.payload, "amount");
        const attestedBy = str(event.payload, "attestedBy");
        if (amount === null || amount !== state.amount) {
          // The capture is pinned at initiation (§10) — a capture for any other
          // amount is not this payment's truth.
          return fail("malformed_payment");
        }
        if (manual) {
          if (attestedBy === null) {
            return fail("malformed_payment");
          }
          state.attested = true;
          state.attestedBy = attestedBy;
        } else {
          const providerRef = str(event.payload, "providerRef");
          if (providerRef === null) {
            return fail("malformed_payment");
          }
          state.providerRef = providerRef;
        }
        state.captured = amount;
        state.status = "captured";
        break;
      }

      case "PaymentFailed": {
        if (!paymentCommandAllowed(state.status, "fail")) {
          return fail("illegal_replayed_transition");
        }
        if (str(event.payload, "code") === null) {
          return fail("malformed_payment");
        }
        state.status = "failed";
        break;
      }

      case "PaymentRefunded": {
        if (!paymentCommandAllowed(state.status, "refund")) {
          return fail("illegal_replayed_transition");
        }
        const amount = money(event.payload, "amount");
        const reason = str(event.payload, "reason");
        if (amount === null || amount === 0 || reason === null) {
          return fail("malformed_payment");
        }
        // Cumulative bound: refunds may never exceed the capture.
        if (!deductPaise(refundableOf(state), paise(amount)).ok) {
          return fail("refund_exceeds_captured");
        }
        state.refundedTotal = addPaise(paise(state.refundedTotal), paise(amount));
        // Partial refunds leave the payment captured; only full repayment is terminal.
        if (refundableOf(state) === 0) {
          state.status = "refunded";
        }
        break;
      }

      case "PaymentDisputed": {
        if (!paymentCommandAllowed(state.status, "dispute")) {
          return fail("illegal_replayed_transition");
        }
        if (str(event.payload, "reason") === null) {
          return fail("malformed_payment");
        }
        state.status = "disputed";
        break;
      }

      case "PaymentRecovered":
        break;

      default:
        return fail("unknown_event_type");
    }

    state.lastSeq = event.seq;
    state.eventCount += 1;
  }

  if (projection === null) {
    return { ok: false, atSeq: 0, reason: "unknown_payment" };
  }
  return { ok: true, projection };
}
