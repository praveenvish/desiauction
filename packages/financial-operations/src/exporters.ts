/**
 * Export artifact builders (IP-6, M-IP6-3; IP-6_ARCHITECTURE §11). Pure —
 * no IO, no ambient time, no randomness.
 *
 * THE CONSTITUTIONAL SHAPE: an export SERIALIZES frozen document payloads —
 * the reproduced canonical bytes M-IP6-2 sealed — and copies their fields
 * VERBATIM. Nothing here calculates a financial value; the only "conversion"
 * is paise-to-decimal STRING formatting (digit manipulation for display
 * files, never arithmetic — money invariant 5). Every builder is
 * deterministic: the same inputs produce the same artifact bytes, forever,
 * which is what makes every export reproducible and every corruption
 * detectable by digest.
 */

import { canonicalJson, csvCell } from "@desiauction/core";

import type { ExportKind } from "./export-run";
import type { Watermark } from "./watermark";
import { canonicalWatermark } from "./watermark";

/** One document as an export sees it: register fields + the REPRODUCED bytes. */
export interface ExportDocument {
  readonly docId: string;
  readonly seriesId: string;
  readonly kind: string;
  readonly number: number;
  readonly formatted: string;
  readonly fy: string;
  readonly partyType: string;
  readonly partyId: string;
  readonly partyLabel: string;
  /** Quoted paise, copied verbatim from the register (which the fold vouches for). */
  readonly amount: number;
  readonly sourceRef: string;
  readonly contentDigest: string;
  /** The reproduced canonical payload — the document itself. */
  readonly payload: string;
}

export interface ExportSeriesMeta {
  readonly seriesId: string;
  readonly kind: string;
  readonly fy: string;
  readonly prefix: string;
  readonly status: string;
  readonly documentCount: number;
}

export interface ExportInputs {
  readonly exportId: string;
  readonly orgId: string;
  readonly kind: ExportKind;
  readonly params: Readonly<Record<string, unknown>>;
  readonly watermark: Watermark;
  readonly documents: readonly ExportDocument[];
  readonly series: readonly ExportSeriesMeta[];
}

export interface BuiltArtifact {
  readonly bytes: string;
  readonly rowCount: number;
  /** Filename extension the artifact store keys with. */
  readonly extension: string;
}

/**
 * Integer paise → decimal-rupee STRING by digit manipulation (never float
 * math): 4000000 → "40000.00". Display formatting for export files only.
 */
export function paiseToDecimalString(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new Error("unrepresentable_paise");
  }
  const digits = String(paise).padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

// PRR P2/F23: the finance register embeds user-controlled partyLabel/sourceRef.
// Route through the shared escaper from @desiauction/core so it gets the same
// spreadsheet-formula-injection neutralization as every other export, instead of
// this package quietly keeping the pre-fix quote-only logic.
const csvField = csvCell;

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sorted(documents: readonly ExportDocument[]): ExportDocument[] {
  return [...documents].sort((a, b) => a.seriesId.localeCompare(b.seriesId) || a.number - b.number);
}

/** The document register as CSV — one row per document, fields verbatim. */
function buildRegisterCsv(inputs: ExportInputs): BuiltArtifact {
  const header =
    "series_id,kind,number,formatted,fy,party_type,party_id,party_label,amount_paise,amount,source_ref,content_digest,doc_id";
  const rows = sorted(inputs.documents).map((doc) =>
    [
      doc.seriesId,
      doc.kind,
      String(doc.number),
      doc.formatted,
      doc.fy,
      doc.partyType,
      doc.partyId,
      csvField(doc.partyLabel),
      String(doc.amount),
      paiseToDecimalString(doc.amount),
      csvField(doc.sourceRef),
      doc.contentDigest,
      doc.docId,
    ].join(","),
  );
  return {
    bytes: [header, ...rows].join("\n") + "\n",
    rowCount: rows.length,
    extension: "csv",
  };
}

/**
 * Tally-importable voucher XML — receipts as Receipt vouchers, invoices as
 * Sales, corrections as Credit Notes. Amounts copied verbatim (paise) and
 * formatted for display; nothing is summed, split or derived.
 */
function buildTallyXml(inputs: ExportInputs): BuiltArtifact {
  const voucherType = (kind: string): string =>
    kind === "receipt" ? "Receipt" : kind === "tax-invoice" ? "Sales" : "Credit Note";
  const messages = sorted(inputs.documents).map((doc) =>
    [
      "  <TALLYMESSAGE>",
      `   <VOUCHER VCHTYPE="${voucherType(doc.kind)}" ACTION="Create">`,
      `    <VOUCHERNUMBER>${xmlEscape(doc.formatted)}</VOUCHERNUMBER>`,
      `    <PARTYLEDGERNAME>${xmlEscape(doc.partyLabel)}</PARTYLEDGERNAME>`,
      `    <AMOUNT>${paiseToDecimalString(doc.amount)}</AMOUNT>`,
      `    <NARRATION>${xmlEscape(`${doc.sourceRef} · ${doc.contentDigest}`)}</NARRATION>`,
      "   </VOUCHER>",
      "  </TALLYMESSAGE>",
    ].join("\n"),
  );
  const bytes = [
    "<ENVELOPE>",
    " <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>",
    " <BODY>",
    ...messages,
    " </BODY>",
    "</ENVELOPE>",
    "",
  ].join("\n");
  return { bytes, rowCount: inputs.documents.length, extension: "xml" };
}

/** GSTR-1-shaped data: tax-invoice payloads, verbatim. Zero tax computation. */
function buildGstr1Json(inputs: ExportInputs): BuiltArtifact {
  const invoices = sorted(inputs.documents).filter((doc) => doc.kind === "tax-invoice");
  const bytes = canonicalJson({
    export: { exportId: inputs.exportId, kind: "gstr1-json", params: inputs.params },
    watermark: canonicalWatermark(inputs.watermark),
    invoices: invoices.map((doc) => ({
      docId: doc.docId,
      formatted: doc.formatted,
      contentDigest: doc.contentDigest,
      payload: doc.payload,
    })),
  });
  return { bytes, rowCount: invoices.length, extension: "json" };
}

/** The evidence bundle: every document's reproduced bytes + its sealed digest. */
function buildBundle(inputs: ExportInputs, withSeries: boolean): BuiltArtifact {
  const documents = sorted(inputs.documents).map((doc) => ({
    docId: doc.docId,
    seriesId: doc.seriesId,
    kind: doc.kind,
    number: doc.number,
    formatted: doc.formatted,
    contentDigest: doc.contentDigest,
    payload: doc.payload,
  }));
  const bytes = canonicalJson({
    export: {
      exportId: inputs.exportId,
      orgId: inputs.orgId,
      kind: inputs.kind,
      params: inputs.params,
    },
    watermark: canonicalWatermark(inputs.watermark),
    documents,
    ...(withSeries
      ? {
          series: [...inputs.series]
            .sort((a, b) => a.seriesId.localeCompare(b.seriesId))
            .map((series) => ({ ...series })),
        }
      : {}),
  });
  return { bytes, rowCount: documents.length, extension: "json" };
}

/**
 * THE ONE BUILDER — deterministic per kind; an unknown kind is
 * unrepresentable (the closed ExportKind union).
 */
export function buildExportArtifact(inputs: ExportInputs): BuiltArtifact {
  switch (inputs.kind) {
    case "journal-csv":
      return buildRegisterCsv(inputs);
    case "tally-xml":
      return buildTallyXml(inputs);
    case "gstr1-json":
      return buildGstr1Json(inputs);
    case "audit-bundle":
      return buildBundle(inputs, false);
    case "archive-bundle":
      return buildBundle(inputs, true);
  }
}
