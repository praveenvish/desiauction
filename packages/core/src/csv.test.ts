import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves safe values unquoted", () => {
    expect(csvCell("Amit")).toBe("Amit");
    expect(csvCell("")).toBe("");
    expect(csvCell("123")).toBe("123");
  });

  it("quotes and escapes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralizes formula-injection cells (CWE-1236) while keeping numbers numeric", () => {
    // Attacks: prefixed with a quote so a spreadsheet treats them as text.
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
    expect(csvCell("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(csvCell("+cmd|'/c calc'")).toBe("'+cmd|'/c calc'");
    expect(csvCell("-2+3+cmd")).toBe("'-2+3+cmd");
    // Tab / CR leading chars are triggers too.
    expect(csvCell("\t=1")).toBe("'\t=1");
    // A `+`/`-` followed by non-digits IS a formula and is neutralized.
    expect(csvCell("+HYPERLINK(1)")).toBe("'+HYPERLINK(1)");
    // Genuine numbers are NOT touched (a `+91…` phone reads as a number, which
    // is not a formula — safe to leave, and it keeps numeric columns numeric).
    expect(csvCell("+919000000000")).toBe("+919000000000");
    expect(csvCell("-500")).toBe("-500");
    expect(csvCell("+3.5")).toBe("+3.5");
    expect(csvCell("42")).toBe("42");
  });
});

describe("toCsv", () => {
  it("serializes a header + rows with per-cell escaping", () => {
    const csv = toCsv(
      ["number", "name", "team"],
      [
        ["1", "Amit", "Alpha"],
        ["2", 'O"Brien, R', "Zeta, B"],
      ],
    );
    expect(csv).toBe('number,name,team\n1,Amit,Alpha\n2,"O""Brien, R","Zeta, B"');
  });

  it("emits just the header for no rows", () => {
    expect(toCsv(["a", "b"], [])).toBe("a,b");
  });
});
