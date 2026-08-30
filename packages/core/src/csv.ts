/**
 * Neutralize spreadsheet formula injection (CWE-1236, PRR P2/F23).
 *
 * A cell that opens with `=`, `+`, `-`, `@`, a tab or a carriage return is
 * interpreted as a FORMULA by Excel and Google Sheets when the exported CSV is
 * opened — so a player who registers under the name `=HYPERLINK("evil")` or
 * `@SUM(...)` runs code on the organizer's machine. Prefixing a single quote
 * makes the cell text (the quote is hidden by the spreadsheet). Genuine numbers
 * (`-500`, `+3.5`, `42`, and a digits-only `+919000000000`) are left alone: they
 * are not formulas and must stay numeric. A leading `+`/`-` that is NOT a plain
 * number (e.g. `+91-900...` with a separator, or `+cmd`) is neutralized.
 */
function neutralizeFormula(value: string): string {
  if (/^[=+\-@\t\r]/.test(value) && !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(value)) {
    return `'${value}`;
  }
  return value;
}

/**
 * CSV serialization primitive (Reporting platform). Pure, RFC-4180-ish: a cell
 * is quoted only when it contains a comma, double-quote, or newline; embedded
 * quotes are doubled. LF line endings. The counterpart to `registration-csv.ts`
 * (the parser) — one escaper for every export in the product, so the formula
 * neutralization lives here and covers all of them at once.
 */
export function csvCell(value: string): string {
  const safe = neutralizeFormula(value);
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Serialize a header row + data rows into a CSV document. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = rows.map((row) => row.map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\n");
}
