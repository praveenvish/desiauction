/**
 * Collections (IP-5_ARCHITECTURE §8.3/§9/§10, M-IP5-2) — the pure decisions and
 * the deterministic coordination that turn money-in into balanced postings and
 * discharged obligations.
 *
 * Everything here is a pure function of folds and inputs. The Payment command
 * deciders return EVENTS on the payment stream; the coordinator turns a
 * committed payment event into its ratified downstream effects — the journal
 * posting and the case discharge/reinstatement — each keyed by a DERIVED command
 * id so re-running after a crash is idempotent by construction.
 *
 * No new event types are introduced: the directive's command vocabulary
 * (CreatePayment, ManualPaymentReceived, GatewayPaymentInitiated,
 * WebhookReceived, PaymentCaptured, PaymentRejected, PaymentExpired,
 * PaymentRefunded) maps onto the CLOSED catalog's seven payment events.
 */

import { addPaise, deductPaise, paise, type Paise } from "@desiauction/core";

import type { Decision, NewEvent, SettlementEventEnvelope } from "./events";
import {
  buildCollectionPosting,
  buildRefundPosting,
  refundReinstatement,
  type JournalProjection,
} from "./journal";
import {
  isManualMethod,
  isPaymentMethod,
  paymentCommandAllowed,
  refundableOf,
  type PaymentMethod,
  type PaymentProjection,
} from "./payment";

/** The closed set of payment/collection command rejections. Deterministic. */
export type CollectionRejection =
  | "case_not_collecting"
  | "invalid_amount"
  | "amount_exceeds_outstanding"
  | "invalid_method"
  | "wrong_method_channel"
  | "illegal_transition"
  | "amount_mismatch"
  | "refund_exceeds_captured"
  | "envelope_mismatch";

function reject(reason: CollectionRejection): Decision {
  return { ok: false, reason };
}

function paymentEvent(paymentId: string, type: string, payload: Record<string, unknown>): NewEvent {
  return { streamType: "payment", streamId: paymentId, type, payload };
}

// --- Payment command deciders --------------------------------------------------------

export interface InitiatePaymentInput {
  readonly paymentId: string;
  readonly caseId: string;
  readonly teamId: string;
  readonly method: string;
  readonly amount: number;
  /** Gateway orders carry paymentId + org in provider metadata — the webhook's
   * trusted envelope (§21). Absent for manual methods. */
  readonly orderRef?: string;
  /** The case's status — collections happen only while a case is `settling`. */
  readonly caseStatus: string;
  /** The team's outstanding at initiation — the initiation bound (§10). */
  readonly teamOutstanding: number;
}

/**
 * CreatePayment / ManualPaymentReceived / GatewayPaymentInitiated all begin here:
 * one `PaymentInitiated`, the method distinguishing the channel. The amount is
 * pinned now and is ≤ the team's outstanding at initiation; overpayment can only
 * emerge later, when a waiver races the capture (§9.3).
 */
export function decideInitiatePayment(input: InitiatePaymentInput): Decision {
  if (input.caseStatus !== "settling") {
    return reject("case_not_collecting");
  }
  if (!isPaymentMethod(input.method)) {
    return reject("invalid_method");
  }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    return reject("invalid_amount");
  }
  if (!deductPaise(paise(input.teamOutstanding), paise(input.amount)).ok) {
    return reject("amount_exceeds_outstanding");
  }
  const gateway = !isManualMethod(input.method);
  return {
    ok: true,
    events: [
      paymentEvent(input.paymentId, "PaymentInitiated", {
        paymentId: input.paymentId,
        caseId: input.caseId,
        teamId: input.teamId,
        method: input.method,
        amount: input.amount,
        // The gateway order's ref is the webhook's trusted envelope anchor.
        ...(gateway && input.orderRef !== undefined ? { orderRef: input.orderRef } : {}),
      }),
    ],
  };
}

export interface AttestCaptureInput {
  readonly attestedBy: string;
  readonly evidenceRef?: string;
}

/**
 * ManualPaymentReceived → capture: a capability-gated human attestation, recorded
 * AS an attestation (never provider truth). The captured amount is the pinned
 * initiation amount — a manual capture cannot invent a different figure.
 */
export function decideAttestCapture(
  projection: PaymentProjection,
  input: AttestCaptureInput,
): Decision {
  if (!isManualMethod(projection.method)) {
    return reject("wrong_method_channel");
  }
  if (!paymentCommandAllowed(projection.status, "attest")) {
    return reject("illegal_transition");
  }
  if (input.attestedBy === "") {
    return reject("invalid_amount");
  }
  return {
    ok: true,
    events: [
      paymentEvent(projection.paymentId, "PaymentCaptured", {
        amount: projection.amount,
        attestedBy: input.attestedBy,
        ...(input.evidenceRef !== undefined ? { evidenceRef: input.evidenceRef } : {}),
      }),
    ],
  };
}

export interface ManualRefundInput {
  readonly amount: number;
  readonly reason: string;
}

/**
 * A manual payment reversal (override-gated at the writer). Provider refunds
 * arrive via the webhook path instead. Partial refunds accumulate (§10); the
 * cumulative bound is re-checked here and, independently, on replay.
 */
export function decideManualRefund(
  projection: PaymentProjection,
  input: ManualRefundInput,
): Decision {
  if (!isManualMethod(projection.method)) {
    return reject("wrong_method_channel");
  }
  if (!paymentCommandAllowed(projection.status, "refund")) {
    return reject("illegal_transition");
  }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.reason === "") {
    return reject("invalid_amount");
  }
  if (!deductPaise(refundableOf(projection), paise(input.amount)).ok) {
    return reject("refund_exceeds_captured");
  }
  return {
    ok: true,
    events: [
      paymentEvent(projection.paymentId, "PaymentRefunded", {
        amount: input.amount,
        reason: input.reason,
      }),
    ],
  };
}

/**
 * PaymentExpired → the closed catalog has no "expired" type; an expiry is a
 * `PaymentFailed` with an `expired` code, emitted by the sweep (§8.3). Legal
 * only while the payment is still open (created/authorized).
 */
export function decideExpirePayment(projection: PaymentProjection): Decision {
  if (!paymentCommandAllowed(projection.status, "fail")) {
    return reject("illegal_transition");
  }
  return {
    ok: true,
    events: [
      paymentEvent(projection.paymentId, "PaymentFailed", {
        code: "expired",
        detail: "payment window elapsed without capture",
      }),
    ],
  };
}

// --- Webhook → event (gateway; provider truth) ---------------------------------------

export interface WebhookFacts {
  readonly providerEventId: string;
  readonly kind: "authorized" | "captured" | "failed" | "refunded" | "disputed";
  readonly amount: number;
  readonly providerRef: string;
  readonly reason?: string;
}

/**
 * WebhookReceived → a payment event, chosen by provider truth. The envelope is
 * already signature/window/pin-verified by the ingress (§21) before this pure
 * decision runs; here we enforce MACHINE legality and the pinned amount for a
 * capture. Provider truth may arrive out of order — a capture is legal straight
 * from `created` (an authorize webhook may never be seen).
 */
export function decideWebhookEvent(projection: PaymentProjection, facts: WebhookFacts): Decision {
  if (isManualMethod(projection.method)) {
    // A manual payment never has a gateway; a webhook naming it is a mismatch.
    return reject("wrong_method_channel");
  }
  switch (facts.kind) {
    case "authorized": {
      if (!paymentCommandAllowed(projection.status, "authorize")) {
        return reject("illegal_transition");
      }
      return {
        ok: true,
        events: [
          paymentEvent(projection.paymentId, "PaymentAuthorized", {
            providerRef: facts.providerRef,
            providerEventId: facts.providerEventId,
          }),
        ],
      };
    }
    case "captured": {
      if (!paymentCommandAllowed(projection.status, "capture")) {
        return reject("illegal_transition");
      }
      // A capture for any amount other than the pinned one is not this payment.
      if (facts.amount !== projection.amount) {
        return reject("amount_mismatch");
      }
      return {
        ok: true,
        events: [
          paymentEvent(projection.paymentId, "PaymentCaptured", {
            amount: facts.amount,
            providerRef: facts.providerRef,
            providerEventId: facts.providerEventId,
          }),
        ],
      };
    }
    case "failed": {
      if (!paymentCommandAllowed(projection.status, "fail")) {
        return reject("illegal_transition");
      }
      return {
        ok: true,
        events: [
          paymentEvent(projection.paymentId, "PaymentFailed", {
            code: "provider_failed",
            detail: facts.reason ?? "provider reported failure",
            providerEventId: facts.providerEventId,
          }),
        ],
      };
    }
    case "refunded": {
      if (!paymentCommandAllowed(projection.status, "refund")) {
        return reject("illegal_transition");
      }
      if (!Number.isSafeInteger(facts.amount) || facts.amount <= 0) {
        return reject("invalid_amount");
      }
      if (!deductPaise(refundableOf(projection), paise(facts.amount)).ok) {
        return reject("refund_exceeds_captured");
      }
      return {
        ok: true,
        events: [
          paymentEvent(projection.paymentId, "PaymentRefunded", {
            amount: facts.amount,
            reason: facts.reason ?? "provider refund",
            providerEventId: facts.providerEventId,
          }),
        ],
      };
    }
    case "disputed": {
      if (!paymentCommandAllowed(projection.status, "dispute")) {
        return reject("illegal_transition");
      }
      return {
        ok: true,
        events: [
          paymentEvent(projection.paymentId, "PaymentDisputed", {
            providerRef: facts.providerRef,
            reason: facts.reason ?? "provider dispute",
            providerEventId: facts.providerEventId,
          }),
        ],
      };
    }
  }
}

// --- The Collections Coordinator (deterministic, source-keyed) -----------------------

export type CollectionPolicy =
  "collection-posting" | "collection-discharge" | "refund-posting" | "refund-reinstate";

export const COLLECTION_POLICIES: readonly CollectionPolicy[] = [
  "collection-posting",
  "collection-discharge",
  "refund-posting",
  "refund-reinstate",
];

/** Which payment events have downstream effects. */
export function paymentHasEffects(eventType: string): boolean {
  return eventType === "PaymentCaptured" || eventType === "PaymentRefunded";
}

export function collectionCommandId(
  sourceStream: string,
  sourceSeq: number,
  policy: CollectionPolicy,
): string {
  return `${sourceStream}:${String(sourceSeq)}:${policy}`;
}

export interface CoordinationContext {
  readonly orgId: string;
  readonly caseId: string;
  readonly teamId: string;
  readonly method: PaymentMethod;
  /** The team's outstanding, read from the case fold at coordination time. */
  readonly teamOutstanding: number;
  /** The org's refund-liability balance, read from the journal fold. */
  readonly remainingLiability: number;
  /** Minted by the writer at the edge; referenced by the discharge/reinstate. */
  readonly postingId: string;
}

export interface CoordinationEffect {
  readonly commandId: string;
  readonly event: NewEvent;
}

/**
 * The ratified downstream effects of a committed payment event (§8.3):
 *
 *   PaymentCaptured → JournalPosted(Collection | Overpaid) → ObligationDischarged
 *   PaymentRefunded → JournalPosted(Refund, liability-first) → ObligationReinstated
 *
 * The amounts are computed ONCE here, from the current folds, and written into
 * the events; replay never recomputes them. The discharge is min(captured,
 * outstanding); the excess (a raced waiver) is absorbed by the Overpaid template
 * into refund-liability. A refund reinstates ONLY its dues-debiting portion, so
 * returning an overpayment never resurrects a settled debt.
 */
export function coordinationEffects(
  source: SettlementEventEnvelope,
  ctx: CoordinationContext,
): readonly CoordinationEffect[] {
  const stream = `${source.streamType}:${source.streamId}`;
  const sourceRef = { stream, seq: source.seq };
  const paymentId = source.streamId;

  if (source.type === "PaymentCaptured") {
    const captured = amountOf(source);
    if (captured === null) {
      return [];
    }
    const posting = buildCollectionPosting(
      ctx.caseId,
      ctx.teamId,
      ctx.method,
      captured,
      ctx.teamOutstanding,
    );
    const dischargeAmount = minPaise(captured, ctx.teamOutstanding);
    const effects: CoordinationEffect[] = [
      {
        commandId: collectionCommandId(stream, source.seq, "collection-posting"),
        event: {
          streamType: "journal",
          streamId: ctx.orgId,
          type: "JournalPosted",
          payload: {
            postingId: ctx.postingId,
            template: posting.template,
            legs: posting.legs.map((leg) => ({ ...leg })),
            source: sourceRef,
            memo: `Collection · case ${ctx.caseId} · team ${ctx.teamId}`,
          },
        },
      },
    ];
    if (dischargeAmount > 0) {
      effects.push({
        commandId: collectionCommandId(stream, source.seq, "collection-discharge"),
        event: {
          streamType: "case",
          streamId: ctx.caseId,
          type: "ObligationDischarged",
          payload: {
            teamId: ctx.teamId,
            amount: dischargeAmount,
            paymentId,
            postingRef: ctx.postingId,
          },
        },
      });
    }
    return effects;
  }

  if (source.type === "PaymentRefunded") {
    const refundAmount = amountOf(source);
    if (refundAmount === null) {
      return [];
    }
    const posting = buildRefundPosting(
      ctx.caseId,
      ctx.teamId,
      ctx.method,
      refundAmount,
      ctx.remainingLiability,
    );
    const reinstatement = refundReinstatement(posting, ctx.caseId, ctx.teamId);
    const effects: CoordinationEffect[] = [
      {
        commandId: collectionCommandId(stream, source.seq, "refund-posting"),
        event: {
          streamType: "journal",
          streamId: ctx.orgId,
          type: "JournalPosted",
          payload: {
            postingId: ctx.postingId,
            template: posting.template,
            legs: posting.legs.map((leg) => ({ ...leg })),
            source: sourceRef,
            memo: `Refund · case ${ctx.caseId} · team ${ctx.teamId}`,
          },
        },
      },
    ];
    if (reinstatement > 0) {
      effects.push({
        commandId: collectionCommandId(stream, source.seq, "refund-reinstate"),
        event: {
          streamType: "case",
          streamId: ctx.caseId,
          type: "ObligationReinstated",
          payload: {
            teamId: ctx.teamId,
            amount: reinstatement,
            paymentId,
            postingRef: ctx.postingId,
            compensates: source.seq,
          },
        },
      });
    }
    return effects;
  }

  return [];
}

function amountOf(event: SettlementEventEnvelope): number | null {
  const value = event.payload["amount"];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function minPaise(a: number, b: number): Paise {
  return paise(a <= b ? a : b);
}

// --- Wallet projections (the M-IP5-2 required set; all derived) ----------------------

export interface CollectionsSummary {
  /** What teams still owe: Σ dues balances. */
  readonly outstanding: number;
  /** Net cash on hand: Σ funds balances (gross received − refunded). */
  readonly collected: number;
  /** Over-collection awaiting refund. */
  readonly refundLiability: number;
  /** Cash free of any refund earmark: collected − refundLiability. */
  readonly available: number;
  /** Audited forgiveness: Σ waived balances. */
  readonly waived: number;
}

/**
 * The five required projections (§12, M-IP5-2), each a pure fold of the journal —
 * never a stored balance. Rebuild the journal and these are byte-identical.
 */
export function collectionsSummary(journal: JournalProjection): CollectionsSummary {
  let outstanding = paise(0);
  let collected = paise(0);
  let waived = paise(0);
  let refundLiability = paise(0);

  for (const [account, balance] of Object.entries(journal.accounts)) {
    const family = account.split(":")[0];
    if (family === "dues") {
      outstanding = addPaise(outstanding, net(balance.debits, balance.credits));
    } else if (family === "funds") {
      collected = addPaise(collected, net(balance.debits, balance.credits));
    } else if (family === "waived") {
      waived = addPaise(waived, net(balance.debits, balance.credits));
    } else if (account === "refund-liability") {
      refundLiability = addPaise(refundLiability, net(balance.credits, balance.debits));
    }
  }

  const availableResult = deductPaise(collected, refundLiability);
  return {
    outstanding,
    collected,
    refundLiability,
    available: availableResult.ok ? availableResult.value : 0,
    waived,
  };
}

function net(positive: number, negative: number): Paise {
  const result = deductPaise(paise(positive), paise(negative));
  return result.ok ? result.value : paise(0);
}
