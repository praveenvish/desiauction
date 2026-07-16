/**
 * The DocumentSeries aggregate (IP-6_ARCHITECTURE §7/§8.2): one per
 * org · kind · fiscal year, one stream, one reducer. Pure.
 *
 * Dense statutory numbering IS the stream's total order: a document's number
 * must be exactly (documents issued so far) + 1, so a gap or a fork is
 * unrepresentable in a replayed projection (`number_gap`). Documents are
 * immutable at issue; corrections are NEW documents in a correction series
 * referencing the original (invariant 24) — nothing here can edit history.
 *
 * NO COMMAND SHIPS DocumentIssued/CorrectionIssued IN M-IP6-1 (the frozen
 * settlement ADR-3 discipline: the catalog and reducer are complete, the
 * command surface arrives with its milestone — M-IP6-2 documents). Every money
 * figure below is a QUOTATION validated for internal consistency with the
 * frozen kernel; nothing is calculated.
 */

import { addPaise, paise, type Paise } from "@desiauction/core";

import { money, num, obj, str, type FinopsEventEnvelope, type FinopsReplayFailure } from "./events";
import { isFiscalYear, watermarkAdvances, watermarkOf, type Watermark } from "./watermark";

export type SeriesKind = "receipt" | "tax-invoice" | "correction";

export const SERIES_KINDS: readonly SeriesKind[] = ["receipt", "tax-invoice", "correction"];

export function isSeriesKind(value: string): value is SeriesKind {
  return (SERIES_KINDS as readonly string[]).includes(value);
}

export type SeriesStatus = "open" | "closed";

export interface DocumentParty {
  readonly type: string;
  readonly id: string;
  /** Label SNAPSHOT at issue — documents stay readable after renames/erasure. */
  readonly label: string;
}

export interface DocumentProjection {
  readonly docId: string;
  readonly number: number;
  readonly kind: SeriesKind;
  readonly party: DocumentParty;
  /** The quoted total in integer paise — equals the kernel sum of its lines. */
  readonly amount: number;
  /** The correction target (correction series only). */
  readonly corrects: string | null;
  /** Idempotency anchor: the settlement fact this document testifies about. */
  readonly sourceRef: string | null;
  readonly profileSeq: number;
  readonly watermark: Watermark;
  readonly contentDigest: string;
  readonly issuedAtSeq: number;
  readonly issuedBy: string;
}

export interface SeriesProjection {
  seriesId: string;
  orgId: string;
  kind: SeriesKind;
  fy: string;
  prefix: string;
  status: SeriesStatus;
  documents: DocumentProjection[];
  /** The register digest sealed by SeriesClosed (null while open). */
  registerDigest: string | null;
  /** The last document watermark — later issues may never regress it. */
  lastWatermark: Watermark;
  recoveries: number;
  lastSeq: number;
  eventCount: number;
}

export type SeriesReplayResult = { ok: true; projection: SeriesProjection } | FinopsReplayFailure;

function partyOf(value: unknown): DocumentParty | null {
  const record = obj(value);
  if (record === null) {
    return null;
  }
  const type = str(record, "type");
  const id = str(record, "id");
  const label = str(record, "label");
  return type === null || id === null || label === null ? null : { type, id, label };
}

/** Quoted lines: description + non-negative paise + settlement provenance. */
function linesTotalOf(value: unknown): Paise | null {
  const lines = Array.isArray(value) ? value : null;
  if (lines === null || lines.length === 0) {
    return null;
  }
  let total = paise(0);
  for (const raw of lines) {
    const line = obj(raw);
    const amount = line === null ? null : money(line, "amount");
    const description = line === null ? null : str(line, "description");
    const provenance = line === null ? null : obj(line["provenance"]);
    const stream = provenance === null ? null : str(provenance, "stream");
    const seq = provenance === null ? null : num(provenance, "seq");
    if (amount === null || description === null || stream === null || seq === null) {
      return null;
    }
    total = addPaise(total, paise(amount));
  }
  return total;
}

/**
 * A tax block, when present, must RECOMPOSE exactly: taxable value plus every
 * quoted part equals the document total, in integer paise, kernel-verified
 * (ADR-6). This validates a quotation's internal consistency; it computes no
 * tax — no M-IP6-1 command emits one.
 */
function taxRecomposes(value: unknown, total: number): boolean {
  const tax = obj(value);
  if (tax === null) {
    return false;
  }
  const taxableValue = money(tax, "taxableValue");
  const ratePermille = num(tax, "ratePermille");
  if (taxableValue === null || ratePermille === null) {
    return false;
  }
  let sum = paise(taxableValue);
  for (const part of ["cgst", "sgst", "igst"]) {
    if (tax[part] !== undefined) {
      const amount = money(tax, part);
      if (amount === null) {
        return false;
      }
      sum = addPaise(sum, paise(amount));
    }
  }
  return sum === total;
}

interface IssueFacts {
  readonly docId: string;
  readonly number: number;
  readonly party: DocumentParty;
  readonly amount: number;
  readonly sourceRef: string | null;
  readonly profileSeq: number;
  readonly watermark: Watermark;
  readonly contentDigest: string;
}

function issueFactsOf(payload: Readonly<Record<string, unknown>>): IssueFacts | null {
  const docId = str(payload, "docId");
  const number = num(payload, "number");
  const party = partyOf(payload["party"]);
  const linesTotal = linesTotalOf(payload["lines"]);
  const amount = money(payload, "amount");
  const profileSeq = num(payload, "profileSeq");
  const watermark = watermarkOf(payload["watermark"]);
  const contentDigest = str(payload, "contentDigest");
  const sourceRef = payload["sourceRef"] === undefined ? null : str(payload, "sourceRef");
  if (
    docId === null ||
    number === null ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    party === null ||
    linesTotal === null ||
    amount === null ||
    amount !== linesTotal || // the quoted total must equal the kernel sum of its lines
    profileSeq === null ||
    !Number.isSafeInteger(profileSeq) ||
    profileSeq < 1 ||
    watermark === null ||
    contentDigest === null ||
    (payload["sourceRef"] !== undefined && sourceRef === null)
  ) {
    return null;
  }
  return { docId, number, party, amount, sourceRef, profileSeq, watermark, contentDigest };
}

export function replaySeries(events: readonly FinopsEventEnvelope[]): SeriesReplayResult {
  let projection: SeriesProjection | null = null;

  for (const event of events) {
    const fail = (reason: FinopsReplayFailure["reason"]): SeriesReplayResult => ({
      ok: false,
      atSeq: event.seq,
      reason,
    });

    if (projection === null) {
      if (event.seq !== 1) {
        return fail("sequence_gap");
      }
      if (event.type !== "SeriesOpened") {
        return fail("unknown_series");
      }
      const seriesId = str(event.payload, "seriesId");
      const orgId = str(event.payload, "orgId");
      const kindRaw = str(event.payload, "kind");
      const fy = str(event.payload, "fy");
      const prefix = str(event.payload, "prefix");
      if (
        seriesId === null ||
        seriesId !== event.streamId ||
        orgId === null ||
        kindRaw === null ||
        !isSeriesKind(kindRaw) ||
        fy === null ||
        !isFiscalYear(fy) ||
        prefix === null
      ) {
        return fail("malformed_series");
      }
      projection = {
        seriesId,
        orgId,
        kind: kindRaw,
        fy,
        prefix,
        status: "open",
        documents: [],
        registerDigest: null,
        lastWatermark: {},
        recoveries: 0,
        lastSeq: 1,
        eventCount: 1,
      };
      continue;
    }

    if (event.seq !== projection.lastSeq + 1) {
      return fail("sequence_gap");
    }
    const state = projection;

    switch (event.type) {
      case "SeriesOpened":
        return fail("illegal_replayed_transition");

      case "DocumentIssued":
      case "CorrectionIssued": {
        if (state.status !== "open") {
          return fail("illegal_replayed_transition");
        }
        // A correction series issues only corrections; document series only
        // documents — the statutory lanes never interleave.
        if (event.type === "CorrectionIssued" && state.kind !== "correction") {
          return fail("illegal_replayed_transition");
        }
        if (event.type === "DocumentIssued" && state.kind === "correction") {
          return fail("illegal_replayed_transition");
        }
        const facts = issueFactsOf(event.payload);
        if (facts === null) {
          return fail("malformed_document");
        }
        let corrects: string | null = null;
        if (event.type === "CorrectionIssued") {
          corrects = str(event.payload, "corrects");
          if (corrects === null || str(event.payload, "reason") === null) {
            return fail("malformed_document");
          }
        }
        if (
          event.payload["tax"] !== undefined &&
          !taxRecomposes(event.payload["tax"], facts.amount)
        ) {
          return fail("decomposition_mismatch");
        }
        // DENSE numbering: the number IS the issue order. A forged number —
        // ahead, behind, or repeated — cannot fold.
        if (facts.number !== state.documents.length + 1) {
          return fail("number_gap");
        }
        if (state.documents.some((doc) => doc.docId === facts.docId)) {
          return fail("malformed_document");
        }
        // One settlement cause, one document (per series) — a replayed policy
        // or duplicated command can never double-issue.
        if (
          facts.sourceRef !== null &&
          state.documents.some((doc) => doc.sourceRef === facts.sourceRef)
        ) {
          return fail("duplicate_document_source");
        }
        // A later document may never stand on LESS settlement history.
        if (!watermarkAdvances(state.lastWatermark, facts.watermark)) {
          return fail("watermark_regression");
        }
        state.documents.push({
          docId: facts.docId,
          number: facts.number,
          kind: state.kind,
          party: facts.party,
          amount: facts.amount,
          corrects,
          sourceRef: facts.sourceRef,
          profileSeq: facts.profileSeq,
          watermark: facts.watermark,
          contentDigest: facts.contentDigest,
          issuedAtSeq: event.seq,
          issuedBy: event.actor,
        });
        state.lastWatermark = facts.watermark;
        break;
      }

      case "SeriesClosed": {
        if (state.status !== "open") {
          return fail("illegal_replayed_transition");
        }
        const count = num(event.payload, "count");
        const registerDigest = str(event.payload, "registerDigest");
        if (count === null || registerDigest === null || count !== state.documents.length) {
          return fail("malformed_series");
        }
        state.status = "closed";
        state.registerDigest = registerDigest;
        break;
      }

      case "SeriesRecovered": {
        state.recoveries += 1;
        break;
      }

      default:
        return fail("unknown_event_type");
    }

    state.lastSeq = event.seq;
    state.eventCount += 1;
  }

  if (projection === null) {
    return { ok: false, atSeq: 0, reason: "unknown_series" };
  }
  return { ok: true, projection };
}
