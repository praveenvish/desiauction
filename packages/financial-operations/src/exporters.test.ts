import { describe, expect, it } from "vitest";

import {
  buildExportArtifact,
  paiseToDecimalString,
  type ExportDocument,
  type ExportInputs,
} from "./exporters";

const DOC: ExportDocument = {
  docId: "01DOC000000000000000000001",
  seriesId: "01SER00000000000000000000A",
  kind: "receipt",
  number: 1,
  formatted: "RCT/2026-27/000001",
  fy: "2026-27",
  partyType: "team",
  partyId: "01TEAM0000000000000000000A",
  partyLabel: 'Tigers, "The" <XI>',
  amount: 4_000_000,
  sourceRef: "payment:01PAY00000000000000000001:2",
  contentDigest: "digest-1",
  payload: '{"document":{"docId":"01DOC000000000000000000001"}}',
};

function inputs(kind: ExportInputs["kind"], documents: ExportDocument[] = [DOC]): ExportInputs {
  return {
    exportId: "01EXP00000000000000000000A",
    orgId: "01ORG00000000000000000000A",
    kind,
    params: { fy: "2026-27" },
    watermark: { "journal:org": 9, "case:C": 7 },
    documents,
    series: [
      {
        seriesId: DOC.seriesId,
        kind: "receipt",
        fy: "2026-27",
        prefix: "RCT",
        status: "open",
        documentCount: documents.length,
      },
    ],
  };
}

describe("export artifact builders — serialization only, deterministic forever", () => {
  it("paiseToDecimalString is digit manipulation, never float math", () => {
    expect(paiseToDecimalString(4_000_000)).toBe("40000.00");
    expect(paiseToDecimalString(1)).toBe("0.01");
    expect(paiseToDecimalString(0)).toBe("0.00");
    expect(paiseToDecimalString(99)).toBe("0.99");
    expect(paiseToDecimalString(100)).toBe("1.00");
    expect(paiseToDecimalString(2_500_075)).toBe("25000.75");
    expect(() => paiseToDecimalString(-1)).toThrow("unrepresentable_paise");
    expect(() => paiseToDecimalString(0.5)).toThrow("unrepresentable_paise");
  });

  it("every kind builds byte-identical artifacts on repeated builds", () => {
    for (const kind of [
      "journal-csv",
      "tally-xml",
      "gstr1-json",
      "audit-bundle",
      "archive-bundle",
    ] as const) {
      const first = buildExportArtifact(inputs(kind));
      const second = buildExportArtifact(inputs(kind));
      expect(first.bytes).toBe(second.bytes);
      expect(first.rowCount).toBe(second.rowCount);
    }
  });

  it("document order is canonical: input order never changes the bytes", () => {
    const other: ExportDocument = { ...DOC, docId: "01DOC000000000000000000002", number: 2 };
    const forward = buildExportArtifact(inputs("audit-bundle", [DOC, other]));
    const reversed = buildExportArtifact(inputs("audit-bundle", [other, DOC]));
    expect(forward.bytes).toBe(reversed.bytes);
  });

  it("journal-csv copies fields verbatim and escapes hostile labels", () => {
    const built = buildExportArtifact(inputs("journal-csv"));
    expect(built.rowCount).toBe(1);
    expect(built.extension).toBe("csv");
    expect(built.bytes).toContain("4000000,40000.00");
    expect(built.bytes).toContain('"Tigers, ""The"" <XI>"');
    expect(built.bytes).toContain(DOC.contentDigest);
  });

  it("tally-xml maps kinds to voucher types and escapes XML", () => {
    const correction: ExportDocument = {
      ...DOC,
      docId: "01DOC000000000000000000003",
      kind: "correction",
      number: 2,
    };
    const built = buildExportArtifact(inputs("tally-xml", [DOC, correction]));
    expect(built.extension).toBe("xml");
    expect(built.bytes).toContain('VCHTYPE="Receipt"');
    expect(built.bytes).toContain('VCHTYPE="Credit Note"');
    expect(built.bytes).toContain("Tigers, &quot;The&quot; &lt;XI&gt;");
    expect(built.bytes).toContain("<AMOUNT>40000.00</AMOUNT>");
  });

  it("gstr1-json carries ONLY tax-invoice payloads, verbatim", () => {
    const invoice: ExportDocument = {
      ...DOC,
      docId: "01DOC000000000000000000004",
      kind: "tax-invoice",
    };
    const built = buildExportArtifact(inputs("gstr1-json", [DOC, invoice]));
    expect(built.rowCount).toBe(1);
    expect(built.bytes).toContain(invoice.docId);
    expect(built.bytes).not.toContain(`"${DOC.docId}"`);
  });

  it("bundles embed the REPRODUCED payload bytes and sealed digests", () => {
    const audit = buildExportArtifact(inputs("audit-bundle"));
    expect(audit.bytes).toContain(DOC.payload.replaceAll('"', '\\"'));
    expect(audit.bytes).toContain(DOC.contentDigest);
    const archive = buildExportArtifact(inputs("archive-bundle"));
    expect(archive.bytes).toContain('"series":');
    expect(archive.bytes).toContain('"prefix":"RCT"');
  });
});
