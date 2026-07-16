import {
  correctionQuote,
  fiscalYearOf,
  invoiceQuote,
  profileAt,
  receiptQuote,
  renderDocumentPayload,
  replaySeries,
  watermarkOf,
  type DocumentQuote,
  type DocumentRow,
  type FinopsEventEnvelope,
  type QuoteResult,
} from "..";

import type { FinopsDeps } from "./deps";
import { issueReceipt, type FinopsAck } from "./writer";

/**
 * Document reproduction and issuance operations (M-IP6-2).
 *
 * REPRODUCTION is the constitutional test made a runtime surface: re-derive
 * the canonical payload from nothing but the pinned sources — the settlement
 * events at the recorded provenance, the profile AS IT STOOD at the pinned
 * seq, the series descriptor, and the issuance event's own facts — and compare
 * its digest with the one sealed in the event. A match proves the document; a
 * mismatch proves a forgery. Projection rows are never inputs to this.
 */

export interface Reproduction {
  readonly ok: boolean;
  readonly reason?: string;
  /** The re-rendered canonical payload (present when derivable). */
  readonly payload?: string;
  readonly digest?: string;
  readonly pinnedDigest?: string;
  /** True only when the re-rendered digest equals the sealed one, byte for byte. */
  readonly matches?: boolean;
}

interface IssuanceFacts {
  readonly event: FinopsEventEnvelope;
  readonly docId: string;
  readonly number: number;
  readonly party: { type: string; id: string; label: string };
  readonly profileSeq: number;
  readonly sourceRef: string;
  readonly contentDigest: string;
  readonly corrects: string | null;
  readonly reason: string | null;
}

function issuanceFactsFor(
  events: readonly FinopsEventEnvelope[],
  docId: string,
): IssuanceFacts | null {
  for (const event of events) {
    if (
      (event.type === "DocumentIssued" || event.type === "CorrectionIssued") &&
      event.payload["docId"] === docId
    ) {
      const party = event.payload["party"] as { type: string; id: string; label: string };
      return {
        event,
        docId,
        number: event.payload["number"] as number,
        party,
        profileSeq: event.payload["profileSeq"] as number,
        sourceRef: event.payload["sourceRef"] as string,
        contentDigest: event.payload["contentDigest"] as string,
        corrects: typeof event.payload["corrects"] === "string" ? event.payload["corrects"] : null,
        reason: typeof event.payload["reason"] === "string" ? event.payload["reason"] : null,
      };
    }
  }
  return null;
}

/** Re-derive the quote from the FROZEN settlement streams via the sourceRef. */
async function requoteFromSource(
  deps: FinopsDeps,
  kind: "receipt" | "tax-invoice" | "correction",
  sourceRef: string,
): Promise<QuoteResult> {
  const parts = sourceRef.split(":");
  const streamType = parts[0] ?? "";
  const streamId = parts[1] ?? "";
  const seq = Number(parts[2] ?? "");
  if (
    (streamType !== "payment" && streamType !== "case") ||
    streamId === "" ||
    !Number.isInteger(seq)
  ) {
    return { ok: false, reason: "source_ref_malformed" };
  }
  const events = await deps.source.loadEventsFrom(streamType, streamId, 0);
  if (events.length === 0) {
    return { ok: false, reason: "source_unknown" };
  }
  if (kind === "receipt") {
    return receiptQuote(events);
  }
  if (kind === "tax-invoice") {
    const teamId = parts[3] ?? "";
    return invoiceQuote(events, teamId);
  }
  return correctionQuote(events, seq);
}

/**
 * Re-render a document from its pinned sources and verify byte-identity with
 * the sealed digest. This is how a challenged receipt is proven years later —
 * and how a forged monetary value is caught: the forger cannot make the
 * honest re-render agree with a dishonest figure.
 */
export async function reproduceDocument(deps: FinopsDeps, docId: string): Promise<Reproduction> {
  const row = await deps.store.loadDocument(docId);
  if (row === null) {
    return { ok: false, reason: "document_unknown" };
  }
  const seriesEvents = await deps.store.loadStream("series", row.seriesId);
  // Fold FIRST: an unfoldable series never yields "facts" — the reducer's
  // shape validation stands between the log and every read of it.
  const seriesFold = replaySeries(seriesEvents);
  if (!seriesFold.ok) {
    return { ok: false, reason: "series_unfoldable" };
  }
  const facts = issuanceFactsFor(seriesEvents, docId);
  if (facts === null) {
    return { ok: false, reason: "issuance_event_missing" };
  }
  const profileEvents = await deps.store.loadStream("profile", row.orgId);
  const profile = profileAt(profileEvents, facts.profileSeq);
  if (profile === null) {
    return { ok: false, reason: "profile_prefix_unfoldable" };
  }
  const quoted = await requoteFromSource(deps, seriesFold.projection.kind, facts.sourceRef);
  if (!quoted.ok) {
    return { ok: false, reason: `requote_failed:${quoted.reason}` };
  }
  const watermark = watermarkOf(facts.event.payload["watermark"]);
  if (watermark === null) {
    return { ok: false, reason: "watermark_malformed" };
  }
  const payload = renderDocumentPayload({
    docId,
    number: facts.number,
    kind: seriesFold.projection.kind,
    series: {
      seriesId: seriesFold.projection.seriesId,
      prefix: seriesFold.projection.prefix,
      fy: seriesFold.projection.fy,
    },
    profile: {
      seq: facts.profileSeq,
      legalName: profile.legalName,
      posture: profile.posture,
      gstin: profile.gstin,
    },
    party: facts.party,
    quote: quoted.quote,
    watermark,
    corrects: facts.corrects,
    reason: facts.reason,
  });
  const digest = deps.digest(payload);
  return {
    ok: true,
    payload,
    digest,
    pinnedDigest: facts.contentDigest,
    matches: digest === facts.contentDigest,
  };
}

// --- Receipt-due discovery and auto-issuance (profile.autoReceipt) ----------------------

export interface ReceiptCandidate {
  readonly paymentId: string;
  readonly caseId: string;
  readonly teamId: string;
}

/**
 * Captured payments with no receipt in ANY of the org's receipt series.
 * Discovery reads the settlement projection (verified upstream); the issuance
 * decision re-derives everything from the fold. This list is also the
 * COORDINATION CATCH-UP input: a crash between cursor advance and policy
 * effect leaves the payment here, and the next run re-derives the same
 * command id (§7 discipline).
 */
export async function receiptCandidates(
  deps: FinopsDeps,
  orgId: string,
): Promise<readonly ReceiptCandidate[]> {
  const captured = await deps.source.listCapturedPayments(orgId);
  if (captured.length === 0) {
    return [];
  }
  const issuedPayments = new Set<string>();
  for (const seriesId of await deps.store.listStreamIds(orgId, "series")) {
    const series = await deps.store.loadSeries(seriesId);
    if (series === null || series.kind !== "receipt") {
      continue;
    }
    for (const doc of await deps.store.loadDocuments(seriesId)) {
      const parts = (doc.sourceRef ?? "").split(":");
      if (parts[0] === "payment" && parts[1] !== undefined) {
        issuedPayments.add(parts[1]);
      }
    }
  }
  return captured.filter((payment) => !issuedPayments.has(payment.paymentId));
}

export interface AutoIssueResult {
  readonly issued: number;
  readonly skipped: readonly { paymentId: string; reason: string }[];
}

/**
 * The auto-receipt policy (§8.6): for every receipt-due capture, issue under
 * the DERIVED command id `settlement:payment:{id}:{captureSeq}:auto-receipt` —
 * re-running after any crash re-derives the identical command and the
 * duplicate returns its original ack. A candidate that cannot issue (no open
 * series for its fiscal year, unresolvable label) is SKIPPED and remains
 * visible in the IssuanceSnapshot — never a silent loss, never a block.
 */
export async function issueDueReceipts(deps: FinopsDeps, orgId: string): Promise<AutoIssueResult> {
  const profile = await deps.store.loadProfile(orgId);
  if (profile === null || !profile.autoReceipt) {
    return { issued: 0, skipped: [] };
  }
  const skipped: { paymentId: string; reason: string }[] = [];
  let issued = 0;
  for (const candidate of await receiptCandidates(deps, orgId)) {
    const events = await deps.source.loadEventsFrom("payment", candidate.paymentId, 0);
    const quoted = receiptQuote(events);
    if (!quoted.ok) {
      skipped.push({ paymentId: candidate.paymentId, reason: quoted.reason });
      continue;
    }
    const series = await seriesForQuote(deps, orgId, quoted.quote);
    if (series === null) {
      skipped.push({ paymentId: candidate.paymentId, reason: "no_open_receipt_series" });
      continue;
    }
    const ack: FinopsAck = await issueReceipt(
      deps,
      { kind: "system", orgId, source: "follower" },
      { seriesId: series, paymentId: candidate.paymentId },
      `settlement:payment:${candidate.paymentId}:${String(quoted.quote.sourceSeq)}:auto-receipt`,
    );
    if (ack.ok) {
      issued += ack.status === "accepted" ? 1 : 0;
    } else {
      skipped.push({ paymentId: candidate.paymentId, reason: ack.reason });
    }
  }
  return { issued, skipped };
}

async function seriesForQuote(
  deps: FinopsDeps,
  orgId: string,
  quote: DocumentQuote,
): Promise<string | null> {
  const series = await deps.store.loadSeriesFor(orgId, "receipt", fiscalYearOf(quote.sourceDate));
  return series !== null && series.status === "open" ? series.seriesId : null;
}

export type { DocumentRow };
