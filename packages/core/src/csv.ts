/**
 * CSV serialization primitive (Reporting platform). Pure, RFC-4180-ish: a cell
 * is quoted only when it contains a comma, double-quote, or newline; embedded
 * quotes are doubled. LF line endings. The counterpart to `registration-csv.ts`
 * (the parser) — one escaper for every export in the product.
 */
export function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize a header row + data rows into a CSV document. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const lines = rows.map((row) => row.map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\n");
}
