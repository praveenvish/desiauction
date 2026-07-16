/**
 * Documents (IP-6, M-IP6-2; IP-6_ARCHITECTURE §10): quote derivation,
 * deterministic rendering, and the issuance decisions. Pure — no IO, no
 * ambient time, no randomness.
 *
 * THE CONSTITUTIONAL SHAPE: a document QUOTES settlement, it never computes.
 * Every monetary value below is read off a frozen settlement event or fold
 * (the quote builders take settlement ENVELOPES and fold them with the FROZEN
 * reducers); callers cannot supply amounts at all. Rendering is a pure
 * function of (settlement facts · profile at its pinned seq · series ·
 * issuance facts) to canonical bytes — re-rendering at any later date
 * reproduces the bytes or proves the document forged.
 *
 * No new event type exists here: issuance emits the foundation's frozen
 * `DocumentIssued` / `CorrectionIssued` shapes exactly (the dormant branches
 * this milestone was designed to awaken). The catalog stays closed at 23.
 */

import { canonicalJson } from "@desiauction/core";
import { replayCase, replayPayment, type SettlementEventEnvelope } from "@desiauction/settlement";

import type { FinopsDecision, FinopsNewEvent } from "./events";
import { replayProfile, type ProfileProjection } from "./profile";
import type { DocumentParty, SeriesKind, SeriesProjection } from "./series";
import type { FinopsEventEnvelope } from "./events";
import {
  fiscalYearOf,
  istDateOf,
  watermarkKey,
  canonicalWatermark,
  type Watermark,
} from "./watermark";

// --- Quotes: settlement facts, read off the frozen folds ------------------------------

export interface QuoteLine {
  readonly description: string;
  /** Integer paise, copied VERBATIM from the settlement event it names. */
  readonly amount: number;
  readonly provenance: { readonly stream: string; readonly seq: number };
}

/**
 * A quotation of one settlement fact, ready to issue: what the document says
 * (lines, total), what it stands on (source ref/seq/watermark key), and the
 * IST date of the fact (its fiscal home).
 */
export interface DocumentQuote {
  readonly kind: SeriesKind;
  readonly lines: readonly QuoteLine[];
  /** The quoted total — identical to the single source amount, never summed here. */
  readonly amount: number;
  /** Idempotency anchor: one settlement cause, one document per series. */
  readonly sourceRef: string;
  /** The watermark entry the source must be covered by. */
  readonly sourceKey: string;
  readonly sourceSeq: number;
  /** IST date of the settlement fact — decides the fiscal year it belongs to. */
  readonly sourceDate: string;
  readonly partyId: string;
  readonly caseId: string | null;
}

export type QuoteResult = { ok: true; quote: DocumentQuote } | { ok: false; reason: string };

const quoteFail = (reason: string): QuoteResult => ({ ok: false, reason });

/**
 * RECEIPT: quotes one captured payment. The amount is the PaymentCaptured
 * event's own figure; the frozen payment reducer must accept the stream first
 * (an unfoldable payment can never be receipted).
 */
export function receiptQuote(paymentEvents: readonly SettlementEventEnvelope[]): QuoteResult {
  const fold = replayPayment(paymentEvents);
  if (!fold.ok) {
    return quoteFail("source_unfoldable");
  }
  const payment = fold.projection;
  const capture = paymentEvents.find((event) => event.type === "PaymentCaptured");
  if (capture === undefined || payment.captured <= 0) {
    return quoteFail("payment_not_captured");
  }
  const amount = capture.payload["amount"];
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return quoteFail("source_unfoldable");
  }
  return {
    ok: true,
    quote: {
      kind: "receipt",
      lines: [
        {
          description: `Payment received — ${payment.method}`,
          amount,
          provenance: { stream: `payment:${payment.paymentId}`, seq: capture.seq },
        },
      ],
      amount,
      sourceRef: `payment:${payment.paymentId}:${String(capture.seq)}`,
      sourceKey: watermarkKey("payment", payment.paymentId),
      sourceSeq: capture.seq,
      sourceDate: istDateOf(capture.atMs),
      partyId: payment.teamId,
      caseId: payment.caseId,
    },
  };
}

/**
 * INVOICE: quotes one team's recognised dues on a case — the obligation as
 * COMPUTED (adjust never shipped; waivers and collections are settlement
 * facts a correction quotes later, never an edit to the demand).
 */
export function invoiceQuote(
  caseEvents: readonly SettlementEventEnvelope[],
  teamId: string,
): QuoteResult {
  const fold = replayCase(caseEvents);
  if (!fold.ok) {
    return quoteFail("source_unfoldable");
  }
  const obligation = fold.projection.obligations[teamId];
  const computed = caseEvents.find((event) => event.type === "ObligationsComputed");
  if (obligation === undefined || computed === undefined) {
    return quoteFail("obligation_unknown");
  }
  return {
    ok: true,
    quote: {
      kind: "tax-invoice",
      lines: [
        {
          description: "Auction dues",
          amount: obligation.amount,
          provenance: { stream: `case:${fold.projection.caseId}`, seq: computed.seq },
        },
      ],
      amount: obligation.amount,
      sourceRef: `case:${fold.projection.caseId}:${String(computed.seq)}:${teamId}`,
      sourceKey: watermarkKey("case", fold.projection.caseId),
      sourceSeq: computed.seq,
      sourceDate: istDateOf(computed.atMs),
      partyId: teamId,
      caseId: fold.projection.caseId,
    },
  };
}

/** The settlement event types a correction may lawfully quote as its cause. */
export const CORRECTION_CAUSES = ["PaymentRefunded", "ObligationWaived"] as const;

/**
 * CORRECTION: quotes one COMPENSATING settlement fact (a refund on a receipted
 * payment; a waiver on invoiced dues). The original document is referenced,
 * never touched.
 */
export function correctionQuote(
  causeEvents: readonly SettlementEventEnvelope[],
  causeSeq: number,
): QuoteResult {
  const cause = causeEvents.find((event) => event.seq === causeSeq);
  if (cause === undefined) {
    return quoteFail("cause_unknown");
  }
  if (!(CORRECTION_CAUSES as readonly string[]).includes(cause.type)) {
    return quoteFail("cause_not_compensating");
  }
  const amount = cause.payload["amount"];
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return quoteFail("source_unfoldable");
  }
  if (cause.streamType === "payment") {
    const fold = replayPayment(causeEvents);
    if (!fold.ok) {
      return quoteFail("source_unfoldable");
    }
    return {
      ok: true,
      quote: {
        kind: "correction",
        lines: [
          {
            description: "Payment refunded",
            amount,
            provenance: { stream: `payment:${cause.streamId}`, seq: cause.seq },
          },
        ],
        amount,
        sourceRef: `payment:${cause.streamId}:${String(cause.seq)}`,
        sourceKey: watermarkKey("payment", cause.streamId),
        sourceSeq: cause.seq,
        sourceDate: istDateOf(cause.atMs),
        partyId: fold.projection.teamId,
        caseId: fold.projection.caseId,
      },
    };
  }
  if (cause.streamType === "case") {
    const fold = replayCase(causeEvents);
    const teamId = cause.payload["teamId"];
    if (!fold.ok || typeof teamId !== "string" || teamId === "") {
      return quoteFail("source_unfoldable");
    }
    return {
      ok: true,
      quote: {
        kind: "correction",
        lines: [
          {
            description: "Dues waived",
            amount,
            provenance: { stream: `case:${cause.streamId}`, seq: cause.seq },
          },
        ],
        amount,
        sourceRef: `case:${cause.streamId}:${String(cause.seq)}:${teamId}`,
        sourceKey: watermarkKey("case", cause.streamId),
        sourceSeq: cause.seq,
        sourceDate: istDateOf(cause.atMs),
        partyId: teamId,
        caseId: cause.streamId,
      },
    };
  }
  return quoteFail("cause_not_compensating");
}

// --- Rendering: canonical, immutable, byte-identical after replay ----------------------

export interface RenderInputs {
  readonly docId: string;
  readonly number: number;
  readonly kind: SeriesKind;
  readonly series: { readonly seriesId: string; readonly prefix: string; readonly fy: string };
  readonly profile: {
    readonly seq: number;
    readonly legalName: string;
    readonly posture: string;
    readonly gstin: string | null;
  };
  readonly party: DocumentParty;
  readonly quote: DocumentQuote;
  readonly watermark: Watermark;
  readonly corrects: string | null;
  readonly reason: string | null;
}

/** `RCT/2026-27/000007` — dense, zero-padded, derived; never invented. */
export function formattedNumber(prefix: string, fy: string, number: number): string {
  return `${prefix}/${fy}/${String(number).padStart(6, "0")}`;
}

/**
 * THE CANONICAL PAYLOAD — sorted-key JSON of pure facts. Everything in it
 * derives from the frozen settlement events at the pinned provenance, the
 * profile at its pinned seq, the series descriptor, and the issuance facts
 * recorded in the event — so replaying those sources re-renders these exact
 * bytes, forever. No HTML, no PDF, no clock, no locale.
 */
export function renderDocumentPayload(inputs: RenderInputs): string {
  return canonicalJson({
    document: {
      docId: inputs.docId,
      kind: inputs.kind,
      number: inputs.number,
      formatted: formattedNumber(inputs.series.prefix, inputs.series.fy, inputs.number),
      date: inputs.quote.sourceDate,
      fy: inputs.series.fy,
    },
    issuer: {
      legalName: inputs.profile.legalName,
      posture: inputs.profile.posture,
      gstin: inputs.profile.gstin,
      profileSeq: inputs.profile.seq,
    },
    party: { type: inputs.party.type, id: inputs.party.id, label: inputs.party.label },
    lines: inputs.quote.lines.map((line) => ({
      description: line.description,
      amount: line.amount,
      provenance: line.provenance,
    })),
    totals: { amount: inputs.quote.amount },
    source: {
      sourceRef: inputs.quote.sourceRef,
      caseId: inputs.quote.caseId,
      watermark: canonicalWatermark(inputs.watermark),
    },
    corrects: inputs.corrects,
    reason: inputs.reason,
    series: { seriesId: inputs.series.seriesId, prefix: inputs.series.prefix },
  });
}

/** The profile AS IT STOOD at a pinned seq — a prefix fold, deterministic. */
export function profileAt(
  events: readonly FinopsEventEnvelope[],
  seq: number,
): ProfileProjection | null {
  const prefix = events.filter((event) => event.seq <= seq);
  if (prefix.length === 0) {
    return null;
  }
  const fold = replayProfile(prefix);
  return fold.ok ? fold.projection : null;
}

// --- Issuance decisions -----------------------------------------------------------------

export interface IssueDocumentInput {
  readonly docId: string;
  readonly party: DocumentParty;
  readonly quote: DocumentQuote;
  readonly profile: ProfileProjection;
  /** The profile stream's head seq — the pin the document stands on. */
  readonly profileSeq: number;
  /** The org's consumed settlement frontier at issuance. */
  readonly watermark: Watermark;
  /** Correction linkage (correction kind only). */
  readonly corrects?: string;
  readonly reason?: string;
}

const reject = (reason: string): FinopsDecision => ({ ok: false, reason });

/**
 * The one issuance decision (IssueReceipt / IssueInvoice / IssueCorrection are
 * this function under their quote builders). Validates — never computes:
 *
 *   series legality   the lane is open, owned by the org, and of the quote's kind
 *   fiscal legality   the SOURCE FACT's fiscal year is the series' year
 *   quote coverage    the follower has consumed through the quoted seq
 *   duplicates        one settlement cause, one document per series
 *   posture           a gst-registered issuer gets NO invoice until tax
 *                     decomposition is authorized (never a non-compliant document)
 *   numbering         number = issued-count + 1, derived from the fold
 *
 * and then renders the canonical payload and emits the FROZEN event shape.
 */
export function decideIssueDocument(
  series: SeriesProjection | null,
  input: IssueDocumentInput,
  digest: (bytes: string) => string,
): FinopsDecision {
  if (series === null) {
    return reject("series_missing");
  }
  if (series.status !== "open") {
    return reject("series_closed");
  }
  if (series.kind !== input.quote.kind) {
    return reject("series_kind_mismatch");
  }
  if (input.profile.orgId !== series.orgId) {
    return reject("profile_missing");
  }
  // A registered issuer's invoice must carry a lawful tax decomposition, and
  // computing one is NOT authorized in this milestone (CTO: no GST
  // calculations). Fail closed rather than emit a non-compliant document.
  if (input.quote.kind === "tax-invoice" && input.profile.posture !== "none") {
    return reject("tax_decomposition_not_available");
  }
  if (fiscalYearOf(input.quote.sourceDate) !== series.fy) {
    return reject("fiscal_year_mismatch");
  }
  // The document may only stand on history the org has actually consumed.
  if ((input.watermark[input.quote.sourceKey] ?? 0) < input.quote.sourceSeq) {
    return reject("watermark_behind_source");
  }
  if (series.documents.some((doc) => doc.sourceRef === input.quote.sourceRef)) {
    return reject("duplicate_document_source");
  }
  if (input.party.id !== input.quote.partyId) {
    return reject("party_mismatch");
  }
  const isCorrection = input.quote.kind === "correction";
  if (isCorrection && (input.corrects === undefined || input.corrects === "")) {
    return reject("corrects_required");
  }
  if (isCorrection && (input.reason === undefined || input.reason.trim() === "")) {
    return reject("reason_required");
  }

  const number = series.documents.length + 1;
  const watermark = canonicalWatermark(input.watermark);
  const payloadBytes = renderDocumentPayload({
    docId: input.docId,
    number,
    kind: series.kind,
    series: { seriesId: series.seriesId, prefix: series.prefix, fy: series.fy },
    profile: {
      seq: input.profileSeq,
      legalName: input.profile.legalName,
      posture: input.profile.posture,
      gstin: input.profile.gstin,
    },
    party: input.party,
    quote: input.quote,
    watermark,
    corrects: input.corrects ?? null,
    reason: input.reason ?? null,
  });

  const event: FinopsNewEvent = {
    streamType: "series",
    streamId: series.seriesId,
    type: isCorrection ? "CorrectionIssued" : "DocumentIssued",
    payload: {
      docId: input.docId,
      number,
      party: { type: input.party.type, id: input.party.id, label: input.party.label },
      lines: input.quote.lines.map((line) => ({
        description: line.description,
        amount: line.amount,
        provenance: line.provenance,
      })),
      amount: input.quote.amount,
      sourceRef: input.quote.sourceRef,
      profileSeq: input.profileSeq,
      watermark,
      // The digest of the canonical payload IS the document (ADR-9): the
      // bytes are re-derivable from the pinned sources forever, so the event
      // carries the digest, never a blob. The digest fn is injected (the
      // frozen DigestFn discipline) — the domain renders, the edge hashes.
      contentDigest: digest(payloadBytes),
      ...(isCorrection ? { corrects: input.corrects, reason: input.reason } : {}),
    },
  };
  return { ok: true, events: [event] };
}
