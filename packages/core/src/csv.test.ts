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
